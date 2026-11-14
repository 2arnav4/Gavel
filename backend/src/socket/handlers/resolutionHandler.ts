import type { Server, Socket } from "socket.io";
import { env } from "../../config/env.js";
import { isDatabaseConnected } from "../../config/db.js";
import { Room } from "../../models/roomModel.js";
import { AuctionItem, type IAuctionItem } from "../../models/itemModel.js";
import { Participant } from "../../models/participantModel.js";
import { getAuctionEndsAt, getExpiryResolution } from "../../utils/auction.js";
import { logger } from "../../utils/logger.js";
import type { SocketError } from "../errors.js";

type Resolution = "sold" | "unsold";

const auctionTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearAllAuctionTimers(): number {
  const count = auctionTimers.size;
  for (const timer of auctionTimers.values()) clearTimeout(timer);
  auctionTimers.clear();
  return count;
}

export function hasAuctionTimer(roomId: string): boolean {
  return auctionTimers.has(roomId);
}

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

export type SweepScope = { roomIds?: unknown[] };

const SWEEP_BATCH = 100;

export async function sweepExpiredItems(io: Server, scope: SweepScope = {}): Promise<number> {
  const filter: Record<string, unknown> = {
    status: "active",
    isPaused: false,
    endsAt: { $lte: new Date() },
  };
  if (scope.roomIds) filter.roomId = { $in: scope.roomIds };

  const expired = await AuctionItem.find(filter)
    .select("roomId")
    .sort({ endsAt: 1 })
    .limit(SWEEP_BATCH)
    .lean();
  const roomIds = [...new Set(expired.map((item) => item.roomId.toString()))];
  await Promise.all(roomIds.map((roomId) => expireActiveItem(io, roomId)));
  return roomIds.length;
}

export const STUCK_AFTER_MS = 5_000;

export async function recoverStuckRooms(io: Server, scope: SweepScope = {}): Promise<number> {
  const settledBefore = new Date(Date.now() - STUCK_AFTER_MS);
  const roomFilter: Record<string, unknown> = { status: "live", isPaused: false, updatedAt: { $lte: settledBefore } };
  if (scope.roomIds) roomFilter._id = { $in: scope.roomIds };

  const rooms = await Room.find(roomFilter).select("currentItemId").limit(SWEEP_BATCH).lean();
  let recovered = 0;

  for (const room of rooms) {
    const roomId = room._id.toString();
    const current = room.currentItemId
      ? await AuctionItem.findById(room.currentItemId).select("status updatedAt").lean()
      : null;

    if (current?.status === "active") continue;
    if (current && current.updatedAt > settledBefore) continue;

    const orphan = await AuctionItem.findOne({ roomId: room._id, status: "active" })
      .select("_id endsAt isPaused")
      .lean();

    if (orphan) {
      const adopted = await Room.findOneAndUpdate(
        { _id: room._id, status: "live", currentItemId: room.currentItemId ?? null },
        { $set: { currentItemId: orphan._id, endsAt: orphan.endsAt ?? null } },
        { new: true },
      );
      if (adopted && orphan.endsAt && !orphan.isPaused) scheduleAuctionTimer(io, roomId, orphan.endsAt);
      if (adopted) {
        recovered += 1;
        logger.warn("Recovered a room pointing away from its active item", { roomId, itemId: orphan._id.toString() });
      }
      continue;
    }

    const advanced = await progressAuction(io, roomId, room.currentItemId ?? null);
    if (advanced) {
      recovered += 1;
      logger.warn("Recovered a room stuck on a resolved item", {
        roomId,
        itemId: room.currentItemId?.toString() ?? null,
      });
    }
  }

  return recovered;
}

export function startExpirySweep(io: Server, intervalMs = 1_000, scope: SweepScope = {}): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !isDatabaseConnected()) return;
    running = true;
    sweepExpiredItems(io, scope)
      .then(() => recoverStuckRooms(io, scope))
      .catch((error) => logger.error("Expiry sweep failed", { error }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
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

async function progressAuction(
  io: Server,
  roomId: string,
  fromItemId: unknown,
): Promise<boolean> {
  const room = await Room.findOneAndUpdate(
    { _id: roomId, status: "live", currentItemId: fromItemId ?? null },
    { $set: { currentItemId: null, endsAt: null, isPaused: false, pausedRemainingMs: null } },
    { new: true },
  );
  if (!room) return false;

  const endsAt = getAuctionEndsAt(Date.now(), env.auctionItemDurationSeconds);
  const nextItem = await AuctionItem.findOneAndUpdate(
    { roomId: room._id, status: "pending" },
    { $set: { status: "active", endsAt }, $inc: { version: 1 } },
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
    return true;
  }

  const updatedRoom = await Room.findOneAndUpdate(
    { _id: room._id, status: "live", currentItemId: null },
    { $set: { currentItemId: nextItem._id, endsAt, isPaused: false, pausedRemainingMs: null } },
    { new: true },
  );

  if (!updatedRoom) return false;

  scheduleAuctionTimer(io, roomId, endsAt);
  io.to(socketRoomId).emit("item:activated", {
    item: nextItem,
    startedAt: new Date().toISOString(),
    endsAt: endsAt.toISOString(),
    version: nextItem.version,
  });
  return true;
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
    { $set: update, $inc: { version: 1 } },
    { new: true },
  );
  if (!resolvedItem) return null;

  let winner = null;
  if (resolution === "sold" && resolvedItem.highestBidderId) {
    try {
      winner = await Participant.findOneAndUpdate(
        { _id: resolvedItem.highestBidderId },
        { $inc: { spent: resolvedItem.currentBid } },
        { new: true },
      ).select("-sessionToken");
    } catch (error) {
      logger.error("Winner charge failed; reconcile this sale by hand", {
        error,
        roomId,
        itemId: resolvedItem._id.toString(),
        participantId: resolvedItem.highestBidderId.toString(),
        amount: resolvedItem.currentBid,
      });
    }
  }

  clearAuctionTimer(roomId);
  const socketRoomId = `room:${room.code}`;
  io.to(socketRoomId).emit("item:ended", {
    item: resolvedItem,
    resolution,
    winner,
    version: resolvedItem.version,
  });
  await progressAuction(io, roomId, resolvedItem._id);

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
        socket.emit("error", { code: "NOT_AUTHENTICATED", message: "Not authenticated for any room." } satisfies SocketError);
        return;
      }
      if (participant.role !== "admin") {
        socket.emit("error", { code: "NOT_AUTHORIZED", message: "Access denied: Only room hosts can resolve items." } satisfies SocketError);
        return;
      }

      const resolvedItem = await resolveActiveItem(io, cachedRoom._id.toString(), resolution);
      if (!resolvedItem) {
        const message = resolution === "sold"
          ? "An item can only be sold after at least one accepted bid."
          : "Item is not currently active or has already been resolved.";
        socket.emit("error", { code: "NOTHING_TO_RESOLVE", message } satisfies SocketError);
      }
    } catch (error) {
      logger.error("Error resolving auction item", { error, resolution });
      socket.emit("error", { code: "INTERNAL_ERROR", message: "Internal server error resolving item." } satisfies SocketError);
    }
  };

  socket.on("item:sell", resolve("sold"));
  socket.on("item:unsold", resolve("unsold"));
}
