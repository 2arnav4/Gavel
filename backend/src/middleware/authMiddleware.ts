import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "./errorHandler.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    username: string;
    role: "admin" | "participant";
  };
  sessionToken?: string;
}

/**
 * Reads the auth JWT from either transport.
 *
 * The cookie is preferred because it is HTTP-only and therefore not readable by
 * script. But the API is served from a different registrable domain than the
 * frontend, which makes that cookie third-party — and browsers increasingly
 * refuse to store or send those by default (Chrome incognito, Safari ITP,
 * Firefox ETP). Relying on the cookie alone means the app silently fails for
 * anyone with tracking protection on, so a bearer header is accepted as a
 * fallback. The proper fix is to serve both from one origin; this is the
 * portable one.
 */
export function readAuthToken(req: Request): string | undefined {
  const cookieToken = (req as AuthenticatedRequest).cookies?.token;
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || undefined;
  }

  return undefined;
}

/**
 * Required authentication. Rejects the request unless a valid JWT is present,
 * and makes the verified identity the only source of the username.
 *
 * Room creation and joining establish who a participant is for the entire
 * lifetime of an auction, so they must not accept a username supplied in the
 * request body: doing so lets an unauthenticated caller enter a room under any
 * name they choose.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const token = readAuthToken(req);

  if (!token) {
    next(new AppError("You must be signed in to do that.", 401));
    return;
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret) as {
      username: string;
      role: "admin" | "participant";
    };
    next();
  } catch {
    next(new AppError("Your session has expired. Please sign in again.", 401));
  }
}

/**
 * Reads the room-scoped participant session token (issued on room create/join)
 * from request headers and attaches it to req.sessionToken. Does not verify
 * the token against a participant — the service layer looks it up and
 * enforces role checks, matching how every other room-scoped write is done.
 */
export function extractSessionToken(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  // Deliberately not falling back to the Authorization header: that now carries
  // the account JWT, and treating one as the other would silently authorise the
  // wrong thing. The room session token has its own dedicated header.
  const headerToken =
    req.headers["x-session-token"] ?? req.headers["session-token"];

  if (headerToken) {
    req.sessionToken = Array.isArray(headerToken)
      ? headerToken[0]
      : headerToken;
  }

  next();
}
