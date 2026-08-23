import mongoose, { Schema, Document } from "mongoose";

export interface IAuctionItem extends Document {
  roomId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  startingBid: number;
  currentBid: number;
  highestBidderId?: mongoose.Types.ObjectId | null;
  highestBidderUsername?: string | null;
  status: "pending" | "active" | "sold" | "unsold";
  /** Mirrors the room's pause state so it can be enforced inside the bid claim. */
  isPaused: boolean;
  endsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuctionItemSchema = new Schema<IAuctionItem>(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    startingBid: {
      type: Number,
      required: true,
      min: [0.01, "Starting bid must be positive."],
    },
    currentBid: {
      type: Number,
      required: true,
      default: 0,
    },
    highestBidderId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    highestBidderUsername: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "active", "sold", "unsold"],
      default: "pending",
      required: true,
    },
    isPaused: {
      type: Boolean,
      default: false,
      required: true,
    },
    endsAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Supports both the catalog listing and the conditional claim of the next
// pending item, which sorts by creation order while filtering on room and status.
AuctionItemSchema.index({ roomId: 1, status: 1, createdAt: 1 });

export const AuctionItem = mongoose.model<IAuctionItem>(
  "AuctionItem",
  AuctionItemSchema
);
