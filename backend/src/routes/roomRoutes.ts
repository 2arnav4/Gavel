import { Router } from "express";
import {
  createRoomHandler,
  joinRoomHandler,
  getRoomHandler,
  getRoomResultsHandler,
} from "../controllers/roomController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

export const roomRouter = Router();

// Writes are authenticated: identity comes from the verified cookie only.
roomRouter.post("/", requireAuth, createRoomHandler);
roomRouter.post("/:code/join", requireAuth, joinRoomHandler);

// Reads stay open. A room code is the invitation, and requiring an account to
// look up a room would break sharing a link before signing up. Neither route
// exposes a session token, so knowing a code grants visibility, never control.
roomRouter.get("/:code", getRoomHandler);
roomRouter.get("/:code/results", getRoomResultsHandler);
