import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../middleware/errorHandler.js";
import { readEventField, readHandshakeAuth, toSocketMessage } from "./validation.js";

const VALID_TOKEN = "8a2f6b1c-0d4e-4a19-9c3b-7e5f21d08a6b";

test("accepts a well formed handshake and normalises the room code", () => {
  assert.deepEqual(
    readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: "xyz9ab" }),
    { sessionToken: VALID_TOKEN, roomCode: "XYZ9AB" },
  );
});

test("trims surrounding whitespace on both fields", () => {
  assert.deepEqual(
    readHandshakeAuth({ sessionToken: `  ${VALID_TOKEN}  `, roomCode: "  xyz9ab  " }),
    { sessionToken: VALID_TOKEN, roomCode: "XYZ9AB" },
  );
});

test("rejects operator objects that would otherwise reach the Mongo query", () => {
  const payloads: unknown[] = [
    { sessionToken: { $ne: null }, roomCode: "XYZ9AB" },
    { sessionToken: { $gt: "" }, roomCode: "XYZ9AB" },
    { sessionToken: { $regex: ".*" }, roomCode: "XYZ9AB" },
    { sessionToken: { $exists: true }, roomCode: "XYZ9AB" },
  ];

  for (const payload of payloads) {
    assert.throws(() => readHandshakeAuth(payload), AppError);
  }
});

test("rejects a non-string room code instead of throwing a TypeError", () => {
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: 123 }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: {} }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: [] }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: true }), AppError);
});

test("rejects missing, empty and null fields", () => {
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN }), AppError);
  assert.throws(() => readHandshakeAuth({ roomCode: "XYZ9AB" }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: "" }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: "   " }), AppError);
  assert.throws(() => readHandshakeAuth({ sessionToken: null, roomCode: "XYZ9AB" }), AppError);
});

test("rejects a handshake that is not an object at all", () => {
  assert.throws(() => readHandshakeAuth(undefined), AppError);
  assert.throws(() => readHandshakeAuth(null), AppError);
  assert.throws(() => readHandshakeAuth("XYZ9AB"), AppError);
  assert.throws(() => readHandshakeAuth([VALID_TOKEN, "XYZ9AB"]), AppError);
});

test("rejects oversized values before they reach the database", () => {
  assert.throws(
    () => readHandshakeAuth({ sessionToken: "a".repeat(9999), roomCode: "XYZ9AB" }),
    AppError,
  );
  assert.throws(
    () => readHandshakeAuth({ sessionToken: VALID_TOKEN, roomCode: "TOOLONGCODE" }),
    AppError,
  );
});

test("toSocketMessage surfaces validation messages to the client", () => {
  assert.equal(toSocketMessage(new AppError("Room code is required.", 400)), "Room code is required.");
});

test("toSocketMessage hides internal failures behind a generic message", () => {
  assert.equal(toSocketMessage(new Error("connect ECONNREFUSED 10.0.0.1:27017")), "Internal server error");
  assert.equal(toSocketMessage(new TypeError("x.toUpperCase is not a function")), "Internal server error");
  assert.equal(toSocketMessage("a bare string"), "Internal server error");
  assert.equal(toSocketMessage(undefined), "Internal server error");
});

test("readEventField returns the value when the payload is a real object", () => {
  assert.equal(readEventField({ amount: 500 }, "amount"), 500);
  assert.equal(readEventField({ amount: "500" }, "amount"), "500");
});

test("readEventField returns undefined instead of throwing on a non-object payload", () => {
  assert.equal(readEventField(undefined, "amount"), undefined);
  assert.equal(readEventField(null, "amount"), undefined);
  assert.equal(readEventField(500, "amount"), undefined);
  assert.equal(readEventField("500", "amount"), undefined);
  assert.equal(readEventField([], "amount"), undefined);
  assert.equal(readEventField({}, "amount"), undefined);
});
