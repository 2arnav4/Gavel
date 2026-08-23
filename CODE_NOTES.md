# Code Notes

Explanatory comments extracted from the source. Line numbers refer to the
file as it was before extraction; they mark roughly where each note applied.

## `backend/src/app.ts`

**line 18**

```
// Health stays unguarded so it can still report during a database outage.
```

## `backend/src/config/cors.ts`

**line 8**

```
// env.clientUrls is already trimmed and stripped of trailing slashes, so
```

**line 9**

```
// only the incoming origin needs normalizing before the comparison.
```

## `backend/src/config/db.ts`

**line 10**

```
// Fail a buffered query in 5s instead of Mongoose's 10s default, so requests
```

**line 11**

```
// that slip past the readiness guard surface an error quickly.
```

**line 47**

```
/**
 * Backfills purse fields onto documents written before budgets existed.
 *
 * `startingBudget` is required on the room schema, so a room created earlier
 * would fail validation the moment anything saved it — which is exactly what
 * starting its auction does. Adding a required field to a collection that
 * already has rows is a migration, not a schema edit.
 */
```

**line 84**

```
/**
 * Connects to MongoDB in the background, retrying with exponential backoff until
 * the first connection succeeds. Resolves once the database is usable.
 *
 * This never rejects and never exits the process: an unreachable database must
 * degrade the API, not prevent the HTTP server from binding its port. Mongoose
 * handles reconnection on its own after this initial connection is established,
 * so the retry loop only covers cold start.
 */
```

**line 102**

```
// Overrides any database segment in the URI, so the target is the same
```

**line 103**

```
// whichever connection string is supplied.
```

## `backend/src/config/env.ts`

**line 15**

```
// CLIENT_URL may name more than one origin, comma-separated, so a single
```

**line 16**

```
// backend can serve several deployed frontends. Trailing slashes are stripped
```

**line 17**

```
// here rather than at every comparison site.
```

**line 46**

```
// Set explicitly rather than inferred from the URI path. A connection string
```

**line 47**

```
// without a database segment makes Mongoose silently fall back to "test",
```

**line 48**

```
// which is how production data ends up somewhere nobody intended. Naming it
```

**line 49**

```
// here means the database is a property of the application, not of whatever
```

**line 50**

```
// string happens to be pasted into a hosting dashboard.
```

**line 53**

```
// Every bidder in a room starts with the same purse, so the auction is a
```

**line 54**

```
// contest of allocation rather than of who is willing to type the largest
```

**line 55**

```
// number. Overridable per room at creation.
```

**line 57**

```
// The smallest legal raise. Without one, a bidder can outbid by a rupee, which
```

**line 58**

```
// makes the countdown extension meaningless: an item can be held open forever
```

**line 59**

```
// by increments that never meaningfully change the price.
```

## `backend/src/controllers/authController.ts`

**line 16**

```
// 24 hours
```

**line 19**

```
// OWASP's current floor for PBKDF2-HMAC-SHA512. Stored alongside each hash so
```

**line 20**

```
// this can be raised later without locking existing users out.
```

**line 39**

```
/**
 * Compares in constant time. A plain `!==` on hex strings short-circuits at the
 * first differing character, so its runtime leaks how much of a guess was
 * correct — enough, over many attempts, to reconstruct a hash byte by byte.
 */
```

**line 51**

```
// timingSafeEqual throws on a length mismatch, which would itself be a signal.
```

**line 76**

```
/**
 * Validates credentials and sets an HTTP-only JWT cookie.
 *
 * `demo` / `password123` is a shared demo account: each sign-in mints a
 * distinct alias so the same credentials can drive several browser windows at
 * once. Everything else is a registered account with a verified password.
 *
 * The JWT carries a role only as an account-level default. Authority inside an
 * auction comes from the participant record created at room create/join, never
 * from this token.
 */
```

**line 105**

```
// Random rather than a counter: a counter lives in process memory, so a
```

**line 106**

```
// restart replays aliases and the next demo_1 collides with the demo_1
```

**line 107**

```
// already sitting in a room.
```

**line 114**

```
// Same message and roughly the same work whether or not the account
```

**line 115**

```
// exists, so this cannot be used to enumerate registered usernames.
```

**line 122**

```
// Sign JWT Token
```

**line 127**

```
// Set Cookie
```

**line 130**

```
// The token is returned as well as set as a cookie. The API and the frontend
```

**line 131**

```
// are on different registrable domains, so that cookie is third-party and is
```

**line 132**

```
// blocked by default in Chrome incognito and under Safari/Firefox tracking
```

**line 133**

```
// protection. Clients hold this and send it as a bearer header instead.
```

**line 144**

```
/**
 * Registers a new user and sets HTTP-only JWT cookie (auto-login).
 */
```

**line 159**

```
// Prevent registering with reserved names
```

**line 167**

```
// Validate password strength
```

**line 173**

```
// Check if user already exists
```

**line 184**

```
// Hash password
```

**line 188**

```
// Create user
```

**line 198**

```
// Auto-login (Sign JWT Token)
```

**line 204**

```
// Set Cookie
```

**line 217**

```
/**
 * Clears HTTP-only authentication cookie.
 */
```

**line 241**

```
/**
 * Checks active profile details from JWT cookie.
 */
```

**line 269**

```
// Invalid/Expired token -> clear cookie and return null
```

## `backend/src/controllers/healthController.ts`

**line 4**

```
/**
 * Liveness plus readiness.
 *
 * Always responds 200 so a platform health check treats the process as alive and
 * does not restart it during a database outage. Readiness is reported in the body
 * via `ready`, which is what a caller should branch on.
 */
```

## `backend/src/controllers/itemController.ts`

**line 5**

```
/**
 * Handles registering a new auction item.
 * POST /api/rooms/:code/items
 */
```

**line 23**

```
// Passed through untouched: Number(undefined) is NaN, which would report
```

**line 24**

```
// a missing field as an invalid one. The service decides what is valid.
```

**line 28**

```
// Retrieve global Socket.IO instance and broadcast event
```

**line 48**

```
/**
 * Handles fetching all auction items for a room.
 * GET /api/rooms/:code/items
 */
```

## `backend/src/controllers/roomController.ts`

**line 5**

```
/**
 * Handles room creation requests.
 * POST /api/rooms
 */
```

**line 16**

```
// requireAuth guarantees this; the body is deliberately not consulted.
```

**line 33**

```
/**
 * Handles requests for joining a room.
 * POST /api/rooms/:code/join
 */
```

**line 44**

```
// requireAuth guarantees this; the body is deliberately not consulted.
```

**line 53**

```
/**
 * Handles room lookup requests.
 * GET /api/rooms/:code
 */
```

**line 71**

```
/**
 * Handles fetching results for a room.
 * GET /api/rooms/:code/results
 */
```

## `backend/src/index.ts`

**line 16**

```
// Bind the port before touching MongoDB. The database is a runtime dependency,
```

**line 17**

```
// not a startup precondition: if it is unreachable the process must stay up and
```

**line 18**

```
// serve 503s rather than exit, which would fail the deploy outright.
```

**line 23**

```
// Timers for in-flight auctions live in memory, so they can only be rebuilt once
```

**line 24**

```
// the database is actually readable.
```

**line 27**

```
// Presence is tracked by an in-memory socket map but persisted on the
```

**line 28**

```
// participant. A restart loses the map, so any flag left set here describes a
```

**line 29**

```
// connection that no longer exists and would show that bidder as permanently
```

**line 30**

```
// online. Every live socket re-registers itself on the next room:connect.
```

## `backend/src/middleware/authMiddleware.ts`

**line 14**

```
/**
 * Reads the auth JWT from either transport.
 *
 * The cookie is preferred because it is HTTP-only and therefore not readable by
 * script. But the API is served from a different registrable domain than the
 * frontend, which makes that cookie third-party — and browsers increasingly
 * refuse to store or send those by default (Chrome incognito, Safari ITP,
 * Firefox ETP). Relying on the cookie alone means the app silently fails for
 * anyone with tracking protection on, so a bearer header is accepted as a
 * fallback. The proper fix is to serve both from one origin; this is the
 * portable one.
 */
```

**line 38**

```
/**
 * Required authentication. Rejects the request unless a valid JWT is present,
 * and makes the verified identity the only source of the username.
 *
 * Room creation and joining establish who a participant is for the entire
 * lifetime of an auction, so they must not accept a username supplied in the
 * request body: doing so lets an unauthenticated caller enter a room under any
 * name they choose.
 */
```

**line 70**

```
/**
 * Reads the room-scoped participant session token (issued on room create/join)
 * from request headers and attaches it to req.sessionToken. Does not verify
 * the token against a participant — the service layer looks it up and
 * enforces role checks, matching how every other room-scoped write is done.
 */
```

**line 81**

```
// Deliberately not falling back to the Authorization header: that now carries
```

**line 82**

```
// the account JWT, and treating one as the other would silently authorise the
```

**line 83**

```
// wrong thing. The room session token has its own dedicated header.
```

## `backend/src/middleware/requireDatabase.ts`

**line 5**

```
/**
 * Rejects API requests while the database is unreachable.
 *
 * Without this, requests made during a database outage sit in Mongoose's write
 * buffer until it times out, which reads to the client as a hung request. A
 * fast, explicit 503 lets the frontend show a real error state instead.
 */
```

## `backend/src/models/bidModel.ts`

**line 41**

```
// Only track creation time
```

**line 45**

```
// The bid log is read newest-first for one item on every room:connect and after
```

**line 46**

```
// every accepted bid, so it is the hottest read in the auction.
```

## `backend/src/models/itemModel.ts`

**line 12**

```
/** Mirrors the room's pause state so it can be enforced inside the bid claim. */
```

**line 76**

```
// Supports both the catalog listing and the conditional claim of the next
```

**line 77**

```
// pending item, which sorts by creation order while filtering on room and status.
```

## `backend/src/models/participantModel.ts`

**line 9**

```
/** Purse copied from the room at join time, so a later room edit cannot move it. */
```

**line 11**

```
/** Total won so far. Remaining purse is budget - spent. */
```

**line 67**

```
// Compound unique index so usernames are unique within a single room, regardless of case.
```

## `backend/src/models/roomModel.ts`

**line 7**

```
/** The purse every bidder in this room starts with. Fixed at creation. */
```

**line 9**

```
/** Smallest legal raise over the standing highest bid. Fixed at creation. */
```

**line 14**

```
/** True while the host has frozen the countdown for the active item. */
```

**line 16**

```
/** Milliseconds left on the active item at the moment it was paused. */
```

**line 73**

```
// Stored rather than recomputed: pausing clears endsAt, so the remaining
```

**line 74**

```
// time has nowhere else to live and must survive a restart.
```

## `backend/src/models/userModel.ts`

**line 8**

```
/** Stored per user so the work factor can be raised without invalidating existing passwords. */
```

**line 36**

```
// Accounts created before this field existed were hashed at 1,000 rounds.
```

## `backend/src/routes/itemRoutes.ts`

**line 8**

```
// mergeParams is enabled to read :code parameter defined in parent routes mounting path
```

## `backend/src/routes/roomRoutes.ts`

**line 12**

```
// Writes are authenticated: identity comes from the verified cookie only.
```

**line 16**

```
// Reads stay open. A room code is the invitation, and requiring an account to
```

**line 17**

```
// look up a room would break sharing a link before signing up. Neither route
```

**line 18**

```
// exposes a session token, so knowing a code grants visibility, never control.
```

## `backend/src/services/itemService.ts`

**line 11**

```
// Mirrored by the input limits on the lobby form. Enforced here as well because
```

**line 12**

```
// a maxLength attribute stops a typo, not a crafted request.
```

**line 16**

```
/**
 * Creates an auction item in the database.
 * Only the room admin can add items, and only before the auction starts (status: 'lobby').
 */
```

**line 36**

```
// 1. Find Room
```

**line 42**

```
// 2. Validate Room status
```

**line 47**

```
// 3. Find Participant and validate role
```

**line 59**

```
// 4. Create and Save Auction Item
```

**line 65**

```
// Zero, not startingBid: currentBid means "the highest bid actually placed".
```

**line 66**

```
// Seeding it with the asking price would make the first valid bid one rupee
```

**line 67**

```
// above the advertised figure, so nobody could open at the listed price.
```

**line 76**

```
/**
 * Returns all auction items registered in a room.
 */
```

## `backend/src/services/roomService.ts`

**line 19**

```
/**
 * Creates an auction room and sets the creator as the admin participant.
 */
```

**line 46**

```
// 1. Generate unique room code
```

**line 49**

```
// 2. Create the room
```

**line 59**

```
// 3. Create the admin participant. The host is given a purse too so the
```

**line 60**

```
// record is uniform, but it is never spent — hosts cannot bid.
```

**line 73**

```
// 4. Link admin participant id to the room
```

**line 84**

```
/**
 * Adds a participant to an existing auction room if name is not taken.
 */
```

**line 91**

```
// 1. Find room
```

**line 103**

```
// 2. Verify that username is not already taken in this room.
```

**line 112**

```
// 3. Create participant
```

**line 120**

```
// Copied, not referenced: a bidder's purse is fixed at the moment they join.
```

**line 125**

```
// The check above is a read-then-write race: two joins claiming the same name
```

**line 126**

```
// can both pass it. The compound unique index is the real guard, so translate
```

**line 127**

```
// its duplicate-key error into the message the pre-check would have produced
```

**line 128**

```
// rather than letting a generic conflict reach the client.
```

**line 145**

```
/**
 * Retrieves public room details by room code.
 */
```

**line 158**

```
/**
 * Retrieves resolved auction items (sold/unsold) for results presentation.
 */
```

**line 168**

```
// Retrieve items that are resolved (sold or unsold)
```

## `backend/src/socket/handlers/auctionHandler.ts`

**line 8**

```
/** Resolves the host's room, or emits the reason it cannot act. */
```

**line 31**

```
/**
 * Registers Auction-related event listeners for a given Socket instance.
 */
```

**line 35**

```
// Event: auction:start
```

**line 46**

```
// 1. Verify user is admin
```

**line 52**

```
// 2. Fetch fresh Room document and verify status
```

**line 64**

```
// 3. Select first pending item
```

**line 79**

```
// 4. Update item status to active
```

**line 84**

```
// 5. Update room status to live and link currentItemId
```

**line 90**

```
// Keep cached room reference inside socket.data in sync
```

**line 97**

```
// 6. Broadcast event: auction:started
```

**line 102**

```
// 7. Broadcast event: item:activated
```

**line 116**

```
// Event: auction:pause — freeze the countdown on the active item.
```

**line 122**

```
// Claim the pause atomically. Two rapid clicks, or two host tabs, cannot
```

**line 123**

```
// both succeed, so the remaining time is only ever computed once.
```

**line 124**

```
//
```

**line 125**

```
// `new: false` returns the document as it was at the instant of the swap,
```

**line 126**

```
// which is the only trustworthy source for the deadline: reading endsAt
```

**line 127**

```
// separately could observe a value a concurrent bid had already extended.
```

**line 164**

```
// Event: auction:resume — restore the countdown from where it stopped.
```

**line 175**

```
// Fall back to a full window if the stored remainder is missing, so a
```

**line 176**

```
// corrupted pause can never strand an item with no deadline at all.
```

## `backend/src/socket/handlers/biddingHandler.ts`

**line 13**

```
/**
 * Registers Bidding-related event listeners for a given Socket instance.
 */
```

**line 17**

```
// Event: bid:place
```

**line 41**

```
// Query database to fetch fresh status and currentItemId
```

**line 51**

```
// 1. Verify user is a participant (Admins/Hosts cannot bid)
```

**line 63**

```
// 2. Fetch latest active item details
```

**line 98**

```
// 3a. Budget. Read fresh rather than trusting socket.data, which is a
```

**line 99**

```
// snapshot from the handshake and predates every item won since.
```

**line 100**

```
//
```

**line 101**

```
// Checked here rather than inside the atomic claim because the claim
```

**line 102**

```
// operates on the item, not the participant. That is safe only because
```

**line 103**

```
// exactly one item is live at a time, so a bidder can hold at most one
```

**line 104**

```
// outstanding commitment: `spent` cannot move between this check and the
```

**line 105**

```
// claim except by an item resolving, which would fail the claim anyway.
```

**line 106**

```
// Bidding on several items at once would need a conditional decrement on
```

**line 107**

```
// the participant instead.
```

**line 123**

```
// 3b. Validate bid amount. The first bid may match the asking price
```

**line 124**

```
// exactly; every later bid must clear the room's minimum increment.
```

**line 138**

```
// 4. Claim the highest bid atomically before writing anything.
```

**line 139**

```
//
```

**line 140**

```
// Only one concurrent request can match `currentBid: { $lt: amount }`, so
```

**line 141**

```
// the losers never write at all. Persisting the bid first and deleting it
```

**line 142**

```
// on failure — the previous approach — left a rejected bid briefly visible
```

**line 143**

```
// to any concurrent room:connect reading the log, and orphaned it forever
```

**line 144**

```
// if the process died between the write and the compensating delete.
```

**line 145**

```
//
```

**line 146**

```
// The same update extends the deadline: an accepted bid restarts the
```

**line 147**

```
// countdown so a last-second snipe cannot end the item uncontested.
```

**line 154**

```
// Enforced here and not only in the check above: a pause landing
```

**line 155**

```
// between that read and this update would otherwise let one bid
```

**line 156**

```
// through after the countdown had visibly stopped for everyone.
```

**line 159**

```
// The price floor is expressed against the document's own fields
```

**line 160**

```
// rather than against the values read a moment ago. A plain
```

**line 161**

```
// `currentBid: { $lt: amount }` would compare correctly but enforce
```

**line 162**

```
// the wrong rule: it permits a one-rupee raise. Computing the floor
```

**line 163**

```
// inside the query means a bid that was legal when it was validated
```

**line 164**

```
// is re-checked against whatever the current price actually is.
```

**line 167**

```
// No bids yet: the asking price is the floor, unmodified. Adding
```

**line 168**

```
// an increment here would mean the advertised price was never
```

**line 169**

```
// actually available to anyone.
```

**line 204**

```
// 5. The claim succeeded, so this bid is now the authoritative highest and
```

**line 205**

```
// can safely be appended to the immutable log.
```

**line 215**

```
// Reset Room endsAt and reschedule the authoritative server-owned timer
```

**line 223**

```
// 6. Broadcast successful bid
```

## `backend/src/socket/handlers/resolutionHandler.ts`

**line 18**

```
/** Schedule an authoritative expiry for the active item in a room. */
```

**line 30**

```
/** Recreate timers after a backend restart from the persisted room state. */
```

**line 38**

```
// A paused room has no deadline to run down. It stays frozen until the host
```

**line 39**

```
// resumes, which is what re-arms its timer.
```

**line 80**

```
// Clearing the pause here matters: an item can be sold while frozen, and the
```

**line 81**

```
// next item must not inherit a paused room it knows nothing about.
```

**line 121**

```
// Claim the active item conditionally. Only one simultaneous resolution can win.
```

**line 124**

```
// An expiry must also prove the deadline has actually passed. A bid accepted
```

**line 125**

```
// moments before expiry pushes endsAt into the future and reschedules the
```

**line 126**

```
// timer, but clearTimeout cannot recall a callback that has already fired and
```

**line 127**

```
// is awaiting its database reads. Without this condition that stale callback
```

**line 128**

```
// still matches on status alone and ends an item that was just extended,
```

**line 129**

```
// cutting the countdown the extension was meant to protect. Host-initiated
```

**line 130**

```
// resolutions stay unconditional: selling early is the whole point.
```

**line 142**

```
// Charge the winner only once the sale is final. Committing at bid time would
```

**line 143**

```
// mean refunding every outbid participant, and a refund that fails leaves the
```

**line 144**

```
// purse wrong; charging at resolution has exactly one writer per item.
```

**line 167**

```
// The expiry did not claim the item. Either it was already resolved, or its
```

**line 168**

```
// deadline moved into the future between this callback firing and its update.
```

**line 169**

```
// In that second case an item would otherwise be left active with no timer
```

**line 170**

```
// owning it, so re-arm from the persisted deadline. This also covers a timer
```

**line 171**

```
// that fires a fraction early, where the elapsed-deadline check would fail.
```

## `backend/src/socket/handlers/roomHandler.ts`

**line 9**

```
/**
 * Registers Room-related event listeners for a given Socket instance.
 */
```

**line 13**

```
// Event: room:connect
```

**line 24**

```
// Fetch fresh room status and currentItemId from database
```

**line 34**

```
// Join the Socket.IO room channel
```

**line 48**

```
// Retrieve all participants of this room
```

**line 50**

```
// Hide sensitive session tokens
```

**line 53**

```
// Fetch currently active item details and its bids if room is live
```

**line 65**

```
// Emit room:state to the current client. serverTime lets the client measure
```

**line 66**

```
// its own clock offset, so a countdown derived from an absolute deadline
```

**line 67**

```
// stays correct even on a machine whose clock is wrong.
```

**line 77**

```
// Broadcast participant:joined to other clients in the room
```

**line 78**

```
// To hide session token, construct clean participant object
```

**line 101**

```
// Event: disconnect
```

**line 121**

```
// Broadcast participant:left to other clients in the room
```

## `backend/src/socket/index.ts`

**line 15**

```
// Apply authentication middleware to incoming connections
```

**line 18**

```
// Listen for socket connections and register event handlers
```

**line 26**

```
// Timer restoration is driven from the entry point once MongoDB is connected.
```

## `backend/src/socket/middleware/auth.ts`

**line 6**

```
/**
 * Middleware to authenticate and authorize a Socket.IO connection.
 * Validates that the session token exists and matches the specified room.
 */
```

**line 15**

```
// Mirror the REST readiness guard. Without this, a participant lookup during
```

**line 16**

```
// a database outage sits in Mongoose's buffer until it times out and then
```

**line 17**

```
// surfaces as an authentication failure, which tells the user the wrong story.
```

**line 31**

```
// 1. Find participant by sessionToken
```

**line 37**

```
// 2. Find room by roomCode
```

**line 43**

```
// Attach validated details to the socket metadata block
```

## `backend/src/utils/auction.ts`

**line 15**

```
/**
 * The smallest amount that can currently be bid on an item.
 *
 * The opening bid is the asking price exactly — an increment on top of it would
 * mean the advertised price was never actually available. Every raise after that
 * must clear the room's increment, so bidding converges instead of crawling up a
 * rupee at a time while the countdown keeps resetting.
 *
 * Shared by the server's validation and the client's display so the two can
 * never disagree about what is legal.
 */
```

## `backend/src/utils/auctionConcurrencyTest.ts`

**line 9**

```
/**
 * Integration tests for the concurrency control the auction depends on.
 *
 * These exercise the exact conditional updates used by the bid and resolution
 * handlers, against a real MongoDB, because that is where the correctness lives:
 * the guarantees come from the query filters, not from application logic, so a
 * test with a mocked model would prove nothing.
 *
 * Requires a reachable MONGODB_URI. If there is none, every test is skipped
 * rather than failed, so `npm test` still passes in an environment without a
 * database.
 */
```

**line 65**

```
/** The bid handler's claim, in full. */
```

**line 86**

```
/** The host's pause claim, in full. */
```

**line 164**

```
// Two bidders both saw ₹1,000 and both compute ₹1,100 as legal. Only one can
```

**line 165**

```
// win; the loser's amount is no longer a full increment above the new price,
```

**line 166**

```
// so it must fail rather than sneak through on a stale comparison.
```

**line 200**

```
// The item's deadline has already been pushed into the future by an accepted
```

**line 201**

```
// bid. A timer callback fired for the previous deadline is now in flight and
```

**line 202**

```
// cannot be cancelled, so it must fail to claim the item.
```

**line 262**

```
// endsAt is null while paused, and null never satisfies $lte against a date,
```

**line 263**

```
// so an expiry cannot claim a frozen item however long the pause lasts.
```

**line 294**

```
// Both a host sell and a timer expiry fire at the same instant. Only the one
```

**line 295**

```
// that claims the item may charge the winner.
```

## `backend/src/utils/codeGenerator.ts`

**line 3**

```
/**
 * Generates a random 6-character uppercase alphanumeric room code.
 */
```

**line 15**

```
/**
 * Generates a unique 6-character room code by verifying uniqueness in the database.
 */
```

## `backend/src/utils/seed.ts`

**line 9**

```
/**
 * Creates a demo room with a prepared catalog so a walkthrough does not begin
 * with several minutes of typing item names.
 *
 * Writes straight to MongoDB rather than going through the API, because the
 * host's room session token is issued at creation and is the one thing the
 * script needs to hand back — the REST client would keep it in a cookie jar
 * that the browser cannot read.
 *
 * Run with: npm run seed
 */
```

**line 51**

```
// Deliberately below the ₹85,000 catalog total. A purse that covers
```

**line 52**

```
// everything removes the only interesting decision in the auction; at this
```

**line 53**

```
// level a bidder can take the Rolex and one other lot, or spread across
```

**line 54**

```
// three, but not have all four.
```

**line 56**

```
// Large enough that raises move the price visibly rather than crawling.
```

## `backend/src/utils/validation.ts`

**line 3**

```
/**
 * Request-boundary validation for text fields.
 *
 * `value?.trim()` reads like a guard but only covers `null` and `undefined`. A
 * number, object, array or boolean sails past optional chaining, reaches
 * `.trim()`, throws a TypeError, and surfaces to the client as a 500 — a
 * malformed request reported as a server fault. Anything arriving as JSON can
 * be any JSON type, so the type has to be checked before the value is used.
 */
```

**line 13**

```
/** Requires a non-empty string. Returns it trimmed. */
```

**line 20**

```
// Absent and wrong-typed are reported the same way on purpose: from the
```

**line 21**

```
// client's side both mean "this field was not supplied correctly", and
```

**line 22**

```
// distinguishing them only helps someone probing the shape of the API.
```

**line 37**

```
/** Allows the field to be omitted, but rejects a supplied non-string. */
```

**line 57**

```
/**
 * Requires a finite positive number, accepting the numeric strings that arrive
 * from form inputs. Rejects NaN and Infinity, which `> 0` alone would let
 * through in the Infinity case.
 */
```

## `backend/src/utils/validationTest.ts`

**line 6**

```
/**
 * These exist because `value?.trim()` passed review as a guard and was not one.
 * Every case below returned a 500 before the boundary was introduced.
 */
```

## `frontend/src/hooks/useSocket.ts`

**line 14**

```
/** Manages one room-scoped socket and applies server-authoritative state updates. */
```

**line 23**

```
// serverTime minus the local clock at the moment a server message arrived.
```

**line 24**

```
// Deadlines are absolute server timestamps, so counting down against an
```

**line 25**

```
// uncorrected local clock would drift by however wrong that clock is.
```

**line 59**

```
// Merge rather than replace: a concurrent item:added event can never be lost.
```

**line 83**

```
// startedAt is the server's clock at activation, so it re-measures the
```

**line 84**

```
// offset on every item without needing a separate round trip.
```

**line 100**

```
// Clearing endsAt is what freezes the countdown: the client renders the
```

**line 101**

```
// stored remainder instead of counting down to an absolute deadline.
```

**line 116**

```
// The winner's purse changed as part of the sale, so patch it here rather
```

**line 117**

```
// than waiting for the next full state sync.
```

**line 169**

```
// Deliberately not disconnecting. Moving from the lobby to the auction
```

**line 170**

```
// unmounts this hook and immediately remounts it for the same room, and a
```

**line 171**

```
// teardown in between makes every other client watch that participant go
```

**line 172**

```
// offline and back online. connectSocket only replaces the socket when the
```

**line 173**

```
// room or participant actually changes, and the Leave Room handlers
```

**line 174**

```
// disconnect explicitly.
```

## `frontend/src/services/api.ts`

**line 7**

```
// A free-tier host spins the server down when idle, and the next request pays
```

**line 8**

```
// the cold start. Allow for that before declaring the backend unreachable.
```

**line 11**

```
/**
 * The backend could not be reached at all, or reached but is not healthy.
 *
 * Distinct from a normal failed response: "nobody is logged in" is an expected
 * outcome, whereas this means the app cannot function and should say so.
 */
```

**line 45**

```
/** Purse fixed at join time. Remaining is budget - spent. */
```

**line 67**

```
/** Present on login/register only; mirrored into the session store. */
```

**line 71**

```
/**
 * Headers for an authenticated request.
 *
 * `credentials: "include"` alone is not enough: the API lives on a different
 * registrable domain than the app, so its auth cookie is third-party, and
 * Chrome incognito plus Safari and Firefox tracking protection refuse to send
 * it. The bearer header carries the same JWT over a channel no cookie policy
 * can block. The cookie is still sent when the browser allows it.
 */
```

**line 85**

```
/**
 * Authentication Endpoints
 */
```

**line 151**

```
// Network failure, DNS failure, CORS rejection or timeout.
```

**line 155**

```
// 5xx means the backend is up but unhealthy, e.g. its database is unreachable.
```

**line 167**

```
/**
 * Room Endpoints
 */
```

## `frontend/src/services/socket.ts`

**line 10**

```
/**
 * Connects the socket to the backend server with handshake authentication parameters.
 */
```

**line 16**

```
// Never reuse an authenticated socket for a different room or participant.
```

**line 45**

```
/**
 * Disconnects the socket connection and cleans up the instance.
 */
```

**line 56**

```
/**
 * Returns the active socket instance.
 */
```

## `frontend/src/stores/useSessionStore.ts`

**line 11**

```
/**
   * The account JWT, mirrored from the auth cookie.
   *
   * The cookie is third-party here (API and app are on different domains) and is
   * blocked outright by Chrome incognito and by tracking protection, so it
   * cannot be the only copy. Sent as a bearer header on authenticated requests.
   */
```

**line 27**

```
/** Clears the room membership but keeps the user signed in. */
```

**line 29**

```
/** Clears room membership and the signed-in user. Used by logout. */
```

**line 61**

```
// Key used in localStorage
```

## `frontend/src/app/AuthInitializer.tsx`

**line 12**

```
// How long to wait before telling the user a slow start is expected rather than broken.
```

**line 21**

```
// Bumping this re-runs the check. Retrying by changing an input rather than by
```

**line 22**

```
// calling the effect's body keeps every state write inside either a promise
```

**line 23**

```
// callback or an event handler, so no render is committed and then discarded.
```

**line 32**

```
// The server is the authority on whether the session is still valid. If
```

**line 33**

```
// it says nobody is signed in, a token left in storage is stale and
```

**line 34**

```
// would otherwise keep the UI claiming an identity the API rejects —
```

**line 35**

```
// exactly the mismatch that produced "You must be signed in to do that"
```

**line 36**

```
// on a screen showing a signed-in user.
```

**line 44**

```
// An unreachable backend is not the same as a signed-out user: rendering
```

**line 45**

```
// the app would leave every request failing with no explanation.
```

## `frontend/src/components/Layout.tsx`

**line 5**

```
// Auth is resolved once, before the router mounts, by AuthInitializer — this
```

**line 6**

```
// layout only renders the shared chrome around routed pages.
```

## `frontend/src/features/auction/AuctionPage.tsx`

**line 28**

```
/**
 * The smallest legal bid right now.
 *
 * Mirrors getMinimumBid on the server: the opening bid is the asking price
 * exactly, and every raise after that must clear the room's increment. Kept
 * identical so the UI never offers an amount the server would reject.
 */
```

**line 40**

```
// Room codes are stored uppercase, so a lowercase URL must not read as a
```

**line 41**

```
// different room and lock out a session that is actually valid.
```

**line 54**

```
// Connect to Socket.IO to track live bidding item, presence, and bids history
```

**line 83**

```
// The opening bid may match the asking price exactly; every later bid must
```

**line 84**

```
// clear the room's minimum raise.
```

**line 88**

```
// currentBid is zero until someone actually bids, so it is only a real price
```

**line 89**

```
// once it is positive.
```

**line 92**

```
// While paused there is no deadline to count down to, so the frozen remainder
```

**line 93**

```
// is rendered instead of a live difference.
```

**line 105**

```
// A bidder whose purse cannot even cover the minimum is out of the running for
```

**line 106**

```
// this item, which is worth saying plainly rather than letting them bid and be
```

**line 107**

```
// rejected by the server.
```

**line 110**

```
// Preset raises stepped by the room's own increment, so every chip is a legal
```

**line 111**

```
// bid by construction. Anything beyond the purse is dropped rather than shown
```

**line 112**

```
// disabled: an unaffordable option is noise under a countdown.
```

**line 130**

```
// Listen to live events for broadcast logs and toast notifications
```

**line 179**

```
// socketStatus is a dependency because getSocket() returns null until the
```

**line 180**

```
// connection has been created; without it these listeners would never attach
```

**line 181**

```
// on a first render that beat the socket into existence.
```

**line 184**

```
// Security check: Redirect if the user has no session or is in the wrong room
```

**line 187**

```
// Automatically navigate to results page when room transitions to completed status
```

**line 195**

```
// Leaving a room ends the room membership only. Clearing the whole session
```

**line 196**

```
// would also sign the user out while their auth cookie stayed set, so the
```

**line 197**

```
// next reload would silently sign them back in.
```

**line 203**

```
// Submit new bid (Participants only)
```

**line 232**

```
// Reset input field
```

**line 235**

```
// Sell active item (Admin only)
```

**line 243**

```
// Mark active item unsold (Admin only)
```

**line 251**

```
// Freeze or restore the countdown (Admin only)
```

**line 259**

```
// Checked before the connection states: without a session token the socket can
```

**line 260**

```
// never connect, so reporting a connection failure would send the user to a
```

**line 261**

```
// dead end instead of to the join screen that actually fixes it.
```

**line 323**

```
// The host runs the auction rather than bidding in it, so listing them here
```

**line 324**

```
// would misrepresent who you are actually competing against.
```

**line 331**

```
/* Connection status header */
```

**line 376**

```
/* Host Control center resolving controls (Visible to Admin only) */
```

**line 426**

```
/* Live Auction Board Layout */
```

**line 429**

```
/* Active Item Container (2/3 width) */
```

**line 432**

```
/* Current Item Presentation */
```

**line 476**

```
/* Pricing Box */
```

**line 510**

```
/* Bidding Placement input Box (Visible to Bidders only) */
```

**line 530**

```
/* noValidate: the browser's own tooltip for `min` is an
                    unstyled native popup that appears on submit and cannot be
                    themed. All validation is ours, rendered inline. */
```

**line 617**

```
// Digits only. A minus sign can never reach state, so
```

**line 618**

```
// a negative bid is unreachable rather than rejected.
```

**line 634**

```
/* Sidebar Section (1/3 width) */
```

**line 637**

```
/* Bid History list timeline */
```

**line 699**

```
/* Bidders Connection Sidebar */
```

**line 744**

```
/* Notification logs panel */
```

**line 761**

```
// Newest first: during a live auction the latest event is the
```

**line 762**

```
// one that matters, and scrolling to find it wastes the clock.
```

**line 786**

```
/* Floating Toast Notification Container */
```

## `frontend/src/features/auth/AuthPortal.tsx`

**line 54**

```
// Client-side password validation on Sign Up
```

**line 73**

```
// Stored before the user, so any request triggered by the state change
```

**line 74**

```
// already has a token to send.
```

**line 112**

```
/* Quick Demo Credentials Selection */
```

**line 131**

```
/* Selection Tabs */
```

**line 165**

```
/* Input Form */
```

## `frontend/src/features/results/ResultsPage.tsx`

**line 75**

```
// Calculate statistics
```

**line 84**

```
/* Page Header */
```

**line 109**

```
/* Stats Summary Panel */
```

**line 111**

```
/* Revenue */
```

**line 126**

```
/* Sold Count */
```

**line 141**

```
/* Unsold Count */
```

**line 157**

```
/* Results Catalog Table */
```

## `frontend/src/pages/CreateRoomPage.tsx`

**line 12**

```
// Matches the server's fallback. Shown pre-filled so the field reads as a
```

**line 13**

```
// setting with a sensible value rather than a question.
```

**line 100**

```
/* Identity comes from the session, so it is stated rather than asked for. */
```

## `frontend/src/pages/JoinRoomPage.tsx`

**line 96**

```
/* Identity comes from the session, so it is stated rather than asked for. */
```

## `frontend/src/pages/LobbyPage.tsx`

**line 23**

```
// Mirrors the server-side caps in itemService. Enforced in both places: the
```

**line 24**

```
// input stops a mistake, the service stops a crafted request.
```

**line 29**

```
// Room codes are stored uppercase, so a lowercase URL must not read as a
```

**line 30**

```
// different room and lock out a session that is actually valid.
```

**line 43**

```
// Connect to the socket server to sync room and items state in realtime
```

**line 54**

```
// Admin Item Form State
```

**line 62**

```
// Security check: Redirect if the user has no session or is in the wrong room
```

**line 77**

```
// Leaving a room ends the room membership only. Clearing the whole session
```

**line 78**

```
// would also sign the user out while their auth cookie stayed set, so the
```

**line 79**

```
// next reload would silently sign them back in.
```

**line 85**

```
// Submit new auction item (Admin only)
```

**line 113**

```
// Clear form on success
```

**line 126**

```
// Redirect to live auction page when the room transitions to active/live status
```

**line 133**

```
// Request the server to start the auction (Admin only)
```

**line 141**

```
// Checked before the connection states: without a session token the socket can
```

**line 142**

```
// never connect, so reporting a connection failure would send the user to a
```

**line 143**

```
// dead end instead of to the join screen that actually fixes it.
```

**line 165**

```
// Show dynamic loader until we get the room details from the socket room state
```

**line 206**

```
// The host runs the auction rather than competing in it, and is already shown
```

**line 207**

```
// in the profile card above, so listing them among the bidders both
```

**line 208**

```
// double-counts and misrepresents who you are bidding against.
```

**line 215**

```
/* Connection status header */
```

**line 253**

```
/* Host Control Center banner */
```

**line 276**

```
/* Dashboard Room/Profile Info */
```

**line 278**

```
/* Room Details Card (3/5 width) */
```

**line 321**

```
/* User Profile Card (2/5 width) */
```

**line 363**

```
/* Realtime Catalog & Admin Form */
```

**line 366**

```
/* Upcoming Items List (3/5 width) */
```

**line 415**

```
/* Add Auction Item form (2/5 width, visible to Admin only) */
```

**line 423**

```
/* noValidate: native constraint tooltips are unstyled OS popups
                  that clash with the dark UI. Validation is handled below. */
```

**line 466**

```
// Digits only, so a negative or malformed price cannot be typed.
```

**line 519**

```
/* Realtime Active Presence Board */
```
