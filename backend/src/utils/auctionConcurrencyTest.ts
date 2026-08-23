import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuctionItem } from "../models/itemModel.js";
import { Room } from "../models/roomModel.js";
import { Participant } from "../models/participantModel.js";

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

let dbAvailable = false;
let roomId: mongoose.Types.ObjectId;

before(async () => {
  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5_000,
      dbName: env.mongodbDbName,
    });
    dbAvailable = true;
    const room = await Room.create({
      code: `T${Date.now().toString(36).slice(-5).toUpperCase()}`,
      name: "Concurrency Test Room",
      status: "live",
      startingBudget: 1_000_000,
      minBidIncrement: TEST_INCREMENT,
    });
    roomId = room._id as mongoose.Types.ObjectId;
  } catch {
    dbAvailable = false;
  }
});

after(async () => {
  if (!dbAvailable) return;
  await AuctionItem.deleteMany({ roomId });
  await Room.deleteMany({ _id: roomId });
  await mongoose.disconnect();
});

async function createActiveItem(startingBid: number, endsInMs: number) {
  return AuctionItem.create({
    roomId,
    name: "Concurrency Fixture",
    startingBid,
    currentBid: 0,
    status: "active",
    endsAt: new Date(Date.now() + endsInMs),
  });
}

const TEST_INCREMENT = 100;

/** The bid handler's claim, in full. */
function claimBid(itemId: mongoose.Types.ObjectId, amount: number, newEndsAt: Date) {
  return AuctionItem.findOneAndUpdate(
    {
      _id: itemId,
      status: "active",
      isPaused: false,
      endsAt: { $gt: new Date() },
      $expr: {
        $cond: {
          if: { $gt: ["$currentBid", 0] },
          then: { $gte: [amount, { $add: ["$currentBid", TEST_INCREMENT] }] },
          else: { $gte: [amount, "$startingBid"] },
        },
      },
    },
    { $set: { currentBid: amount, endsAt: newEndsAt } },
    { new: true },
  );
}

/** The host's pause claim, in full. */
function claimPause(itemId: mongoose.Types.ObjectId) {
  return AuctionItem.findOneAndUpdate(
    { _id: itemId, status: "active", isPaused: false, endsAt: { $gt: new Date() } },
    { $set: { isPaused: true, endsAt: null } },
    { new: false },
  );
}

test("only one of many identical concurrent bids is accepted", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  const later = new Date(Date.now() + 60_000);

  const results = await Promise.all(
    Array.from({ length: 20 }, () => claimBid(item._id as mongoose.Types.ObjectId, 500, later)),
  );

  const accepted = results.filter((result) => result !== null);
  assert.equal(accepted.length, 1, "exactly one bid at the same amount may win");

  const stored = await AuctionItem.findById(item._id);
  assert.equal(stored?.currentBid, 500);
});

test("a rising ladder of concurrent bids settles on the highest", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  const later = new Date(Date.now() + 60_000);
  const amounts = [150, 400, 250, 900, 300, 700];

  await Promise.all(
    amounts.map((amount) => claimBid(item._id as mongoose.Types.ObjectId, amount, later)),
  );

  const stored = await AuctionItem.findById(item._id);
  assert.equal(stored?.currentBid, Math.max(...amounts), "the highest bid must survive the race");
});

test("a bid below the asking price cannot win even with no bids yet", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);

  const result = await claimBid(item._id as mongoose.Types.ObjectId, 50, new Date(Date.now() + 60_000));
  assert.equal(result, null, "currentBid starts at zero, so startingBid must be enforced in the filter");
});

test("the opening bid may match the asking price exactly", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);

  const result = await claimBid(item._id as mongoose.Types.ObjectId, 100, new Date(Date.now() + 60_000));
  assert.notEqual(result, null, "an item listed at 100 must be openable at 100");
});

test("a raise below the minimum increment is refused", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  const later = new Date(Date.now() + 60_000);

  await claimBid(item._id as mongoose.Types.ObjectId, 1_000, later);

  const oneRupeeMore = await claimBid(item._id as mongoose.Types.ObjectId, 1_001, later);
  assert.equal(oneRupeeMore, null, "outbidding by a rupee must not be possible");

  const justUnder = await claimBid(item._id as mongoose.Types.ObjectId, 1_099, later);
  assert.equal(justUnder, null, "one short of the increment is still short");

  const exact = await claimBid(item._id as mongoose.Types.ObjectId, 1_100, later);
  assert.notEqual(exact, null, "exactly one increment above must be accepted");
});

test("the increment is measured against the live price, not a stale read", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  const later = new Date(Date.now() + 60_000);
  await claimBid(item._id as mongoose.Types.ObjectId, 1_000, later);

  // Two bidders both saw ₹1,000 and both compute ₹1,100 as legal. Only one can
  // win; the loser's amount is no longer a full increment above the new price,
  // so it must fail rather than sneak through on a stale comparison.
  const results = await Promise.all([
    claimBid(item._id as mongoose.Types.ObjectId, 1_100, later),
    claimBid(item._id as mongoose.Types.ObjectId, 1_100, later),
  ]);
  assert.equal(results.filter((r) => r !== null).length, 1, "only one raise may land");

  const stored = await AuctionItem.findById(item._id);
  assert.equal(stored?.currentBid, 1_100);
});

test("only one of two simultaneous resolutions wins", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);

  const [sell, unsold] = await Promise.all([
    AuctionItem.findOneAndUpdate(
      { _id: item._id, status: "active" },
      { $set: { status: "sold" } },
      { new: true },
    ),
    AuctionItem.findOneAndUpdate(
      { _id: item._id, status: "active" },
      { $set: { status: "unsold" } },
      { new: true },
    ),
  ]);

  const winners = [sell, unsold].filter((result) => result !== null);
  assert.equal(winners.length, 1, "an item can only be resolved once");
});

test("a stale expiry cannot end an item whose deadline was extended", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  // The item's deadline has already been pushed into the future by an accepted
  // bid. A timer callback fired for the previous deadline is now in flight and
  // cannot be cancelled, so it must fail to claim the item.
  const item = await createActiveItem(100, 60_000);

  const staleExpiry = await AuctionItem.findOneAndUpdate(
    { _id: item._id, status: "active", endsAt: { $lte: new Date() } },
    { $set: { status: "sold" } },
    { new: true },
  );

  assert.equal(staleExpiry, null, "an extended item must survive its previous timer");

  const stored = await AuctionItem.findById(item._id);
  assert.equal(stored?.status, "active", "the item must still be open for bidding");
});

test("only one of two simultaneous pauses wins, so the remainder is read once", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);

  const results = await Promise.all([
    claimPause(item._id as mongoose.Types.ObjectId),
    claimPause(item._id as mongoose.Types.ObjectId),
  ]);

  const winners = results.filter((result) => result !== null);
  assert.equal(winners.length, 1, "a double click must not compute the remaining time twice");
  assert.notEqual(winners[0]?.endsAt, null, "the winner must see the pre-pause deadline");
});

test("a paused item accepts no bids", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  await claimPause(item._id as mongoose.Types.ObjectId);

  const result = await claimBid(item._id as mongoose.Types.ObjectId, 5_000, new Date(Date.now() + 60_000));
  assert.equal(result, null, "pausing must close bidding at the database, not just in the UI");
});

test("resuming restores bidding with the remaining time", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 30_000);
  const before = await claimPause(item._id as mongoose.Types.ObjectId);
  const remainingMs = (before!.endsAt as Date).getTime() - Date.now();

  const resumed = await AuctionItem.findOneAndUpdate(
    { _id: item._id, status: "active", isPaused: true },
    { $set: { isPaused: false, endsAt: new Date(Date.now() + remainingMs) } },
    { new: true },
  );
  assert.notEqual(resumed, null, "a paused item must be resumable");

  const bid = await claimBid(item._id as mongoose.Types.ObjectId, 500, new Date(Date.now() + 30_000));
  assert.notEqual(bid, null, "bidding must reopen after resume");
});

test("a paused item cannot be expired by a timer", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, 60_000);
  await claimPause(item._id as mongoose.Types.ObjectId);

  // endsAt is null while paused, and null never satisfies $lte against a date,
  // so an expiry cannot claim a frozen item however long the pause lasts.
  const expiry = await AuctionItem.findOneAndUpdate(
    { _id: item._id, status: "active", endsAt: { $lte: new Date() } },
    { $set: { status: "unsold" } },
    { new: true },
  );
  assert.equal(expiry, null, "a pause must survive indefinitely without expiring");
});

test("a winner is charged exactly once, even if two resolutions race", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const bidder = await Participant.create({
    roomId,
    username: `budget_${Date.now().toString(36)}`,
    usernameNormalized: `budget_${Date.now().toString(36)}`,
    role: "participant",
    sessionToken: `tok_${Date.now()}_${Math.random()}`,
    budget: 10_000,
    spent: 0,
  });

  const item = await AuctionItem.create({
    roomId,
    name: "Charged Once",
    startingBid: 100,
    currentBid: 4_000,
    highestBidderId: bidder._id,
    status: "active",
    endsAt: new Date(Date.now() - 1_000),
  });

  // Both a host sell and a timer expiry fire at the same instant. Only the one
  // that claims the item may charge the winner.
  const resolutions = await Promise.all([
    AuctionItem.findOneAndUpdate({ _id: item._id, status: "active" }, { $set: { status: "sold" } }, { new: true }),
    AuctionItem.findOneAndUpdate({ _id: item._id, status: "active" }, { $set: { status: "sold" } }, { new: true }),
  ]);
  const winners = resolutions.filter((result) => result !== null);
  assert.equal(winners.length, 1, "only one resolution may claim the item");

  await Participant.updateOne({ _id: bidder._id }, { $inc: { spent: winners[0]!.currentBid } });

  const charged = await Participant.findById(bidder._id);
  assert.equal(charged?.spent, 4_000, "the purse must be debited once, not twice");
  assert.equal((charged!.budget - charged!.spent), 6_000, "remaining purse must reflect a single sale");

  await Participant.deleteOne({ _id: bidder._id });
});

test("an expiry does claim an item whose deadline has genuinely passed", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");
  const item = await createActiveItem(100, -1_000);

  const expiry = await AuctionItem.findOneAndUpdate(
    { _id: item._id, status: "active", endsAt: { $lte: new Date() } },
    { $set: { status: "unsold" } },
    { new: true },
  );

  assert.notEqual(expiry, null, "the elapsed-deadline guard must not block a real expiry");
  assert.equal(expiry?.status, "unsold");
});
