import type { Server, Socket } from "socket.io";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid } from "../../models/bidModel.js";
import { Participant } from "../../models/participantModel.js";
import { Room } from "../../models/roomModel.js";
import { getMinimumBid, isValidPositiveAmount } from "../../utils/auction.js";
import { env } from "../../config/env.js";
import { scheduleAuctionTimer } from "./resolutionHandler.js";
import { createRateLimiter } from "../../utils/rateLimiter.js";
import { readEventField } from "../validation.js";
import { logger } from "../../utils/logger.js";

const bidRateLimiter = createRateLimiter({ limit: 5, windowMs: 1000 });

type BidRejection = {
  reason: string;
  minimumBid?: number;
  retryAfterMs?: number;
};

export function registerBiddingHandlers(io: Server, socket: Socket): void {
  socket.on("bid:place", async (data: unknown) => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("bid:rejected", {
          reason: "Not authenticated for any room.",
        } satisfies BidRejection);
        return;
      }

      const bidLimit = bidRateLimiter.check(participant._id.toString());
      if (!bidLimit.allowed) {
        socket.emit("bid:rejected", {
          reason: "You are bidding too quickly. Slow down for a moment.",
          retryAfterMs: bidLimit.retryAfterMs,
        } satisfies BidRejection);
        return;
      }

      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("bid:rejected", {
          reason: "Room not found.",
        } satisfies BidRejection);
        return;
      }

      if (participant.role !== "participant") {
        socket.emit("bid:rejected", {
          reason: "Access denied: Room hosts are not allowed to place bids.",
        } satisfies BidRejection);
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      if (!room.currentItemId) {
        socket.emit("bid:rejected", {
          reason: "No active bidding item found.",
        } satisfies BidRejection);
        return;
      }

      const activeItem = await AuctionItem.findById(room.currentItemId);
      if (!activeItem || activeItem.status !== "active") {
        socket.emit("bid:rejected", {
          reason: "Item is not open for bidding.",
        } satisfies BidRejection);
        return;
      }

      if (activeItem.isPaused) {
        socket.emit("bid:rejected", {
          reason: "Bidding is paused by the host.",
          minimumBid: getMinimumBid(activeItem.startingBid, activeItem.currentBid, room.minBidIncrement),
        } satisfies BidRejection);
        return;
      }

      const amount = readEventField(data, "amount");
      if (!isValidPositiveAmount(amount)) {
        socket.emit("bid:rejected", {
          reason: "Bid amount must be a valid number.",
          minimumBid: getMinimumBid(activeItem.startingBid, activeItem.currentBid, room.minBidIncrement),
        } satisfies BidRejection);
        return;
      }

      const freshParticipant = await Participant.findById(participant._id);
      if (!freshParticipant) {
        socket.emit("bid:rejected", {
          reason: "Your participant record no longer exists.",
        } satisfies BidRejection);
        return;
      }

      const remainingBudget = freshParticipant.budget - freshParticipant.spent;
      if (amount > remainingBudget) {
        socket.emit("bid:rejected", {
          reason: `That exceeds your remaining purse of ₹${remainingBudget.toLocaleString("en-IN")}.`,
          minimumBid: getMinimumBid(activeItem.startingBid, activeItem.currentBid, room.minBidIncrement),
        } satisfies BidRejection);
        return;
      }

      const minimumBidRequired = getMinimumBid(
        activeItem.startingBid,
        activeItem.currentBid,
        room.minBidIncrement,
      );
      if (amount < minimumBidRequired) {
        socket.emit("bid:rejected", {
          reason: `Bid amount is too low. Minimum required: ₹${minimumBidRequired}`,
          minimumBid: minimumBidRequired,
        } satisfies BidRejection);
        return;
      }

      const newEndsAt = new Date(Date.now() + env.auctionItemDurationSeconds * 1000);

      const updatedItem = await AuctionItem.findOneAndUpdate(
        {
          _id: activeItem._id,
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
        },
        { new: true },
      );

      if (!updatedItem) {
        const latestItem = await AuctionItem.findById(activeItem._id);
        const latestMinimumBid = latestItem
          ? getMinimumBid(latestItem.startingBid, latestItem.currentBid, room.minBidIncrement)
          : undefined;
        const reason = latestItem?.isPaused
          ? "Bidding is paused by the host."
          : latestItem?.endsAt && latestItem.endsAt <= new Date()
            ? "Bidding time has expired for this item."
            : latestMinimumBid !== undefined
              ? `Bid amount is too low. Minimum required: ₹${latestMinimumBid}`
              : "Your bid could not be placed. Please try again.";
        socket.emit("bid:rejected", {
          reason,
          ...(latestMinimumBid !== undefined ? { minimumBid: latestMinimumBid } : {}),
        } satisfies BidRejection);
        return;
      }

      const newBid = new Bid({
        roomId: room._id,
        itemId: activeItem._id,
        participantId: participant._id,
        username: participant.username,
        amount,
      });
      await newBid.save();

      await Room.updateOne(
        { _id: room._id },
        { $set: { endsAt: newEndsAt } }
      );
      room.endsAt = newEndsAt;
      scheduleAuctionTimer(io, room._id.toString(), newEndsAt);

      io.to(socketRoomId).emit("bid:accepted", {
        bid: newBid,
        item: updatedItem,
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
        reason: "Internal server error placing bid.",
      } satisfies BidRejection);
    }
  });
}
