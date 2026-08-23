import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../middleware/errorHandler.js";
import { optionalString, requirePositiveNumber, requireString } from "./validation.js";

/**
 * These exist because `value?.trim()` passed review as a guard and was not one.
 * Every case below returned a 500 before the boundary was introduced.
 */

const WRONG_TYPES: [string, unknown][] = [
  ["number", 12345],
  ["object", {}],
  ["array", []],
  ["boolean", true],
  ["nested object", { toString: "not a function" }],
];

test("requireString rejects every non-string JSON type with a 400", () => {
  for (const [label, value] of WRONG_TYPES) {
    assert.throws(
      () => requireString(value, "Room name"),
      (error: unknown) => {
        assert.ok(error instanceof AppError, `${label} should raise an AppError`);
        assert.equal(error.statusCode, 400, `${label} should be a client error, not a 500`);
        return true;
      },
      `requireString accepted a ${label}`,
    );
  }
});

test("requireString rejects absent and blank values", () => {
  for (const value of [undefined, null, "", "   ", "\t\n"]) {
    assert.throws(() => requireString(value, "Room name"), AppError);
  }
});

test("requireString returns the trimmed value", () => {
  assert.equal(requireString("  Rare Collectibles  ", "Room name"), "Rare Collectibles");
});

test("requireString enforces a maximum length against the trimmed value", () => {
  assert.equal(requireString(`  ${"a".repeat(10)}  `, "Item name", 10).length, 10);
  assert.throws(() => requireString("a".repeat(11), "Item name", 10), AppError);
});

test("optionalString allows omission but still rejects a wrong type", () => {
  assert.equal(optionalString(undefined, "Description"), "");
  assert.equal(optionalString(null, "Description"), "");
  assert.equal(optionalString("", "Description"), "");

  for (const [label, value] of WRONG_TYPES) {
    assert.throws(
      () => optionalString(value, "Description"),
      AppError,
      `optionalString accepted a ${label}`,
    );
  }
});

test("requirePositiveNumber accepts numeric strings from form inputs", () => {
  assert.equal(requirePositiveNumber("500", "Starting bid"), 500);
  assert.equal(requirePositiveNumber(" 500 ", "Starting bid"), 500);
  assert.equal(requirePositiveNumber(500, "Starting bid"), 500);
});

test("requirePositiveNumber rejects zero, negatives, NaN and Infinity", () => {
  for (const value of [0, -1, "-50", "abc", Number.NaN, Number.POSITIVE_INFINITY, {}, [], null]) {
    assert.throws(
      () => requirePositiveNumber(value, "Starting bid"),
      AppError,
      `requirePositiveNumber accepted ${JSON.stringify(value)}`,
    );
  }
});
