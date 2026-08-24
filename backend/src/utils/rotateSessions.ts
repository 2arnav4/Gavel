import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Participant } from "../models/participantModel.js";
import { Room } from "../models/roomModel.js";

function parseRoomFilter(argv: string[]): string | null {
  const index = argv.indexOf("--room");
  if (index === -1) return null;

  const code = argv[index + 1];
  if (!code) throw new Error("--room requires a room code, e.g. --room 291H4L");

  return code.trim().toUpperCase();
}

async function main(): Promise<void> {
  const roomCode = parseRoomFilter(process.argv.slice(2));

  await mongoose.connect(env.mongodbUri, {
    dbName: env.mongodbDbName,
    serverSelectionTimeoutMS: 10_000,
  });

  let filter: Record<string, unknown> = {};

  if (roomCode) {
    const room = await Room.findOne({ code: roomCode });
    if (!room) {
      console.error(`No room found with code ${roomCode}.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    filter = { roomId: room._id };
  }

  const participants = await Participant.find(filter).select("_id");

  if (participants.length === 0) {
    console.log("No participants matched. Nothing to rotate.");
    await mongoose.disconnect();
    return;
  }

  const operations = participants.map((participant) => ({
    updateOne: {
      filter: { _id: participant._id },
      update: { $set: { sessionToken: crypto.randomUUID(), isConnected: false } },
    },
  }));

  const result = await Participant.bulkWrite(operations);

  console.log(
    `Rotated ${result.modifiedCount} session token(s)` +
      (roomCode ? ` in room ${roomCode}.` : " across every room."),
  );
  console.log(
    "Existing sockets stay connected until the process restarts; any reconnect now fails.",
  );
  console.log("Restart the backend to force every client to re-authenticate.");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Session rotation failed:", error);
  process.exit(1);
});
