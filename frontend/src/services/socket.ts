import { io, Socket } from "socket.io-client";

const rawApiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
const sanitizedBaseUrl = rawApiUrl.replace(/\/$/, "");
const SOCKET_URL = sanitizedBaseUrl.endsWith("/api") ? sanitizedBaseUrl.slice(0, -4) : sanitizedBaseUrl;

let socket: Socket | null = null;
let activeConnection: { roomCode: string; sessionToken: string } | null = null;

export function connectSocket(roomCode: string, sessionToken: string): Socket {
  const requestedConnection = { roomCode: roomCode.toUpperCase(), sessionToken };

  if (socket) {
    if (
      activeConnection?.roomCode === requestedConnection.roomCode &&
      activeConnection.sessionToken === requestedConnection.sessionToken
    ) {
      if (!socket.connected) socket.connect();
      return socket;
    }

    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_URL, {
    auth: {
      roomCode: requestedConnection.roomCode,
      sessionToken,
    },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
  });
  activeConnection = requestedConnection;

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    activeConnection = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

export function isFatalSocketError(message: string): boolean {
  return message.startsWith("Authentication failed");
}
