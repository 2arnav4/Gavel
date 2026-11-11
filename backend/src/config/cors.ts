import type { CorsOptions } from "cors";
import { env } from "./env.js";
import { AppError } from "../middleware/errorHandler.js";

const VERCEL_PREVIEW = /^https:\/\/gavel-[a-z0-9-]+\.vercel\.app$/;

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const normalized = origin.replace(/\/$/, "");

    const allowedOrigins = env.isDevelopment
      ? [...env.clientUrls, "http://localhost:5173"]
      : env.clientUrls;

    if (allowedOrigins.includes(normalized)) {
      return callback(null, true);
    }

    if (env.allowPreviewOrigins && VERCEL_PREVIEW.test(normalized)) {
      return callback(null, true);
    }

    callback(new AppError("This origin is not allowed.", 403));
  },
  credentials: true,
};
