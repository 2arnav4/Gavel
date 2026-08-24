import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

mongoose.set("bufferTimeoutMS", 5_000);

export type DatabaseStatus =
  | "connected"
  | "connecting"
  | "disconnecting"
  | "disconnected";

const READY_STATE_LABELS: Record<number, DatabaseStatus> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function getDatabaseStatus(): DatabaseStatus {
  return READY_STATE_LABELS[mongoose.connection.readyState] ?? "disconnected";
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function migrateParticipantUsernameKeys(): Promise<void> {
  await Participant.collection.updateMany(
    { usernameNormalized: { $exists: false } },
    [{ $set: { usernameNormalized: { $toLower: "$username" } } }],
  );
  await Participant.createIndexes();
}

async function migrateBudgets(): Promise<void> {
  await Room.collection.updateMany(
    { startingBudget: { $exists: false } },
    { $set: { startingBudget: env.defaultStartingBudget } },
  );
  await Room.collection.updateMany(
    { minBidIncrement: { $exists: false } },
    { $set: { minBidIncrement: env.defaultMinBidIncrement } },
  );
  await Participant.collection.updateMany(
    { budget: { $exists: false } },
    { $set: { budget: env.defaultStartingBudget, spent: 0 } },
  );
}

function registerConnectionLogging(): void {
  mongoose.connection.on("connected", () => {
    logger.info("Connected to MongoDB", { database: env.mongodbDbName });
  });

  mongoose.connection.on("error", (err: Error) => {
    logger.error("MongoDB connection error", { error: err });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected, Mongoose will reconnect automatically");
  });
}

export async function connectDB(): Promise<void> {
  registerConnectionLogging();

  let delay = INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(env.mongodbUri, {
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
        dbName: env.mongodbDbName,
      });
      await migrateParticipantUsernameKeys();
      await migrateBudgets();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("MongoDB connection attempt failed", {
        attempt,
        reason: message,
        retryInMs: delay,
      });

      await sleep(delay);
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }
  }
}
