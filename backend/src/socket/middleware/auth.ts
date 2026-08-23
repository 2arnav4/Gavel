import type { Socket } from "socket.io";
import { isDatabaseConnected } from "../../config/db.js";
import { Participant } from "../../models/participantModel.js";
import { Room } from "../../models/roomModel.js";

export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    if (!isDatabaseConnected()) {
      return next(
        new Error("The server cannot reach its database right now. Please retry in a moment."),
      );
    }

    const sessionToken = socket.handshake.auth.sessionToken;
    const roomCode = socket.handshake.auth.roomCode;

    if (!sessionToken || !roomCode) {
      return next(new Error("Authentication failed: Missing credentials."));
    }

    const participant = await Participant.findOne({ sessionToken });
    if (!participant) {
      return next(new Error("Authentication failed: Invalid session token."));
    }

    const room = await Room.findById(participant.roomId);
    if (!room || room.code !== roomCode.toUpperCase()) {
      return next(new Error("Authentication failed: Room mismatch."));
    }

    socket.data.participant = participant;
    socket.data.room = room;

    next();
  } catch (error) {
    console.error("Socket authentication middleware error:", error);
    next(new Error("Authentication failed: Internal server error."));
  }
}
