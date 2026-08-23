import { createServer } from "http";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { createSocketServer } from "./socket/index.js";
import { restoreAuctionTimers } from "./socket/handlers/resolutionHandler.js";
import { Participant } from "./models/participantModel.js";

const app = createApp();
const httpServer = createServer(app);

const io = createSocketServer(httpServer);
app.set("io", io);

// Bind the port before touching MongoDB. The database is a runtime dependency,
// not a startup precondition: if it is unreachable the process must stay up and
// serve 503s rather than exit, which would fail the deploy outright.
httpServer.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});

// Timers for in-flight auctions live in memory, so they can only be rebuilt once
// the database is actually readable.
void connectDB().then(async () => {
  try {
    // Presence is tracked by an in-memory socket map but persisted on the
    // participant. A restart loses the map, so any flag left set here describes a
    // connection that no longer exists and would show that bidder as permanently
    // online. Every live socket re-registers itself on the next room:connect.
    const { modifiedCount } = await Participant.updateMany(
      { isConnected: true },
      { $set: { isConnected: false } },
    );
    if (modifiedCount > 0) {
      console.log(`Cleared ${modifiedCount} stale presence flag(s) from the previous run.`);
    }
  } catch (error) {
    console.error("Unable to clear stale presence flags:", error);
  }

  try {
    await restoreAuctionTimers(io);
  } catch (error) {
    console.error("Unable to restore auction timers:", error);
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Shutting down.`);

  io.close();
  httpServer.close();
  await mongoose.disconnect().catch(() => undefined);

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
