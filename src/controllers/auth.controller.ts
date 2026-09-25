import type { Request, Response, NextFunction } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import User, { type IUser } from "../models/User";
import { effectivePermissions } from "../lib/permissions";

/** Usuário com os módulos que ele realmente pode acessar. */
function withPermissions(user: IUser) {
  return { ...user.toJSON(), permissions: effectivePermissions(user) };
}

function createToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as SignOptions);
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      res.status(400).json({ error: "Informe e-mail e senha." });
      return;
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !user.isActive || !(await user.comparePassword(password))) {
      res.status(401).json({ error: "E-mail ou senha inválidos." });
      return;
    }

    const token = createToken(user._id.toString());

    res.json({
      token,
      user: withPermissions(user),
    });
  } catch (error) {
    next(error);
  }
}

export function me(req: Request, res: Response) {
  res.json({ user: withPermissions(req.user!) });
}
