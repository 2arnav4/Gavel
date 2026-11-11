export const SOCKET_ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "ROOM_NOT_FOUND",
  "PARTICIPANT_NOT_FOUND",
  "NO_ACTIVE_ITEM",
  "ITEM_CLOSED",
  "STALE_ITEM",
  "AUCTION_PAUSED",
  "AUCTION_ENDED",
  "AUCTION_ALREADY_STARTED",
  "AUCTION_NOT_PAUSED",
  "NO_ITEMS",
  "BID_TOO_LOW",
  "INSUFFICIENT_BUDGET",
  "NOTHING_TO_RESOLVE",
  "INTERNAL_ERROR",
] as const;

export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[number];

export type SocketError = {
  code: SocketErrorCode;
  message: string;
};

export type BidRejection = {
  code: SocketErrorCode;
  reason: string;
  minimumBid?: number;
  retryAfterMs?: number;
};

export function isSocketErrorCode(value: unknown): value is SocketErrorCode {
  return typeof value === "string" && (SOCKET_ERROR_CODES as readonly string[]).includes(value);
}
