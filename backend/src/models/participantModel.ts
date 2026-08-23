import mongoose, { Schema, Document } from "mongoose";

export interface IParticipant extends Document {
  roomId: mongoose.Types.ObjectId;
  username: string;
  usernameNormalized: string;
  role: "admin" | "participant";
  sessionToken: string;
  /** Purse copied from the room at join time, so a later room edit cannot move it. */
  budget: number;
  /** Total won so far. Remaining purse is budget - spent. */
  spent: number;
  isConnected: boolean;
  joinedAt: Date;
}

const ParticipantSchema = new Schema<IParticipant>({
  roomId: {
    type: Schema.Types.ObjectId,
    ref: "Room",
    required: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  usernameNormalized: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  role: {
    type: String,
    enum: ["admin", "participant"],
    default: "participant",
    required: true,
  },
  sessionToken: {
    type: String,
    required: true,
    unique: true,
  },
  budget: {
    type: Number,
    required: true,
    default: 0,
  },
  spent: {
    type: Number,
    required: true,
    default: 0,
  },
  isConnected: {
    type: Boolean,
    default: false,
    required: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
});

// Compound unique index so usernames are unique within a single room, regardless of case.
ParticipantSchema.index({ roomId: 1, usernameNormalized: 1 }, { unique: true });

export const Participant = mongoose.model<IParticipant>(
  "Participant",
  ParticipantSchema
);
