import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import type { Socket as ClientSocket } from "socket.io-client";
import { AuctionItem } from "../models/itemModel.js";
import { Bid } from "../models/bidModel.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";
import { clearAuctionTimer } from "../socket/handlers/resolutionHandler.js";
import { connect, nextEvent, startHarness, type Harness } from "../socket/testHarness.js";
import { connectTestDatabase } from "../utils/testDatabase.js";
import { connectRedis, createStreamsAdapter, type RedisConnection } from "./redisClient.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
const STARTING_BID = 1_000;
const MIN_INCREMENT = 500;

let ready = false;
let skipReason = "";
let redisA: RedisConnection | null = null;
let redisB: RedisConnection | null = null;
let serverA: Harness;
let serverB: Harness;
let roomId: mongoose.Types.ObjectId;
let roomCode: string;
let itemId: string;
const tokens: Record<string, string> = {};
const openSockets: ClientSocket[] = [];

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

async function joined(server: Harness, who: string): Promise<ClientSocket> {
  const socket = track(await connect(server.url, { sessionToken: tokens[who], roomCode }));
  socket.emit("room:connect");
  await nextEvent(socket, "room:state");
  return socket;
}

async function currentFloor(): Promise<number> {
  const item = await AuctionItem.findById(itemId);
  return item!.currentBid > 0 ? item!.currentBid + MIN_INCREMENT : item!.startingBid;
}

before(async () => {
  if (!(await connectTestDatabase())) {
    skipReason = "no reachable MONGODB_URI";
    return;
  }
  redisA = await connectRedis(REDIS_URL);
  redisB = redisA ? await connectRedis(REDIS_URL) : null;
  if (!redisA || !redisB) {
    skipReason = "no reachable local Redis";
    return;
  }

  const streamName = `gavel:test:${crypto.randomUUID()}`;
  serverA = await startHarness({ adapter: createStreamsAdapter(redisA, streamName) });
  serverB = await startHarness({ adapter: createStreamsAdapter(redisB, streamName) });

  roomCode = `M${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const room = await Room.create({
    code: roomCode,
    name: "Multi Instance Room",
    status: "live",
    startingBudget: 1_000_000,
    minBidIncrement: MIN_INCREMENT,
  });
  roomId = room._id as mongoose.Types.ObjectId;

  const item = await AuctionItem.create({
    roomId,
    name: "Multi Instance Fixture",
    startingBid: STARTING_BID,
    currentBid: 0,
    status: "active",
    endsAt: new Date(Date.now() + 5 * 60_000),
  });
  itemId = item._id.toString();
  await Room.updateOne({ _id: roomId }, { $set: { currentItemId: item._id } });

  for (const name of ["m_host", "m_a", "m_b", "m_c"]) {
    tokens[name] = crypto.randomUUID();
    await Participant.create({
      roomId,
      username: name,
      usernameNormalized: name,
      role: name === "m_host" ? "admin" : "participant",
      sessionToken: tokens[name],
      budget: 1_000_000,
      spent: 0,
    });
  }
  ready = true;
});

after(async () => {
  for (const socket of openSockets) socket.close();
  if (ready) {
    clearAuctionTimer(roomId.toString());
    await serverA.close();
    await serverB.close();
    await Bid.deleteMany({ roomId });
    await AuctionItem.deleteMany({ roomId });
    await Participant.deleteMany({ roomId });
    await Room.deleteMany({ _id: roomId });
  }
  if (redisA?.isOpen) await redisA.close();
  if (redisB?.isOpen) await redisB.close();
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
});

test("a bid accepted on server A reaches a bidder connected to server B", async (t) => {
  if (!ready) return t.skip(skipReason);

  const bidderOnA = await joined(serverA, "m_a");
  const observerOnB = await joined(serverB, "m_b");
  const amount = await currentFloor();

  const seenOnB = nextEvent<{ bid: { amount: number; username: string }; version: number }>(observerOnB, "bid:accepted");
  bidderOnA.emit("bid:place", { amount, itemId });
  const event = await seenOnB;

  assert.equal(event.bid.amount, amount);
  assert.equal(event.bid.username, "m_a");
  assert.equal(typeof event.version, "number");
});

test("both servers converge on the same final price after bids from each side", async (t) => {
  if (!ready) return t.skip(skipReason);

  const onA = await joined(serverA, "m_a");
  const onB = await joined(serverB, "m_b");
  const watcherA = await joined(serverA, "m_host");
  const watcherB = await joined(serverB, "m_c");

  const lastSeen = (socket: ClientSocket) => {
    let latest = 0;
    socket.on("bid:accepted", (payload: { item: { currentBid: number } }) => {
      latest = Math.max(latest, payload.item.currentBid);
    });
    return () => latest;
  };
  const priceOnA = lastSeen(watcherA);
  const priceOnB = lastSeen(watcherB);

  for (let round = 0; round < 3; round += 1) {
    const amount = await currentFloor();
    const bidder = round % 2 === 0 ? onA : onB;
    const done = nextEvent(watcherB, "bid:accepted");
    bidder.emit("bid:place", { amount, itemId });
    await done;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  const stored = (await AuctionItem.findById(itemId))!.currentBid;
  assert.equal(priceOnA(), stored, "watchers on server A must see the stored price");
  assert.equal(priceOnB(), stored, "watchers on server B must see the stored price");
});

test("losing Redis does not crash the server, and local clients still get the broadcast", async (t) => {
  if (!ready) return t.skip(skipReason);

  const bidderOnA = await joined(serverA, "m_a");
  const watcherOnA = await joined(serverA, "m_host");

  await redisA!.destroy();

  const amount = await currentFloor();
  const localSeen = nextEvent<{ bid: { amount: number } }>(watcherOnA, "bid:accepted", 3_000);
  bidderOnA.emit("bid:place", { amount, itemId });

  assert.equal((await localSeen).bid.amount, amount, "same-server delivery must survive a Redis outage");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await AuctionItem.findById(itemId))!.currentBid, amount, "the bid itself is decided by MongoDB, not Redis");
});
