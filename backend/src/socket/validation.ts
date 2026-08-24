import { AppError } from "../middleware/errorHandler.js";
import { requireString } from "../utils/validation.js";

const SESSION_TOKEN_MAX_LENGTH = 64;
const ROOM_CODE_LENGTH = 6;

const GENERIC_SOCKET_ERROR = "Internal server error";

export type HandshakeCredentials = {
  sessionToken: string;
  roomCode: string;
};

export function readHandshakeAuth(auth: unknown): HandshakeCredentials {
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    throw new AppError("Missing credentials.", 400);
  }

  const candidate = auth as Record<string, unknown>;

  return {
    sessionToken: requireString(
      candidate.sessionToken,
      "Session token",
      SESSION_TOKEN_MAX_LENGTH,
    ),
    roomCode: requireString(
      candidate.roomCode,
      "Room code",
      ROOM_CODE_LENGTH,
    ).toUpperCase(),
  };
}

export function toSocketMessage(error: unknown): string {
  return error instanceof AppError ? error.message : GENERIC_SOCKET_ERROR;
}

export function readEventField(payload: unknown, field: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[field];
}
