import type { Request, Response, NextFunction } from "express";
import type { Model } from "mongoose";

interface CrudOptions {
  omitFields?: string[];
}

export function createDocument<T>(model: Model<T>, options: CrudOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.create(req.body);
      const json = doc.toJSON();
      options.omitFields?.forEach((field) => delete (json as Record<string, unknown>)[field]);
      res.status(201).json({ data: json });
    } catch (error) {
      next(error);
    }
  };
}

export function getDocument<T>(model: Model<T>, options: CrudOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findById(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Registro não encontrado." });
        return;
      }
      const json = doc.toJSON();
      options.omitFields?.forEach((field) => delete (json as Record<string, unknown>)[field]);
      res.json({ data: json });
    } catch (error) {
      next(error);
    }
  };
}

export function listDocuments<T>(model: Model<T>, filterFn?: (req: Request) => Record<string, unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = filterFn ? filterFn(req) : {};
      const data = await model.find(filter).sort({ createdAt: -1 });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  };
}

export function updateDocument<T>(model: Model<T>, options: CrudOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!doc) {
        res.status(404).json({ error: "Registro não encontrado." });
        return;
      }
      const json = doc.toJSON();
      options.omitFields?.forEach((field) => delete (json as Record<string, unknown>)[field]);
      res.json({ data: json });
    } catch (error) {
      next(error);
    }
  };
}

export function deleteDocument<T>(model: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doc = await model.findByIdAndDelete(req.params.id);
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
