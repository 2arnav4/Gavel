import { createServer } from "http";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { connectDB } from "./config/db.js";
import { createSocketServer } from "./socket/index.js";
import { connectRedis, createStreamsAdapter } from "./realtime/redisClient.js";
import { createRedisRateLimiter } from "./realtime/redisRateLimiter.js";
import { BID_LIMIT, localBidRateLimiter, setBidRateLimiter } from "./socket/handlers/biddingHandler.js";
import { LOGIN_LIMIT, loginRateLimiter, setLoginRateLimiter } from "./middleware/rateLimit.js";
import { createRedisPresenceStore } from "./realtime/presenceStore.js";
import { closePresenceStore, setPresenceStore } from "./socket/handlers/roomHandler.js";
import {
  clearAllAuctionTimers,
  restoreAuctionTimers,
  startExpirySweep,
} from "./socket/handlers/resolutionHandler.js";
import { Participant } from "./models/participantModel.js";

const app = createApp();
const httpServer = createServer(app);

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;
let stopExpirySweep: (() => void) | null = null;

const redis = env.redisUrl ? await connectRedis(env.redisUrl) : null;
if (redis) {
  setBidRateLimiter(createRedisRateLimiter({ client: redis, prefix: "gavel:rl:bid", ...BID_LIMIT, fallback: localBidRateLimiter }));
  setLoginRateLimiter(createRedisRateLimiter({ client: redis, prefix: "gavel:rl:login", ...LOGIN_LIMIT, fallback: loginRateLimiter }));
  setPresenceStore(createRedisPresenceStore({ client: redis }));
}
const io = createSocketServer(httpServer, redis ? { adapter: createStreamsAdapter(redis) } : {});
app.set("io", io);
logger.info("Realtime fan-out mode", { mode: redis ? "redis-streams" : "single-instance" });

httpServer.listen(env.port, () => {
  logger.info("Server listening", { port: env.port, environment: env.nodeEnv });
});

void connectDB().then(async () => {
  try {
    const { modifiedCount } = await Participant.updateMany(
      { isConnected: true },
      { $set: { isConnected: false } },
    );
    if (modifiedCount > 0) {
      logger.info("Cleared stale presence flags from the previous run", { modifiedCount });
    }
  } catch (error) {
    logger.error("Unable to clear stale presence flags", { error });
  }

  try {
    await restoreAuctionTimers(io);
  } catch (error) {
    logger.error("Unable to restore auction timers", { error });
  }

  if (!shuttingDown) stopExpirySweep = startExpirySweep(io);
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Shutdown signal received", { signal });

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit", { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    stopExpirySweep?.();
    closePresenceStore();
    const clearedTimers = clearAllAuctionTimers();
    if (clearedTimers > 0) {
      logger.info("Cleared in-process auction timers", { clearedTimers });
    }

    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (redis) await redis.close();
    await mongoose.disconnect();
  } catch (error) {
    logger.error("Error during shutdown", { error });
  }

  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
