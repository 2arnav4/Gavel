import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import { connectRedis, type RedisConnection } from "./redisClient.js";
import { createLocalPresenceStore, createRedisPresenceStore, type PresenceStore } from "./presenceStore.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

let client: RedisConnection | null = null;
const stores: PresenceStore[] = [];

function store(options: { prefix: string; entryTtlMs?: number; heartbeatMs?: number }): PresenceStore {
  const created = createRedisPresenceStore({ client: client!, ...options });
  stores.push(created);
  return created;
}

before(async () => {
  client = await connectRedis(REDIS_URL);
});

after(async () => {
  for (const created of stores) created.close();
  if (client?.isOpen) await client.close();
});

test("the local store keeps today's single-process behaviour", async () => {
  const local = createLocalPresenceStore();
  assert.equal(await local.attach("p", "s1"), "first-socket");
  assert.equal(await local.attach("p", "s2"), "additional-socket");
  assert.equal(await local.detach("p", "s1"), "remaining-sockets");
  assert.equal(await local.detach("p", "s2"), "last-socket");
  assert.equal(await local.socketCount("p"), 0);
});

test("two instances see one participant's sockets as one presence", async (t) => {
  if (!client) return t.skip("no reachable local Redis");

  const prefix = `gavel:test:presence:${crypto.randomUUID()}`;
  const instanceA = store({ prefix });
  const instanceB = store({ prefix });

  assert.equal(await instanceA.attach("p1", "a-1"), "first-socket");
  assert.equal(await instanceB.attach("p1", "b-1"), "additional-socket", "a tab on another instance is not a fresh join");
  assert.equal(await instanceB.socketCount("p1"), 2);
  assert.equal(await instanceA.detach("p1", "a-1"), "remaining-sockets", "the tab on instance B keeps them online");
  assert.equal(await instanceA.socketCount("p1"), 1, "instance A can see instance B's socket");
  assert.equal(await instanceB.detach("p1", "b-1"), "last-socket");
});

test("a crashed instance's sockets expire instead of keeping someone online forever", async (t) => {
  if (!client) return t.skip("no reachable local Redis");

  const prefix = `gavel:test:presence:${crypto.randomUUID()}`;
  const crashed = store({ prefix, entryTtlMs: 200, heartbeatMs: 60_000 });
  const survivor = store({ prefix });

  await crashed.attach("p2", "dead-socket");
  assert.equal(await survivor.socketCount("p2"), 1);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await survivor.socketCount("p2"), 0, "an entry nobody refreshed must stop counting");
});

test("the heartbeat keeps a live instance's sockets counted past the entry TTL", async (t) => {
  if (!client) return t.skip("no reachable local Redis");

  const prefix = `gavel:test:presence:${crypto.randomUUID()}`;
  const live = store({ prefix, entryTtlMs: 300, heartbeatMs: 100 });

  await live.attach("p3", "s");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await live.socketCount("p3"), 1);
});

test("a lost Redis connection falls back to this instance's view", async (t) => {
  const isolated = await connectRedis(REDIS_URL);
  if (!isolated) return t.skip("no reachable local Redis");

  const fallback = createRedisPresenceStore({ client: isolated, prefix: `gavel:test:presence:${crypto.randomUUID()}` });
  stores.push(fallback);
  await isolated.destroy();

  assert.equal(await fallback.attach("p4", "s1"), "first-socket");
  assert.equal(await fallback.socketCount("p4"), 1);
  assert.equal(await fallback.detach("p4", "s1"), "last-socket");
});
