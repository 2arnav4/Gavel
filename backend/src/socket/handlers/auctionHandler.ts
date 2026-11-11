import type { Server, Socket } from "socket.io";
import { Room } from "../../models/roomModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { env } from "../../config/env.js";
import { clearAuctionTimer, scheduleAuctionTimer } from "./resolutionHandler.js";
import { getAuctionEndsAt } from "../../utils/auction.js";
import { logger } from "../../utils/logger.js";
import type { SocketError } from "../errors.js";

async function requireHostRoom(socket: Socket) {
  const participant = socket.data.participant;
  const cachedRoom = socket.data.room;

  if (!participant || !cachedRoom) {
    socket.emit("error", { code: "NOT_AUTHENTICATED", message: "Not authenticated for any room." } satisfies SocketError);
    return null;
  }
  if (participant.role !== "admin") {
    socket.emit("error", { code: "NOT_AUTHORIZED", message: "Access denied: Only the room host can control the auction." } satisfies SocketError);
    return null;
  }

  const room = await Room.findById(cachedRoom._id);
  if (!room || room.status !== "live" || !room.currentItemId) {
    socket.emit("error", { code: "NO_ACTIVE_ITEM", message: "There is no live item to control right now." } satisfies SocketError);
    return null;
  }

  return room;
}

export function registerAuctionHandlers(io: Server, socket: Socket): void {
  socket.on("auction:start", async () => {
    try {
      const participant = socket.data.participant;
      const room = socket.data.room;

      if (!participant || !room) {
        socket.emit("error", { code: "NOT_AUTHENTICATED", message: "Not authenticated for any room." } satisfies SocketError);
        return;
      }

      if (participant.role !== "admin") {
        socket.emit("error", { code: "NOT_AUTHORIZED", message: "Access denied: Only the room administrator can start the auction." } satisfies SocketError);
        return;
      }

      const startedAt = new Date();
      const endsAt = getAuctionEndsAt(startedAt.getTime(), env.auctionItemDurationSeconds);

      const claimedRoom = await Room.findOneAndUpdate(
        { _id: room._id, status: "lobby" },
        { $set: { status: "live", isPaused: false, pausedRemainingMs: null, endsAt } },
        { new: true },
      );

      if (!claimedRoom) {
        socket.emit("error", {
          code: "AUCTION_ALREADY_STARTED",
          message: "Auction has already started or completed.",
        } satisfies SocketError);
        return;
      }

      const activeItem = await AuctionItem.findOneAndUpdate(
        { roomId: claimedRoom._id, status: "pending" },
        { $set: { status: "active", isPaused: false, endsAt }, $inc: { version: 1 } },
        { new: true, sort: { createdAt: 1 } },
      );

      if (!activeItem) {
        await Room.updateOne(
          { _id: claimedRoom._id, status: "live" },
          { $set: { status: "lobby", endsAt: null } },
        );
        socket.emit("error", {
          code: "NO_ITEMS",
          message: "Cannot start auction: At least one upcoming item is required.",
        } satisfies SocketError);
        return;
      }

      const startedRoom = await Room.findOneAndUpdate(
        { _id: claimedRoom._id },
        { $set: { currentItemId: activeItem._id } },
        { new: true },
      );

      socket.data.room = startedRoom ?? claimedRoom;

      const roomCode = claimedRoom.code;
      const socketRoomId = `room:${roomCode}`;
      scheduleAuctionTimer(io, claimedRoom._id.toString(), endsAt);

      io.to(socketRoomId).emit("auction:started", {
        room: startedRoom ?? claimedRoom,
      });

      io.to(socketRoomId).emit("item:activated", {
        item: activeItem,
        startedAt: startedAt.toISOString(),
        endsAt: endsAt.toISOString(),
        version: activeItem.version,
      });

      logger.info("Auction started", { roomCode, itemId: activeItem._id.toString() });
    } catch (error) {
      logger.error("Error in auction:start handler", { error });
      socket.emit("error", { code: "INTERNAL_ERROR", message: "Internal server error starting the auction." } satisfies SocketError);
    }
  });

  socket.on("auction:pause", async () => {
    try {
      const room = await requireHostRoom(socket);
      if (!room) return;

      const beforePause = await AuctionItem.findOneAndUpdate(
        {
          _id: room.currentItemId,
          status: "active",
          isPaused: false,
          endsAt: { $gt: new Date() },
        },
        { $set: { isPaused: true, endsAt: null }, $inc: { version: 1 } },
        { new: false },
      );

      if (!beforePause) {
        socket.emit("error", { code: "AUCTION_PAUSED", message: "The item is already paused or is no longer running." } satisfies SocketError);
        return;
      }

      const remainingMs = Math.max(0, (beforePause.endsAt?.getTime() ?? Date.now()) - Date.now());

      clearAuctionTimer(room._id.toString());
      await Room.updateOne(
        { _id: room._id },
        { $set: { isPaused: true, pausedRemainingMs: remainingMs, endsAt: null } },
      );

      io.to(`room:${room.code}`).emit("auction:paused", {
        itemId: beforePause._id,
        remainingMs,
        version: (beforePause.version ?? 0) + 1,
      });

      logger.info("Auction paused", { roomCode: room.code, remainingMs });
    } catch (error) {
      logger.error("Error in auction:pause handler", { error });
      socket.emit("error", { code: "INTERNAL_ERROR", message: "Internal server error pausing the auction." } satisfies SocketError);
    }
  });

  socket.on("auction:resume", async () => {
    try {
      const room = await requireHostRoom(socket);
      if (!room) return;

      if (!room.isPaused) {
        socket.emit("error", { code: "AUCTION_NOT_PAUSED", message: "The auction is not paused." } satisfies SocketError);
        return;
      }

      const remainingMs = room.pausedRemainingMs ?? env.auctionItemDurationSeconds * 1000;
      const endsAt = new Date(Date.now() + remainingMs);

      const resumedItem = await AuctionItem.findOneAndUpdate(
        { _id: room.currentItemId, status: "active", isPaused: true },
        { $set: { isPaused: false, endsAt }, $inc: { version: 1 } },
        { new: true },
      );

      if (!resumedItem) {
        socket.emit("error", { code: "ITEM_CLOSED", message: "The paused item is no longer available to resume." } satisfies SocketError);
        return;
      }

      await Room.updateOne(
        { _id: room._id },
        { $set: { isPaused: false, pausedRemainingMs: null, endsAt } },
      );

      scheduleAuctionTimer(io, room._id.toString(), endsAt);

      io.to(`room:${room.code}`).emit("auction:resumed", {
        item: resumedItem,
        endsAt: endsAt.toISOString(),
        serverTime: new Date().toISOString(),
        version: resumedItem.version,
      });

      logger.info("Auction resumed", { roomCode: room.code, remainingMs });
    } catch (error) {
      logger.error("Error in auction:resume handler", { error });
      socket.emit("error", { code: "INTERNAL_ERROR", message: "Internal server error resuming the auction." } satisfies SocketError);
    }
  });
}
