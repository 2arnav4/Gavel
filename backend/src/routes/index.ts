import { Router } from "express";
import { roomRouter } from "./roomRoutes.js";
import { itemRouter } from "./itemRoutes.js";
import { authRouter } from "./authRoutes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/rooms", roomRouter);
apiRouter.use("/rooms/:code/items", itemRouter);
