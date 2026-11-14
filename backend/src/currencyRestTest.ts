import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { connectTestDatabase } from "./utils/testDatabase.js";
import { loginRateLimiter } from "./middleware/rateLimit.js";
import { AuctionItem } from "./models/itemModel.js";
import { Participant } from "./models/participantModel.js";
import { Room } from "./models/roomModel.js";
import { User } from "./models/userModel.js";

const PASSWORD = "Str0ng!Passw0rd";

type Json = Record<string, unknown>;

let dbAvailable = false;
let server: HttpServer;
let baseUrl: string;
let token = "";
const username = `t_curr_${crypto.randomBytes(3).toString("hex")}`;
const createdRoomCodes: string[] = [];

async function api(
  path: string,
  init: { method?: string; body?: unknown; sessionToken?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.sessionToken) headers["x-session-token"] = init.sessionToken;

  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
}

async function createRoom(body: Json) {
  const res = await api("/rooms", { method: "POST", body: { roomName: "Currency REST Room", ...body } });
  if (res.status === 201) createdRoomCodes.push((res.body.room as Json).code as string);
  return res;
}

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;

  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  loginRateLimiter.clear();
  const registered = await api("/auth/register", { method: "POST", body: { username, password: PASSWORD } });
  token = registered.body.token as string;
});

beforeEach(() => {
  loginRateLimiter.clear();
});

after(async () => {
  if (!dbAvailable) return;
  for (const code of createdRoomCodes) {
    const room = await Room.findOne({ code });
    if (!room) continue;
    await AuctionItem.deleteMany({ roomId: room._id });
    await Participant.deleteMany({ roomId: room._id });
    await Room.deleteMany({ _id: room._id });
  }
  await User.deleteMany({ usernameNormalized: username.toLowerCase() });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
});

test("a room created without a currency is INR, as before", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await createRoom({ startingBudget: 50_000, minBidIncrement: 500 });
  assert.equal(res.status, 201);
  assert.equal((res.body.room as Json).currency, "INR");
});

test("a room can be created in another currency, and the code is normalized", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  for (const [sent, stored] of [["USD", "USD"], ["jpy", "JPY"], [" eur ", "EUR"], ["KWD", "KWD"]]) {
    const res = await createRoom({ startingBudget: 50_000, minBidIncrement: 500, currency: sent });
    assert.equal(res.status, 201, `currency ${sent}`);
    assert.equal((res.body.room as Json).currency, stored);
  }
});

test("the currency is returned by the room read and stored on the document", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const created = await createRoom({ currency: "GBP" });
  const code = (created.body.room as Json).code as string;

  const read = await api(`/rooms/${code}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.currency, "GBP");
  assert.equal((await Room.findOne({ code }))?.currency, "GBP");
});

test("an unsupported or malformed currency is a 400 and creates nothing", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const roomName = `Refused ${crypto.randomBytes(4).toString("hex")}`;
  for (const currency of ["ZZZ", "rupees", "US", 42, ["USD"], { $ne: null }, true]) {
    const res = await createRoom({ currency, roomName });
    assert.equal(res.status, 400, `currency ${JSON.stringify(currency)} must be refused`);
    assert.match(String(res.body.error), /currency/i);
  }
  assert.equal(await Room.countDocuments({ name: roomName }), 0);
});

test("budget and minimum raise must be whole numbers", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const fractionalBudget = await createRoom({ startingBudget: 50_000.5, minBidIncrement: 500 });
  assert.equal(fractionalBudget.status, 400);
  assert.match(String(fractionalBudget.body.error), /Starting budget must be a whole number/);

  const fractionalIncrement = await createRoom({ startingBudget: 50_000, minBidIncrement: 0.5 });
  assert.equal(fractionalIncrement.status, 400);
  assert.match(String(fractionalIncrement.body.error), /Minimum bid increment must be a whole number/);
});

test("an item's starting bid must be a whole number", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const created = await createRoom({ currency: "USD" });
  const code = (created.body.room as Json).code as string;
  const sessionToken = created.body.sessionToken as string;

  const fractional = await api(`/rooms/${code}/items`, {
    method: "POST",
    sessionToken,
    body: { name: "Half Lot", startingBid: 999.99 },
  });
  assert.equal(fractional.status, 400);
  assert.match(String(fractional.body.error), /Starting bid must be a whole number/);

  const whole = await api(`/rooms/${code}/items`, {
    method: "POST",
    sessionToken,
    body: { name: "Whole Lot", startingBid: 1_000 },
  });
  assert.equal(whole.status, 201);
});
