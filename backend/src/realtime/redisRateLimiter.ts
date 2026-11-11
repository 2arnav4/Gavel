import type { RateLimitDecision, RateLimiter } from "../utils/rateLimiter.js";
import { logger } from "../utils/logger.js";
import type { RedisConnection } from "./redisClient.js";

export type RateLimitCheck = {
  check(key: string): RateLimitDecision | Promise<RateLimitDecision>;
};

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

type RedisRateLimiterOptions = {
  client: RedisConnection;
  prefix: string;
  limit: number;
  windowMs: number;
  fallback: RateLimiter;
};

export function createRedisRateLimiter(options: RedisRateLimiterOptions): RateLimitCheck {
  const { client, prefix, limit, windowMs, fallback } = options;

  return {
    async check(key: string): Promise<RateLimitDecision> {
      if (!client.isReady) return fallback.check(key);

      try {
        const reply = (await client.eval(FIXED_WINDOW_SCRIPT, {
          keys: [`${prefix}:${key}`],
          arguments: [String(windowMs)],
        })) as [number, number];
        const [count, ttl] = reply.map(Number);

        if (count > limit) {
          return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, ttl) };
        }
        return { allowed: true, remaining: limit - count, retryAfterMs: 0 };
      } catch (error) {
        logger.warn("Shared rate limit unavailable, using this instance's counters", {
          prefix,
          reason: error instanceof Error ? error.message : String(error),
        });
        return fallback.check(key);
      }
    },
  };
}
