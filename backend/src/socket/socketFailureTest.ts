import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import type { Socket as ClientSocket } from "socket.io-client";
import { connectTestDatabase } from "../utils/testDatabase.js";
import { AuctionItem } from "../models/itemModel.js";
import { Bid } from "../models/bidModel.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";
import { clearAuctionTimer } from "./handlers/resolutionHandler.js";
import { connect, expectRejectedHandshake, nextEvent, startHarness, type Harness } from "./testHarness.js";

type BidRejection = { code: string; reason: string; minimumBid?: number; retryAfterMs?: number };
type SocketError = { code: string; message: string };

const STARTING_BID = 1_000;
const MIN_INCREMENT = 500;
const BIDDER_BUDGET = 10_000;
const POOR_BUDGET = 500;

let dbAvailable = false;
let harness: Harness;
let roomId: mongoose.Types.ObjectId;
let roomCode: string;
let hostToken: string;
let bidderToken: string;
let poorToken: string;
const openSockets: ClientSocket[] = [];

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

async function createBidder(username: string, budget = BIDDER_BUDGET): Promise<string> {
  const sessionToken = crypto.randomUUID();
  await Participant.create({
    roomId,
    username,
    usernameNormalized: username,
    role: "participant",
    sessionToken,
    budget,
    spent: 0,
  });
  return sessionToken;
}

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;

  harness = await startHarness();

  roomCode = `T${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const room = await Room.create({
    code: roomCode,
    name: "Socket Failure Test Room",
    status: "live",
    startingBudget: BIDDER_BUDGET,
    minBidIncrement: MIN_INCREMENT,
  });
  roomId = room._id as mongoose.Types.ObjectId;

  const item = await AuctionItem.create({
    roomId,
    name: "Socket Failure Fixture",
    startingBid: STARTING_BID,
    currentBid: 0,
    status: "active",
    endsAt: new Date(Date.now() + 5 * 60_000),
  });
  await Room.updateOne({ _id: roomId }, { $set: { currentItemId: item._id } });

  hostToken = crypto.randomUUID();
  bidderToken = crypto.randomUUID();
  poorToken = crypto.randomUUID();

  await Participant.create([
    { roomId, username: "t_host", usernameNormalized: "t_host", role: "admin", sessionToken: hostToken, budget: BIDDER_BUDGET, spent: 0 },
    { roomId, username: "t_bidder", usernameNormalized: "t_bidder", role: "participant", sessionToken: bidderToken, budget: BIDDER_BUDGET, spent: 0 },
    { roomId, username: "t_poor", usernameNormalized: "t_poor", role: "participant", sessionToken: poorToken, budget: POOR_BUDGET, spent: 0 },
  ]);
});

after(async () => {
  if (!dbAvailable) return;
  clearAuctionTimer(roomId.toString());
  for (const socket of openSockets) socket.close();
  await harness.close();
  await Bid.deleteMany({ roomId });
  await AuctionItem.deleteMany({ roomId });
  await Participant.deleteMany({ roomId });
  await Room.deleteMany({ _id: roomId });
  await mongoose.disconnect();
});

test("valid credentials complete the handshake", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  assert.equal(socket.connected, true);
  socket.close();
});

test("operator objects in sessionToken no longer authenticate anyone", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const payloads: unknown[] = [
    { $ne: null },
    { $gt: "" },
    { $regex: ".*" },
    { $exists: true },
  ];

  for (const sessionToken of payloads) {
    const message = await expectRejectedHandshake(harness.url, { sessionToken, roomCode });
    assert.match(message, /Session token is required/);
  }
});

test("a malformed roomCode is reported as a client error, not a server error", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  for (const badCode of [123, {}, [], true, "", "   ", "WAYTOOLONG"]) {
    const message = await expectRejectedHandshake(harness.url, { sessionToken: bidderToken, roomCode: badCode });
    assert.match(message, /Room code is required|Room code must be/);
    assert.doesNotMatch(message, /Internal server error/);
  }
});

test("missing credentials are rejected without touching the database", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  assert.match(await expectRejectedHandshake(harness.url, {}), /Session token is required/);
  assert.match(await expectRejectedHandshake(harness.url, { roomCode }), /Session token is required/);
  assert.match(await expectRejectedHandshake(harness.url, { sessionToken: bidderToken }), /Room code is required/);
});

test("an unknown session token is rejected", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const message = await expectRejectedHandshake(harness.url, {
    sessionToken: crypto.randomUUID(),
    roomCode,
  });
  assert.match(message, /Invalid session token/);
});

test("a valid token for the wrong room is rejected", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const message = await expectRejectedHandshake(harness.url, {
    sessionToken: bidderToken,
    roomCode: "ZZZZZZ",
  });
  assert.match(message, /Room mismatch/);
});

test("a host bidding is rejected and is not told a minimum bid", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: hostToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID });

  const rejection = await pending;
  assert.equal(rejection.code, "NOT_AUTHORIZED");
  assert.match(rejection.reason, /hosts are not allowed to place bids/);
  assert.equal(rejection.minimumBid, undefined);
  socket.close();
});

test("a malformed bid payload reports the real minimum, not currentBid + 1", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const malformedToken = await createBidder("t_malformed");
  const socket = track(await connect(harness.url, { sessionToken: malformedToken, roomCode }));

  for (const payload of [null, 42, "abc", {}, undefined]) {
    const pending = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", payload);

    const rejection = await pending;
    assert.equal(rejection.code, "INVALID_INPUT");
    assert.equal(rejection.minimumBid, STARTING_BID);
  }

  socket.close();
});

test("a bid below the minimum is rejected with the increment-aware minimum", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const lowToken = await createBidder("t_low");
  const socket = track(await connect(harness.url, { sessionToken: lowToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID - 1 });

  const rejection = await pending;
  assert.equal(rejection.code, "BID_TOO_LOW");
  assert.equal(rejection.minimumBid, STARTING_BID);
  socket.close();
});

test("a bid beyond the remaining purse is rejected", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: poorToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID });

  const rejection = await pending;
  assert.equal(rejection.code, "INSUFFICIENT_BUDGET");
  assert.equal(rejection.minimumBid, STARTING_BID);
  socket.close();
});

test("the sixth bid inside one second is throttled and carries a retry delay", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const throttleToken = await createBidder("t_flood");

  const socket = track(await connect(harness.url, { sessionToken: throttleToken, roomCode }));

  const rejections: BidRejection[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pending = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", { amount: "not-a-number" });
    rejections.push(await pending);
  }

  const throttled = rejections[5];
  assert.equal(throttled.code, "RATE_LIMITED");
  assert.ok(throttled.retryAfterMs !== undefined && throttled.retryAfterMs > 0);
  assert.equal(throttled.minimumBid, undefined);
  socket.close();
});

test("a participant cannot resolve an item", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));

  for (const event of ["item:sell", "item:unsold"]) {
    const pending = nextEvent<SocketError>(socket, "error");
    socket.emit(event);
    assert.equal((await pending).code, "NOT_AUTHORIZED");
  }

  socket.close();
});

test("an accepted bid is written once and broadcast to the room", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const acceptToken = await createBidder("t_accept");
  const socket = track(await connect(harness.url, { sessionToken: acceptToken, roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");

  const pending = nextEvent<{ bid: { amount: number }; item: { currentBid: number } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: STARTING_BID });

  const accepted = await pending;
  assert.equal(accepted.bid.amount, STARTING_BID);
  assert.equal(accepted.item.currentBid, STARTING_BID);
  assert.equal(await Bid.countDocuments({ roomId, amount: STARTING_BID }), 1);
  socket.close();
});

test("after an accepted bid the minimum moves by the room increment", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const raiseToken = await createBidder("t_raise");
  const socket = track(await connect(harness.url, { sessionToken: raiseToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID + 1 });

  const rejection = await pending;
  assert.equal(rejection.minimumBid, STARTING_BID + MIN_INCREMENT);
  socket.close();
});

const GRACE_MS = Number(process.env.PRESENCE_GRACE_MS ?? 10_000);

function neverEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  withinMs: number,
  matches: (payload: T) => boolean = () => true,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(true);
    }, withinMs);

    function onEvent(payload: T): void {
      if (!matches(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(false);
    }

    socket.on(event, onEvent);
  });
}

type DeparturePayload = { participant: { username: string; isConnected: boolean } };

function departureOf(username: string) {
  return (payload: DeparturePayload) => payload?.participant?.username === username;
}

function nextDepartureOf(socket: ClientSocket, username: string, timeoutMs: number): Promise<DeparturePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("participant:left", onEvent);
      reject(new Error(`Timed out waiting for ${username} to leave`));
    }, timeoutMs);

    function onEvent(payload: DeparturePayload): void {
      if (!departureOf(username)(payload)) return;
      clearTimeout(timer);
      socket.off("participant:left", onEvent);
      resolve(payload);
    }

    socket.on("participant:left", onEvent);
  });
}

async function joinedObserver(): Promise<ClientSocket> {
  const observer = track(await connect(harness.url, { sessionToken: hostToken, roomCode }));
  observer.emit("room:connect");
  await nextEvent(observer, "room:state");
  return observer;
}

test("a reconnect inside the grace period does not broadcast a departure", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const observer = await joinedObserver();

  const bidder = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  bidder.emit("room:connect");
  await nextEvent(bidder, "room:state");

  const noDeparture = neverEvent(observer, "participant:left", GRACE_MS * 3, departureOf("t_bidder"));
  bidder.close();

  const rejoined = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  rejoined.emit("room:connect");
  await nextEvent(rejoined, "room:state");

  assert.equal(await noDeparture, true);
  assert.equal(
    (await Participant.findOne({ sessionToken: bidderToken }))?.isConnected,
    true,
  );

  rejoined.close();
  observer.close();
});

test("a participant who does not return is marked offline after the grace period", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const observer = await joinedObserver();

  const leaver = track(await connect(harness.url, { sessionToken: poorToken, roomCode }));
  leaver.emit("room:connect");
  await nextEvent(leaver, "room:state");

  const departure = nextDepartureOf(observer, "t_poor", GRACE_MS * 5 + 2_000);
  leaver.close();

  const { participant } = await departure;
  assert.equal(participant.username, "t_poor");
  assert.equal(participant.isConnected, false);
  assert.equal(
    (await Participant.findOne({ sessionToken: poorToken }))?.isConnected,
    false,
  );

  observer.close();
});

test("a second tab closing leaves the participant online immediately", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const observer = await joinedObserver();

  const tabOne = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  tabOne.emit("room:connect");
  await nextEvent(tabOne, "room:state");

  const tabTwo = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  tabTwo.emit("room:connect");
  await nextEvent(tabTwo, "room:state");

  const noDeparture = neverEvent(observer, "participant:left", GRACE_MS * 3, departureOf("t_bidder"));
  tabTwo.close();

  assert.equal(await noDeparture, true);
  assert.equal(
    (await Participant.findOne({ sessionToken: bidderToken }))?.isConnected,
    true,
  );

  tabOne.close();
  observer.close();
});


test("two simultaneous auction:start events produce exactly one started auction", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const raceCode = `T${(Date.now() + 7).toString(36).slice(-5).toUpperCase()}`;
  const raceRoom = await Room.create({
    code: raceCode,
    name: "Start Race Room",
    status: "lobby",
    startingBudget: BIDDER_BUDGET,
    minBidIncrement: MIN_INCREMENT,
  });
  const raceRoomId = raceRoom._id as mongoose.Types.ObjectId;

  await AuctionItem.create([
    { roomId: raceRoomId, name: "Race A", startingBid: STARTING_BID, currentBid: 0, status: "pending" },
    { roomId: raceRoomId, name: "Race B", startingBid: STARTING_BID, currentBid: 0, status: "pending" },
    { roomId: raceRoomId, name: "Race C", startingBid: STARTING_BID, currentBid: 0, status: "pending" },
  ]);

  const raceHostToken = crypto.randomUUID();
  await Participant.create({
    roomId: raceRoomId,
    username: "t_racehost",
    usernameNormalized: "t_racehost",
    role: "admin",
    sessionToken: raceHostToken,
    budget: BIDDER_BUDGET,
    spent: 0,
  });

  const observer = track(await connect(harness.url, { sessionToken: raceHostToken, roomCode: raceCode }));
  observer.emit("room:connect");
  await nextEvent(observer, "room:state");

  let startedBroadcasts = 0;
  let activatedBroadcasts = 0;
  observer.on("auction:started", () => { startedBroadcasts += 1; });
  observer.on("item:activated", () => { activatedBroadcasts += 1; });

  const errors: SocketError[] = [];
  observer.on("error", (e: SocketError) => { errors.push(e); });

  const CONCURRENT = 5;
  const starters = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      connect(harness.url, { sessionToken: raceHostToken, roomCode: raceCode })),
  );
  for (const s of starters) track(s);

  const starterErrors: SocketError[] = [];
  for (const s of starters) s.on("error", (e: SocketError) => { starterErrors.push(e); });

  await Promise.all(starters.map((s) => new Promise<void>((resolve) => {
    s.emit("auction:start");
    setTimeout(resolve, 0);
  })));
  await new Promise((r) => setTimeout(r, 2_500));

  const finalRoom = await Room.findById(raceRoomId);
  const activeItems = await AuctionItem.countDocuments({ roomId: raceRoomId, status: "active" });
  const pendingItems = await AuctionItem.countDocuments({ roomId: raceRoomId, status: "pending" });

  assert.equal(finalRoom?.status, "live", "room should be live exactly once");
  assert.equal(activeItems, 1, `exactly one item should be active, saw ${activeItems}`);
  assert.equal(pendingItems, 2, "the other two items must stay pending");
  assert.equal(startedBroadcasts, 1, `exactly one auction:started, saw ${startedBroadcasts}`);
  assert.equal(activatedBroadcasts, 1, `exactly one item:activated, saw ${activatedBroadcasts}`);

  const losers = starterErrors.filter((e) => e.code === "AUCTION_ALREADY_STARTED");
  assert.equal(losers.length, CONCURRENT - 1, `${CONCURRENT - 1} starts should be rejected, saw ${losers.length}`);

  for (const s of starters) s.close();
  observer.close();

  await AuctionItem.deleteMany({ roomId: raceRoomId });
  await Participant.deleteMany({ roomId: raceRoomId });
  await Room.deleteMany({ _id: raceRoomId });
});

test("starting a room with no items leaves it in lobby, not stranded live", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const emptyCode = `T${(Date.now() + 11).toString(36).slice(-5).toUpperCase()}`;
  const emptyRoom = await Room.create({
    code: emptyCode,
    name: "Empty Room",
    status: "lobby",
    startingBudget: BIDDER_BUDGET,
    minBidIncrement: MIN_INCREMENT,
  });
  const emptyRoomId = emptyRoom._id as mongoose.Types.ObjectId;

  const emptyHostToken = crypto.randomUUID();
  await Participant.create({
    roomId: emptyRoomId,
    username: "t_emptyhost",
    usernameNormalized: "t_emptyhost",
    role: "admin",
    sessionToken: emptyHostToken,
    budget: BIDDER_BUDGET,
    spent: 0,
  });

  const socket = track(await connect(harness.url, { sessionToken: emptyHostToken, roomCode: emptyCode }));
  const pending = nextEvent<SocketError>(socket, "error");
  socket.emit("auction:start");

  assert.equal((await pending).code, "NO_ITEMS");
  assert.equal((await Room.findById(emptyRoomId))?.status, "lobby", "room must roll back to lobby");

  socket.close();
  await Participant.deleteMany({ roomId: emptyRoomId });
  await Room.deleteMany({ _id: emptyRoomId });
});


type ItemModelSpy = { findById: typeof AuctionItem.findById };

async function countItemReads(run: () => Promise<void>): Promise<number> {
  const model = AuctionItem as unknown as ItemModelSpy;
  const original = model.findById;
  let reads = 0;

  model.findById = ((...args: Parameters<typeof AuctionItem.findById>) => {
    reads += 1;
    return original.apply(AuctionItem, args);
  }) as typeof AuctionItem.findById;

  try {
    await run();
  } finally {
    model.findById = original;
  }

  return reads;
}

test("an accepted bid performs no pre-claim item read", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_noread");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");

  const live = await AuctionItem.findOne({ roomId, status: "active" });
  assert.ok(live, "precondition: an active item exists");
  const winningAmount = live!.currentBid > 0
    ? live!.currentBid + MIN_INCREMENT
    : live!.startingBid;

  const reads = await countItemReads(async () => {
    const accepted = nextEvent(socket, "bid:accepted");
    socket.emit("bid:place", { amount: winningAmount });
    await accepted;
  });

  assert.equal(reads, 0, "the successful bid path must not read the item outside the atomic claim");
  socket.close();
});

test("a losing bid reads the item exactly once, after the claim", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_oneread");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));

  const reads = await countItemReads(async () => {
    const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", { amount: 1 });
    const rejection = await rejected;
    assert.equal(rejection.code, "BID_TOO_LOW");
    assert.ok(rejection.minimumBid !== undefined, "a losing bid must still carry an accurate minimum");
  });

  assert.equal(reads, 1, "a losing bid must read the item once, not twice");
  socket.close();
});

async function liveItemState() {
  const live = await AuctionItem.findOne({ roomId, status: "active" });
  assert.ok(live, "precondition: an active item exists");
  const winningAmount = live!.currentBid > 0 ? live!.currentBid + MIN_INCREMENT : live!.startingBid;
  return { live: live!, winningAmount };
}

test("a bid naming an item that is no longer on the block is rejected without a claim", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_stale");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  const { live, winningAmount } = await liveItemState();
  const bidsBefore = await Bid.countDocuments({ roomId });

  const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: winningAmount, itemId: new mongoose.Types.ObjectId().toString() });
  const rejection = await rejected;

  assert.equal(rejection.code, "STALE_ITEM");
  assert.equal(await Bid.countDocuments({ roomId }), bidsBefore, "a stale bid must not be logged");
  assert.equal((await AuctionItem.findById(live._id))?.currentBid, live.currentBid, "a stale bid must not move the price");
  socket.close();
});

test("a non-string item id is rejected as invalid input", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_badid");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  const { winningAmount } = await liveItemState();

  const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: winningAmount, itemId: { $ne: null } });
  assert.equal((await rejected).code, "INVALID_INPUT");
  socket.close();
});

test("a bid naming the current item is accepted as before", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_current");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");
  const { live, winningAmount } = await liveItemState();

  const accepted = nextEvent<{ bid: { amount: number } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: winningAmount, itemId: live._id.toString() });
  assert.equal((await accepted).bid.amount, winningAmount);
  socket.close();
});

test("a retried bid id is replayed to the sender, not claimed or rejected as too low", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_retry");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");
  const { live, winningAmount } = await liveItemState();
  const bidId = crypto.randomUUID();

  const first = nextEvent<{ duplicate?: boolean }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: winningAmount, itemId: live._id.toString(), bidId });
  assert.equal((await first).duplicate, undefined, "the first attempt is a normal acceptance");

  const replay = nextEvent<{ duplicate?: boolean; bid: { amount: number } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: winningAmount, itemId: live._id.toString(), bidId });
  const replayed = await replay;

  assert.equal(replayed.duplicate, true);
  assert.equal(replayed.bid.amount, winningAmount);
  assert.equal(await Bid.countDocuments({ clientBidId: bidId }), 1, "a retried bid must be logged once");
  assert.equal((await AuctionItem.findById(live._id))?.currentBid, winningAmount, "a retry must not move the price");
  socket.close();
});

test("a bid id reused for a different amount is rejected", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_reuse");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");
  const { live, winningAmount } = await liveItemState();
  const bidId = crypto.randomUUID();

  const first = nextEvent(socket, "bid:accepted");
  socket.emit("bid:place", { amount: winningAmount, itemId: live._id.toString(), bidId });
  await first;

  const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: winningAmount + MIN_INCREMENT, itemId: live._id.toString(), bidId });
  assert.equal((await rejected).code, "INVALID_INPUT");
  assert.equal((await AuctionItem.findById(live._id))?.currentBid, winningAmount);
  socket.close();
});

test("concurrent accepted bids carry strictly increasing item versions", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const observer = track(await connect(harness.url, { sessionToken: hostToken, roomCode }));
  observer.emit("room:connect");
  await nextEvent(observer, "room:state");

  const bidders: ClientSocket[] = [];
  for (let index = 0; index < 6; index += 1) {
    const socket = track(await connect(harness.url, { sessionToken: await createBidder(`t_seq${index}`), roomCode }));
    socket.emit("room:connect");
    await nextEvent(socket, "room:state");
    bidders.push(socket);
  }

  const outcomeOf = (socket: ClientSocket, index: number) => new Promise<void>((resolve) => {
    const finish = () => {
      socket.off("bid:accepted", onAccepted);
      socket.off("bid:rejected", finish);
      resolve();
    };
    const onAccepted = (payload: { bid: { username: string } }) => {
      if (payload.bid.username === `t_seq${index}`) finish();
    };
    socket.on("bid:accepted", onAccepted);
    socket.on("bid:rejected", finish);
  });

  const { live, winningAmount } = await liveItemState();
  const seen: Array<{ amount: number; version: number }> = [];
  const onAccepted = (payload: { bid: { amount: number }; version: number }) => {
    seen.push({ amount: payload.bid.amount, version: payload.version });
  };
  observer.on("bid:accepted", onAccepted);

  const outcomes = bidders.map(outcomeOf);
  bidders.forEach((socket, index) => {
    socket.emit("bid:place", { amount: winningAmount + index * MIN_INCREMENT, itemId: live._id.toString() });
  });
  await Promise.all(outcomes);
  await new Promise((resolve) => setTimeout(resolve, 200));
  observer.off("bid:accepted", onAccepted);

  assert.ok(seen.length >= 1, "at least one concurrent bid must be accepted");
  assert.equal(new Set(seen.map((entry) => entry.version)).size, seen.length, "no two accepted bids may share a version");
  const byAmount = [...seen].sort((a, b) => a.amount - b.amount);
  for (let index = 1; index < byAmount.length; index += 1) {
    assert.ok(byAmount[index].version > byAmount[index - 1].version, "a higher accepted bid must carry a higher version");
  }
  const stored = await AuctionItem.findById(live._id);
  assert.equal(stored?.version, Math.max(...seen.map((entry) => entry.version)), "the stored version matches the newest event");
  assert.equal(stored?.version, (live.version ?? 0) + seen.length, "every accepted bid bumps the version exactly once");

  for (const socket of bidders) socket.close();
  observer.close();
});

test("a malformed bid id is rejected before anything is read", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const token = await createBidder("t_badbidid");
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode }));
  const { winningAmount } = await liveItemState();

  for (const bidId of ["short", { $ne: null }, "x".repeat(65), "has spaces in it"]) {
    const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", { amount: winningAmount, bidId });
    assert.equal((await rejected).code, "INVALID_INPUT", `bidId ${JSON.stringify(bidId)} must be rejected`);
  }
  socket.close();
});
