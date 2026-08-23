import { Router } from "express";
import {
  createRoomHandler,
  joinRoomHandler,
  getRoomHandler,
  getRoomResultsHandler,
} from "../controllers/roomController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

export const roomRouter = Router();

roomRouter.post("/", requireAuth, createRoomHandler);
roomRouter.post("/:code/join", requireAuth, joinRoomHandler);

roomRouter.get("/:code", getRoomHandler);
roomRouter.get("/:code/results", getRoomResultsHandler);
