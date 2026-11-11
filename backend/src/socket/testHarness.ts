import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import type { Server as IoServer } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer, type SocketServerOptions } from "./index.js";

export type Harness = {
  url: string;
  io: IoServer;
  close: () => Promise<void>;
};

export async function startHarness(options: SocketServerOptions = {}): Promise<Harness> {
  const httpServer: HttpServer = createServer();
  const io = createSocketServer(httpServer, options);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    io,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export function connect(url: string, auth: unknown): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      auth: auth as Record<string, unknown>,
      transports: ["websocket"],
      reconnection: false,
      timeout: 5_000,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

export async function expectRejectedHandshake(url: string, auth: unknown): Promise<string> {
  try {
    const socket = await connect(url, auth);
    socket.close();
    throw new Error("HANDSHAKE_UNEXPECTEDLY_ACCEPTED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "HANDSHAKE_UNEXPECTEDLY_ACCEPTED") throw error;
    return message;
  }
}

export function nextEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);

    function onEvent(payload: T): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}
