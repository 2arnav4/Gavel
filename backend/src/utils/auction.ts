export type ExpiryResolution = "sold" | "unsold";

export function isValidPositiveAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

export function getAuctionEndsAt(now: number, durationSeconds: number): Date {
  return new Date(now + durationSeconds * 1000);
}

export function getExpiryResolution(hasHighestBidder: boolean): ExpiryResolution {
  return hasHighestBidder ? "sold" : "unsold";
}

/**
 * The smallest amount that can currently be bid on an item.
 *
 * The opening bid is the asking price exactly — an increment on top of it would
 * mean the advertised price was never actually available. Every raise after that
 * must clear the room's increment, so bidding converges instead of crawling up a
 * rupee at a time while the countdown keeps resetting.
 *
 * Shared by the server's validation and the client's display so the two can
 * never disagree about what is legal.
 */
export function getMinimumBid(
  startingBid: number,
  currentBid: number,
  minBidIncrement: number,
): number {
  return currentBid > 0 ? currentBid + minBidIncrement : startingBid;
}
