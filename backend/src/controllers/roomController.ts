import type { Request, Response, NextFunction } from "express";
import * as roomService from "../services/roomService.js";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";

export async function createRoomHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { roomName, startingBudget, minBidIncrement, currency } = req.body;
    const username = req.user?.username ?? "";
    const optionalNumber = (value: unknown) =>
      value === undefined || value === null || value === "" ? undefined : Number(value);

    const result = await roomService.createRoom(
      username,
      roomName,
      optionalNumber(startingBudget),
      optionalNumber(minBidIncrement),
      currency,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function joinRoomHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const code = req.params.code as string;
    const username = req.user?.username ?? "";
    const result = await roomService.joinRoom(code, username);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getRoomHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const code = req.params.code as string;
    const room = await roomService.getRoomByCode(code);
    res.status(200).json(room);
  } catch (error) {
    next(error);
  }
}

export async function getRoomResultsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const code = req.params.code as string;
    const results = await roomService.getRoomResults(code);
    res.status(200).json(results);
  } catch (error) {
    next(error);
  }
}

export async function getRoomParticipantsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const code = req.params.code as string;
    const result = await roomService.getRoomParticipants(code, req.query.cursor, req.query.limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
