import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, serializeContext } from "./logger.js";

const FIXED_TIME = new Date("2026-08-24T06:09:00.000Z");

function collect(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = [];
  const log = createLogger({
    json: true,
    now: () => FIXED_TIME,
    sink: (line) => lines.push(line),
    ...options,
  });
  return { log, lines };
}

test("emits one json line per entry with timestamp, level and message", () => {
  const { log, lines } = collect({ level: "debug" });

  log.info("Server listening", { port: 3001 });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    timestamp: "2026-08-24T06:09:00.000Z",
    level: "info",
    message: "Server listening",
    port: 3001,
  });
});

test("drops entries below the configured level", () => {
  const { log, lines } = collect({ level: "warn" });

  log.debug("noise");
  log.info("noise");
  log.warn("kept");
  log.error("kept");

  assert.deepEqual(lines.map((line) => JSON.parse(line).level), ["warn", "error"]);
});

test("serialises an Error in context instead of logging an empty object", () => {
  const { log, lines } = collect({ level: "debug" });

  log.error("Shutdown failed", { error: new TypeError("boom") });

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.error.name, "TypeError");
  assert.equal(entry.error.message, "boom");
  assert.equal(typeof entry.error.stack, "string");
});

test("serializeContext leaves plain values untouched", () => {
  assert.deepEqual(
    serializeContext({ roomCode: "XYZ9AB", amount: 500, paused: false, missing: null }),
    { roomCode: "XYZ9AB", amount: 500, paused: false, missing: null },
  );
});

test("human format stays on one line and appends context as json", () => {
  const lines: string[] = [];
  const log = createLogger({
    level: "debug",
    json: false,
    now: () => FIXED_TIME,
    sink: (line) => lines.push(line),
  });

  log.warn("MongoDB disconnected", { attempt: 2 });

  assert.equal(lines[0], '2026-08-24T06:09:00.000Z WARN  MongoDB disconnected {"attempt":2}');
  assert.ok(!lines[0].includes("\n"));
});

test("omits the context suffix entirely when there is no context", () => {
  const lines: string[] = [];
  const log = createLogger({
    level: "debug",
    json: false,
    now: () => FIXED_TIME,
    sink: (line) => lines.push(line),
  });

  log.info("Shutting down");

  assert.equal(lines[0], "2026-08-24T06:09:00.000Z INFO  Shutting down");
});
