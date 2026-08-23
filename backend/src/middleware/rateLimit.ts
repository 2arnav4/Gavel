import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "../utils/rateLimiter.js";

export const loginRateLimiter = createRateLimiter({
  limit: 5,
  windowMs: 60 * 1000,
});

export function rateLimit(limiter = loginRateLimiter) {
  return function rateLimitMiddleware(req: Request,res: Response,next: NextFunction,) {
    const key = req.ip ?? "unknown";
    const decision = limiter.check(key);

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
