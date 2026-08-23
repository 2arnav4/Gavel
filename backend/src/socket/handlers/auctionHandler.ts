import type { Server, Socket } from "socket.io";
import { Room } from "../../models/roomModel.js";
import { AuctionItem } from "../../models/itemModel.js";
import { env } from "../../config/env.js";
import { clearAuctionTimer, scheduleAuctionTimer } from "./resolutionHandler.js";
import { getAuctionEndsAt } from "../../utils/auction.js";

/** Resolves the host's room, or emits the reason it cannot act. */
async function requireHostRoom(socket: Socket) {
  const participant = socket.data.participant;
  const cachedRoom = socket.data.room;

  if (!participant || !cachedRoom) {
    socket.emit("error", { message: "Not authenticated for any room." });
    return null;
  }
  if (participant.role !== "admin") {
    socket.emit("error", { message: "Access denied: Only the room host can control the auction." });
    return null;
  }

  const room = await Room.findById(cachedRoom._id);
  if (!room || room.status !== "live" || !room.currentItemId) {
    socket.emit("error", { message: "There is no live item to control right now." });
    return null;
  }

  return room;
}

/**
 * Registers Auction-related event listeners for a given Socket instance.
 */
export function registerAuctionHandlers(io: Server, socket: Socket): void {
  // Event: auction:start
  socket.on("auction:start", async () => {
    try {
      const participant = socket.data.participant;
      const room = socket.data.room;

      if (!participant || !room) {
        socket.emit("error", { message: "Not authenticated for any room." });
        return;
      }

      // 1. Verify user is admin
      if (participant.role !== "admin") {
        socket.emit("error", { message: "Access denied: Only the room administrator can start the auction." });
        return;
      }

      // 2. Fetch fresh Room document and verify status
      const freshRoom = await Room.findById(room._id);
      if (!freshRoom) {
        socket.emit("error", { message: "Room not found." });
        return;
      }

      if (freshRoom.status !== "lobby") {
        socket.emit("error", { message: "Auction has already started or completed." });
        return;
      }

      // 3. Select first pending item
      const pendingItems = await AuctionItem.find({
        roomId: freshRoom._id,
        status: "pending",
      }).sort({ createdAt: 1 });

      if (pendingItems.length === 0) {
        socket.emit("error", { message: "Cannot start auction: At least one upcoming item is required." });
        return;
      }

      const activeItem = pendingItems[0];
      const startedAt = new Date();
      const endsAt = getAuctionEndsAt(startedAt.getTime(), env.auctionItemDurationSeconds);

      // 4. Update item status to active
      activeItem.status = "active";
      activeItem.endsAt = endsAt;
      await activeItem.save();

      // 5. Update room status to live and link currentItemId
      freshRoom.status = "live";
      freshRoom.currentItemId = activeItem._id;
      freshRoom.endsAt = endsAt;
      await freshRoom.save();

      // Keep cached room reference inside socket.data in sync
      socket.data.room = freshRoom;

      const roomCode = freshRoom.code;
      const socketRoomId = `room:${roomCode}`;
      scheduleAuctionTimer(io, freshRoom._id.toString(), endsAt);

      // 6. Broadcast event: auction:started
      io.to(socketRoomId).emit("auction:started", {
        room: freshRoom,
      });

      // 7. Broadcast event: item:activated
      io.to(socketRoomId).emit("item:activated", {
        item: activeItem,
        startedAt: startedAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });

      console.log(`Lobby ${roomCode} transitioned to LIVE. Active item: ${activeItem.name}`);
    } catch (error) {
      console.error("Error in auction:start handler:", error);
      socket.emit("error", { message: "Internal server error starting the auction." });
    }
  });

  // Event: auction:pause — freeze the countdown on the active item.
  socket.on("auction:pause", async () => {
    try {
      const room = await requireHostRoom(socket);
      if (!room) return;

      // Claim the pause atomically. Two rapid clicks, or two host tabs, cannot
      // both succeed, so the remaining time is only ever computed once.
      //
      // `new: false` returns the document as it was at the instant of the swap,
      // which is the only trustworthy source for the deadline: reading endsAt
      // separately could observe a value a concurrent bid had already extended.
      const beforePause = await AuctionItem.findOneAndUpdate(
        {
          _id: room.currentItemId,
          status: "active",
          isPaused: false,
          endsAt: { $gt: new Date() },
        },
        { $set: { isPaused: true, endsAt: null } },
        { new: false },
      );

      if (!beforePause) {
        socket.emit("error", { message: "The item is already paused or is no longer running." });
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
      });

      console.log(`Auction ${room.code} paused with ${Math.round(remainingMs / 1000)}s remaining.`);
    } catch (error) {
      console.error("Error in auction:pause handler:", error);
      socket.emit("error", { message: "Internal server error pausing the auction." });
    }
  });

  // Event: auction:resume — restore the countdown from where it stopped.
  socket.on("auction:resume", async () => {
    try {
      const room = await requireHostRoom(socket);
      if (!room) return;

      if (!room.isPaused) {
        socket.emit("error", { message: "The auction is not paused." });
        return;
      }

      // Fall back to a full window if the stored remainder is missing, so a
      // corrupted pause can never strand an item with no deadline at all.
      const remainingMs = room.pausedRemainingMs ?? env.auctionItemDurationSeconds * 1000;
      const endsAt = new Date(Date.now() + remainingMs);

      const resumedItem = await AuctionItem.findOneAndUpdate(
        { _id: room.currentItemId, status: "active", isPaused: true },
        { $set: { isPaused: false, endsAt } },
        { new: true },
      );

      if (!resumedItem) {
        socket.emit("error", { message: "The paused item is no longer available to resume." });
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
      });

      console.log(`Auction ${room.code} resumed with ${Math.round(remainingMs / 1000)}s remaining.`);
    } catch (error) {
      console.error("Error in auction:resume handler:", error);
      socket.emit("error", { message: "Internal server error resuming the auction." });
    }
  });
}
