import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import type { Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../app.js";
import { AuctionItem } from "../models/itemModel.js";
import { Bid } from "../models/bidModel.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";
import { connectTestDatabase } from "../utils/testDatabase.js";
import { BID_LOG_PAGE, ROOM_CONNECT_LIMIT, ROSTER_PAGE } from "./handlers/roomHandler.js";
import { connect, nextEvent, startHarness, type Harness } from "./testHarness.js";

type SeededRoom = {
  roomId: mongoose.Types.ObjectId;
  code: string;
  hostToken: string;
  hostId: string;
  tokens: string[];
  ids: string[];
};

type RoomState = {
  participants: Array<Record<string, unknown> & { _id: string; role: string; isConnected: boolean }>;
  participantCount: number;
  onlineCount: number;
  participantsTruncated: boolean;
  bids: Array<{ amount: number }>;
  bidCount: number;
};

type PresenceChanged = {
  participantCount: number;
  onlineCount: number;
  joinedCount: number;
  leftCount: number;
  joined: Array<Record<string, unknown> & { _id: string }>;
  left: string[];
};

let dbAvailable = false;
let harness: Harness;
let restServer: HttpServer;
let restUrl: string;
const seeded: SeededRoom[] = [];
const open: ClientSocket[] = [];

function track(socket: ClientSocket): ClientSocket {
  open.push(socket);
  return socket;
}

async function seedRoom(bidders: number): Promise<SeededRoom> {
  const code = `R${crypto.randomBytes(4).toString("hex").slice(0, 5)}`.toUpperCase();
  const room = await Room.create({
    code,
    name: `Roster ${code}`,
    status: "lobby",
    startingBudget: 100000,
    minBidIncrement: 100,
  });
  const tag = code.toLowerCase();
  const hostToken = crypto.randomUUID();
  const base = Date.now() - 1_000_000;

  const host = await Participant.create({
    roomId: room._id,
    username: `${tag}_host`,
    usernameNormalized: `${tag}_host`,
    role: "admin",
    sessionToken: hostToken,
    budget: 100000,
    spent: 0,
    joinedAt: new Date(base),
  });
  room.adminParticipantId = host._id;
  await room.save();

  const tokens: string[] = [];
  const docs = [];
  for (let index = 0; index < bidders; index += 1) {
    const token = crypto.randomUUID();
    tokens.push(token);
    docs.push({
      roomId: room._id,
      username: `${tag}_b${index}`,
      usernameNormalized: `${tag}_b${index}`,
      role: "participant",
      sessionToken: token,
      budget: 100000,
      spent: 0,
      isConnected: false,
      joinedAt: new Date(base + 1000 + Math.floor(index / 3)),
    });
  }
  const inserted = bidders > 0 ? await Participant.insertMany(docs) : [];

  const result = {
    roomId: room._id as mongoose.Types.ObjectId,
    code,
    hostToken,
    hostId: host._id.toString(),
    tokens,
    ids: inserted.map((doc) => doc._id.toString()),
  };
  seeded.push(result);
  return result;
}

async function join(token: string, code: string): Promise<{ socket: ClientSocket; state: RoomState }> {
  const socket = track(await connect(harness.url, { sessionToken: token, roomCode: code }));
  const pending = nextEvent<RoomState>(socket, "room:state");
  socket.emit("room:connect");
  return { socket, state: await pending };
}

function sawEvent(socket: ClientSocket, event: string, withinMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(false);
    }, withinMs);
    function onEvent(): void {
      clearTimeout(timer);
      resolve(true);
    }
    socket.once(event, onEvent);
  });
}

function waitForPresence(
  socket: ClientSocket,
  matches: (payload: PresenceChanged) => boolean,
  timeoutMs = 6_000,
): Promise<PresenceChanged> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("presence:changed", onEvent);
      reject(new Error("Timed out waiting for a matching presence:changed"));
    }, timeoutMs);
    function onEvent(payload: PresenceChanged): void {
      if (!matches(payload)) return;
      clearTimeout(timer);
      socket.off("presence:changed", onEvent);
      resolve(payload);
    }
    socket.on("presence:changed", onEvent);
  });
}

async function rest(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${restUrl}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;

  harness = await startHarness();
  restServer = createServer(createApp());
  await new Promise<void>((resolve) => restServer.listen(0, "127.0.0.1", resolve));
  restUrl = `http://127.0.0.1:${(restServer.address() as AddressInfo).port}/api`;
});

after(async () => {
  for (const socket of open) socket.close();
  if (!dbAvailable) return;

  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const room of seeded) {
    await Bid.deleteMany({ roomId: room.roomId });
    await AuctionItem.deleteMany({ roomId: room.roomId });
    await Participant.deleteMany({ roomId: room.roomId });
    await Room.deleteMany({ _id: room.roomId });
  }
  await harness.close();
  await new Promise<void>((resolve) => restServer.close(() => resolve()));
  await mongoose.disconnect();
});

test("a room at or under the page size still receives its whole roster", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(ROSTER_PAGE - 1);
  const { socket, state } = await join(room.tokens[0], room.code);

  assert.equal(state.participantsTruncated, false);
  assert.equal(state.participants.length, ROSTER_PAGE);
  assert.equal(state.participantCount, ROSTER_PAGE);
  assert.equal(state.onlineCount, 1);
  socket.close();
});

test("a large room receives a capped roster that always holds the requester and the host", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(150);
  const lastBidder = room.ids[149];
  const { socket, state } = await join(room.tokens[149], room.code);

  assert.equal(state.participantsTruncated, true);
  assert.equal(state.participantCount, 151);
  assert.ok(state.participants.length <= ROSTER_PAGE + 2, `roster of ${state.participants.length} exceeds the cap`);
  assert.ok(state.participants.length >= ROSTER_PAGE);

  const self = state.participants.find((entry) => entry._id === lastBidder);
  assert.ok(self, "the requester must be in its own roster");
  assert.equal(self.isConnected, true);
  assert.ok(state.participants.some((entry) => entry._id === room.hostId && entry.role === "admin"), "the host must be in the roster");
  assert.equal(new Set(state.participants.map((entry) => entry._id)).size, state.participants.length, "no duplicates");
  assert.ok(state.onlineCount >= 0 && state.onlineCount <= 151);
  assert.equal(JSON.stringify(state).includes("sessionToken"), false, "no session token may leave the server");
  socket.close();
});

test("a large room lists online participants first", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(150);
  const onlineIds = room.ids.slice(140, 145);
  await Participant.updateMany({ _id: { $in: onlineIds } }, { $set: { isConnected: true } });

  const { socket, state } = await join(room.hostToken, room.code);
  for (const id of onlineIds) {
    assert.ok(state.participants.some((entry) => entry._id === id && entry.isConnected), `online participant ${id} missing`);
  }
  socket.close();
});

test("a small room keeps per-person presence events and sends no batch", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(3);
  const host = await join(room.hostToken, room.code);

  const joined = nextEvent<{ participant: { _id: string } }>(host.socket, "participant:joined");
  const batched = sawEvent(host.socket, "presence:changed", 1_800);
  const bidder = await join(room.tokens[0], room.code);

  assert.equal((await joined).participant._id, room.ids[0]);
  assert.equal(await batched, false);
  bidder.socket.close();
  host.socket.close();
});

test("a large room batches presence into presence:changed and sends no per-person events", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(150);
  const host = await join(room.hostToken, room.code);

  const perPerson = sawEvent(host.socket, "participant:joined", 2_500);
  const arrival = waitForPresence(host.socket, (payload) => payload.joined.some((entry) => entry._id === room.ids[7]));
  const bidder = await join(room.tokens[7], room.code);
  const second = await join(room.tokens[8], room.code);

  const batch = await arrival;
  assert.equal(batch.participantCount, 151);
  assert.ok(batch.onlineCount >= 2, `onlineCount ${batch.onlineCount}`);
  assert.ok(batch.joinedCount >= 1);
  assert.equal(JSON.stringify(batch).includes("sessionToken"), false);
  assert.equal(await perPerson, false, "a large room must not broadcast participant:joined");

  const perPersonLeft = sawEvent(host.socket, "participant:left", 3_000);
  const departure = waitForPresence(host.socket, (payload) => payload.left.includes(room.ids[7]));
  bidder.socket.close();

  const gone = await departure;
  assert.ok(gone.leftCount >= 1);
  assert.equal(await perPersonLeft, false, "a large room must not broadcast participant:left");
  assert.equal((await Participant.findById(room.ids[7]))?.isConnected, false);

  second.socket.close();
  host.socket.close();
});

test("room:state carries only the newest bids plus the full count", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(1);
  const item = await AuctionItem.create({
    roomId: room.roomId,
    name: "Capped log",
    startingBid: 100,
    currentBid: 100 + 129 * 100,
    status: "active",
    endsAt: new Date(Date.now() + 600_000),
  });
  await Room.updateOne({ _id: room.roomId }, { $set: { status: "live", currentItemId: item._id, endsAt: item.endsAt } });

  const total = BID_LOG_PAGE + 30;
  const start = Date.now() - total * 1000;
  await Bid.insertMany(
    Array.from({ length: total }, (_, index) => ({
      roomId: room.roomId,
      itemId: item._id,
      participantId: room.ids[0],
      username: "capped",
      amount: 100 + index * 100,
      createdAt: new Date(start + index * 1000),
    })),
  );

  const { socket, state } = await join(room.tokens[0], room.code);
  assert.equal(state.bids.length, BID_LOG_PAGE);
  assert.equal(state.bidCount, total);
  assert.equal(state.bids[0].amount, 100 + (total - 1) * 100, "newest bid first");
  socket.close();

  await Room.updateOne({ _id: room.roomId }, { $set: { status: "completed", currentItemId: null, endsAt: null } });
  await AuctionItem.updateOne({ _id: item._id }, { $set: { status: "unsold", endsAt: null } });
});

test("the roster endpoint pages through every participant once, in a stable order", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(150);
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const query: string = cursor ? `?limit=40&cursor=${cursor}` : "?limit=40";
    const { status, body } = await rest(`/rooms/${room.code}/participants${query}`);
    assert.equal(status, 200);
    const page = body.participants as Array<{ _id: string; joinedAt: string }>;
    assert.ok(page.length <= 40);
    assert.equal(body.participantCount, 151);
    assert.equal(JSON.stringify(body).includes("sessionToken"), false);
    seen.push(...page.map((entry) => entry._id));
    cursor = body.nextCursor as string | null;
    pages += 1;
  } while (cursor && pages < 10);

  assert.equal(pages, 4);
  assert.equal(seen.length, 151);
  assert.equal(new Set(seen).size, 151, "no participant may repeat across pages");

  const expected = await Participant.find({ roomId: room.roomId }).sort({ joinedAt: 1, _id: 1 }).select("_id").lean();
  assert.deepEqual(seen, expected.map((entry) => entry._id.toString()));
});

test("room:connect is rate limited per socket and an over-limit request does no work", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(2);
  const socket = track(await connect(harness.url, { sessionToken: room.tokens[0], roomCode: room.code }));
  const states: unknown[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  socket.on("room:state", (state) => states.push(state));
  socket.on("error", (error: { code: string; message: string }) => errors.push(error));

  for (let attempt = 0; attempt < ROOM_CONNECT_LIMIT.limit + 2; attempt += 1) socket.emit("room:connect");
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  assert.equal(states.length, ROOM_CONNECT_LIMIT.limit);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.code === "RATE_LIMITED"));

  const other = await join(room.tokens[1], room.code);
  assert.equal(other.state.participantCount, 3, "one socket's limit must not block another socket");
  other.socket.close();
  socket.close();
});

test("the roster endpoint bounds its limit and rejects bad input", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const room = await seedRoom(150);
  const path = `/rooms/${room.code}/participants`;

  const capped = await rest(`${path}?limit=5000`);
  assert.equal(capped.status, 200);
  assert.equal((capped.body.participants as unknown[]).length, 100);

  const defaulted = await rest(path);
  assert.equal(defaulted.status, 200);
  assert.equal((defaulted.body.participants as unknown[]).length, 50);

  for (const query of ["?limit=0", "?limit=-3", "?limit=abc", "?limit=1.5", "?cursor=nope", `?cursor=${"9".repeat(60)}`, "?limit=10&limit=20", "?cursor=a&cursor=b"]) {
    const { status, body } = await rest(`${path}${query}`);
    assert.equal(status, 400, query);
    assert.equal(typeof body.error, "string", query);
  }

  for (const query of ["?limit[$gt]=1", "?cursor[$ne]=1"]) {
    const { status, body } = await rest(`${path}${query}`);
    assert.equal(status, 200, query);
    assert.equal((body.participants as unknown[]).length, 50, `${query} must be ignored, not read as an operator`);
  }

  assert.equal((await rest("/rooms/ZZZZZZ/participants")).status, 404);
});
