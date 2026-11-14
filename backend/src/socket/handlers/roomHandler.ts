import type { Server, Socket } from "socket.io";
import { Participant } from "../../models/participantModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid } from "../../models/bidModel.js";
import { Room } from "../../models/roomModel.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { createLocalPresenceStore, type PresenceStore } from "../../realtime/presenceStore.js";
import { createRateLimiter } from "../../utils/rateLimiter.js";
import type { SocketError } from "../errors.js";

const PRESENCE_GRACE_MS = env.presenceGraceMs;

let presence: PresenceStore = createLocalPresenceStore();
const pendingOffline = new Map<string, NodeJS.Timeout>();

export const ROOM_CONNECT_LIMIT = { limit: 5, windowMs: 10_000 };

export const roomConnectLimiter = createRateLimiter(ROOM_CONNECT_LIMIT);

export const ROSTER_PAGE = 100;
export const BID_LOG_PAGE = 100;
const ROSTER_SHARE_MS = 1_000;
const PRESENCE_FLUSH_MS = 1_000;
const PRESENCE_JOINED_SAMPLE = 20;
const PRESENCE_LEFT_SAMPLE = 200;

type RosterEntry = Record<string, unknown> & { _id: { toString(): string } };

type RosterSummary = {
  participantCount: number;
  onlineCount: number;
  page: RosterEntry[] | null;
};

const rosterSummaries = new Map<string, { at: number; read: Promise<RosterSummary> }>();

async function loadRosterSummary(roomId: string): Promise<RosterSummary> {
  const participantCount = await Participant.countDocuments({ roomId });

  if (participantCount <= ROSTER_PAGE) {
    return { participantCount, onlineCount: -1, page: null };
  }

  const [onlineCount, page] = await Promise.all([
    Participant.countDocuments({ roomId, isConnected: true }),
    Participant.find({ roomId })
      .select("-sessionToken")
      .sort({ isConnected: -1, joinedAt: 1, _id: 1 })
      .limit(ROSTER_PAGE)
      .lean(),
  ]);

  return { participantCount, onlineCount, page: page as unknown as RosterEntry[] };
}

function readRosterSummary(roomId: string): Promise<RosterSummary> {
  const now = Date.now();
  const shared = rosterSummaries.get(roomId);
  if (shared && now - shared.at < ROSTER_SHARE_MS) return shared.read;

  const read = loadRosterSummary(roomId);
  rosterSummaries.set(roomId, { at: now, read });
  read.catch(() => rosterSummaries.delete(roomId));
  if (rosterSummaries.size > 500) {
    for (const [key, entry] of rosterSummaries) {
      if (now - entry.at >= ROSTER_SHARE_MS) rosterSummaries.delete(key);
    }
  }
  return read;
}

async function readRoster(roomId: string, selfId: string, adminId: string | null) {
  const summary = await readRosterSummary(roomId);

  if (!summary.page) {
    const participants = (await Participant.find({ roomId })
      .select("-sessionToken")
      .lean()) as unknown as RosterEntry[];
    return {
      participants,
      participantCount: participants.length,
      onlineCount: participants.filter((entry) => entry.isConnected === true).length,
      participantsTruncated: false,
    };
  }

  const page = summary.page;
  const pinnedIds = [selfId, ...(adminId && adminId !== selfId ? [adminId] : [])];
  const missing = pinnedIds.filter((id) => !page.some((entry) => entry._id.toString() === id));
  const pinned = missing.length > 0
    ? ((await Participant.find({ _id: { $in: missing }, roomId })
        .select("-sessionToken")
        .lean()) as unknown as RosterEntry[])
    : [];

  const participants = [...pinned, ...page].map((entry) =>
    entry._id.toString() === selfId ? { ...entry, isConnected: true } : entry,
  );

  return {
    participants,
    participantCount: summary.participantCount,
    onlineCount: summary.onlineCount,
    participantsTruncated: true,
  };
}

type CleanParticipant = {
  _id: unknown;
  roomId: unknown;
  username: string;
  role: string;
  isConnected: boolean;
  joinedAt: unknown;
};

type PresenceBatch = {
  joined: Map<string, CleanParticipant>;
  left: Set<string>;
  timer: NodeJS.Timeout;
};

const presenceBatches = new Map<string, PresenceBatch>();

async function flushPresence(io: Server, roomId: string, socketRoomId: string): Promise<void> {
  const batch = presenceBatches.get(roomId);
  if (!batch) return;
  presenceBatches.delete(roomId);

  try {
    const [participantCount, onlineCount] = await Promise.all([
      Participant.countDocuments({ roomId }),
      Participant.countDocuments({ roomId, isConnected: true }),
    ]);

    io.to(socketRoomId).emit("presence:changed", {
      participantCount,
      onlineCount,
      joinedCount: batch.joined.size,
      leftCount: batch.left.size,
      joined: [...batch.joined.values()].slice(0, PRESENCE_JOINED_SAMPLE),
      left: [...batch.left].slice(0, PRESENCE_LEFT_SAMPLE),
    });
  } catch (error) {
    logger.error("Error flushing presence changes", { error, roomId });
  }
}

function queuePresence(
  io: Server,
  roomId: string,
  socketRoomId: string,
  change: { joined?: CleanParticipant; leftId?: string },
): void {
  let batch = presenceBatches.get(roomId);
  if (!batch) {
    const timer = setTimeout(() => void flushPresence(io, roomId, socketRoomId), PRESENCE_FLUSH_MS);
    timer.unref();
    batch = { joined: new Map(), left: new Set(), timer };
    presenceBatches.set(roomId, batch);
  }

  if (change.joined) {
    const id = String(change.joined._id);
    batch.left.delete(id);
    batch.joined.set(id, change.joined);
  }
  if (change.leftId) {
    batch.joined.delete(change.leftId);
    batch.left.add(change.leftId);
  }
}

async function isLargeRoom(roomId: string): Promise<boolean> {
  const summary = await readRosterSummary(roomId);
  return summary.participantCount > ROSTER_PAGE;
}

export function setPresenceStore(store: PresenceStore): void {
  presence.close();
  presence = store;
}

export function closePresenceStore(): void {
  presence.close();
}

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on("room:connect", async () => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("error", { code: "NOT_AUTHENTICATED", message: "Not authenticated for any room." } satisfies SocketError);
        return;
      }

      if (!roomConnectLimiter.check(socket.id).allowed) {
        socket.emit("error", {
          code: "RATE_LIMITED",
          message: "Too many room refreshes. Wait a few seconds and try again.",
        } satisfies SocketError);
        return;
      }

      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found." } satisfies SocketError);
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      socket.join(socketRoomId);

      const participantKey = participant._id.toString();
      const attachResult = await presence.attach(participantKey, socket.id);
      socket.data.hasJoinedRoom = true;

      const reconnectedWithinGrace = pendingOffline.get(participantKey);
      if (reconnectedWithinGrace) {
        clearTimeout(reconnectedWithinGrace);
        pendingOffline.delete(participantKey);
        logger.info("Participant reconnected within the grace period", {
          roomCode,
          participantId: participantKey,
        });
      }

      const becameOnline = attachResult === "first-socket" && !reconnectedWithinGrace;

      if (becameOnline) {
        await Participant.updateOne({ _id: participant._id }, { $set: { isConnected: true } });
      }

      const roomKey = room._id.toString();
      const roster = await readRoster(
        roomKey,
        participantKey,
        room.adminParticipantId ? room.adminParticipantId.toString() : null,
      );

      let activeItem = null;
      let bids: unknown[] = [];
      let bidCount = 0;
      if (room.status === "live" && room.currentItemId) {
        activeItem = await AuctionItem.findById(room.currentItemId);
        if (activeItem) {
          bids = await Bid.find({ itemId: activeItem._id })
            .sort({ createdAt: -1 })
            .limit(BID_LOG_PAGE)
            .lean();
          bidCount = bids.length < BID_LOG_PAGE
            ? bids.length
            : await Bid.countDocuments({ itemId: activeItem._id });
        }
      }

      const items = await AuctionItem.find({ roomId: room._id }).sort({ createdAt: 1 }).lean();

      socket.emit("room:state", {
        room,
        participants: roster.participants,
        participantCount: roster.participantCount,
        onlineCount: roster.onlineCount,
        participantsTruncated: roster.participantsTruncated,
        activeItem,
        bids,
        bidCount,
        items,
        serverTime: new Date().toISOString(),
      });

      const cleanParticipant = {
        _id: participant._id,
        roomId: participant.roomId,
        username: participant.username,
        role: participant.role,
        isConnected: true,
        joinedAt: participant.joinedAt,
      };

      if (becameOnline) {
        if (roster.participantsTruncated) {
          queuePresence(io, roomKey, socketRoomId, { joined: cleanParticipant });
        } else {
          socket.to(socketRoomId).emit("participant:joined", {
            participant: cleanParticipant,
          });
        }
      }

      logger.info("Participant connected", { roomCode, participantId: participant._id.toString() });
    } catch (error) {
      logger.error("Error in room:connect handler", { error });
      socket.emit("error", { code: "INTERNAL_ERROR", message: "Internal server error during room connect." } satisfies SocketError);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const participant = socket.data.participant;
      const room = socket.data.room;

      if (!participant || !room || !socket.data.hasJoinedRoom) return;

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      const participantKey = participant._id.toString();
      if ((await presence.detach(participantKey, socket.id)) !== "last-socket") return;
      if (pendingOffline.has(participantKey)) return;

      const finalizeOffline = async (): Promise<void> => {
        pendingOffline.delete(participantKey);

        try {
          if ((await presence.socketCount(participantKey)) > 0) return;
          await Participant.updateOne(
            { _id: participant._id },
            { $set: { isConnected: false } },
          );

          const roomKey = String(participant.roomId);
          if (await isLargeRoom(roomKey)) {
            queuePresence(io, roomKey, socketRoomId, { leftId: participantKey });
          } else {
            io.to(socketRoomId).emit("participant:left", {
              participant: {
                _id: participant._id,
                roomId: participant.roomId,
                username: participant.username,
                role: participant.role,
                isConnected: false,
                joinedAt: participant.joinedAt,
              },
            });
          }

          logger.info("Participant marked offline after the grace period", {
            roomCode,
            participantId: participantKey,
          });
        } catch (error) {
          logger.error("Error finalizing participant disconnect", { error, participantId: participantKey });
        }
      };

      const timer = setTimeout(() => void finalizeOffline(), PRESENCE_GRACE_MS);
      timer.unref();
      pendingOffline.set(participantKey, timer);

      logger.debug("Participant socket closed, offline pending", {
        roomCode,
        participantId: participantKey,
        graceMs: PRESENCE_GRACE_MS,
      });
    } catch (error) {
      logger.error("Error in disconnect handler", { error });
    }
  });
}
