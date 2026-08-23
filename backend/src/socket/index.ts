import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { corsOptions } from "../config/cors.js";
import { socketAuthMiddleware } from "./middleware/auth.js";
import { registerRoomHandlers } from "./handlers/roomHandler.js";
import { registerAuctionHandlers } from "./handlers/auctionHandler.js";
import { registerBiddingHandlers } from "./handlers/biddingHandler.js";
import { registerResolutionHandlers } from "./handlers/resolutionHandler.js";

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: corsOptions,
  });

  // Apply authentication middleware to incoming connections
  io.use(socketAuthMiddleware);

  // Listen for socket connections and register event handlers
  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket);
    registerAuctionHandlers(io, socket);
    registerBiddingHandlers(io, socket);
    registerResolutionHandlers(io, socket);
  });

  // Timer restoration is driven from the entry point once MongoDB is connected.
  return io;
}
