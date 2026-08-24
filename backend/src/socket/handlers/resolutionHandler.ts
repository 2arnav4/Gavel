import type { Server, Socket } from "socket.io";
import { env } from "../../config/env.js";
import { Room } from "../../models/roomModel.js";
import { AuctionItem, type IAuctionItem } from "../../models/itemModel.js";
import { Participant } from "../../models/participantModel.js";
import { getAuctionEndsAt, getExpiryResolution } from "../../utils/auction.js";
import { logger } from "../../utils/logger.js";

type Resolution = "sold" | "unsold";

const auctionTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearAuctionTimer(roomId: string): void {
  const timer = auctionTimers.get(roomId);
  if (timer) clearTimeout(timer);
  auctionTimers.delete(roomId);
}

export function scheduleAuctionTimer(io: Server, roomId: string, endsAt: Date): void {
  clearAuctionTimer(roomId);

  const delay = Math.max(0, endsAt.getTime() - Date.now());
  const timer = setTimeout(() => {
    void expireActiveItem(io, roomId);
  }, delay);

  auctionTimers.set(roomId, timer);
}

export async function restoreAuctionTimers(io: Server): Promise<void> {
  const liveRooms = await Room.find({
    status: "live",
    currentItemId: { $ne: null },
  });

  for (const room of liveRooms) {
    if (room.isPaused) continue;

    const endsAt = room.endsAt ?? getAuctionEndsAt(Date.now(), env.auctionItemDurationSeconds);
    if (!room.endsAt) {
      room.endsAt = endsAt;
      await room.save();
      await AuctionItem.updateOne(
        { _id: room.currentItemId, status: "active" },
        { $set: { endsAt } },
      );
    }
    scheduleAuctionTimer(io, room._id.toString(), endsAt);
  }
}

async function progressAuction(io: Server, roomId: string): Promise<void> {
  const room = await Room.findById(roomId);
  if (!room || room.status !== "live") return;

  const endsAt = getAuctionEndsAt(Date.now(), env.auctionItemDurationSeconds);
  const nextItem = await AuctionItem.findOneAndUpdate(
    { roomId: room._id, status: "pending" },
    { $set: { status: "active", endsAt } },
    { new: true, sort: { createdAt: 1 } },
  );

  const socketRoomId = `room:${room.code}`;

  if (!nextItem) {
    const completedRoom = await Room.findOneAndUpdate(
      { _id: room._id, status: "live" },
      { $set: { status: "completed", currentItemId: null, endsAt: null, isPaused: false, pausedRemainingMs: null } },
      { new: true },
    );

    clearAuctionTimer(roomId);
    if (completedRoom) io.to(socketRoomId).emit("auction:completed", { room: completedRoom });
    return;
  }

  const updatedRoom = await Room.findOneAndUpdate(
    { _id: room._id, status: "live" },
    { $set: { currentItemId: nextItem._id, endsAt, isPaused: false, pausedRemainingMs: null } },
    { new: true },
  );

  if (!updatedRoom) return;

  scheduleAuctionTimer(io, roomId, endsAt);
  io.to(socketRoomId).emit("item:activated", {
    item: nextItem,
    startedAt: new Date().toISOString(),
    endsAt: endsAt.toISOString(),
  });
}

async function resolveActiveItem(
  io: Server,
  roomId: string,
  requestedResolution: Resolution | "expired",
): Promise<IAuctionItem | null> {
  const room = await Room.findById(roomId);
  if (!room || room.status !== "live" || !room.currentItemId) return null;

  const activeItem = await AuctionItem.findById(room.currentItemId);
  if (!activeItem || activeItem.status !== "active") return null;

  const resolution: Resolution = requestedResolution === "expired"
    ? getExpiryResolution(Boolean(activeItem.highestBidderId))
    : requestedResolution;

  if (resolution === "sold" && !activeItem.highestBidderId) {
    return null;
  }

  const update = resolution === "unsold"
    ? { status: "unsold", highestBidderId: null, highestBidderUsername: null }
    : { status: "sold" };

  const claim: Record<string, unknown> = { _id: activeItem._id, status: "active" };

  if (requestedResolution === "expired") {
    claim.endsAt = { $lte: new Date() };
  }

  const resolvedItem = await AuctionItem.findOneAndUpdate(
    claim,
    { $set: update },
    { new: true },
  );
  if (!resolvedItem) return null;

  let winner = null;
  if (resolution === "sold" && resolvedItem.highestBidderId) {
    winner = await Participant.findOneAndUpdate(
      { _id: resolvedItem.highestBidderId },
      { $inc: { spent: resolvedItem.currentBid } },
      { new: true },
    ).select("-sessionToken");
  }

  clearAuctionTimer(roomId);
  const socketRoomId = `room:${room.code}`;
  io.to(socketRoomId).emit("item:ended", { item: resolvedItem, resolution, winner });
  await progressAuction(io, roomId);

  return resolvedItem;
}

async function expireActiveItem(io: Server, roomId: string): Promise<void> {
  try {
    const resolvedItem = await resolveActiveItem(io, roomId, "expired");
    if (resolvedItem) return;

    const room = await Room.findById(roomId);
    if (!room || room.status !== "live" || !room.currentItemId) return;

    const item = await AuctionItem.findById(room.currentItemId);
    if (item?.status === "active" && item.endsAt && item.endsAt.getTime() > Date.now()) {
      scheduleAuctionTimer(io, roomId, item.endsAt);
    }
  } catch (error) {
    logger.error("Error expiring auction item", { error, roomId });
  }
}

export function registerResolutionHandlers(io: Server, socket: Socket): void {
  const resolve = (resolution: Resolution) => async () => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("error", { message: "Not authenticated for any room." });
        return;
      }
      if (participant.role !== "admin") {
        socket.emit("error", { message: "Access denied: Only room hosts can resolve items." });
        return;
      }

      const resolvedItem = await resolveActiveItem(io, cachedRoom._id.toString(), resolution);
      if (!resolvedItem) {
        const message = resolution === "sold"
          ? "An item can only be sold after at least one accepted bid."
          : "Item is not currently active or has already been resolved.";
        socket.emit("error", { message });
      }
    } catch (error) {
      logger.error("Error resolving auction item", { error, resolution });
      socket.emit("error", { message: "Internal server error resolving item." });
    }
  };

  socket.on("item:sell", resolve("sold"));
  socket.on("item:unsold", resolve("unsold"));
}
