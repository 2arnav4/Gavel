import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AppError } from "../middleware/errorHandler.js";
import { env } from "../config/env.js";
import { User, type IUser } from "../models/userModel.js";
import { readAuthToken } from "../middleware/authMiddleware.js";
import { requireString } from "../utils/validation.js";

const isProd = env.nodeEnv === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax" | "strict" | undefined,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

// OWASP's current floor for PBKDF2-HMAC-SHA512. Stored alongside each hash so
// this can be raised later without locking existing users out.
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(
  password: string,
  salt: string,
  iterations: number,
): string {
  return crypto
    .pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString("hex");
}

/**
 * Compares in constant time. A plain `!==` on hex strings short-circuits at the
 * first differing character, so its runtime leaks how much of a guess was
 * correct — enough, over many attempts, to reconstruct a hash byte by byte.
 */
function verifyPassword(password: string, user: IUser): boolean {
  const candidate = Buffer.from(
    hashPassword(password, user.salt, user.hashIterations ?? 1_000),
    "hex",
  );
  const stored = Buffer.from(user.passwordHash, "hex");

  // timingSafeEqual throws on a length mismatch, which would itself be a signal.
  if (candidate.length !== stored.length) return false;

  return crypto.timingSafeEqual(candidate, stored);
}

function validatePassword(password: string): string | null {
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

/**
 * Validates credentials and sets an HTTP-only JWT cookie.
 *
 * `demo` / `password123` is a shared demo account: each sign-in mints a
 * distinct alias so the same credentials can drive several browser windows at
 * once. Everything else is a registered account with a verified password.
 *
 * The JWT carries a role only as an account-level default. Authority inside an
 * auction comes from the participant record created at room create/join, never
 * from this token.
 */
export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { username, password } = req.body;

    const trimmedUsername = requireString(username, "Username", 40);
    const normalizedUsername = trimmedUsername.toLowerCase();

    let finalUsername = trimmedUsername;
    const role: "admin" | "participant" = "participant";

    if (normalizedUsername === "demo") {
      if (password !== "password123") {
        throw new AppError("Invalid credentials for the demo account.", 401);
      }
      // Random rather than a counter: a counter lives in process memory, so a
      // restart replays aliases and the next demo_1 collides with the demo_1
      // already sitting in a room.
      finalUsername = `demo_${crypto.randomBytes(3).toString("hex")}`;
    } else {
      const user = await User.findOne({
        usernameNormalized: normalizedUsername,
      });
      const suppliedPassword = requireString(password, "Password");
      // Same message and roughly the same work whether or not the account
      // exists, so this cannot be used to enumerate registered usernames.
      if (!user || !verifyPassword(suppliedPassword, user)) {
        throw new AppError("Invalid username or password.", 401);
      }
      finalUsername = user.username;
    }

    // Sign JWT Token
    const token = jwt.sign({ username: finalUsername, role }, env.jwtSecret, {
      expiresIn: "24h",
    });

    // Set Cookie
    res.cookie("token", token, COOKIE_OPTIONS);

    // The token is returned as well as set as a cookie. The API and the frontend
    // are on different registrable domains, so that cookie is third-party and is
    // blocked by default in Chrome incognito and under Safari/Firefox tracking
    // protection. Clients hold this and send it as a bearer header instead.
    res.status(200).json({
      username: finalUsername,
      role,
      token,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Registers a new user and sets HTTP-only JWT cookie (auto-login).
 */
export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { username, password } = req.body;

    const trimmedUsername = requireString(username, "Username", 40);
    const suppliedPassword = requireString(password, "Password");
    const normalizedUsername = trimmedUsername.toLowerCase();

    // Prevent registering with reserved names
    if (
      normalizedUsername === "admin" ||
      normalizedUsername.startsWith("demo")
    ) {
      throw new AppError("Username is reserved and cannot be registered.", 400);
    }

    // Validate password strength
    const passwordError = validatePassword(suppliedPassword);
    if (passwordError) {
      throw new AppError(passwordError, 400);
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      usernameNormalized: normalizedUsername,
    });
    if (existingUser) {
      throw new AppError(
        "Username is already registered. Please choose another or sign in.",
        400,
      );
    }

    // Hash password
    const salt = generateSalt();
    const passwordHash = hashPassword(suppliedPassword, salt, PBKDF2_ITERATIONS);

    // Create user
    const user = new User({
      username: trimmedUsername,
      usernameNormalized: normalizedUsername,
      passwordHash,
      salt,
      hashIterations: PBKDF2_ITERATIONS,
    });
    await user.save();

    // Auto-login (Sign JWT Token)
    const role = "participant";
    const token = jwt.sign({ username: trimmedUsername, role }, env.jwtSecret, {
      expiresIn: "24h",
    });

    // Set Cookie
    res.cookie("token", token, COOKIE_OPTIONS);

    res.status(201).json({
      username: trimmedUsername,
      role,
      token,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Clears HTTP-only authentication cookie.
 */
export async function logoutHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as
        | "none"
        | "lax"
        | "strict"
        | undefined,
    });
    res.status(200).json({ message: "Logout successful." });
  } catch (error) {
    next(error);
  }
}

/**
 * Checks active profile details from JWT cookie.
 */
export async function meHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = readAuthToken(req);

    if (!token) {
      res.status(200).json({ user: null });
      return;
    }

    try {
      const decoded = jwt.verify(token, env.jwtSecret) as {
        username: string;
        role: string;
      };
      res.status(200).json({
        user: {
          username: decoded.username,
          role: decoded.role,
        },
      });
    } catch (err) {
      // Invalid/Expired token -> clear cookie and return null
      res.clearCookie("token", COOKIE_OPTIONS);
      res.status(200).json({ user: null });
    }
  } catch (error) {
    next(error);
  }
}
