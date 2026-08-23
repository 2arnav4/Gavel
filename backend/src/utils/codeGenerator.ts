import { Room } from "../models/roomModel.js";

/**
 * Generates a random 6-character uppercase alphanumeric room code.
 */
function generateRandomCode(length = 6): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generates a unique 6-character room code by verifying uniqueness in the database.
 */
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
