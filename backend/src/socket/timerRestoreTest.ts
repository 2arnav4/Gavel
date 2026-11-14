import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import { connectTestDatabase } from "../utils/testDatabase.js";
import { AuctionItem } from "../models/itemModel.js";
import { Room } from "../models/roomModel.js";
import {
  clearAuctionTimer,
  hasAuctionTimer,
  recoverStuckRooms,
  restoreAuctionTimers,
  STUCK_AFTER_MS,
  startExpirySweep,
  sweepExpiredItems,
} from "./handlers/resolutionHandler.js";
import { startHarness, type Harness } from "./testHarness.js";

let dbAvailable = false;
let harness: Harness;
const createdRooms: mongoose.Types.ObjectId[] = [];

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;
  harness = await startHarness();
});

after(async () => {
  if (!dbAvailable) return;
  for (const roomId of createdRooms) {
    clearAuctionTimer(roomId.toString());
    await AuctionItem.deleteMany({ roomId });
    await Room.deleteMany({ _id: roomId });
  }
  await harness.close();
  await mongoose.disconnect();
});

async function makeLiveRoom(options: {
  endsAt: Date | null;
  isPaused?: boolean;
  hasBidder?: boolean;
}) {
  const room = await Room.create({
    code: `R${Math.random().toString(36).slice(-5).toUpperCase()}`,
    name: "Timer Restore Room",
    status: "live",
    startingBudget: 100_000,
    minBidIncrement: 500,
    isPaused: options.isPaused ?? false,
    endsAt: options.endsAt,
  });
  const roomId = room._id as mongoose.Types.ObjectId;
  createdRooms.push(roomId);

  const item = await AuctionItem.create({
    roomId,
    name: "Restore Fixture",
    startingBid: 1_000,
    currentBid: options.hasBidder ? 1_000 : 0,
    highestBidderId: options.hasBidder ? new mongoose.Types.ObjectId() : null,
    highestBidderUsername: options.hasBidder ? "ghost_bidder" : null,
    status: "active",
    isPaused: options.isPaused ?? false,
    endsAt: options.endsAt,
  });

  await Room.updateOne({ _id: roomId }, { $set: { currentItemId: item._id } });
  return { roomId, itemId: item._id as mongoose.Types.ObjectId };
}

test("a live room gets its timer rebuilt from the database", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId } = await makeLiveRoom({ endsAt: new Date(Date.now() + 60_000) });
  clearAuctionTimer(roomId.toString());
  assert.equal(hasAuctionTimer(roomId.toString()), false, "precondition: no timer in memory");

  await restoreAuctionTimers(harness.io);

  assert.equal(hasAuctionTimer(roomId.toString()), true, "restore must schedule a timer");
});

test("a deadline that already passed resolves the item immediately after restore", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({
    endsAt: new Date(Date.now() - 5_000),
    hasBidder: true,
  });
  clearAuctionTimer(roomId.toString());

  await restoreAuctionTimers(harness.io);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const item = await AuctionItem.findById(itemId);
  assert.equal(item?.status, "sold", "an expired item with a bidder must resolve as sold");
});

test("an expired item with no bidder resolves as unsold", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({
    endsAt: new Date(Date.now() - 5_000),
    hasBidder: false,
  });
  clearAuctionTimer(roomId.toString());

  await restoreAuctionTimers(harness.io);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const item = await AuctionItem.findById(itemId);
  assert.equal(item?.status, "unsold");
});

test("a paused room is skipped, so a paused auction never restarts on boot", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({ endsAt: null, isPaused: true });
  clearAuctionTimer(roomId.toString());

  await restoreAuctionTimers(harness.io);
  await new Promise((resolve) => setTimeout(resolve, 800));

  assert.equal(hasAuctionTimer(roomId.toString()), false, "a paused room must not get a timer");
  assert.equal((await AuctionItem.findById(itemId))?.status, "active", "the item must stay active");
});

test("a live room with no stored deadline is given one rather than expiring instantly", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({ endsAt: null });
  clearAuctionTimer(roomId.toString());

  await restoreAuctionTimers(harness.io);

  const room = await Room.findById(roomId);
  const item = await AuctionItem.findById(itemId);

  assert.ok(room?.endsAt, "the room must be given a deadline");
  assert.ok(room!.endsAt!.getTime() > Date.now(), "the new deadline must be in the future");
  assert.ok(item?.endsAt, "the item must be given the same deadline");
  assert.equal(item?.status, "active", "it must not resolve immediately");
});

test("an expired item whose timer was never scheduled is resolved by the sweep", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({ endsAt: new Date(Date.now() - 1_000), hasBidder: true });
  clearAuctionTimer(roomId.toString());
  assert.equal(hasAuctionTimer(roomId.toString()), false, "precondition: no timer owns this item");

  const swept = await sweepExpiredItems(harness.io, { roomIds: [roomId] });

  assert.equal(swept, 1);
  assert.equal((await AuctionItem.findById(itemId))?.status, "sold");
});

test("the sweep leaves running, paused and future items alone", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const future = await makeLiveRoom({ endsAt: new Date(Date.now() + 60_000) });
  const paused = await makeLiveRoom({ endsAt: null, isPaused: true });
  clearAuctionTimer(future.roomId.toString());
  clearAuctionTimer(paused.roomId.toString());

  const swept = await sweepExpiredItems(harness.io, { roomIds: [future.roomId, paused.roomId] });

  assert.equal(swept, 0);
  assert.equal((await AuctionItem.findById(future.itemId))?.status, "active");
  assert.equal((await AuctionItem.findById(paused.itemId))?.status, "active");
});

test("the background sweep resolves an orphaned item within a few ticks, and stops cleanly", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({ endsAt: new Date(Date.now() - 1_000) });
  clearAuctionTimer(roomId.toString());

  const stop = startExpirySweep(harness.io, 200, { roomIds: [roomId] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  } finally {
    stop();
  }

  assert.equal((await AuctionItem.findById(itemId))?.status, "unsold");
});

test("a sweep racing the in-process timer resolves the item exactly once", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId, itemId } = await makeLiveRoom({ endsAt: new Date(Date.now() - 1_000), hasBidder: true });
  const before = (await AuctionItem.findById(itemId))!.version ?? 0;

  await Promise.all([
    restoreAuctionTimers(harness.io),
    sweepExpiredItems(harness.io, { roomIds: [roomId] }),
    sweepExpiredItems(harness.io, { roomIds: [roomId] }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const item = await AuctionItem.findById(itemId);
  assert.equal(item?.status, "sold");
  assert.equal(item?.version, before + 1, "only one resolution may claim the item");
});

test("restore is idempotent — running it twice leaves one timer per room", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const { roomId } = await makeLiveRoom({ endsAt: new Date(Date.now() + 60_000) });
  clearAuctionTimer(roomId.toString());

  await restoreAuctionTimers(harness.io);
  await restoreAuctionTimers(harness.io);

  assert.equal(hasAuctionTimer(roomId.toString()), true);
});

async function makeStuckRoom(options: { current: "sold" | "unsold" | "none" | "orphan"; pending: number; ageMs: number }) {
  const room = await Room.create({
    code: `S${Math.random().toString(36).slice(-5).toUpperCase()}`,
    name: "Stuck Room",
    status: "live",
    startingBudget: 100_000,
    minBidIncrement: 500,
  });
  const roomId = room._id as mongoose.Types.ObjectId;
  createdRooms.push(roomId);
  const old = new Date(Date.now() - options.ageMs);

  let currentItemId: mongoose.Types.ObjectId | null = null;
  if (options.current === "sold" || options.current === "unsold") {
    const resolved = await AuctionItem.create({
      roomId, name: "Resolved", startingBid: 1_000, status: options.current,
      currentBid: options.current === "sold" ? 1_000 : 0,
    });
    currentItemId = resolved._id as mongoose.Types.ObjectId;
    await AuctionItem.collection.updateOne({ _id: currentItemId }, { $set: { updatedAt: old } });
  }
  if (options.current === "orphan") {
    await AuctionItem.create({
      roomId, name: "Orphan", startingBid: 1_000, status: "active",
      endsAt: new Date(Date.now() + 60_000),
    });
  }
  for (let i = 0; i < options.pending; i += 1) {
    await AuctionItem.create({ roomId, name: `Pending ${i}`, startingBid: 1_000, status: "pending" });
  }
  await Room.collection.updateOne({ _id: roomId }, { $set: { currentItemId, updatedAt: old } });
  return roomId;
}

test("a room left on a resolved item is advanced to the next item by recovery", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomId = await makeStuckRoom({ current: "sold", pending: 2, ageMs: STUCK_AFTER_MS + 2_000 });
  assert.equal(await recoverStuckRooms(harness.io, { roomIds: [roomId] }), 1);

  const room = await Room.findById(roomId);
  const active = await AuctionItem.find({ roomId, status: "active" });
  assert.equal(active.length, 1, "exactly one item is live after recovery");
  assert.equal(String(room?.currentItemId), String(active[0]._id));
  assert.ok(room?.endsAt && room.endsAt.getTime() > Date.now());
});

test("a room whose last item was resolved without advancing is completed by recovery", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomId = await makeStuckRoom({ current: "unsold", pending: 0, ageMs: STUCK_AFTER_MS + 2_000 });
  assert.equal(await recoverStuckRooms(harness.io, { roomIds: [roomId] }), 1);
  assert.equal((await Room.findById(roomId))?.status, "completed");
});

test("an active item no room points at is adopted by recovery", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomId = await makeStuckRoom({ current: "orphan", pending: 1, ageMs: STUCK_AFTER_MS + 2_000 });
  assert.equal(await recoverStuckRooms(harness.io, { roomIds: [roomId] }), 1);

  const room = await Room.findById(roomId);
  const active = await AuctionItem.find({ roomId, status: "active" });
  assert.equal(active.length, 1, "adoption must not activate a second item");
  assert.equal(String(room?.currentItemId), String(active[0]._id));
  assert.equal(await AuctionItem.countDocuments({ roomId, status: "pending" }), 1);
});

test("a resolution that just happened is left for the normal path", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomId = await makeStuckRoom({ current: "sold", pending: 1, ageMs: 500 });
  assert.equal(await recoverStuckRooms(harness.io, { roomIds: [roomId] }), 0);
  assert.equal(await AuctionItem.countDocuments({ roomId, status: "active" }), 0);
});

test("concurrent recoveries of one stuck room activate exactly one item", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomId = await makeStuckRoom({ current: "sold", pending: 3, ageMs: STUCK_AFTER_MS + 2_000 });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => recoverStuckRooms(harness.io, { roomIds: [roomId] })),
  );

  assert.equal(results.reduce((a, b) => a + b, 0), 1, "only one recovery may win");
  assert.equal(await AuctionItem.countDocuments({ roomId, status: "active" }), 1);
  assert.equal(await AuctionItem.countDocuments({ roomId, status: "pending" }), 2);
});
