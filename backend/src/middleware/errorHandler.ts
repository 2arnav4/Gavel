import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isDuplicateKey = "code" in err && err.code === 11000;
  const statusCode = err instanceof AppError ? err.statusCode : isDuplicateKey ? 409 : err instanceof mongoose.Error.ValidationError ? 400 : 500;
  const message = err instanceof AppError
    ? err.message
    : isDuplicateKey
      ? "A record with these details already exists."
      : err instanceof mongoose.Error.ValidationError
        ? "Invalid request data."
        : "Internal server error";

  res.status(statusCode).json({ error: message });
}
