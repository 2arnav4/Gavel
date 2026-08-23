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

httpServer.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});

void connectDB().then(async () => {
  try {
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
