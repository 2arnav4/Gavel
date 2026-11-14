import crypto from "crypto";
import { Room } from "../models/roomModel.js";
import { Participant } from "../models/participantModel.js";
import { AuctionItem } from "../models/itemModel.js";
import { generateUniqueRoomCode } from "../utils/codeGenerator.js";
import { AppError } from "../middleware/errorHandler.js";
import { env } from "../config/env.js";
import { requirePositiveNumber, requireString } from "../utils/validation.js";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export async function createRoom(
  username: string,
  roomName: string,
  startingBudget?: number,
  minBidIncrement?: number,
) {
  const hostName = requireString(username, "Username", 40);
  const name = requireString(roomName, "Room name", 60);

  const budget = requirePositiveNumber(
    startingBudget ?? env.defaultStartingBudget,
    "Starting budget",
  );
  const increment = requirePositiveNumber(
    minBidIncrement ?? env.defaultMinBidIncrement,
    "Minimum bid increment",
  );
  if (increment > budget) {
    throw new AppError(
      "Minimum bid increment cannot exceed the bidder budget, or no raise would ever be affordable.",
      400,
    );
  }

  const code = await generateUniqueRoomCode();

  const room = new Room({
    code,
    name,
    status: "lobby",
    startingBudget: budget,
    minBidIncrement: increment,
  });
  await room.save();

  const sessionToken = crypto.randomUUID();
  const participant = new Participant({
    roomId: room._id,
    username: hostName,
    usernameNormalized: hostName.toLowerCase(),
    role: "admin",
    sessionToken,
    budget,
    spent: 0,
  });
  await participant.save();

  room.adminParticipantId = participant._id;
  await room.save();

  return {
    room,
    participant,
    sessionToken,
  };
}

export async function joinRoom(code: string, username: string) {
  const bidderName = requireString(username, "Username", 40);
  const normalizedCode = requireString(code, "Room code").toUpperCase();

  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found", 404);
  }

  if (room.status === "completed") {
    throw new AppError("This auction room has already completed", 400);
  }

  const normalizedUsername = bidderName.toLowerCase();

  const existingParticipant = await Participant.findOne({
    roomId: room._id,
    usernameNormalized: normalizedUsername,
  });
  if (existingParticipant) {
    throw new AppError(`Username "${username}" is already taken in this room`, 400);
  }

  const sessionToken = crypto.randomUUID();
  const participant = new Participant({
    roomId: room._id,
    username: bidderName,
    usernameNormalized: normalizedUsername,
    role: "participant",
    sessionToken,
    budget: room.startingBudget,
    spent: 0,
  });

  try {
    await participant.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(`Username "${username.trim()}" is already taken in this room`, 409);
    }
    throw error;
  }

  return {
    room,
    participant,
    sessionToken,
  };
}

export async function getRoomByCode(code: string) {
  const normalizedCode = requireString(code, "Room code").toUpperCase();
  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found", 404);
  }

  return room;
}

export async function getRoomResults(code: string) {
  const normalizedCode = requireString(code, "Room code").toUpperCase();
  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found", 404);
  }

  const items = await AuctionItem.find({
    roomId: room._id,
    status: { $in: ["sold", "unsold"] },
  }).sort({ updatedAt: 1 });

  return items;
}

const ROSTER_LIMIT_MAX = 100;
const ROSTER_LIMIT_DEFAULT = 50;
const ROSTER_CURSOR = /^(\d{1,16})_([a-f0-9]{24})$/;

export async function getRoomParticipants(code: string, cursor: unknown, limit: unknown) {
  const normalizedCode = requireString(code, "Room code").toUpperCase();

  let pageSize = ROSTER_LIMIT_DEFAULT;
  if (limit !== undefined) {
    const parsed = requirePositiveNumber(limit, "Limit");
    if (!Number.isInteger(parsed)) {
      throw new AppError("Limit must be a whole number.", 400);
    }
    pageSize = Math.min(parsed, ROSTER_LIMIT_MAX);
  }

  let after: { joinedAt: Date; id: string } | null = null;
  if (cursor !== undefined) {
    const match = ROSTER_CURSOR.exec(requireString(cursor, "Cursor", 48));
    if (!match) {
      throw new AppError("Cursor is not valid.", 400);
    }
    after = { joinedAt: new Date(Number(match[1])), id: match[2] };
  }

  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found", 404);
  }

  const filter: Record<string, unknown> = { roomId: room._id };
  if (after) {
    filter.$or = [
      { joinedAt: { $gt: after.joinedAt } },
      { joinedAt: after.joinedAt, _id: { $gt: after.id } },
    ];
  }

  const rows = await Participant.find(filter)
    .select("-sessionToken")
    .sort({ joinedAt: 1, _id: 1 })
    .limit(pageSize + 1)
    .lean();

  const participants = rows.slice(0, pageSize);
  const last = participants[participants.length - 1];
  const nextCursor = rows.length > pageSize && last
    ? `${new Date(last.joinedAt).getTime()}_${last._id.toString()}`
    : null;

  return {
    participants,
    nextCursor,
    participantCount: await Participant.countDocuments({ roomId: room._id }),
  };
}
