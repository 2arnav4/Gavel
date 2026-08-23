import type { CorsOptions } from "cors";
import { env } from "./env.js";

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // env.clientUrls is already trimmed and stripped of trailing slashes, so
    // only the incoming origin needs normalizing before the comparison.
    const allowedOrigins = env.isDevelopment
      ? [...env.clientUrls, "http://localhost:5173"]
      : env.clientUrls;

    if (allowedOrigins.includes(origin.replace(/\/$/, ""))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};
