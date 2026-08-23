# Design Decisions & Architecture Trade-offs

This document outlines key technical decisions, architectural trade-offs, and design rationales made during the development of the Gavel platform.

---

## 1. Real-time Communication Stack: Socket.IO vs. Native WebSockets

**Decision:** We chose **Socket.IO** over native WebSockets (`ws`).

### Rationale
- **Automatic Reconnection:** Live auctions require continuous connectivity. Socket.IO provides robust automatic reconnection out-of-the-box, ensuring users are seamlessly reconnected if they temporarily lose network coverage.
- **Room-Scoped Messaging:** Socket.IO's native concept of "Rooms" maps perfectly to auction rooms. Moving a socket to a room (`socket.join("room:" + code)`) allows us to broadcast events like bids and presence updates only to relevant users without maintaining complex manual mapping structures.
- **Heartbeats & Presence:** In-built ping/pong mechanism allows accurate and fast detection of socket disconnects, which drives our live connection status badges (the participant presence list).

---

## 2. Server-Authoritative Timer & Clock Sync

**Decision:** The item countdown timer is owned entirely by the server; the client only renders the countdown using the absolute deadline timestamp (`endsAt`).

### Rationale
- **Prevention of Cheat/Exploits:** If the countdown is client-driven, a malicious bidder could delay their local clock to submit bids after the timer should have expired. By storing `endsAt` on the server and executing the expiration on a server-owned `setTimeout`, cheating is eliminated.
- **Restoration Resiliency:** Because `endsAt` is stored as an absolute UTC date in MongoDB, a server crash or database disconnection does not reset the timer duration when the backend restarts. The server simply query active rooms and schedules the timer for `endsAt - now`.
- **Clock Drift Mitigation:** Bids are validated against the server's clock inside the conditional update (`endsAt: { $gt: new Date() }`), so a drifted client cannot buy itself extra time.

- **Offset correction:** drift protection would otherwise be one-directional. The server refuses late bids, but the *client* decides when to hide the bid form, so a client running fast would hide the input while the server was still accepting — the honest-user mirror of the cheat this design prevents. Both `room:state` and `item:activated` therefore carry the server's clock at send time, and the client subtracts the measured offset before rendering the countdown. Deadlines stay absolute and server-owned; only the local rendering of them is corrected.

---

## 3. Storage Strategy: MongoDB and Mongoose

**Decision:** **MongoDB** was selected as the database, and Mongoose for Object-Document Mapping (ODM).

### Rationale
- **Document Model Alignment:** Auction catalogs, participant lists, and bid histories are document-centric and map naturally to nested JSON documents.
- **Atomic Operations:** MongoDB's `findOneAndUpdate` supports conditional updates. This allowed us to implement lock-free concurrent bid validation and item status transitions directly at the database layer (preventing race conditions) without introducing complex distributed lock managers like Redis.

---

## 4. Authentication Architecture: Dual-Layer Auth

**Decision:** The application employs a two-tier identity structure:
1. **Global identity (JWT cookie):** Identifies the account across the app. Issued on register or login, stored as an HTTP-only cookie.
2. **Room authorization (`sessionToken`):** Issued on room creation or join. Determines the role — `admin` or `participant` — inside that specific room.

### Rationale
- **Decoupled Roles:** Room role is a property of membership, not of the account. The same user can host one room and bid in another without re-authenticating, and a role cannot leak between rooms.
- **Socket Handshake Security:** Socket.IO handshakes carry the `sessionToken`, which is matched against a participant record before the socket is allowed into a room channel. Session tokens are stripped from every participant list sent to clients.
- **Authorization lives with the room, not the cookie:** every privileged action — adding an item, starting the auction, resolving an item, placing a bid — is checked against the participant's role, not the JWT.

### Why the JWT travels two ways

The token is set as an HTTP-only cookie **and** returned in the login response for the client to send as `Authorization: Bearer`. That looks redundant; it is not.

The frontend is served from Vercel and the API from `live-auction-fhb9.onrender.com`. Those are different registrable domains, so from the browser's point of view the auth cookie is **third-party** — and third-party cookies are blocked by default in Chrome incognito, under Safari's Intelligent Tracking Prevention, and under Firefox's Enhanced Tracking Protection.

The failure mode this produced was instructive. Login itself succeeded, because the *response* was fine; only the `Set-Cookie` was dropped. The client stored the returned user and rendered a signed-in navbar, then every subsequent authenticated request arrived with no cookie and was correctly rejected with 401. The UI said "signed in as demo_fcc15e" while the API said "you must be signed in" — a contradiction that came entirely from trusting a response body over the actual session.

Two fixes were available:

1. **Serve both from one origin** — proxy the API under the frontend's domain so the cookie is first-party. Architecturally the right answer, and what I would do with more runway, but it changes the deployment topology.
2. **Add a bearer header** — carry the same JWT over a channel no cookie policy can block.

I took the second. The cookie is still set and still used when the browser allows it, so nothing is lost where third-party cookies work; the header is the fallback that makes the app usable everywhere.

**The cost, stated plainly:** a token readable by JavaScript is exposed to XSS in a way an HTTP-only cookie is not. That is a real downgrade, accepted because the alternative was an app that silently fails for any visitor with default privacy settings. The server is also now the authority on session validity — if `/auth/me` reports nobody signed in, the client discards its stored token rather than continuing to display an identity the API rejects.

### Where each layer applies
`POST /api/rooms` and `POST /api/rooms/:code/join` sit behind `requireAuth`, and take the username from the verified cookie only — never from the request body. Accepting a body-supplied name would let an unauthenticated caller enter a room under any identity, and since these two endpoints establish who a participant is for the entire auction, that is the one place identity must not be negotiable.

Room *reads* stay open on purpose: a room code is an invitation, and requiring an account to view a shared link would defeat sharing it. Neither read route returns a session token, so a code grants visibility, never control.

Everything inside a room — adding items, starting the auction, bidding, resolving — is authorized against the participant record, not the JWT. The token's `role` claim is an account-level default only and is deliberately never consulted for auction authority.

---

## 5. Anti-Snipe: Every Accepted Bid Restarts the Countdown

**Decision:** An accepted bid resets the item's deadline to a full `AUCTION_ITEM_DURATION_SECONDS` from the moment of acceptance, in the same atomic update that records the bid.

### Rationale
- **A fixed deadline rewards latency, not valuation.** With a hard cutoff, the winning strategy is to bid in the last possible instant, leaving no time for a counter-bid. The item then sells for less than someone was willing to pay, which is the wrong outcome for a host. Restarting the clock means an item only closes once nobody responds for a full window.
- **It costs nothing extra.** The reset rides along in the `$set` of the update that already claims the highest bid, so it inherits that update's atomicity. There is no second write to keep consistent.

### Trade-off
- **Extension is unbounded.** Two determined bidders can keep an item open indefinitely; there is no cap on total extensions and no shrinking window. A production auction would either cap total duration or reset to a shorter window than the opening one — 10-15 seconds is typical — so bidding converges.
- **It creates a race the fixed-deadline design does not have.** Extending a deadline means a timer that has already fired can be holding a stale view of the world. That is handled by requiring an elapsed deadline on the expiry path (see ARCHITECTURE.md, Concurrency §2), but it is complexity the simpler design would not have paid for.

---

## 6. Single-Process In-Memory Timers (Trade-off & Scaling)

**Decision:** Active room timers are kept in memory using a simple Map of `NodeJS.Timeout` IDs keyed by Room ID.

### Trade-off
- **Scaling Limit:** This design requires the WebSocket server to be single-instance. If we scale horizontally behind a load balancer, client connections would be split across instances, and the timer Map would be fragmented (e.g. Instance A would not be able to clear or modify a timer scheduled on Instance B).
- **Mitigation/Path Forward:** For high-throughput scaling, we would introduce a Redis-backed Adapter for Socket.IO events and move timer management to a distributed job scheduler (such as BullMQ) backed by Redis. However, for a single-node deployment, in-memory timers are extremely lightweight, zero-dependency, and offer microsecond performance.
