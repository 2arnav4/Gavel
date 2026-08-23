import { AppError } from "../middleware/errorHandler.js";


export function requireString(
  value: unknown,
  fieldLabel: string,
  maxLength?: number,
): string {
  if (typeof value !== "string") {
    throw new AppError(`${fieldLabel} is required.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(`${fieldLabel} is required.`, 400);
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new AppError(`${fieldLabel} must be ${maxLength} characters or fewer.`, 400);
  }

  return trimmed;
}

export function optionalString(
  value: unknown,
  fieldLabel: string,
  maxLength?: number,
): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value !== "string") {
    throw new AppError(`${fieldLabel} must be text.`, 400);
  }

  const trimmed = value.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new AppError(`${fieldLabel} must be ${maxLength} characters or fewer.`, 400);
  }

  return trimmed;
}

export function requirePositiveNumber(value: unknown, fieldLabel: string): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`${fieldLabel} must be a positive number.`, 400);
  }

  return parsed;
}
