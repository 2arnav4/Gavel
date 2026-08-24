import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresenceTracker } from "./presence.js";

test("the first socket for a participant reports first-socket", () => {
  const presence = createPresenceTracker();
  assert.equal(presence.attach("p1", "s1"), "first-socket");
  assert.equal(presence.socketCount("p1"), 1);
});

test("a second tab does not report the participant as newly online", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  assert.equal(presence.attach("p1", "s2"), "additional-socket");
  assert.equal(presence.socketCount("p1"), 2);
});

test("closing one of two tabs leaves the participant online", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  presence.attach("p1", "s2");
  assert.equal(presence.detach("p1", "s1"), "remaining-sockets");
  assert.equal(presence.socketCount("p1"), 1);
});

test("closing the last tab reports last-socket and frees the entry", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  assert.equal(presence.detach("p1", "s1"), "last-socket");
  assert.equal(presence.socketCount("p1"), 0);
  assert.equal(presence.trackedParticipants(), 0);
});

test("detaching an unknown socket is treated as the last one, not a crash", () => {
  const presence = createPresenceTracker();
  assert.equal(presence.detach("ghost", "s1"), "last-socket");
  assert.equal(presence.trackedParticipants(), 0);
});

test("attaching the same socket id twice does not double count", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  assert.equal(presence.attach("p1", "s1"), "additional-socket");
  assert.equal(presence.socketCount("p1"), 1);
});

test("participants are tracked independently", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  assert.equal(presence.attach("p2", "s2"), "first-socket");
  assert.equal(presence.detach("p1", "s1"), "last-socket");
  assert.equal(presence.socketCount("p2"), 1);
  assert.equal(presence.trackedParticipants(), 1);
});

test("a reconnect after the last socket left reports first-socket again", () => {
  const presence = createPresenceTracker();
  presence.attach("p1", "s1");
  presence.detach("p1", "s1");
  assert.equal(presence.attach("p1", "s2"), "first-socket");
});
