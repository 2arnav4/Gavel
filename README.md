# Gavel

A server-authoritative live auction platform. A host creates a private room, prepares a catalog, and runs the auction one item at a time. Bidders join with a room code and bid concurrently against a synchronized countdown. Every state transition is decided by the server and persisted to MongoDB, so a refresh, a disconnect, or a backend restart recovers the room rather than losing it.

![Auction room preview](main/preview.jpeg)

---

## Live Demo

- **App:** https://gavel-pied.vercel.app
- **API:** https://live-auction-fhb9.onrender.com

> The backend runs on Render's free tier and sleeps after roughly 15 minutes of inactivity. The first request after an idle period wakes it and can take up to a minute; the app shows an explanatory notice while it waits. Load the app once before demoing to warm it.

## Demo Credentials

| Account | Username | Password |
|---|---|---|
| Bidder | `demo` | `password123` |

Signing in as `demo` issues a unique alias (`demo_a1b2c3`) so the same credentials can drive several browser profiles at once without colliding. You can also register a normal account from the Sign Up tab.

Roles are per-room, not global: whoever creates a room is that room's host, and everyone who joins is a bidder. The same account can host one room and bid in another.

## Tech Stack

**Frontend** — React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, Socket.IO client, React Router
**Backend** — Node.js, Express 5, TypeScript, Mongoose, Socket.IO
**Database** — MongoDB (Atlas)
**Hosting** — Vercel (frontend), Render (backend)
**Testing** — Node.js native test runner

## Features

- **Rooms by code** — create a room, share a six-character code, join from anywhere.
- **Host and bidder roles** — assigned server-side at room creation or join and encoded in a room-scoped session token.
- **Catalog preparation** — the host adds items while the room is in the lobby; every connected client sees them appear live.
- **Minimum raise** — like an auctioneer's step, each room sets the smallest legal increase over the standing bid, so a one-rupee outbid cannot stall an item indefinitely. The opening bid is still the asking price exactly.
- **Bidder budgets** — every bidder starts with the same purse, set when the room is created. A bid cannot exceed what is left, and the winner is debited only when the sale is final, so the auction is a contest of allocation rather than of who types the biggest number.
- **Atomic concurrent bidding** — simultaneous bids are resolved by a single conditional MongoDB update, so exactly one can win.
- **Anti-snipe countdown** — an accepted bid restarts the item's countdown, so a last-second bid cannot win uncontested.
- **Server-owned timers** — deadlines are stored as absolute timestamps and rebuilt on boot, so a restart mid-auction resumes rather than resets. A one-second database sweep resolves any item whose timer was lost.
- **Ordered, resumable events** — every item event carries a version, so a client drops late duplicates and resyncs when it detects a gap.
- **Safe retries** — a bid names its item and carries a client id, so a bid queued across a reconnect cannot land on the next item, and a retried bid is never counted twice.
- **Presence** — live online/offline indicators, with stale flags cleared on startup.
- **Pause and resume** — the host can freeze the countdown mid-item; bidding closes at the database while paused and the clock restarts from the exact remainder.
- **Resolution** — the host can sell or mark unsold at any time; otherwise the timer resolves the item automatically.
- **Results** — a final summary of revenue, items sold, and winners.
- **Degraded mode** — if MongoDB is unreachable the API returns an explicit 503 and the client shows a retryable error instead of hanging.

## Architecture

Two entry points, one source of truth. A REST request and a socket event both
end at the same MongoDB documents, and neither layer holds authoritative state.

```mermaid
flowchart TB
  subgraph Client ["Browser"]
    UI["React 19 + Zustand"]
  end

  subgraph HTTP ["REST path — request/response"]
    direction TB
    RL["rateLimit()"] --> RT["routes/"]
    RT --> CT["controllers/<br/><i>thin: parse, delegate, respond</i>"]
    CT --> SV["services/<br/><i>validation + business rules</i>"]
  end

  subgraph WS ["Socket path — continuous"]
    direction TB
    AUTH["socketAuthMiddleware<br/><i>readHandshakeAuth → typed</i>"] --> HD["handlers/<br/>room · auction · bidding · resolution"]
  end

  subgraph Process ["In-process state"]
    TIMERS["Auction countdowns"]
    PRES["Presence tracker"]
    LIMIT["Bid rate limiter"]
  end

  DB[("MongoDB Atlas<br/>rooms · participants<br/>auctionitems · bids")]

  UI -->|"auth, rooms, items"| RL
  UI <-->|"bid:place, auction:*, item:*"| AUTH
  SV --> DB
  HD --> DB
  HD --- LIMIT
  HD --- PRES
  TIMERS -->|"on expiry"| HD
  HD -->|"io.to(room:CODE).emit"| UI
  CT -.->|"io.to(...).emit item:added"| UI
  DB -.->|"restoreAuctionTimers() on boot"| TIMERS
```

The dotted edges are the two places the layers cross. The REST item controller
reaches for `io` so a lobby catalog updates without a refetch, and the process
rebuilds its timers from `endsAt` on the documents at boot, because a restart
must not silently orphan a running auction.

Validation happens once, at whichever boundary the data arrives through:
`utils/validation.ts` for REST bodies, and the same guards re-used through
`socket/validation.ts` for the handshake. Nothing untrusted reaches a query.

REST handles anything request/response shaped — authentication, creating and joining rooms, adding catalog items, fetching results. Socket.IO handles everything continuous — presence, bids, item activation, resolution. MongoDB is the only source of truth; the socket layer broadcasts state, it does not own it.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the event map, concurrency control, and schema, [DECISIONS.md](DECISIONS.md) for the trade-offs behind these choices, and [SCALING.md](SCALING.md) for what breaks first under load.

## Realtime Design

Sockets authenticate during the handshake with the room-scoped `sessionToken` issued at create/join, and are joined to a `room:{CODE}` channel. The client never decides anything: it emits intent (`bid:place`, `item:sell`) and renders what the server broadcasts back.

Ordering matters for correctness in two places, both handled at the database rather than in application code:

- A bid is accepted by a conditional update requiring the item to still be active, still be within its deadline, and hold a lower current bid. Concurrent bids at the same amount cannot both match.
- An item is resolved by a conditional update requiring it to still be active, so a host clicking Sell at the same instant a timer expires produces exactly one outcome.

Full event table in [ARCHITECTURE.md](ARCHITECTURE.md).

## Database Schema

Five collections: `users` (global accounts), `rooms`, `participants` (per-room membership and role), `auctionitems`, `bids`. Diagram and field detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## Running Locally

**Prerequisites:** Node.js 18+, and MongoDB running locally or an Atlas connection string.

```bash
git clone https://github.com/2arnav4/Gavel.git
cd Gavel
```

**Backend**

```bash
cd backend
npm install
cp .env.example .env     # then edit MONGODB_URI and JWT_SECRET
npm run dev              # watch mode on http://localhost:3001
```

**Frontend** (in a second terminal)

```bash
cd frontend
npm install
cp .env.example .env
npm run dev              # http://localhost:5173
```

**Seed a demo room** (optional — creates a room with a prepared catalog and prints how to open it as the host)

```bash
cd backend && npm run seed
```

**Checks**

```bash
cd backend  && npm run lint && npm test    # typecheck, unit + concurrency tests
cd frontend && npm run lint && npm run build
```

The database tests run against a local MongoDB only (`MONGODB_URI` or `TEST_MONGODB_URI`, on localhost), in a separate `gavel_test` database. They refuse to start against a remote URI, and skip themselves if no local database is reachable. The multi-instance tests also need a local Redis, and skip without one.

## Environment Variables

**`backend/.env`**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3001` | HTTP port. Must be a positive integer. |
| `NODE_ENV` | no | `development` | `production` enables `Secure; SameSite=None` auth cookies, required for a cross-origin deployment. |
| `CLIENT_URL` | no | `http://localhost:5173` | Allowed CORS origins, comma-separated, so one backend can serve several deployed frontends. Whitespace and trailing slashes are ignored. In development `http://localhost:5173` is always permitted as well. |
| `MONGODB_URI` | no | `mongodb://localhost:27017/auction-room` | Connection string. Any database segment in the path is ignored — `MONGODB_DB_NAME` decides. |
| `MONGODB_DB_NAME` | no | `auction` | Database to use. Set explicitly because a connection string without a database segment silently resolves to `test`, which is how production data ends up somewhere nobody intended. |
| `AUCTION_ITEM_DURATION_SECONDS` | no | `60` | Countdown per item, and the amount an accepted bid restores it to. |
| `DEFAULT_STARTING_BUDGET` | no | `100000` | Purse each bidder starts with when a room does not specify one. |
| `DEFAULT_MIN_BID_INCREMENT` | no | `500` | Smallest legal raise over the standing bid when a room does not specify one. |
| `JWT_SECRET` | **yes in production** | dev-only fallback | Signing key. Startup fails if unset when `NODE_ENV=production`. |
| `REDIS_URL` | no | unset | **Off by default and not set in production.** When set, broadcasts, presence and rate limits are shared across instances through Redis. When unset, or when Redis is unreachable at startup, the server runs as a single instance. See [SCALING.md](SCALING.md). |

**Test-only variables** (read by `npm test`, never by the server)

| Variable | Default | Purpose |
|---|---|---|
| `TEST_MONGODB_URI` | `MONGODB_URI` | Database for the test suite. Must be on `localhost`, `127.0.0.1` or `::1`; the suite refuses to run against anything else. |
| `TEST_MONGODB_DB_NAME` | `gavel_test` | Database name for test fixtures, kept apart from the app's own. |
| `ALLOW_REMOTE_TEST_DB` | unset | Set to `true` to deliberately run the tests against a non-local database. |
| `TEST_REDIS_URL` | `redis://127.0.0.1:6379` | Local Redis for the multi-instance tests. They skip themselves if it is unreachable. |

**`frontend/.env`**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | no | `http://localhost:3001/api` | Backend base URL. A trailing `/api` is optional; the socket client strips it. |

## Deployment

The repository is a monorepo with no application at its root, so a platform that
autodetects the build from the repository root finds nothing to build. Two files
at the root make the backend deployable without any per-service dashboard
configuration:

- `package.json` — the only thing it does is delegate: `build` runs
  `npm ci --include=dev && npm run build` inside `backend/`, which gives the
  language detector something to recognise and forces the TypeScript devDependency
  to install even when `NODE_ENV=production` would otherwise skip it.
- `railway.json` — pins the start command to `node backend/server.js` (one process,
  so `SIGTERM` reaches the graceful-shutdown handler directly instead of passing
  through two `npm` wrappers), points the health check at `/health`, and limits
  rebuild triggers to `backend/**` so frontend commits do not redeploy the API.

`/health` answers `200` while Mongo is still connecting, reporting
`"status": "degraded"`, so a slow first database connection does not fail the
platform's health check and roll the deploy back.

The frontend deploys separately from `frontend/` on Vercel and is unaffected by
either file.

## API

All REST routes are mounted under `/api` and return JSON. Errors use `{ "error": "message" }`.

**Auth**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account and sign in. Password must be 8+ characters with upper, lower, digit, and symbol. |
| `POST` | `/api/auth/login` | Sign in and receive an HTTP-only JWT cookie. |
| `POST` | `/api/auth/logout` | Clear the auth cookie. |
| `GET` | `/api/auth/me` | Current user, or `{ "user": null }`. |

**Rooms**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create a room. **Requires auth.** The username comes from the cookie, not the body. Returns the room, the host participant, and a `sessionToken`. |
| `POST` | `/api/rooms/:code/join` | Join a room. **Requires auth.** Returns the room, the participant, and a `sessionToken`. |
| `GET` | `/api/rooms/:code` | Room details by code. Public. |
| `GET` | `/api/rooms/:code/results` | Resolved items for a finished auction. |

**Items**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms/:code/items` | Add a catalog item. Host only, lobby only. Requires the `x-session-token` header. |
| `GET` | `/api/rooms/:code/items` | List a room's catalog. |

**Health**

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Always 200 while the process is alive. Body reports `ready`, `database`, and `uptimeSeconds`. |

## Demo Flow

1. Sign in as `demo` / `password123`, create a room, and add two or three items.
2. In a second browser profile or incognito window, sign in as `demo` again and join with the room code. Both windows show the participant list updating live.
3. Click **Start Live Auction**. Both screens move to the auction board with a synchronized countdown.
4. Bid from the bidder window. The host window updates instantly; bids below the current highest are rejected with the required minimum. Each accepted bid restarts the countdown.
5. Click **Pause** on the host window. Both clocks freeze at the same second and the bidder's input is replaced by a paused notice; a bid attempted now is rejected with "Bidding is paused by the host." Click **Resume** and the countdown continues from exactly where it stopped.
6. Let the timer expire or resolve the item manually. The next item activates automatically.
7. When the catalog is exhausted every client is redirected to the results page.

To see the concurrency handling directly, open two bidder windows and submit the same amount at the same moment: exactly one is accepted and the other is told the new minimum.

## Known Limitations

- **Single instance in production.** Running more than one instance is supported in code: a database expiry sweep backs up the in-memory timers, and the Redis adapter, shared presence and shared rate limits switch on with `REDIS_URL`. It is not enabled, because Redis and a second instance cost money that one instance does not yet justify. Two instances would also need sticky sessions, and the startup presence reset briefly marks other instances' users offline. See [SCALING.md](SCALING.md).
- **Cold starts.** The free Render tier sleeps when idle; the first request can take up to a minute.
- **Room reads are deliberately public.** Anyone holding a room code can call `GET /api/rooms/:code` and `/results`. The code is the invitation, and requiring an account to view a shared link would defeat that. Neither route returns a session token, so a code grants visibility and never control. Every write is authorized.
- **Rate limiting is per-process unless Redis is enabled.** Login and registration share a fixed window per IP, and `bid:place` is capped per participant per second. Without `REDIS_URL` both counters live in the one Node process, so a restart hands everyone a fresh window.
- **Unbounded anti-snipe.** Every accepted bid restores the full countdown, so two determined bidders can keep an item open indefinitely — though the minimum raise means the price climbs every time they do, so it terminates once someone's purse runs out. A production auction would also cap total duration or reset to a shorter window.
- **Flat bid increment.** The minimum raise is a single figure per room. Real auctions use a tiered ladder that widens as the price climbs, so a ₹500 step is not still in force at ₹40,00,000.
- **Input is validated by hand, on purpose.** Every field is type-checked at the boundary it arrives through, REST and socket alike, but there is no schema library. A second declarative idiom alongside the existing tested guards would make the codebase harder to reason about, not easier, so adding one was considered and rejected. The cost is that the rules live in code rather than in one place.
- **Tests reach the transport but not the browser.** The conditional updates and the socket handlers are both tested against a real MongoDB and a real Socket.IO client, including handshake rejection, bid failure paths and the reconnect grace period. What is still manual is anything above the socket: React rendering, and the client-side reconnect behaviour under a genuinely flaky network.
- **The auth JWT is readable by JavaScript.** The API is on a different domain than the app, so its cookie is third-party and blocked by default in Chrome incognito and under Safari/Firefox tracking protection. The token is therefore also held client-side and sent as a bearer header, which trades HTTP-only protection for actually working. Serving both from one origin would remove the trade-off — see [DECISIONS.md](DECISIONS.md).
- **Logout does not kill a live socket.** Stateless JWT means no instant revocation: the cookie clears, but the token stays valid until expiry and an already-connected socket keeps working. `npm run rotate-sessions` invalidates every participant session when that actually matters.
- **An accepted bid is two writes, not a transaction.** The atomic claim on the item and the `Bid` log entry are separate. If the log write fails the price is still correct — the item is the source of truth — but that bid is missing from history.
- **Legacy password records verify once at their stored iteration count.** New accounts hash at 210,000 PBKDF2-SHA512 iterations. Anything older is verified at what it stored and re-hashed to the current count on the next successful login, so the weaker path survives exactly one login per account.
- **Demo accounts share one password.** `demo` / `password123` is a shared demo login that mints a distinct alias per sign-in. Convenient for a walkthrough, obviously not an authentication model.

## Future Improvements

- Enable the built multi-instance mode (Redis plus a second instance) once one instance is saturated — see [SCALING.md](SCALING.md) for the ordering and what breaks first.
- Fix the startup presence reset so it only clears this instance's own sockets.
- Team squads and per-category caps on top of the existing per-bidder budget.
- Bounded anti-snipe: cap total extensions, or reset to a shorter window than the opening one.
- Spectator (read-only) role.
- Chat and reactions in the auction room.

## License

MIT.
