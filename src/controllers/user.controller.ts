import type { Request, Response, NextFunction } from "express";
import User from "../models/User";

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.create(req.body);
    res.status(201).json({ data: user.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = { ...req.body };
    if (!payload.password) {
      delete payload.password;
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }

    Object.assign(user, payload);
    await user.save();

    res.json({ data: user.toJSON() });
  } catch (error) {
    next(error);
  }
}
