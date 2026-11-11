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

let dbAvailable = false;
let server: HttpServer;
let baseUrl: string;
let username: string;
let bidderUsername: string;
let hostSessionToken = "";
const createdRoomCodes: string[] = [];

type Json = Record<string, unknown>;

async function api(
  path: string,
  init: { method?: string; body?: unknown; token?: string; sessionToken?: string; raw?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.sessionToken) headers["x-session-token"] = init.sessionToken;

  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });

  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = { _raw: text };
  }
  return { status: response.status, body };
}

before(async () => {
  dbAvailable = await connectTestDatabase();
  if (!dbAvailable) return;

  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  username = `t_rest_${crypto.randomBytes(3).toString("hex")}`;
  bidderUsername = `t_bid_${crypto.randomBytes(3).toString("hex")}`;
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
  await User.deleteMany({ usernameNormalized: { $in: [username.toLowerCase(), bidderUsername.toLowerCase()] } });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
});

test("register rejects a weak password with 400", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await api("/auth/register", { method: "POST", body: { username, password: "weak" } });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /at least 8/);
});

test("register rejects reserved usernames", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  for (const reserved of ["admin", "demo", "demo_abc"]) {
    const res = await api("/auth/register", { method: "POST", body: { username: reserved, password: PASSWORD } });
    assert.equal(res.status, 400, `${reserved} should be reserved`);
  }
});

test("register rejects a non-string username without a 500", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  for (const bad of [123, {}, [], null, { $ne: null }]) {
    const res = await api("/auth/register", { method: "POST", body: { username: bad, password: PASSWORD } });
    assert.equal(res.status, 400, `username ${JSON.stringify(bad)} should be a client error`);
    assert.doesNotMatch(String(res.body.error), /Internal server error/);
  }
});

test("register creates an account and returns a token", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await api("/auth/register", { method: "POST", body: { username, password: PASSWORD } });
  assert.equal(res.status, 201);
  assert.equal(res.body.username, username);
  assert.ok(typeof res.body.token === "string" && (res.body.token as string).length > 0);
  assert.equal(res.body.passwordHash, undefined, "a password hash must never be returned");
  assert.equal(res.body.salt, undefined);
});

test("the stored password record uses the current iteration count", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const user = await User.findOne({ usernameNormalized: username.toLowerCase() });
  assert.equal(user?.hashIterations, 210_000);
});

test("registering the same username twice is refused", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await api("/auth/register", { method: "POST", body: { username, password: PASSWORD } });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already registered/);
});

test("login succeeds with the right password and fails identically for both wrong cases", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const good = await api("/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  assert.equal(good.status, 200);
  assert.ok(typeof good.body.token === "string");

  const wrongPassword = await api("/auth/login", { method: "POST", body: { username, password: "Wr0ng!Passw0rd" } });
  const unknownUser = await api("/auth/login", { method: "POST", body: { username: "t_nobody_here", password: PASSWORD } });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.equal(
    wrongPassword.body.error,
    unknownUser.body.error,
    "identical message, so the response cannot be used to enumerate users",
  );
});

test("/auth/me reflects the bearer token and returns null without one", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const login = await api("/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  const token = login.body.token as string;

  const authed = await api("/auth/me", { token });
  assert.equal(authed.status, 200);
  assert.equal((authed.body.user as Json)?.username, username);

  const anonymous = await api("/auth/me");
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.user, null);

  const forged = await api("/auth/me", { token: "not.a.real.jwt" });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.user, null, "a forged token must resolve to no user, not an error");
});

test("creating a room requires authentication", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await api("/rooms", { method: "POST", body: { roomName: "Unauthorized Room" } });
  assert.equal(res.status, 401);
});

test("a full host flow: create a room, add an item, read it back", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const login = await api("/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  const token = login.body.token as string;

  const created = await api("/rooms", {
    method: "POST",
    token,
    body: { roomName: "REST Test Room", startingBudget: 50_000, minBidIncrement: 500 },
  });
  assert.equal(created.status, 201);

  const room = created.body.room as Json;
  const code = room.code as string;
  const hostSession = created.body.sessionToken as string;
  hostSessionToken = hostSession;
  createdRoomCodes.push(code);

  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.ok(hostSession);

  const anonymousAdd = await api(`/rooms/${code}/items`, {
    method: "POST",
    body: { name: "No Session Item", startingBid: 1_000 },
  });
  assert.equal(anonymousAdd.status, 401, "adding an item without a session token must fail");

  const added = await api(`/rooms/${code}/items`, {
    method: "POST",
    sessionToken: hostSession,
    body: { name: "Test Lot", description: "A lot", startingBid: 1_000 },
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.name, "Test Lot");

  const items = await api(`/rooms/${code}/items`);
  assert.equal(items.status, 200);
  assert.equal((items.body as unknown as unknown[]).length, 1);
});

test("a second account can join, but cannot add items", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const code = createdRoomCodes[0];
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username: bidderUsername, password: PASSWORD },
  });
  assert.equal(registered.status, 201);
  const bidderToken = registered.body.token as string;

  const joined = await api(`/rooms/${code}/join`, { method: "POST", token: bidderToken });
  assert.equal(joined.status, 200);

  const bidderSession = joined.body.sessionToken as string;
  assert.ok(bidderSession, "a joiner must receive their own session token");
  assert.notEqual(bidderSession, hostSessionToken, "the joiner must not reuse the host session");

  const forbidden = await api(`/rooms/${code}/items`, {
    method: "POST",
    sessionToken: bidderSession,
    body: { name: "Bidder Lot", startingBid: 1_000 },
  });
  assert.equal(forbidden.status, 403, "a non-admin participant must not add items");
});

test("the host cannot join their own room a second time", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const login = await api("/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  const token = login.body.token as string;

  const again = await api(`/rooms/${createdRoomCodes[0]}/join`, { method: "POST", token });
  assert.ok(again.status === 400 || again.status === 409, `expected 400/409, got ${again.status}`);
  assert.match(String(again.body.error), /already taken/);
});

test("reading a room works, and an unknown code is a 404", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const found = await api(`/rooms/${createdRoomCodes[0]}`);
  assert.equal(found.status, 200);

  const missing = await api("/rooms/ZZZZZZ");
  assert.equal(missing.status, 404);
});

test("malformed JSON is a 400, not a 500", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const res = await api("/auth/login", { method: "POST", raw: "{ not json" });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
});

test("an oversized body is rejected by the size limit", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  const huge = JSON.stringify({ username: "x".repeat(200_000), password: PASSWORD });
  const res = await api("/auth/login", { method: "POST", raw: huge });
  assert.equal(res.status, 413, "a 200kb body must exceed the 32kb limit");
});

test("the sixth login attempt in a window is rate limited with Retry-After", async (t) => {
  if (!dbAvailable) return t.skip("no reachable MONGODB_URI");

  loginRateLimiter.clear();

  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Wr0ng!Passw0rd" }),
    });
    statuses.push(response.status);
    if (response.status === 429) {
      assert.ok(response.headers.get("retry-after"), "a 429 must carry Retry-After");
    }
    await response.text();
  }

  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(statuses[5], 429);
});
