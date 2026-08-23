import type { Request, Response } from "express";
import { getDatabaseStatus, isDatabaseConnected } from "../config/db.js";

/**
 * Liveness plus readiness.
 *
 * Always responds 200 so a platform health check treats the process as alive and
 * does not restart it during a database outage. Readiness is reported in the body
 * via `ready`, which is what a caller should branch on.
 */
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
