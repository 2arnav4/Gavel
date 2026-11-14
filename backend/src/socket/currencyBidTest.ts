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
import { clearAuctionTimer, hasAuctionTimer } from "./handlers/resolutionHandler.js";
import { connect, nextEvent, startHarness, type Harness } from "./testHarness.js";

type BidRejection = { code: string; reason: string; minimumBid?: number };

const STARTING_BID = 2_000;
const MIN_INCREMENT = 250;
const BUDGET = 10_000;

let dbAvailable = false;
let harness: Harness;
const roomIds: mongoose.Types.ObjectId[] = [];
const openSockets: ClientSocket[] = [];

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

async function createLiveRoom(currency: string | undefined, roomOverrides: Record<string, unknown> = {}) {
  const code = `C${crypto.randomBytes(4).toString("hex").slice(0, 5).toUpperCase()}`;
  const room = await Room.create({
    code,
    name: "Currency Test Room",
    status: "live",
    startingBudget: BUDGET,
    minBidIncrement: MIN_INCREMENT,
    ...(currency ? { currency } : {}),
  });
  const roomId = room._id as mongoose.Types.ObjectId;
  roomIds.push(roomId);

  const endsAt = new Date(Date.now() + 5 * 60_000);
  const item = await AuctionItem.create({
    roomId,
    name: "Currency Fixture",
    startingBid: STARTING_BID,
    currentBid: 0,
    status: "active",
    endsAt,
  });
  await Room.updateOne({ _id: roomId }, { $set: { currentItemId: item._id, endsAt, ...roomOverrides } });

  return { roomId, code, itemId: item._id as mongoose.Types.ObjectId };
}

async function joinAsBidder(roomId: mongoose.Types.ObjectId, code: string, budget = BUDGET): Promise<ClientSocket> {
  const sessionToken = crypto.randomUUID();
  const username = `t_cur_${crypto.randomBytes(3).toString("hex")}`;
  await Participant.create({
    roomId,
    username,
    usernameNormalized: username,
    role: "participant",
    sessionToken,
    budget,
    spent: 0,
  });
  const socket = track(await connect(harness.url, { sessionToken, roomCode: code }));
  const joined = nextEvent(socket, "room:state");
  socket.emit("room:connect");
  await joined;
  return socket;
}

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;
  harness = await startHarness();
});

after(async () => {
  if (!dbAvailable) return;
  for (const socket of openSockets) socket.close();
  for (const roomId of roomIds) {
    clearAuctionTimer(roomId.toString());
    await Bid.deleteMany({ roomId });
    await AuctionItem.deleteMany({ roomId });
    await Participant.deleteMany({ roomId });
    await Room.deleteMany({ _id: roomId });
  }
  await harness.close();
  await mongoose.disconnect();
});

test("a room created without a currency is stored as INR", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId } = await createLiveRoom(undefined);
  const stored = await Room.findById(roomId);
  assert.equal(stored?.currency, "INR");
});

test("a fractional bid is rejected as invalid input and never claims", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("USD");
  const socket = await joinAsBidder(roomId, code);

  for (const amount of [STARTING_BID + 0.37, STARTING_BID + 0.5, 2_000.000001]) {
    const rejected = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", { amount, itemId: itemId.toString() });
    const rejection = await rejected;
    assert.equal(rejection.code, "INVALID_INPUT", `amount ${amount} must be rejected`);
    assert.match(rejection.reason, /whole number/);
    assert.equal(rejection.minimumBid, STARTING_BID);
  }

  const item = await AuctionItem.findById(itemId);
  assert.equal(item?.currentBid, 0, "a fractional bid must not move the price");
  assert.equal(await Bid.countDocuments({ itemId }), 0);
});

test("a whole-number bid in a USD room is still accepted", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("USD");
  const socket = await joinAsBidder(roomId, code);

  const accepted = nextEvent<{ bid: { amount: number } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });
  assert.equal((await accepted).bid.amount, STARTING_BID);
});

test("rejection text uses the room's currency, not rupees", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("USD");
  const socket = await joinAsBidder(roomId, code);

  const low = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: 10, itemId: itemId.toString() });
  const tooLow = await low;
  assert.equal(tooLow.code, "BID_TOO_LOW");
  assert.match(tooLow.reason, /\$2,000/);
  assert.doesNotMatch(tooLow.reason, /₹/);

  const poor = await joinAsBidder(roomId, code, 1_500);
  const broke = nextEvent<BidRejection>(poor, "bid:rejected");
  poor.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });
  const overBudget = await broke;
  assert.equal(overBudget.code, "INSUFFICIENT_BUDGET");
  assert.match(overBudget.reason, /\$1,500/);
});

test("a zero-decimal currency formats without decimals", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("JPY");
  const socket = await joinAsBidder(roomId, code);

  const low = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: 10, itemId: itemId.toString() });
  const rejection = await low;
  assert.equal(rejection.code, "BID_TOO_LOW");
  assert.match(rejection.reason, /¥2,000$/);
  assert.doesNotMatch(rejection.reason, /¥2,000\.\d/);
});

test("an INR room keeps Indian digit grouping in rejection text", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  await AuctionItem.updateOne({ _id: itemId }, { $set: { startingBid: 150_000 } });
  const socket = await joinAsBidder(roomId, code, 1_000_000);

  const low = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: 10, itemId: itemId.toString() });
  assert.match((await low).reason, /₹1,50,000/);
});

test("a bid that lands after the room was paused does not give the room a deadline or a timer", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR", {
    isPaused: true,
    endsAt: null,
    pausedRemainingMs: 30_000,
  });
  clearAuctionTimer(roomId.toString());
  const socket = await joinAsBidder(roomId, code);

  const accepted = nextEvent<{ bid: { amount: number } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });
  await accepted;

  const room = await Room.findById(roomId);
  assert.equal(room?.isPaused, true);
  assert.equal(room?.endsAt, null, "a paused room must never receive a deadline from a late bid write");
  assert.equal(hasAuctionTimer(roomId.toString()), false, "no countdown may be armed for a paused room");
});

test("a bid on a running room still extends the room deadline and arms the timer", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  const before = (await Room.findById(roomId))?.endsAt?.getTime() ?? 0;
  const socket = await joinAsBidder(roomId, code);

  const accepted = nextEvent<{ item: { endsAt: string } }>(socket, "bid:accepted");
  socket.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });
  const { item } = await accepted;

  const room = await Room.findById(roomId);
  assert.equal(room?.endsAt?.toISOString(), new Date(item.endsAt).toISOString());
  assert.notEqual(room?.endsAt?.getTime(), before);
  assert.equal(hasAuctionTimer(roomId.toString()), true);
  clearAuctionTimer(roomId.toString());
});

async function moveToNextItem(roomId: mongoose.Types.ObjectId, previousItemId: mongoose.Types.ObjectId) {
  await AuctionItem.updateOne({ _id: previousItemId }, { $set: { status: "sold" } });
  const endsAt = new Date(Date.now() + 5 * 60_000);
  const next = await AuctionItem.create({
    roomId,
    name: "Next Lot",
    startingBid: STARTING_BID,
    currentBid: 0,
    status: "active",
    endsAt,
  });
  await Room.updateOne({ _id: roomId }, { $set: { currentItemId: next._id, endsAt } });
  return next._id as mongoose.Types.ObjectId;
}

test("a retried bid id for an item that has moved on gets its original result, not STALE_ITEM", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  const bidder = await joinAsBidder(roomId, code);
  const bidId = crypto.randomUUID();

  const first = nextEvent<{ bid: { _id: string } }>(bidder, "bid:accepted");
  bidder.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString(), bidId });
  const original = await first;

  await moveToNextItem(roomId, itemId);

  const rejections: BidRejection[] = [];
  bidder.on("bid:rejected", (rejection: BidRejection) => rejections.push(rejection));
  const replay = nextEvent<{ bid: { _id: string }; duplicate?: boolean }>(bidder, "bid:accepted");
  bidder.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString(), bidId });
  const replayed = await replay;

  assert.equal(replayed.duplicate, true);
  assert.equal(replayed.bid._id, original.bid._id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(rejections, []);
  clearAuctionTimer(roomId.toString());
});

test("a bid id reused on a new item is claimed for that item, not swallowed as a replay", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  const bidder = await joinAsBidder(roomId, code);
  const bidId = crypto.randomUUID();

  const first = nextEvent(bidder, "bid:accepted");
  bidder.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString(), bidId });
  await first;

  const nextItemId = await moveToNextItem(roomId, itemId);

  const second = nextEvent<{ item: { _id: string; currentBid: number }; duplicate?: boolean }>(bidder, "bid:accepted");
  bidder.emit("bid:place", { amount: STARTING_BID, itemId: nextItemId.toString(), bidId });
  const accepted = await second;

  assert.equal(accepted.duplicate, undefined, "a new item's bid must not be treated as a retry");
  assert.equal(accepted.item._id, nextItemId.toString());
  assert.equal((await AuctionItem.findById(nextItemId))?.currentBid, STARTING_BID);
  clearAuctionTimer(roomId.toString());
});

test("a log write that fails after a winning claim still broadcasts the accepted bid", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  const observer = await joinAsBidder(roomId, code);
  const bidder = await joinAsBidder(roomId, code);

  const originalSave = Bid.prototype.save;
  let failures = 0;
  t.after(() => {
    Bid.prototype.save = originalSave;
  });
  Bid.prototype.save = async function failOnce() {
    failures += 1;
    Bid.prototype.save = originalSave;
    throw new Error("simulated log outage");
  } as typeof originalSave;

  const rejections: BidRejection[] = [];
  bidder.on("bid:rejected", (rejection: BidRejection) => rejections.push(rejection));
  const seenByRoom = nextEvent<{ item: { currentBid: number } }>(observer, "bid:accepted");
  const seenByBidder = nextEvent<{ item: { currentBid: number } }>(bidder, "bid:accepted");

  bidder.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });

  assert.equal((await seenByRoom).item.currentBid, STARTING_BID);
  assert.equal((await seenByBidder).item.currentBid, STARTING_BID);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(failures, 1, "the stub must actually have failed one save");
  assert.deepEqual(rejections, [], "the bidder must not be told the bid failed");
  assert.equal((await AuctionItem.findById(itemId))?.currentBid, STARTING_BID);
  clearAuctionTimer(roomId.toString());
});

test("a room write that fails after a winning claim still broadcasts and keeps a timer", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, code, itemId } = await createLiveRoom("INR");
  clearAuctionTimer(roomId.toString());
  const bidder = await joinAsBidder(roomId, code);

  const originalUpdateOne = Room.updateOne;
  let failures = 0;
  t.after(() => {
    Room.updateOne = originalUpdateOne;
  });
  Room.updateOne = function failDeadlineWriteOnce(this: typeof Room, ...args: unknown[]) {
    const filter = args[0] as Record<string, unknown> | undefined;
    if (filter && "currentItemId" in filter && "isPaused" in filter) {
      failures += 1;
      Room.updateOne = originalUpdateOne;
      throw new Error("simulated room write outage");
    }
    return (originalUpdateOne as (...rest: unknown[]) => unknown).apply(this, args);
  } as unknown as typeof Room.updateOne;

  const rejections: BidRejection[] = [];
  bidder.on("bid:rejected", (rejection: BidRejection) => rejections.push(rejection));
  const accepted = nextEvent<{ item: { currentBid: number } }>(bidder, "bid:accepted");
  bidder.emit("bid:place", { amount: STARTING_BID, itemId: itemId.toString() });

  assert.equal((await accepted).item.currentBid, STARTING_BID);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(failures, 1, "the stub must actually have failed the deadline write");
  assert.deepEqual(rejections, []);
  assert.equal(hasAuctionTimer(roomId.toString()), true, "the item's countdown must still be armed");
  assert.equal(await Bid.countDocuments({ itemId }), 1);
  clearAuctionTimer(roomId.toString());
});
