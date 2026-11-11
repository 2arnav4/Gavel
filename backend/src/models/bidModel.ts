import mongoose, { Schema, Document } from "mongoose";

export interface IBid extends Document {
  roomId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  username: string;
  amount: number;
  clientBidId?: string;
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
    clientBidId: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

BidSchema.index({ itemId: 1, createdAt: -1 });
BidSchema.index(
  { participantId: 1, clientBidId: 1 },
  { unique: true, partialFilterExpression: { clientBidId: { $type: "string" } } },
);

export const Bid = mongoose.model<IBid>("Bid", BidSchema);
