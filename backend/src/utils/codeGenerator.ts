import { Room } from "../models/roomModel.js";

function generateRandomCode(length = 6): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function generateUniqueRoomCode(): Promise<string> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateRandomCode();
    const existingRoom = await Room.findOne({ code });
    if (!existingRoom) {
      return code;
    }
  }
  throw new Error("Failed to generate a unique room code after multiple attempts.");
}
