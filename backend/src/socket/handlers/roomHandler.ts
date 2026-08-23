import type { Server, Socket } from "socket.io";
import { Participant } from "../../models/participantModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid, type IBid } from "../../models/bidModel.js";
import { Room } from "../../models/roomModel.js";

const participantSockets = new Map<string, Set<string>>();

/**
 * Registers Room-related event listeners for a given Socket instance.
 */
export function registerRoomHandlers(io: Server, socket: Socket): void {
  // Event: room:connect
  socket.on("room:connect", async () => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("error", { message: "Not authenticated for any room." });
        return;
      }

      // Fetch fresh room status and currentItemId from database
      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("error", { message: "Room not found." });
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      // Join the Socket.IO room channel
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

      // Retrieve all participants of this room
      const participants = await Participant.find({ roomId: room._id }).select(
        "-sessionToken" // Hide sensitive session tokens
      );

      // Fetch currently active item details and its bids if room is live
      let activeItem = null;
      let bids: IBid[] = [];
      if (room.status === "live" && room.currentItemId) {
        activeItem = await AuctionItem.findById(room.currentItemId);
        if (activeItem) {
          bids = await Bid.find({ itemId: activeItem._id }).sort({ createdAt: -1 });
        }
      }

      const items = await AuctionItem.find({ roomId: room._id }).sort({ createdAt: 1 });

      // Emit room:state to the current client. serverTime lets the client measure
      // its own clock offset, so a countdown derived from an absolute deadline
      // stays correct even on a machine whose clock is wrong.
      socket.emit("room:state", {
        room,
        participants,
        activeItem,
        bids,
        items,
        serverTime: new Date().toISOString(),
      });

      // Broadcast participant:joined to other clients in the room
      // To hide session token, construct clean participant object
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

      console.log(`User ${participant.username} connected to auction room ${roomCode}`);
    } catch (error) {
      console.error("Error in room:connect handler:", error);
      socket.emit("error", { message: "Internal server error during room connect." });
    }
  });

  // Event: disconnect
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

      // Broadcast participant:left to other clients in the room
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

      console.log(`User ${participant.username} disconnected from auction room ${roomCode}`);
    } catch (error) {
      console.error("Error in disconnect handler:", error);
    }
  });
}
