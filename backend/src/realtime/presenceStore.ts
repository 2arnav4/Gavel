import { createPresenceTracker, type AttachResult, type DetachResult } from "../socket/presence.js";
import { logger } from "../utils/logger.js";
import type { RedisConnection } from "./redisClient.js";

export type PresenceStore = {
  attach(participantId: string, socketId: string): Promise<AttachResult>;
  detach(participantId: string, socketId: string): Promise<DetachResult>;
  socketCount(participantId: string): Promise<number>;
  close(): void;
};

export function createLocalPresenceStore(): PresenceStore {
  const tracker = createPresenceTracker();
  return {
    attach: async (participantId, socketId) => tracker.attach(participantId, socketId),
    detach: async (participantId, socketId) => tracker.detach(participantId, socketId),
    socketCount: async (participantId) => tracker.socketCount(participantId),
    close: () => undefined,
  };
}

const LIVE_COUNT = `
local live = 0
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  if tonumber(fields[i + 1]) > tonumber(ARGV[1]) then
    if fields[i] ~= ARGV[2] then live = live + 1 end
  else
    redis.call('HDEL', KEYS[1], fields[i])
  end
end
return live
`;

const ATTACH_SCRIPT = `
local before = (function()
${LIVE_COUNT}
end)()
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return before
`;

const DETACH_SCRIPT = `
redis.call('HDEL', KEYS[1], ARGV[2])
${LIVE_COUNT}
`;

const COUNT_SCRIPT = `
${LIVE_COUNT}
`;

type RedisPresenceOptions = {
  client: RedisConnection;
  prefix?: string;
  entryTtlMs?: number;
  heartbeatMs?: number;
};

export function createRedisPresenceStore(options: RedisPresenceOptions): PresenceStore {
  const { client, prefix = "gavel:presence", entryTtlMs = 30_000, heartbeatMs = 10_000 } = options;
  const local = createPresenceTracker();
  const owned = new Map<string, Set<string>>();

  const keyFor = (participantId: string) => `${prefix}:${participantId}`;

  async function run(script: string, participantId: string, socketId: string, extra: string[] = []): Promise<number> {
    const reply = await client.eval(script, {
      keys: [keyFor(participantId)],
      arguments: [String(Date.now()), socketId, ...extra],
    });
    return Number(reply);
  }

  function warn(action: string, error: unknown): void {
    logger.warn("Shared presence unavailable, using this instance's view", {
      action,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const heartbeat = setInterval(() => {
    if (!client.isReady) return;
    const expiresAt = String(Date.now() + entryTtlMs);
    for (const [participantId, sockets] of owned) {
      for (const socketId of sockets) {
        client.hSet(keyFor(participantId), socketId, expiresAt).catch((error) => warn("heartbeat", error));
      }
      client.pExpire(keyFor(participantId), entryTtlMs * 2).catch((error) => warn("heartbeat", error));
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    async attach(participantId, socketId) {
      const localResult = local.attach(participantId, socketId);
      const sockets = owned.get(participantId) ?? new Set<string>();
      sockets.add(socketId);
      owned.set(participantId, sockets);

      if (!client.isReady) return localResult;
      try {
        const before = await run(ATTACH_SCRIPT, participantId, socketId, [
          String(Date.now() + entryTtlMs),
          String(entryTtlMs * 2),
        ]);
        return before === 0 ? "first-socket" : "additional-socket";
      } catch (error) {
        warn("attach", error);
        return localResult;
      }
    },

    async detach(participantId, socketId) {
      const localResult = local.detach(participantId, socketId);
      const sockets = owned.get(participantId);
      sockets?.delete(socketId);
      if (sockets && sockets.size === 0) owned.delete(participantId);

      if (!client.isReady) return localResult;
      try {
        const remaining = await run(DETACH_SCRIPT, participantId, socketId);
        return remaining === 0 ? "last-socket" : "remaining-sockets";
      } catch (error) {
        warn("detach", error);
        return localResult;
      }
    },

    async socketCount(participantId) {
      if (!client.isReady) return local.socketCount(participantId);
      try {
        return await run(COUNT_SCRIPT, participantId, "");
      } catch (error) {
        warn("count", error);
        return local.socketCount(participantId);
      }
    },

    close() {
      clearInterval(heartbeat);
    },
  };
}
