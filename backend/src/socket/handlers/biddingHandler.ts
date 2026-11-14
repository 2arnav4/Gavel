import type { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import { AuctionItem, type IAuctionItem } from "../../models/itemModel.js";
import { Bid, type IBid } from "../../models/bidModel.js";
import { Participant } from "../../models/participantModel.js";
import { Room, type IRoom } from "../../models/roomModel.js";
import { getMinimumBid, isValidPositiveAmount, isWholeAmount } from "../../utils/auction.js";
import { env } from "../../config/env.js";
import { formatMoney } from "../../utils/currency.js";
import { scheduleAuctionTimer } from "./resolutionHandler.js";
import { createRateLimiter } from "../../utils/rateLimiter.js";
import type { RateLimitCheck } from "../../realtime/redisRateLimiter.js";
import { readEventField } from "../validation.js";
import type { BidRejection } from "../errors.js";
import { logger } from "../../utils/logger.js";

export const BID_LIMIT = { limit: 5, windowMs: 1000 };

export const localBidRateLimiter = createRateLimiter(BID_LIMIT);

let bidRateLimiter: RateLimitCheck = localBidRateLimiter;

export function setBidRateLimiter(limiter: RateLimitCheck): void {
  bidRateLimiter = limiter;
}

const CLIENT_BID_ID = /^[A-Za-z0-9-]{8,64}$/;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

async function replayAcceptedBid(
  socket: Socket,
  participantId: IBid["participantId"],
  clientBidId: string,
  amount: number,
  requestedItemId: string | undefined,
): Promise<boolean> {
  if (requestedItemId !== undefined && !mongoose.isValidObjectId(requestedItemId)) return false;

  const original = await Bid.findOne({
    participantId,
    clientBidId,
    ...(requestedItemId !== undefined ? { itemId: requestedItemId } : {}),
  });
  if (!original) return false;

  if (original.amount !== amount) {
    socket.emit("bid:rejected", {
      code: "INVALID_INPUT",
      reason: "That bid id was already used for a different amount.",
    } satisfies BidRejection);
    return true;
  }

  socket.emit("bid:accepted", {
    bid: original,
    item: await AuctionItem.findById(original.itemId),
    duplicate: true,
  });
  return true;
}

async function extendRoomDeadline(
  roomId: IRoom["_id"],
  itemId: IAuctionItem["_id"],
  endsAt: Date,
): Promise<boolean> {
  const result = await Room.updateOne(
    { _id: roomId, status: "live", isPaused: false, currentItemId: itemId },
    { $set: { endsAt } },
  );
  return result.matchedCount > 0;
}

export function registerBiddingHandlers(io: Server, socket: Socket): void {
  socket.on("bid:place", async (data: unknown) => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("bid:rejected", {
          code: "NOT_AUTHENTICATED",
          reason: "Not authenticated for any room.",
        } satisfies BidRejection);
        return;
      }

      const bidLimit = await bidRateLimiter.check(participant._id.toString());
      if (!bidLimit.allowed) {
        socket.emit("bid:rejected", {
          code: "RATE_LIMITED",
          reason: "You are bidding too quickly. Slow down for a moment.",
          retryAfterMs: bidLimit.retryAfterMs,
        } satisfies BidRejection);
        return;
      }

      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("bid:rejected", {
          code: "ROOM_NOT_FOUND",
          reason: "Room not found.",
        } satisfies BidRejection);
        return;
      }

      if (participant.role !== "participant") {
        socket.emit("bid:rejected", {
          code: "NOT_AUTHORIZED",
          reason: "Access denied: Room hosts are not allowed to place bids.",
        } satisfies BidRejection);
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      if (!room.currentItemId) {
        socket.emit("bid:rejected", {
          code: "NO_ACTIVE_ITEM",
          reason: "No active bidding item found.",
        } satisfies BidRejection);
        return;
      }

      const itemId = room.currentItemId;

      const requestedItemId = readEventField(data, "itemId");
      if (requestedItemId !== undefined) {
        if (typeof requestedItemId !== "string") {
          socket.emit("bid:rejected", {
            code: "INVALID_INPUT",
            reason: "Item id must be a string.",
          } satisfies BidRejection);
          return;
        }
      }

      let itemLoaded = false;
      let loadedItem: IAuctionItem | null = null;

      const readItem = async (): Promise<IAuctionItem | null> => {
        if (!itemLoaded) {
          loadedItem = await AuctionItem.findById(itemId);
          itemLoaded = true;
        }
        return loadedItem;
      };

      const readMinimumBid = async (): Promise<number | undefined> => {
        const item = await readItem();
        return item
          ? getMinimumBid(item.startingBid, item.currentBid, room.minBidIncrement)
          : undefined;
      };

      const amount = readEventField(data, "amount");
      if (!isValidPositiveAmount(amount)) {
        socket.emit("bid:rejected", {
          code: "INVALID_INPUT",
          reason: "Bid amount must be a valid number.",
          minimumBid: await readMinimumBid(),
        } satisfies BidRejection);
        return;
      }

      if (!isWholeAmount(amount)) {
        socket.emit("bid:rejected", {
          code: "INVALID_INPUT",
          reason: "Bid amount must be a whole number, with no decimals.",
          minimumBid: await readMinimumBid(),
        } satisfies BidRejection);
        return;
      }

      const rawClientBidId = readEventField(data, "bidId");
      if (rawClientBidId !== undefined && (typeof rawClientBidId !== "string" || !CLIENT_BID_ID.test(rawClientBidId))) {
        socket.emit("bid:rejected", {
          code: "INVALID_INPUT",
          reason: "Bid id must be 8 to 64 letters, digits or dashes.",
        } satisfies BidRejection);
        return;
      }
      const clientBidId = rawClientBidId as string | undefined;

      const namedItemId = requestedItemId as string | undefined;

      if (clientBidId && await replayAcceptedBid(socket, participant._id, clientBidId, amount, namedItemId)) {
        return;
      }

      if (namedItemId !== undefined && namedItemId !== itemId.toString()) {
        socket.emit("bid:rejected", {
          code: "STALE_ITEM",
          reason: "That bid was for an item that is no longer on the block.",
        } satisfies BidRejection);
        return;
      }

      const freshParticipant = await Participant.findById(participant._id);
      if (!freshParticipant) {
        socket.emit("bid:rejected", {
          code: "PARTICIPANT_NOT_FOUND",
          reason: "Your participant record no longer exists.",
        } satisfies BidRejection);
        return;
      }

      const remainingBudget = freshParticipant.budget - freshParticipant.spent;
      if (amount > remainingBudget) {
        socket.emit("bid:rejected", {
          code: "INSUFFICIENT_BUDGET",
          reason: `That exceeds your remaining purse of ${formatMoney(remainingBudget, room.currency)}.`,
          minimumBid: await readMinimumBid(),
        } satisfies BidRejection);
        return;
      }

      const newEndsAt = new Date(Date.now() + env.auctionItemDurationSeconds * 1000);

      const updatedItem = await AuctionItem.findOneAndUpdate(
        {
          _id: itemId,
          status: "active",
          isPaused: false,
          endsAt: { $gt: new Date() },
          $expr: {
            $cond: {
              if: { $gt: ["$currentBid", 0] },
              then: { $gte: [amount, { $add: ["$currentBid", room.minBidIncrement] }] },
              else: { $gte: [amount, "$startingBid"] },
            },
          },
        },
        {
          $set: {
            currentBid: amount,
            highestBidderId: participant._id,
            highestBidderUsername: participant.username,
            endsAt: newEndsAt,
          },
          $inc: { version: 1 },
        },
        { new: true },
      );

      if (!updatedItem) {
        if (clientBidId && await replayAcceptedBid(socket, participant._id, clientBidId, amount, namedItemId)) {
          return;
        }

        const latestItem = await readItem();

        if (!latestItem || latestItem.status !== "active") {
          socket.emit("bid:rejected", {
            code: "ITEM_CLOSED",
            reason: "Item is not open for bidding.",
          } satisfies BidRejection);
          return;
        }

        const latestMinimumBid = getMinimumBid(
          latestItem.startingBid,
          latestItem.currentBid,
          room.minBidIncrement,
        );
        const expired = Boolean(latestItem.endsAt && latestItem.endsAt <= new Date());
        const rejection: BidRejection = latestItem.isPaused
          ? { code: "AUCTION_PAUSED", reason: "Bidding is paused by the host." }
          : expired
            ? { code: "AUCTION_ENDED", reason: "Bidding time has expired for this item." }
            : { code: "BID_TOO_LOW", reason: `Bid amount is too low. Minimum required: ${formatMoney(latestMinimumBid, room.currency)}` };

        socket.emit("bid:rejected", {
          ...rejection,
          minimumBid: latestMinimumBid,
        } satisfies BidRejection);
        return;
      }

      const newBid = new Bid({
        roomId: room._id,
        itemId,
        participantId: participant._id,
        username: participant.username,
        amount,
        ...(clientBidId ? { clientBidId } : {}),
      });
      try {
        await newBid.save();
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          logger.warn("Bid log entry skipped: bid id reused concurrently", {
            roomCode,
            participantId: participant._id.toString(),
            amount,
          });
        } else {
          logger.error("Accepted bid could not be written to the log", {
            error,
            roomCode,
            itemId: itemId.toString(),
            participantId: participant._id.toString(),
            amount,
            version: updatedItem.version,
          });
        }
      }

      try {
        if (await extendRoomDeadline(room._id, itemId, newEndsAt)) {
          room.endsAt = newEndsAt;
          scheduleAuctionTimer(io, room._id.toString(), newEndsAt);
        }
      } catch (error) {
        logger.error("Accepted bid could not extend the room deadline", {
          error,
          roomCode,
          itemId: itemId.toString(),
          endsAt: newEndsAt.toISOString(),
        });
        scheduleAuctionTimer(io, room._id.toString(), newEndsAt);
      }

      io.to(socketRoomId).emit("bid:accepted", {
        bid: newBid,
        item: updatedItem,
        version: updatedItem.version,
      });

      logger.info("Bid accepted", {
        roomCode,
        itemId: updatedItem._id.toString(),
        participantId: participant._id.toString(),
        amount,
      });
    } catch (error) {
      logger.error("Error in bid:place handler", { error });
      socket.emit("bid:rejected", {
        code: "INTERNAL_ERROR",
        reason: "Internal server error placing bid.",
      } satisfies BidRejection);
    }
  });
}
