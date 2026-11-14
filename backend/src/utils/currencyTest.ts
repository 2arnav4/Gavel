import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../middleware/errorHandler.js";
import { DEFAULT_CURRENCY, formatMoney, isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { requireWholeAmount } from "./validation.js";
import { isWholeAmount } from "./auction.js";

function rejects(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.statusCode === 400 && pattern.test(error.message));
}

test("an absent currency defaults to INR", () => {
  for (const absent of [undefined, null, ""]) {
    assert.equal(normalizeCurrency(absent), DEFAULT_CURRENCY);
  }
  assert.equal(DEFAULT_CURRENCY, "INR");
});

test("currency codes are trimmed and upper-cased", () => {
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("  jpy "), "JPY");
  assert.equal(normalizeCurrency("Eur"), "EUR");
});

test("unknown currency codes are a 400", () => {
  for (const bad of ["ZZZ", "US", "USDD", "rupees", "₹", "1NR"]) {
    rejects(() => normalizeCurrency(bad), /not a supported currency/);
  }
});

test("non-string currencies are a 400, not a cast error", () => {
  for (const bad of [42, true, ["USD"], { $ne: null }, { code: "USD" }]) {
    rejects(() => normalizeCurrency(bad), /three-letter currency code/);
  }
});

test("the supported list comes from the runtime and includes common codes", () => {
  for (const code of ["INR", "USD", "EUR", "GBP", "AED", "JPY", "AUD", "CAD", "SGD", "KWD"]) {
    assert.equal(isSupportedCurrency(code), true, code);
  }
  assert.equal(isSupportedCurrency("usd"), false, "the lookup is case-sensitive; normalize first");
});

test("money formats in the room's currency with no decimals", () => {
  assert.equal(formatMoney(150000, "INR"), "₹1,50,000");
  assert.equal(formatMoney(150000, "USD"), "$150,000");
  assert.equal(formatMoney(2000, "JPY"), "¥2,000");
  assert.equal(formatMoney(2000, "KWD").includes("."), false, "three-decimal currencies show whole units");
});

test("an unknown or missing currency formats as rupees rather than throwing", () => {
  assert.equal(formatMoney(500, undefined), "₹500");
  assert.equal(formatMoney(500, "NOPE"), "₹500");
});

test("money inputs must be whole numbers", () => {
  assert.equal(requireWholeAmount(500, "Starting bid"), 500);
  assert.equal(requireWholeAmount("750", "Starting bid"), 750);
  for (const fraction of [0.5, 500.25, "10.5", 1e-3]) {
    rejects(() => requireWholeAmount(fraction, "Starting bid"), /whole number/);
  }
  rejects(() => requireWholeAmount(2 ** 60, "Starting bid"), /whole number/);
  rejects(() => requireWholeAmount(-5, "Starting bid"), /positive number/);
  rejects(() => requireWholeAmount("abc", "Starting bid"), /positive number/);
});

test("bid amounts are whole only when they are safe integers", () => {
  assert.equal(isWholeAmount(1000), true);
  assert.equal(isWholeAmount(1000.37), false);
  assert.equal(isWholeAmount(2 ** 60), false);
});
