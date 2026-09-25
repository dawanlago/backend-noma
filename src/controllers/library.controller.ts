import type { NextFunction, Request, Response } from "express";
import LibraryCategory from "../models/LibraryCategory";

export async function listLibrary(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await LibraryCategory.find().sort({ order: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function updateLibraryCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, url } = req.body as Record<string, string | undefined>;
    const doc = await LibraryCategory.findByIdAndUpdate(
      req.params.id,
      { ...(title !== undefined && { title }), ...(description !== undefined && { description }), ...(url !== undefined && { url }) },
      { new: true, runValidators: true },
    );
    if (!doc) {
      res.status(404).json({ error: "Categoria não encontrada." });
      return;
    }
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}
