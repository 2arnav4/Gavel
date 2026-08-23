import type { NextFunction, Request, Response } from "express";
import { isDatabaseConnected } from "../config/db.js";
import { AppError } from "./errorHandler.js";

/**
 * Rejects API requests while the database is unreachable.
 *
 * Without this, requests made during a database outage sit in Mongoose's write
 * buffer until it times out, which reads to the client as a hung request. A
 * fast, explicit 503 lets the frontend show a real error state instead.
 */
export function requireDatabase(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!isDatabaseConnected()) {
    next(
      new AppError(
        "The server cannot reach its database right now. Please retry in a moment.",
        503,
      ),
    );
    return;
  }

  next();
}
