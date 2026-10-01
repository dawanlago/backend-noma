import type { NextFunction, Request, Response } from "express";
import { orgFilter } from "../lib/tenant";
import OptionItem from "../models/OptionItem";
import { isValidList, KEYED_LISTS, slugify, uniqueValue } from "../lib/optionLists";

/** GET /options?lists=a,b — sem `lists`, devolve todas. */
export async function listOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const lists = typeof req.query.lists === "string" ? req.query.lists.split(",").filter(Boolean) : [];
    const filter = lists.length ? { list: { $in: lists } } : {};
    const data = await OptionItem.find(filter).sort({ list: 1, order: 1, createdAt: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function createOption(req: Request, res: Response, next: NextFunction) {
  try {
    const { list, color, meta } = req.body as Record<string, unknown>;
    const label = String(req.body.label || "").trim();
    if (!isValidList(list)) {
      res.status(400).json({ error: "Lista de opções inválida." });
      return;
    }
    if (!label) {
      res.status(400).json({ error: "Informe o nome da opção." });
      return;
    }
    const existing = await OptionItem.find({ list }).select("value label order").lean();
    if (existing.some((item) => item.label.toLowerCase() === label.toLowerCase())) {
      res.status(409).json({ error: "Essa opção já existe na lista." });
      return;
    }
    const value = KEYED_LISTS.includes(list)
      ? uniqueValue(slugify(label), existing.map((item) => item.value))
      : uniqueValue(label, existing.map((item) => item.value));
    const order = existing.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    const doc = await OptionItem.create({
      list,
      value,
      label,
      order,
      color: typeof color === "string" ? color : "",
      meta: meta && typeof meta === "object" ? meta : {},
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateOption(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await OptionItem.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Opção não encontrada." });
      return;
    }
    const { label, color, meta } = req.body as Record<string, unknown>;
    if (typeof label === "string" && label.trim()) doc.label = label.trim();
    if (typeof color === "string") doc.color = color;
    if (meta && typeof meta === "object") {
      doc.meta = meta as Record<string, unknown>;
      doc.markModified("meta");
    }
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteOption(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await OptionItem.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Opção não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** PUT /options/reorder { list, ids } */
export async function reorderOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { list, ids } = req.body as { list?: unknown; ids?: unknown };
    if (!isValidList(list) || !Array.isArray(ids)) {
      res.status(400).json({ error: "Ordem inválida." });
      return;
    }
    await OptionItem.bulkWrite(
      ids.map((id, order) => ({ updateOne: { filter: { _id: String(id), list, ...orgFilter() }, update: { $set: { order } } } })),
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
