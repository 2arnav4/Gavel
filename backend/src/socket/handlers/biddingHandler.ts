import type { Server, Socket } from "socket.io";
import { AuctionItem } from "../../models/itemModel.js";
import { Bid } from "../../models/bidModel.js";
import { Participant } from "../../models/participantModel.js";
import { Room } from "../../models/roomModel.js";
import { getMinimumBid, isValidPositiveAmount } from "../../utils/auction.js";
import { env } from "../../config/env.js";
import { scheduleAuctionTimer } from "./resolutionHandler.js";

/**
 * Registers Bidding-related event listeners for a given Socket instance.
 */
export function registerBiddingHandlers(io: Server, socket: Socket): void {
  // Event: bid:place
  socket.on("bid:place", async (data: { amount?: unknown }) => {
    try {
      const participant = socket.data.participant;
      const cachedRoom = socket.data.room;

      if (!participant || !cachedRoom) {
        socket.emit("bid:rejected", {
          reason: "Not authenticated for any room.",
          minimumBid: 1,
        });
        return;
      }

      // Query database to fetch fresh status and currentItemId
      const room = await Room.findById(cachedRoom._id);
      if (!room) {
        socket.emit("bid:rejected", {
          reason: "Room not found.",
          minimumBid: 1,
        });
        return;
      }

      // 1. Verify user is a participant (Admins/Hosts cannot bid)
      if (participant.role !== "participant") {
        socket.emit("bid:rejected", {
          reason: "Access denied: Room hosts are not allowed to place bids.",
          minimumBid: 0,
        });
        return;
      }

      const roomCode = room.code;
      const socketRoomId = `room:${roomCode}`;

      // 2. Fetch latest active item details
      if (!room.currentItemId) {
        socket.emit("bid:rejected", {
          reason: "No active bidding item found.",
          minimumBid: 1,
        });
        return;
      }

      const activeItem = await AuctionItem.findById(room.currentItemId);
      if (!activeItem || activeItem.status !== "active") {
        socket.emit("bid:rejected", {
          reason: "Item is not open for bidding.",
          minimumBid: 1,
        });
        return;
      }

      if (activeItem.isPaused) {
        socket.emit("bid:rejected", {
          reason: "Bidding is paused by the host.",
          minimumBid: getMinimumBid(activeItem.startingBid, activeItem.currentBid, room.minBidIncrement),
        });
        return;
      }

      const amount = data.amount;
      if (!isValidPositiveAmount(amount)) {
        socket.emit("bid:rejected", {
          reason: "Bid amount must be a valid number.",
          minimumBid: activeItem.currentBid + 1,
        });
        return;
      }

      // 3a. Budget. Read fresh rather than trusting socket.data, which is a
      // snapshot from the handshake and predates every item won since.
      //
      // Checked here rather than inside the atomic claim because the claim
      // operates on the item, not the participant. That is safe only because
      // exactly one item is live at a time, so a bidder can hold at most one
      // outstanding commitment: `spent` cannot move between this check and the
      // claim except by an item resolving, which would fail the claim anyway.
      // Bidding on several items at once would need a conditional decrement on
      // the participant instead.
      const freshParticipant = await Participant.findById(participant._id);
      if (!freshParticipant) {
        socket.emit("bid:rejected", { reason: "Your participant record no longer exists.", minimumBid: 1 });
        return;
      }

      const remainingBudget = freshParticipant.budget - freshParticipant.spent;
      if (amount > remainingBudget) {
        socket.emit("bid:rejected", {
          reason: `That exceeds your remaining purse of ₹${remainingBudget.toLocaleString("en-IN")}.`,
          minimumBid: getMinimumBid(activeItem.startingBid, activeItem.currentBid, room.minBidIncrement),
        });
        return;
      }

      // 3b. Validate bid amount. The first bid may match the asking price
      // exactly; every later bid must clear the room's minimum increment.
      const minimumBidRequired = getMinimumBid(
        activeItem.startingBid,
        activeItem.currentBid,
        room.minBidIncrement,
      );
      if (amount < minimumBidRequired) {
        socket.emit("bid:rejected", {
          reason: `Bid amount is too low. Minimum required: ₹${minimumBidRequired}`,
          minimumBid: minimumBidRequired,
        });
        return;
      }

      // 4. Claim the highest bid atomically before writing anything.
      //
      // Only one concurrent request can match `currentBid: { $lt: amount }`, so
      // the losers never write at all. Persisting the bid first and deleting it
      // on failure — the previous approach — left a rejected bid briefly visible
      // to any concurrent room:connect reading the log, and orphaned it forever
      // if the process died between the write and the compensating delete.
      //
      // The same update extends the deadline: an accepted bid restarts the
      // countdown so a last-second snipe cannot end the item uncontested.
      const newEndsAt = new Date(Date.now() + env.auctionItemDurationSeconds * 1000);

      const updatedItem = await AuctionItem.findOneAndUpdate(
        {
          _id: activeItem._id,
          status: "active",
          // Enforced here and not only in the check above: a pause landing
          // between that read and this update would otherwise let one bid
          // through after the countdown had visibly stopped for everyone.
          isPaused: false,
          endsAt: { $gt: new Date() },
          // The price floor is expressed against the document's own fields
          // rather than against the values read a moment ago. A plain
          // `currentBid: { $lt: amount }` would compare correctly but enforce
          // the wrong rule: it permits a one-rupee raise. Computing the floor
          // inside the query means a bid that was legal when it was validated
          // is re-checked against whatever the current price actually is.
          $expr: {
            $cond: {
              // No bids yet: the asking price is the floor, unmodified. Adding
              // an increment here would mean the advertised price was never
              // actually available to anyone.
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
          : 1;
        const reason = latestItem?.isPaused
          ? "Bidding is paused by the host."
          : latestItem?.endsAt && latestItem.endsAt <= new Date()
            ? "Bidding time has expired for this item."
            : `Bid amount is too low. Minimum required: ₹${latestMinimumBid}`;
        socket.emit("bid:rejected", {
          reason,
          minimumBid: latestMinimumBid,
        });
        return;
      }

      // 5. The claim succeeded, so this bid is now the authoritative highest and
      // can safely be appended to the immutable log.
      const newBid = new Bid({
        roomId: room._id,
        itemId: activeItem._id,
        participantId: participant._id,
        username: participant.username,
        amount,
      });
      await newBid.save();

      // Reset Room endsAt and reschedule the authoritative server-owned timer
      await Room.updateOne(
        { _id: room._id },
        { $set: { endsAt: newEndsAt } }
      );
      room.endsAt = newEndsAt;
      scheduleAuctionTimer(io, room._id.toString(), newEndsAt);

      // 6. Broadcast successful bid
      io.to(socketRoomId).emit("bid:accepted", {
        bid: newBid,
        item: updatedItem,
      });

      console.log(`Bid of ₹${amount} placed by ${participant.username} on item ${updatedItem.name}`);
    } catch (error) {
      console.error("Error in bid:place handler:", error);
      socket.emit("bid:rejected", {
        reason: "Internal server error placing bid.",
        minimumBid: 1,
      });
    }
  });
}
