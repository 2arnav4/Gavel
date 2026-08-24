export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  reset(key: string): void;
  clear(): void;
  size(): number;
}

interface WindowState {
  count: number;
  windowStart: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, now = Date.now } = options;

  const windows = new Map<string, WindowState>();

  function sweep(currentTime: number): void {
    for (const [key, state] of windows) {
      if (currentTime - state.windowStart >= windowMs) {
        windows.delete(key);
      }
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const currentTime = now();
      sweep(currentTime);

      const state = windows.get(key);

      if (!state) {
        windows.set(key, { count: 1, windowStart: currentTime });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }

      if (state.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: state.windowStart + windowMs - currentTime,
        };
      }

      state.count += 1;
      return { allowed: true, remaining: limit - state.count, retryAfterMs: 0 };
    },

    reset(key: string): void {
      windows.delete(key);
    },

    clear(): void {
      windows.clear();
    },

    size(): number {
      return windows.size;
    },
  };
}
