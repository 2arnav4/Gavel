import { AppError } from "../middleware/errorHandler.js";

/**
 * Request-boundary validation for text fields.
 *
 * `value?.trim()` reads like a guard but only covers `null` and `undefined`. A
 * number, object, array or boolean sails past optional chaining, reaches
 * `.trim()`, throws a TypeError, and surfaces to the client as a 500 — a
 * malformed request reported as a server fault. Anything arriving as JSON can
 * be any JSON type, so the type has to be checked before the value is used.
 */

/** Requires a non-empty string. Returns it trimmed. */
export function requireString(
  value: unknown,
  fieldLabel: string,
  maxLength?: number,
): string {
  if (typeof value !== "string") {
    // Absent and wrong-typed are reported the same way on purpose: from the
    // client's side both mean "this field was not supplied correctly", and
    // distinguishing them only helps someone probing the shape of the API.
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

/** Allows the field to be omitted, but rejects a supplied non-string. */
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

/**
 * Requires a finite positive number, accepting the numeric strings that arrive
 * from form inputs. Rejects NaN and Infinity, which `> 0` alone would let
 * through in the Infinity case.
 */
export function requirePositiveNumber(value: unknown, fieldLabel: string): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`${fieldLabel} must be a positive number.`, 400);
  }

  return parsed;
}
