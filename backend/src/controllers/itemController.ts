import type { Request, Response, NextFunction } from "express";
import * as itemService from "../services/itemService.js";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";

export async function addItemHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const code = req.params.code as string;
    const { name, description, startingBid } = req.body;

    const newItem = await itemService.createAuctionItem(
      code,
      req.sessionToken as string,
      name,
      description,
      startingBid,
    );

    const io = req.app.get("io");
    if (io) {
      const roomCode = code.toUpperCase();
      const socketRoomId = `room:${roomCode}`;

      io.to(socketRoomId).emit("item:added", {
        item: newItem,
      });
      console.log(
        `Realtime broadcast 'item:added' sent to channel ${socketRoomId} for item: ${newItem.name}`,
      );
    }

    res.status(201).json(newItem);
  } catch (error) {
    next(error);
  }
}

export async function getItemsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const code = req.params.code as string;
    const items = await itemService.getAuctionItems(code);
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
}
