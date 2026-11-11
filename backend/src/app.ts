import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireDatabase } from "./middleware/requireDatabase.js";
import { apiRouter } from "./routes/index.js";
import { healthRouter } from "./routes/healthRoutes.js";
import helmet from "helmet";

const JSON_BODY_LIMIT = "32kb";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.use("/api", requireDatabase, apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  app.use(errorHandler);

  return app;
}
