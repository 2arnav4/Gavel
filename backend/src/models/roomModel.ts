import mongoose, { Schema, Document } from "mongoose";

export interface IRoom extends Document {
  code: string;
  name: string;
  status: "lobby" | "live" | "completed";
  /** The purse every bidder in this room starts with. Fixed at creation. */
  startingBudget: number;
  /** Smallest legal raise over the standing highest bid. Fixed at creation. */
  minBidIncrement: number;
  adminParticipantId?: mongoose.Types.ObjectId | null;
  currentItemId?: mongoose.Types.ObjectId | null;
  endsAt?: Date | null;
  /** True while the host has frozen the countdown for the active item. */
  isPaused: boolean;
  /** Milliseconds left on the active item at the moment it was paused. */
  pausedRemainingMs?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const RoomSchema = new Schema<IRoom>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      minlength: 6,
      maxlength: 6,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["lobby", "live", "completed"],
      default: "lobby",
      required: true,
    },
    startingBudget: {
      type: Number,
      required: true,
      min: [1, "Starting budget must be positive."],
    },
    minBidIncrement: {
      type: Number,
      required: true,
      min: [1, "Minimum bid increment must be positive."],
    },
    adminParticipantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    currentItemId: {
      type: Schema.Types.ObjectId,
      ref: "AuctionItem",
      default: null,
    },
    endsAt: {
      type: Date,
      default: null,
    },
    isPaused: {
      type: Boolean,
      default: false,
      required: true,
    },
    // Stored rather than recomputed: pausing clears endsAt, so the remaining
    // time has nowhere else to live and must survive a restart.
    pausedRemainingMs: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const Room = mongoose.model<IRoom>("Room", RoomSchema);
