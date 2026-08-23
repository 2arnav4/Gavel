import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireDatabase } from "./middleware/requireDatabase.js";
import { apiRouter } from "./routes/index.js";
import { healthRouter } from "./routes/healthRoutes.js";

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(cookieParser());

  // Health stays unguarded so it can still report during a database outage.
  app.use("/health", healthRouter);
  app.use("/api", requireDatabase, apiRouter);

  app.use(errorHandler);

  return app;
}
