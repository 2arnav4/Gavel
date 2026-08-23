import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  salt: string;
  /** Stored per user so the work factor can be raised without invalidating existing passwords. */
  hashIterations: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      trim: true,
    },
    usernameNormalized: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    salt: {
      type: String,
      required: true,
    },
    // Accounts created before this field existed were hashed at 1,000 rounds.
    hashIterations: {
      type: Number,
      required: true,
      default: 1_000,
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUser>("User", UserSchema);
