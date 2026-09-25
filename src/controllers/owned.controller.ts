import type { NextFunction, Request, Response } from "express";
import type { Model } from "mongoose";
import { ownerScope, recordScope, stripOwner, withOwnerNames } from "../lib/ownership";

/* CRUD genérico para coleções com dono (ownerId). */

export function listOwned<T>(model: Model<T>, sort: Record<string, 1 | -1> = { createdAt: -1 }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docs = await model.find(ownerScope(req)).sort(sort).lean();
      res.json({ data: await withOwnerNames(docs as never[]) });
    } catch (error) {
      next(error);
    }
  };
}

export function getOwned<T>(model: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findOne({ _id: req.params.id, ...recordScope(req) }).lean();
      if (!doc) {
        res.status(404).json({ error: "Registro não encontrado." });
        return;
      }
      const [withName] = await withOwnerNames([doc as never]);
      res.json({ data: withName });
    } catch (error) {
      next(error);
    }
  };
}

export function createOwned<T>(model: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = new model({ ...stripOwner(req.body), ownerId: req.user!._id });
      await doc.save();
      res.status(201).json({ data: doc.toJSON() });
    } catch (error) {
      next(error);
    }
  };
}

export function updateOwned<T>(model: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findOne({ _id: req.params.id, ...recordScope(req) });
      if (!doc) {
        res.status(404).json({ error: "Registro não encontrado." });
        return;
      }
      doc.set(stripOwner(req.body));
      await doc.save();
      res.json({ data: doc.toJSON() });
    } catch (error) {
      next(error);
    }
  };
}

export function deleteOwned<T>(model: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
      if (!doc) {
        res.status(404).json({ error: "Registro não encontrado." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
