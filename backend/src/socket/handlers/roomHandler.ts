import type { Server, Socket } from "socket.io";
import { Participant } from "../../models/participantModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid, type IBid } from "../../models/bidModel.js";
import { Room } from "../../models/roomModel.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { createPresenceTracker } from "../presence.js";

const PRESENCE_GRACE_MS = env.presenceGraceMs;

const presence = createPresenceTracker();
const pendingOffline = new Map<string, NodeJS.Timeout>();

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on("room:connect", async () => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("error", { message: "Not authenticated for any room." });
        return;
      }

      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("error", { message: "Room not found." });
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      socket.join(socketRoomId);

      const participantKey = participant._id.toString();
      const attachResult = presence.attach(participantKey, socket.id);
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

      const participants = await Participant.find({ roomId: room._id }).select(
        "-sessionToken"
      );

      let activeItem = null;
      let bids: IBid[] = [];
      if (room.status === "live" && room.currentItemId) {
        activeItem = await AuctionItem.findById(room.currentItemId);
        if (activeItem) {
          bids = await Bid.find({ itemId: activeItem._id }).sort({ createdAt: -1 });
        }
      }

      const items = await AuctionItem.find({ roomId: room._id }).sort({ createdAt: 1 });

      socket.emit("room:state", {
        room,
        participants,
        activeItem,
        bids,
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
        socket.to(socketRoomId).emit("participant:joined", {
          participant: cleanParticipant,
        });
      }

      logger.info("Participant connected", { roomCode, participantId: participant._id.toString() });
    } catch (error) {
      logger.error("Error in room:connect handler", { error });
      socket.emit("error", { message: "Internal server error during room connect." });
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
      if (presence.detach(participantKey, socket.id) !== "last-socket") return;
      if (pendingOffline.has(participantKey)) return;

      const finalizeOffline = async (): Promise<void> => {
        pendingOffline.delete(participantKey);
        if (presence.socketCount(participantKey) > 0) return;

        try {
          await Participant.updateOne(
            { _id: participant._id },
            { $set: { isConnected: false } },
          );

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
