import dotenv from "dotenv";

dotenv.config();

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;

  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getOriginList(key: string, fallback: string): string[] {
  const origins = getEnv(key, fallback)
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error(`${key} must name at least one origin.`);
  }

  return origins;
}

function getPositiveInteger(key: string, fallback: string): number {
  const value = Number(getEnv(key, fallback));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

const nodeEnv = getEnv("NODE_ENV", "development");

export const env = {
  port: getPositiveInteger("PORT", "3001"),
  nodeEnv,
  clientUrls: getOriginList("CLIENT_URL", "http://localhost:5173"),
  mongodbUri: getEnv("MONGODB_URI", "mongodb://localhost:27017/auction-room"),
  mongodbDbName: getEnv("MONGODB_DB_NAME", "auction"),
  auctionItemDurationSeconds: getPositiveInteger(
    "AUCTION_ITEM_DURATION_SECONDS",
    "60",
  ),
  defaultStartingBudget: getPositiveInteger(
    "DEFAULT_STARTING_BUDGET",
    "100000",
  ),
  defaultMinBidIncrement: getPositiveInteger(
    "DEFAULT_MIN_BID_INCREMENT",
    "500",
  ),
  presenceGraceMs: getPositiveInteger("PRESENCE_GRACE_MS", "10000"),
  allowPreviewOrigins: getEnv("ALLOW_PREVIEW_ORIGINS", "false") === "true",
  jwtSecret:
    process.env.JWT_SECRET ??
    (nodeEnv === "production"
      ? (() => {
          throw new Error("Missing required environment variable: JWT_SECRET");
        })()
      : "development-only-jwt-secret-change-me"),
  isDevelopment: nodeEnv === "development",
};
