import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { logger } from "../utils/logger.js";

const CONNECT_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 5_000;
const ERROR_LOG_INTERVAL_MS = 10_000;

function buildClient(url: string) {
  return createClient({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries: number) => Math.min(200 * 2 ** retries, MAX_RECONNECT_DELAY_MS),
    },
  });
}

export type RedisConnection = ReturnType<typeof buildClient>;

export async function connectRedis(url: string): Promise<RedisConnection | null> {
  let lastErrorLoggedAt = 0;

  const client = buildClient(url);

  client.on("error", (error: Error) => {
    const now = Date.now();
    if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLoggedAt = now;
    logger.error("Redis connection error", { reason: error.message });
  });
  client.on("ready", () => logger.info("Redis connection ready"));

  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connect timed out")), CONNECT_TIMEOUT_MS)),
    ]);
    return client;
  } catch (error) {
    logger.error("Redis unavailable at startup, running single-instance", {
      reason: error instanceof Error ? error.message : String(error),
    });
    client.destroy();
    return null;
  }
}

export function failFastPublisher(client: RedisConnection): RedisConnection {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "xAdd") {
        return (...args: Parameters<RedisConnection["xAdd"]>) => target.isReady
          ? target.xAdd(...args)
          : Promise.reject(new Error("Redis is not connected; delivering to this instance only"));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createStreamsAdapter(client: RedisConnection, streamName = "gavel:socket.io") {
  return createAdapter(failFastPublisher(client), { streamName, onlyPlaintext: true });
}
