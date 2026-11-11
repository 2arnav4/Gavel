import type { Server as HttpServer } from "http";
import { Server, type ServerOptions } from "socket.io";
import { corsOptions } from "../config/cors.js";
import { socketAuthMiddleware } from "./middleware/auth.js";
import { registerRoomHandlers } from "./handlers/roomHandler.js";
import { registerAuctionHandlers } from "./handlers/auctionHandler.js";
import { registerBiddingHandlers } from "./handlers/biddingHandler.js";
import { registerResolutionHandlers } from "./handlers/resolutionHandler.js";

export type SocketServerOptions = {
  adapter?: ServerOptions["adapter"];
};

export function createSocketServer(httpServer: HttpServer, options: SocketServerOptions = {}) {
  const io = new Server(httpServer, {
    cors: corsOptions,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket);
    registerAuctionHandlers(io, socket);
    registerBiddingHandlers(io, socket);
    registerResolutionHandlers(io, socket);
  });

  return io;
}
