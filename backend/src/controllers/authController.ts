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
  maxAge: 24 * 60 * 60 * 1000,
};

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

function verifyPassword(password: string, user: IUser): boolean {
  const candidate = Buffer.from(
    hashPassword(password, user.salt, user.hashIterations ?? 1_000),
    "hex",
  );
  const stored = Buffer.from(user.passwordHash, "hex");

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
      finalUsername = `demo_${crypto.randomBytes(3).toString("hex")}`;
    } else {
      const user = await User.findOne({
        usernameNormalized: normalizedUsername,
      });
      const suppliedPassword = requireString(password, "Password");
      if (!user || !verifyPassword(suppliedPassword, user)) {
        throw new AppError("Invalid username or password.", 401);
      }
      finalUsername = user.username;
    }

    const token = jwt.sign({ username: finalUsername, role }, env.jwtSecret, {
      expiresIn: "24h",
    });

    res.cookie("token", token, COOKIE_OPTIONS);

    res.status(200).json({
      username: finalUsername,
      role,
      token,
    });
  } catch (error) {
    next(error);
  }
}

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

    if (
      normalizedUsername === "admin" ||
      normalizedUsername.startsWith("demo")
    ) {
      throw new AppError("Username is reserved and cannot be registered.", 400);
    }

    const passwordError = validatePassword(suppliedPassword);
    if (passwordError) {
      throw new AppError(passwordError, 400);
    }

    const existingUser = await User.findOne({
      usernameNormalized: normalizedUsername,
    });
    if (existingUser) {
      throw new AppError(
        "Username is already registered. Please choose another or sign in.",
        400,
      );
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(suppliedPassword, salt, PBKDF2_ITERATIONS);

    const user = new User({
      username: trimmedUsername,
      usernameNormalized: normalizedUsername,
      passwordHash,
      salt,
      hashIterations: PBKDF2_ITERATIONS,
    });
    await user.save();

    const role = "participant";
    const token = jwt.sign({ username: trimmedUsername, role }, env.jwtSecret, {
      expiresIn: "24h",
    });

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
      res.clearCookie("token", COOKIE_OPTIONS);
      res.status(200).json({ user: null });
    }
  } catch (error) {
    next(error);
  }
}
