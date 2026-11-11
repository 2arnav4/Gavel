import assert from "node:assert/strict";
import test from "node:test";
import { isLocalMongoUri, readMongoHosts, RemoteTestDatabaseError, resolveTestDatabase } from "./testDatabase.js";

test("local hosts are accepted in every common spelling", () => {
  assert.equal(isLocalMongoUri("mongodb://localhost:27017"), true);
  assert.equal(isLocalMongoUri("mongodb://127.0.0.1:27017/auction"), true);
  assert.equal(isLocalMongoUri("mongodb://[::1]:27017"), true);
  assert.equal(isLocalMongoUri("mongodb://user:pass@localhost/db?authSource=admin"), true);
  assert.equal(isLocalMongoUri("mongodb://localhost:27017,127.0.0.1:27018/?replicaSet=rs0"), true);
});

test("remote, SRV and mixed host lists are rejected", () => {
  assert.equal(isLocalMongoUri("mongodb+srv://user:pass@cluster0.example.mongodb.net/db"), false);
  assert.equal(isLocalMongoUri("mongodb://db.example.com:27017"), false);
  assert.equal(isLocalMongoUri("mongodb://localhost:27017,db.example.com:27017"), false);
  assert.equal(isLocalMongoUri("mongodb://localhost.evil.com:27017"), false);
  assert.equal(isLocalMongoUri("not a uri"), false);
});

test("credentials never leak into the parsed host list", () => {
  assert.deepEqual(readMongoHosts("mongodb://admin:s3cret@127.0.0.1:27017"), ["127.0.0.1"]);
});

test("a remote URI is refused unless explicitly allowed", () => {
  const remote = { TEST_MONGODB_URI: "mongodb+srv://u:p@cluster0.example.mongodb.net" };
  assert.throws(() => resolveTestDatabase(remote), RemoteTestDatabaseError);
  assert.doesNotThrow(() => resolveTestDatabase({ ...remote, ALLOW_REMOTE_TEST_DB: "true" }));
});

test("tests use a dedicated database name, overridable", () => {
  assert.equal(resolveTestDatabase({ TEST_MONGODB_URI: "mongodb://127.0.0.1" }).dbName, "gavel_test");
  assert.equal(
    resolveTestDatabase({ TEST_MONGODB_URI: "mongodb://127.0.0.1", TEST_MONGODB_DB_NAME: "ci_db" }).dbName,
    "ci_db",
  );
});
