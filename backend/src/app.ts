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
  app.set("trust proxy", 1);

  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.use("/api", requireDatabase, apiRouter);

  app.use(errorHandler);

  return app;
}
