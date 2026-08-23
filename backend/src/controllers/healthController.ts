import type { Request, Response } from "express";
import { getDatabaseStatus, isDatabaseConnected } from "../config/db.js";

export function getHealth(_req: Request, res: Response) {
  const ready = isDatabaseConnected();

  res.status(200).json({
    status: ready ? "ok" : "degraded",
    ready,
    database: getDatabaseStatus(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
