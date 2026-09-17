import type { Request, Response, NextFunction } from "express";
import type { Model } from "mongoose";

export function listDocuments<T>(model: Model<T>) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await model.find().sort({ createdAt: -1 });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  };
}
