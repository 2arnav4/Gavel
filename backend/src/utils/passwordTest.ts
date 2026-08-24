import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PBKDF2_ITERATIONS,
  createPasswordRecord,
  hashPassword,
  needsRehash,
  storedIterations,
  validatePassword,
  verifyPassword,
} from "./password.js";

const PASSWORD = "Str0ng!Passw0rd";

test("a fresh record is written at the current iteration count", () => {
  const record = createPasswordRecord(PASSWORD);
  assert.equal(record.hashIterations, PBKDF2_ITERATIONS);
  assert.equal(record.salt.length, 32);
  assert.ok(record.passwordHash.length > 0);
});

test("a fresh record verifies and rejects the wrong password", () => {
  const record = createPasswordRecord(PASSWORD);
  assert.equal(verifyPassword(PASSWORD, record), true);
  assert.equal(verifyPassword("wrong-password", record), false);
});

test("two records for the same password differ, because the salt differs", () => {
  const a = createPasswordRecord(PASSWORD);
  const b = createPasswordRecord(PASSWORD);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.passwordHash, b.passwordHash);
});

test("a fresh record never needs a rehash", () => {
  assert.equal(needsRehash(createPasswordRecord(PASSWORD)), false);
});

test("a legacy record with no iteration count is treated as 1000 and flagged for rehash", () => {
  const salt = "a".repeat(32);
  const legacy = { salt, passwordHash: hashPassword(PASSWORD, salt, 1_000) };

  assert.equal(storedIterations(legacy), 1_000);
  assert.equal(verifyPassword(PASSWORD, legacy), true);
  assert.equal(needsRehash(legacy), true);
});

test("a record below the current iteration count is flagged for rehash", () => {
  const salt = "b".repeat(32);
  const weak = { salt, passwordHash: hashPassword(PASSWORD, salt, 50_000), hashIterations: 50_000 };

  assert.equal(verifyPassword(PASSWORD, weak), true);
  assert.equal(needsRehash(weak), true);
});

test("a rubbish iteration count falls back to legacy rather than throwing", () => {
  const salt = "c".repeat(32);
  const hash = hashPassword(PASSWORD, salt, 1_000);

  for (const bad of [0, -5, 1.5, NaN, undefined]) {
    const record = { salt, passwordHash: hash, hashIterations: bad as number };
    assert.equal(storedIterations(record), 1_000);
    assert.equal(verifyPassword(PASSWORD, record), true);
    assert.equal(needsRehash(record), true);
  }
});

test("hashing refuses a non-positive iteration count outright", () => {
  assert.throws(() => hashPassword(PASSWORD, "d".repeat(32), 0));
  assert.throws(() => hashPassword(PASSWORD, "d".repeat(32), -1));
});

test("a hash at one iteration count does not verify at another", () => {
  const salt = "e".repeat(32);
  const weak = { salt, passwordHash: hashPassword(PASSWORD, salt, 1_000), hashIterations: 1_000 };
  const strong = { ...weak, hashIterations: PBKDF2_ITERATIONS };

  assert.equal(verifyPassword(PASSWORD, weak), true);
  assert.equal(verifyPassword(PASSWORD, strong), false);
});

test("the password policy enforces all five rules", () => {
  assert.equal(validatePassword(PASSWORD), null);
  assert.match(validatePassword("Sh0rt!") ?? "", /at least 8/);
  assert.match(validatePassword("nouppercase1!") ?? "", /uppercase/);
  assert.match(validatePassword("NOLOWERCASE1!") ?? "", /lowercase/);
  assert.match(validatePassword("NoDigitsHere!") ?? "", /digit/);
  assert.match(validatePassword("NoSpecial123") ?? "", /special character/);
});
