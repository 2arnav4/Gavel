import { Router } from "express";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
} from "../controllers/authController.js";
import { rateLimit } from "../middleware/rateLimit.js";

export const authRouter = Router();

authRouter.post("/login", rateLimit(), loginHandler);
authRouter.post("/register", rateLimit(), registerHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", meHandler);
