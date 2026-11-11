import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import { createRateLimiter } from "../utils/rateLimiter.js";
import { connectRedis, type RedisConnection } from "./redisClient.js";
import { createRedisRateLimiter } from "./redisRateLimiter.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

let client: RedisConnection | null = null;

before(async () => {
  client = await connectRedis(REDIS_URL);
});

after(async () => {
  if (client?.isOpen) await client.close();
});

function sharedPair(limit: number, windowMs: number) {
  const prefix = `gavel:test:rl:${crypto.randomUUID()}`;
  const make = () => createRedisRateLimiter({
    client: client!,
    prefix,
    limit,
    windowMs,
    fallback: createRateLimiter({ limit, windowMs }),
  });
  return [make(), make()] as const;
}

test("two instances share one budget instead of each granting their own", async (t) => {
  if (!client) return t.skip("no reachable local Redis");

  const [instanceA, instanceB] = sharedPair(3, 5_000);
  const decisions = [
    await instanceA.check("bidder"),
    await instanceB.check("bidder"),
    await instanceA.check("bidder"),
    await instanceB.check("bidder"),
  ];

  assert.deepEqual(decisions.map((decision) => decision.allowed), [true, true, true, false]);
  assert.ok(decisions[3].retryAfterMs > 0 && decisions[3].retryAfterMs <= 5_000);
});

test("keys are independent and the window resets", async (t) => {
  if (!client) return t.skip("no reachable local Redis");

  const [limiter] = sharedPair(1, 200);
  assert.equal((await limiter.check("one")).allowed, true);
  assert.equal((await limiter.check("one")).allowed, false);
  assert.equal((await limiter.check("two")).allowed, true, "a different key has its own window");

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await limiter.check("one")).allowed, true, "the window must expire");
});

test("a lost Redis connection falls back to this instance's counters", async (t) => {
  const isolated = await connectRedis(REDIS_URL);
  if (!isolated) return t.skip("no reachable local Redis");

  const fallback = createRateLimiter({ limit: 1, windowMs: 5_000 });
  const limiter = createRedisRateLimiter({
    client: isolated,
    prefix: `gavel:test:rl:${crypto.randomUUID()}`,
    limit: 1,
    windowMs: 5_000,
    fallback,
  });

  await isolated.destroy();

  assert.equal((await limiter.check("key")).allowed, true);
  assert.equal((await limiter.check("key")).allowed, false, "the local limiter still enforces the limit");
  assert.equal(fallback.size(), 1);
});
