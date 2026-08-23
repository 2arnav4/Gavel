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

export function readAuthToken(req: Request): string | undefined {
  const cookieToken = (req as AuthenticatedRequest).cookies?.token;
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || undefined;
  }

  return undefined;
}

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

export function extractSessionToken(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const headerToken =
    req.headers["x-session-token"] ?? req.headers["session-token"];

  if (headerToken) {
    req.sessionToken = Array.isArray(headerToken)
      ? headerToken[0]
      : headerToken;
  }

  next();
}
