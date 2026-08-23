import { Router } from "express";
import {
  addItemHandler,
  getItemsHandler,
} from "../controllers/itemController.js";
import { extractSessionToken } from "../middleware/authMiddleware.js";

export const itemRouter = Router({ mergeParams: true });

itemRouter.post("/", extractSessionToken, addItemHandler);
itemRouter.get("/", getItemsHandler);
