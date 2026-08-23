import { useSessionStore } from "../stores/useSessionStore";

const rawApiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
const sanitizedBaseUrl = rawApiUrl.replace(/\/$/, "");
const API_URL = sanitizedBaseUrl.endsWith("/api") ? sanitizedBaseUrl : `${sanitizedBaseUrl}/api`;

// A free-tier host spins the server down when idle, and the next request pays
// the cold start. Allow for that before declaring the backend unreachable.
const COLD_START_TIMEOUT_MS = 60_000;

/**
 * The backend could not be reached at all, or reached but is not healthy.
 *
 * Distinct from a normal failed response: "nobody is logged in" is an expected
 * outcome, whereas this means the app cannot function and should say so.
 */
export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

export interface Room {
  _id: string;
  code: string;
  name: string;
  status: "lobby" | "live" | "completed";
  startingBudget: number;
  minBidIncrement: number;
  adminParticipantId?: string | null;
  endsAt?: string | null;
  isPaused?: boolean;
  pausedRemainingMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  _id: string;
  roomId: string;
  username: string;
  role: "admin" | "participant";
  sessionToken?: string;
  /** Purse fixed at join time. Remaining is budget - spent. */
  budget: number;
  spent: number;
  isConnected: boolean;
  joinedAt: string;
}

export interface RoomResponse {
  room: Room;
  participant: Participant;
  sessionToken: string;
}

export interface JoinResponse {
  room: Room;
  participant: Participant;
  sessionToken: string;
}

export interface AuthResponse {
  username: string;
  role: "admin" | "participant";
  /** Present on login/register only; mirrored into the session store. */
  token?: string;
}

/**
 * Headers for an authenticated request.
 *
 * `credentials: "include"` alone is not enough: the API lives on a different
 * registrable domain than the app, so its auth cookie is third-party, and
 * Chrome incognito plus Safari and Firefox tracking protection refuse to send
 * it. The bearer header carries the same JWT over a channel no cookie policy
 * can block. The cookie is still sent when the browser allows it.
 */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = useSessionStore.getState().authToken;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/**
 * Authentication Endpoints
 */

export async function login(username: string, password?: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to log in.");
  }

  return response.json();
}

export async function register(username: string, password?: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to register.");
  }

  return response.json();
}

export async function logout(): Promise<{ message: string }> {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to log out.");
  }

  return response.json();
}

export async function checkAuth(): Promise<{ user: AuthResponse | null }> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/auth/me`, {
      method: "GET",
      headers: authHeaders(),
      credentials: "include",
      signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
    });
  } catch {
    // Network failure, DNS failure, CORS rejection or timeout.
    throw new ApiUnavailableError("Could not reach the server.");
  }

  // 5xx means the backend is up but unhealthy, e.g. its database is unreachable.
  if (response.status >= 500) {
    throw new ApiUnavailableError("The server is not ready yet.");
  }

  if (!response.ok) {
    return { user: null };
  }

  return response.json();
}

/**
 * Room Endpoints
 */

export async function createRoom(
  username: string,
  roomName: string,
  startingBudget?: number,
  minBidIncrement?: number
): Promise<RoomResponse> {
  const response = await fetch(`${API_URL}/rooms`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username, roomName, startingBudget, minBidIncrement }),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to create room");
  }

  return response.json();
}

export async function joinRoom(
  code: string,
  username: string
): Promise<JoinResponse> {
  const response = await fetch(`${API_URL}/rooms/${code.toUpperCase()}/join`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username }),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to join room");
  }

  return response.json();
}

export interface AuctionItem {
  _id: string;
  roomId: string;
  name: string;
  description?: string;
  startingBid: number;
  currentBid: number;
  highestBidderId?: string | null;
  highestBidderUsername?: string | null;
  status: "pending" | "active" | "sold" | "unsold";
  isPaused?: boolean;
  endsAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function addAuctionItem(
  code: string,
  sessionToken: string,
  name: string,
  description: string,
  startingBid: number
): Promise<AuctionItem> {
  const response = await fetch(`${API_URL}/rooms/${code.toUpperCase()}/items`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/json",
      "x-session-token": sessionToken,
    }),
    body: JSON.stringify({ name, description, startingBid }),
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to add auction item.");
  }

  return response.json();
}

export interface Bid {
  _id: string;
  roomId: string;
  itemId: string;
  participantId: string;
  username: string;
  amount: number;
  createdAt: string;
}

export async function getRoomResults(code: string): Promise<AuctionItem[]> {
  const response = await fetch(`${API_URL}/rooms/${code.toUpperCase()}/results`, {
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? "Failed to fetch auction results.");
  }

  return response.json();
}
