import dotenv from "dotenv";

dotenv.config();

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;

  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

// CLIENT_URL may name more than one origin, comma-separated, so a single
// backend can serve several deployed frontends. Trailing slashes are stripped
// here rather than at every comparison site.
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
  // Set explicitly rather than inferred from the URI path. A connection string
  // without a database segment makes Mongoose silently fall back to "test",
  // which is how production data ends up somewhere nobody intended. Naming it
  // here means the database is a property of the application, not of whatever
  // string happens to be pasted into a hosting dashboard.
  mongodbDbName: getEnv("MONGODB_DB_NAME", "auction"),
  auctionItemDurationSeconds: getPositiveInteger("AUCTION_ITEM_DURATION_SECONDS", "60"),
  // Every bidder in a room starts with the same purse, so the auction is a
  // contest of allocation rather than of who is willing to type the largest
  // number. Overridable per room at creation.
  defaultStartingBudget: getPositiveInteger("DEFAULT_STARTING_BUDGET", "100000"),
  // The smallest legal raise. Without one, a bidder can outbid by a rupee, which
  // makes the countdown extension meaningless: an item can be held open forever
  // by increments that never meaningfully change the price.
  defaultMinBidIncrement: getPositiveInteger("DEFAULT_MIN_BID_INCREMENT", "500"),
  jwtSecret:
    process.env.JWT_SECRET ??
    (nodeEnv === "production"
      ? (() => {
          throw new Error("Missing required environment variable: JWT_SECRET");
        })()
      : "development-only-jwt-secret-change-me"),
  isDevelopment: nodeEnv === "development",
};
