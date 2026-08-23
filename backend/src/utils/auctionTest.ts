import assert from "node:assert/strict";
import test from "node:test";
import { getAuctionEndsAt, getExpiryResolution, isValidPositiveAmount } from "./auction.js";

test("only finite positive amounts are valid bids", () => {
  assert.equal(isValidPositiveAmount(1), true);
  assert.equal(isValidPositiveAmount(0), false);
  assert.equal(isValidPositiveAmount(Number.NaN), false);
  assert.equal(isValidPositiveAmount("100"), false);
});

test("auction expiry time is derived from server time", () => {
  assert.equal(getAuctionEndsAt(1_000, 30).toISOString(), new Date(31_000).toISOString());
});

test("expiry sells only items with an accepted highest bidder", () => {
  assert.equal(getExpiryResolution(true), "sold");
  assert.equal(getExpiryResolution(false), "unsold");
});
