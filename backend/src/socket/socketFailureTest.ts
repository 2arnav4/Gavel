import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import type { Socket as ClientSocket } from "socket.io-client";
import { env } from "../config/env.js";
import { AuctionItem } from "../models/itemModel.js";
import { Bid } from "../models/bidModel.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";
import { connect, expectRejectedHandshake, nextEvent, startHarness, type Harness } from "./testHarness.js";

type BidRejection = { reason: string; minimumBid?: number; retryAfterMs?: number };
type SocketError = { message: string };

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

before(async () => {
  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5_000,
      dbName: env.mongodbDbName,
    });
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }

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
  assert.match(rejection.reason, /hosts are not allowed to place bids/);
  assert.equal(rejection.minimumBid, undefined);
  socket.close();
});

test("a malformed bid payload reports the real minimum, not currentBid + 1", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));

  for (const payload of [null, 42, "abc", {}, undefined]) {
    const pending = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", payload);

    const rejection = await pending;
    assert.match(rejection.reason, /must be a valid number/);
    assert.equal(rejection.minimumBid, STARTING_BID);
  }

  socket.close();
});

test("a bid below the minimum is rejected with the increment-aware minimum", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: poorToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID - 1 });

  const rejection = await pending;
  assert.equal(rejection.minimumBid, STARTING_BID);
  socket.close();
});

test("a bid beyond the remaining purse is rejected", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: poorToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID });

  const rejection = await pending;
  assert.match(rejection.reason, /exceeds your remaining purse/);
  assert.equal(rejection.minimumBid, STARTING_BID);
  socket.close();
});

test("the sixth bid inside one second is throttled and carries a retry delay", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const throttleToken = crypto.randomUUID();
  await Participant.create({
    roomId,
    username: "t_flood",
    usernameNormalized: "t_flood",
    role: "participant",
    sessionToken: throttleToken,
    budget: BIDDER_BUDGET,
    spent: 0,
  });

  const socket = track(await connect(harness.url, { sessionToken: throttleToken, roomCode }));

  const rejections: BidRejection[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pending = nextEvent<BidRejection>(socket, "bid:rejected");
    socket.emit("bid:place", { amount: "not-a-number" });
    rejections.push(await pending);
  }

  const throttled = rejections[5];
  assert.match(throttled.reason, /bidding too quickly/);
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
    assert.match((await pending).message, /Only room hosts can resolve items/);
  }

  socket.close();
});

test("an accepted bid is written once and broadcast to the room", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const socket = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
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

  const socket = track(await connect(harness.url, { sessionToken: bidderToken, roomCode }));
  const pending = nextEvent<BidRejection>(socket, "bid:rejected");
  socket.emit("bid:place", { amount: STARTING_BID + 1 });

  const rejection = await pending;
  assert.equal(rejection.minimumBid, STARTING_BID + MIN_INCREMENT);
  socket.close();
});

const GRACE_MS = Number(process.env.PRESENCE_GRACE_MS ?? 10_000);

function neverEvent(socket: ClientSocket, event: string, withinMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(true);
    }, withinMs);

    function onEvent(): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(false);
    }

    socket.once(event, onEvent);
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

  const noDeparture = neverEvent(observer, "participant:left", GRACE_MS * 3);
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

  const departure = nextEvent<{ participant: { username: string; isConnected: boolean } }>(
    observer,
    "participant:left",
    GRACE_MS * 5 + 2_000,
  );
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

  const noDeparture = neverEvent(observer, "participant:left", GRACE_MS * 3);
  tabTwo.close();

  assert.equal(await noDeparture, true);
  assert.equal(
    (await Participant.findOne({ sessionToken: bidderToken }))?.isConnected,
    true,
  );

  tabOne.close();
  observer.close();
});
