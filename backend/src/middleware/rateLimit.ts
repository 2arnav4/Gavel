import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "../utils/rateLimiter.js";
import type { RateLimitCheck } from "../realtime/redisRateLimiter.js";

export const LOGIN_LIMIT = { limit: 5, windowMs: 60 * 1000 };

export const loginRateLimiter = createRateLimiter(LOGIN_LIMIT);

let activeLoginLimiter: RateLimitCheck = loginRateLimiter;

export function setLoginRateLimiter(limiter: RateLimitCheck): void {
  activeLoginLimiter = limiter;
}

export function rateLimit(limiter?: RateLimitCheck) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = req.ip ?? "unknown";
    const decision = await (limiter ?? activeLoginLimiter).check(key);

    if (!decision.allowed) {
      res.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
      res.status(429).json({
        error: "Too many attempts. Please try again shortly.",
      });
      return;
    }

    next();
  };
}
