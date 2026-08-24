import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimiter.js";

test("allows requests under the limit and counts down remaining", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });

  assert.deepEqual(limiter.check("a"), { allowed: true, remaining: 2, retryAfterMs: 0 });
  assert.deepEqual(limiter.check("a"), { allowed: true, remaining: 1, retryAfterMs: 0 });
  assert.deepEqual(limiter.check("a"), { allowed: true, remaining: 0, retryAfterMs: 0 });
});

test("blocks past the limit and reports time until reset", () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });

  limiter.check("a");
  limiter.check("a");
  limiter.check("a");

  assert.deepEqual(limiter.check("a"), { allowed: false, remaining: 0, retryAfterMs: 1000 });

  clock = 400;
  assert.deepEqual(limiter.check("a"), { allowed: false, remaining: 0, retryAfterMs: 600 });
});

test("blocked requests do not increase the count", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

  limiter.check("a");
  for (let i = 0; i < 50; i += 1) limiter.check("a");

  assert.equal(limiter.check("a").retryAfterMs, 1000);
});

test("keys are independent", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("b").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
});

test("window resets exactly at windowMs", () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });

  limiter.check("a");
  clock = 999;
  assert.equal(limiter.check("a").allowed, false);
  clock = 1000;
  assert.equal(limiter.check("a").allowed, true);
});

test("expired keys are swept out of memory", () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });

  limiter.check("a");
  clock = 400;
  limiter.check("b");
  assert.equal(limiter.size(), 2);

  clock = 2500;
  limiter.check("c");
  assert.equal(limiter.size(), 1);
});

test("reset clears a single key", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

  limiter.check("a");
  assert.equal(limiter.check("a").allowed, false);
  limiter.reset("a");
  assert.equal(limiter.check("a").allowed, true);
});

test("clear empties every window at once", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

  limiter.check("a");
  limiter.check("b");
  assert.equal(limiter.size(), 2);

  limiter.clear();

  assert.equal(limiter.size(), 0);
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("b").allowed, true);
});
