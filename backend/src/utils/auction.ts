export type ExpiryResolution = "sold" | "unsold";

export function isValidPositiveAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

export function isWholeAmount(amount: number): boolean {
  return Number.isSafeInteger(amount);
}

export function getAuctionEndsAt(now: number, durationSeconds: number): Date {
  return new Date(now + durationSeconds * 1000);
}

export function getExpiryResolution(hasHighestBidder: boolean): ExpiryResolution {
  return hasHighestBidder ? "sold" : "unsold";
}

export function getMinimumBid(
  startingBid: number,
  currentBid: number,
  minBidIncrement: number,
): number {
  return currentBid > 0 ? currentBid + minBidIncrement : startingBid;
}
