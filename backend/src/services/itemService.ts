import { Room } from "../models/roomModel.js";
import { Participant } from "../models/participantModel.js";
import { AuctionItem } from "../models/itemModel.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  optionalString,
  requirePositiveNumber,
  requireString,
} from "../utils/validation.js";

const ITEM_NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 300;

export async function createAuctionItem(
  roomCode: string,
  sessionToken: string,
  name: string,
  description: string,
  startingBid: number
) {
  if (typeof sessionToken !== "string" || !sessionToken.trim()) {
    throw new AppError("Authentication token is required.", 401);
  }

  const normalizedCode = requireString(roomCode, "Room code").toUpperCase();
  const itemName = requireString(name, "Item name", ITEM_NAME_MAX_LENGTH);
  const itemDescription = optionalString(description, "Description", DESCRIPTION_MAX_LENGTH);
  const price = requirePositiveNumber(startingBid, "Starting bid");

  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found.", 404);
  }

  if (room.status !== "lobby") {
    throw new AppError("Cannot add items after the auction has started.", 400);
  }

  const participant = await Participant.findOne({
    roomId: room._id,
    sessionToken,
  });
  if (!participant) {
    throw new AppError("Authentication failed: Participant not registered in this room.", 401);
  }
  if (participant.role !== "admin") {
    throw new AppError("Access denied: Only the room administrator can add auction items.", 403);
  }

  const newItem = new AuctionItem({
    roomId: room._id,
    name: itemName,
    description: itemDescription,
    startingBid: price,
    currentBid: 0,
    status: "pending",
  });
  await newItem.save();

  return newItem;
}

export async function getAuctionItems(roomCode: string) {
  const normalizedCode = requireString(roomCode, "Room code").toUpperCase();
  const room = await Room.findOne({ code: normalizedCode });
  if (!room) {
    throw new AppError("Room not found.", 404);
  }

  const items = await AuctionItem.find({ roomId: room._id }).sort({ createdAt: 1 });
  return items;
}
