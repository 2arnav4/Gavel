import mongoose from "mongoose";
import { env } from "../config/env.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_TEST_DB_NAME = "gavel_test";

export class RemoteTestDatabaseError extends Error {
  constructor() {
    super(
      "Refusing to run database tests against a non-local MongoDB. Point MONGODB_URI (or TEST_MONGODB_URI) at localhost, or set ALLOW_REMOTE_TEST_DB=true to override.",
    );
    this.name = "RemoteTestDatabaseError";
  }
}

export function readMongoHosts(uri: string): string[] {
  const match = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)/.exec(uri.trim());
  if (!match) return [];
  if (match[1]) return [`srv:${match[2]}`];

  return match[2]
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
    .map((host) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]));
}

export function isLocalMongoUri(uri: string): boolean {
  const hosts = readMongoHosts(uri);
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.has(host));
}

export function resolveTestDatabase(source: NodeJS.ProcessEnv = process.env): { uri: string; dbName: string } {
  const uri = source.TEST_MONGODB_URI ?? env.mongodbUri;
  if (!isLocalMongoUri(uri) && source.ALLOW_REMOTE_TEST_DB !== "true") {
    throw new RemoteTestDatabaseError();
  }
  return { uri, dbName: source.TEST_MONGODB_DB_NAME ?? DEFAULT_TEST_DB_NAME };
}

export async function connectTestDatabase(): Promise<boolean> {
  const { uri, dbName } = resolveTestDatabase();
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, dbName });
    return true;
  } catch {
    return false;
  }
}
