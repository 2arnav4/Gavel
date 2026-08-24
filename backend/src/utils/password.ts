import crypto from "crypto";

export const PBKDF2_ITERATIONS = 210_000;

const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";

const LEGACY_ITERATIONS = 1_000;

export type StoredPassword = {
  passwordHash: string;
  salt: string;
  hashIterations?: number;
};

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashPassword(
  password: string,
  salt: string,
  iterations: number = PBKDF2_ITERATIONS,
): string {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Password hash iteration count must be a positive integer.");
  }

  return crypto
    .pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString("hex");
}

export function storedIterations(stored: StoredPassword): number {
  const value = stored.hashIterations;
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : LEGACY_ITERATIONS;
}

export function verifyPassword(password: string, stored: StoredPassword): boolean {
  const candidate = Buffer.from(
    hashPassword(password, stored.salt, storedIterations(stored)),
    "hex",
  );
  const expected = Buffer.from(stored.passwordHash, "hex");

  if (candidate.length !== expected.length) return false;

  return crypto.timingSafeEqual(candidate, expected);
}

export function needsRehash(stored: StoredPassword): boolean {
  return storedIterations(stored) < PBKDF2_ITERATIONS;
}

export function createPasswordRecord(password: string): Required<StoredPassword> {
  const salt = generateSalt();
  return {
    salt,
    passwordHash: hashPassword(password, salt, PBKDF2_ITERATIONS),
    hashIterations: PBKDF2_ITERATIONS,
  };
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one digit.";
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return "Password must contain at least one special character (e.g., !, @, #, $, etc.).";
  }
  return null;
}
