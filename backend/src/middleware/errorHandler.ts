import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function readClientStatus(err: Error): number | undefined {
  const candidate = err as Error & { status?: unknown; statusCode?: unknown };
  const raw = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;

  if (typeof raw !== "number") return undefined;
  if (!Number.isInteger(raw) || raw < 400 || raw > 499) return undefined;

  return raw;
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isDuplicateKey = "code" in err && err.code === 11000;

  const bodyParserStatus = readClientStatus(err);

  const statusCode = err instanceof AppError
    ? err.statusCode
    : isDuplicateKey
      ? 409
      : err instanceof mongoose.Error.ValidationError
        ? 400
        : bodyParserStatus ?? 500;

  const message = err instanceof AppError
    ? err.message
    : isDuplicateKey
      ? "A record with these details already exists."
      : err instanceof mongoose.Error.ValidationError
        ? "Invalid request data."
        : bodyParserStatus === 413
          ? "Request body is too large."
          : bodyParserStatus !== undefined
            ? "Request body could not be parsed."
            : "Internal server error";

  res.status(statusCode).json({ error: message });
}
