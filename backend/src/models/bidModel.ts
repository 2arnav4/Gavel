import mongoose, { Schema, Document } from "mongoose";

export interface IBid extends Document {
  roomId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  username: string;
  amount: number;
  createdAt: Date;
}

const BidSchema = new Schema<IBid>(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "AuctionItem",
      required: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Bid amount must be positive."],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Only track creation time
  }
);

// The bid log is read newest-first for one item on every room:connect and after
// every accepted bid, so it is the hottest read in the auction.
BidSchema.index({ itemId: 1, createdAt: -1 });

export const Bid = mongoose.model<IBid>("Bid", BidSchema);
