import type { Server, Socket } from "socket.io";
import { Participant } from "../../models/participantModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid, type IBid } from "../../models/bidModel.js";
import { Room } from "../../models/roomModel.js";
import { logger } from "../../utils/logger.js";

const participantSockets = new Map<string, Set<string>>();

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
      const sockets = participantSockets.get(participantKey) ?? new Set<string>();
      const becameOnline = sockets.size === 0;
      sockets.add(socket.id);
      participantSockets.set(participantKey, sockets);
      socket.data.hasJoinedRoom = true;

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
      const sockets = participantSockets.get(participantKey);
      sockets?.delete(socket.id);
      const becameOffline = !sockets || sockets.size === 0;
      if (becameOffline) participantSockets.delete(participantKey);

      if (!becameOffline) return;
      await Participant.updateOne({ _id: participant._id }, { $set: { isConnected: false } });

      const cleanParticipant = {
        _id: participant._id,
        roomId: participant.roomId,
        username: participant.username,
        role: participant.role,
        isConnected: false,
        joinedAt: participant.joinedAt,
      };

      io.to(socketRoomId).emit("participant:left", {
        participant: cleanParticipant,
      });

      logger.info("Participant disconnected", { roomCode, participantId: participant._id.toString() });
    } catch (error) {
      logger.error("Error in disconnect handler", { error });
    }
  });
}
