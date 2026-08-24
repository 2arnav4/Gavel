import { test } from "node:test";
import assert from "node:assert/strict";
import { SOCKET_ERROR_CODES, isSocketErrorCode } from "./errors.js";

test("every error code is unique", () => {
  assert.equal(new Set(SOCKET_ERROR_CODES).size, SOCKET_ERROR_CODES.length);
});

test("every error code is SCREAMING_SNAKE_CASE", () => {
  for (const code of SOCKET_ERROR_CODES) {
    assert.match(code, /^[A-Z][A-Z_]*[A-Z]$/, `${code} is not SCREAMING_SNAKE_CASE`);
  }
});

test("isSocketErrorCode accepts known codes and rejects everything else", () => {
  assert.equal(isSocketErrorCode("BID_TOO_LOW"), true);
  assert.equal(isSocketErrorCode("RATE_LIMITED"), true);
  assert.equal(isSocketErrorCode("bid_too_low"), false);
  assert.equal(isSocketErrorCode("MADE_UP_CODE"), false);
  assert.equal(isSocketErrorCode(undefined), false);
  assert.equal(isSocketErrorCode(42), false);
});
