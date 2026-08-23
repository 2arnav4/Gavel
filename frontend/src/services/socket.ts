import { io, Socket } from "socket.io-client";

const rawApiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
const sanitizedBaseUrl = rawApiUrl.replace(/\/$/, "");
const SOCKET_URL = sanitizedBaseUrl.endsWith("/api") ? sanitizedBaseUrl.slice(0, -4) : sanitizedBaseUrl;

let socket: Socket | null = null;
let activeConnection: { roomCode: string; sessionToken: string } | null = null;

/**
 * Connects the socket to the backend server with handshake authentication parameters.
 */
export function connectSocket(roomCode: string, sessionToken: string): Socket {
  const requestedConnection = { roomCode: roomCode.toUpperCase(), sessionToken };

  // Never reuse an authenticated socket for a different room or participant.
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
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });
  activeConnection = requestedConnection;

  return socket;
}

/**
 * Disconnects the socket connection and cleans up the instance.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    activeConnection = null;
  }
}

/**
 * Returns the active socket instance.
 */
export function getSocket(): Socket | null {
  return socket;
}
