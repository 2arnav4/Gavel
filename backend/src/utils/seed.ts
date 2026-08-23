import crypto from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Room } from "../models/roomModel.js";
import { Participant } from "../models/participantModel.js";
import { AuctionItem } from "../models/itemModel.js";
import { generateUniqueRoomCode } from "../utils/codeGenerator.js";

/**
 * Creates a demo room with a prepared catalog so a walkthrough does not begin
 * with several minutes of typing item names.
 *
 * Writes straight to MongoDB rather than going through the API, because the
 * host's room session token is issued at creation and is the one thing the
 * script needs to hand back — the REST client would keep it in a cookie jar
 * that the browser cannot read.
 *
 * Run with: npm run seed
 */

const CATALOG = [
  {
    name: "1983 World Cup Signed Bat",
    description: "Match-used willow signed by the winning squad. Certificate of authenticity included.",
    startingBid: 25_000,
  },
  {
    name: "First Edition Wisden Almanack",
    description: "1900 edition, original boards, spine intact. A collector's reference copy.",
    startingBid: 12_000,
  },
  {
    name: "Vintage Rolex Explorer 1016",
    description: "1967 reference, matte dial, recently serviced with original bracelet.",
    startingBid: 40_000,
  },
  {
    name: "Studio Pottery Vase, Leach Pottery",
    description: "Stoneware with tenmoku glaze, impressed seal, circa 1955.",
    startingBid: 8_000,
  },
];

async function seed(): Promise<void> {
  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 15_000,
    dbName: env.mongodbDbName,
  });

  const code = await generateUniqueRoomCode();
  // Deliberately below the ₹85,000 catalog total. A purse that covers
  // everything removes the only interesting decision in the auction; at this
  // level a bidder can take the Rolex and one other lot, or spread across
  // three, but not have all four.
  const startingBudget = 60_000;
  // Large enough that raises move the price visibly rather than crawling.
  const minBidIncrement = 2_500;
  const room = new Room({
    code,
    name: "Rare Collectibles — Demo Auction",
    status: "lobby",
    startingBudget,
    minBidIncrement,
  });
  await room.save();

  const sessionToken = crypto.randomUUID();
  const hostName = `host_${crypto.randomBytes(2).toString("hex")}`;
  const host = new Participant({
    roomId: room._id,
    username: hostName,
    usernameNormalized: hostName.toLowerCase(),
    role: "admin",
    sessionToken,
    budget: startingBudget,
    spent: 0,
  });
  await host.save();

  room.adminParticipantId = host._id;
  await room.save();

  await AuctionItem.insertMany(
    CATALOG.map((item) => ({
      roomId: room._id,
      name: item.name,
      description: item.description,
      startingBid: item.startingBid,
      currentBid: 0,
      status: "pending",
    })),
  );

  const session = {
    state: {
      roomCode: room.code,
      sessionToken,
      username: hostName,
      participantId: host._id.toString(),
      role: "admin",
      authUser: { username: hostName, role: "participant" },
    },
    version: 0,
  };

  console.log(`\n  Seeded room ${room.code} with ${CATALOG.length} items, hosted by ${hostName}.\n`);
  console.log("  To open it as the host, paste this into the browser console on the app, then reload:\n");
  console.log(`localStorage.setItem('auction-session', ${JSON.stringify(JSON.stringify(session))})`);
  console.log(`\n  Then go to /lobby/${room.code}.`);
  console.log(`  Bidders just sign in and join with the code ${room.code}.\n`);

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error("Seeding failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
