import type { NextFunction, Request, Response } from "express";
import { isDatabaseConnected } from "../config/db.js";
import { AppError } from "./errorHandler.js";

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
