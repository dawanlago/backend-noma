import type { NextFunction, Request, Response } from "express";
import CustomField from "../models/CustomField";
import OptionItem from "../models/OptionItem";
import { slugify, uniqueValue } from "../lib/optionLists";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, type CustomFieldEntity } from "../types";

export async function listCustomFields(req: Request, res: Response, next: NextFunction) {
  try {
    const entity = req.query.entity as CustomFieldEntity | undefined;
    const filter = entity && CUSTOM_FIELD_ENTITIES.includes(entity) ? { entity } : {};
    const data = await CustomField.find(filter).sort({ entity: 1, order: 1, createdAt: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function createCustomField(req: Request, res: Response, next: NextFunction) {
  try {
    const entity = req.body.entity as CustomFieldEntity;
    const label = String(req.body.label || "").trim();
    const type = CUSTOM_FIELD_TYPES.includes(req.body.type) ? req.body.type : "text";
    if (!CUSTOM_FIELD_ENTITIES.includes(entity) || !label) {
      res.status(400).json({ error: "Informe onde o campo aparece e o nome dele." });
      return;
    }
    const siblings = await CustomField.find({ entity }).select("key order").lean();
    const doc = await CustomField.create({
      entity,
      label,
      type,
      key: uniqueValue(slugify(label, "campo"), siblings.map((field) => field.key)),
      order: siblings.reduce((max, field) => Math.max(max, field.order), -1) + 1,
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateCustomField(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await CustomField.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Campo não encontrado." });
      return;
    }
    if (typeof req.body.label === "string" && req.body.label.trim()) doc.label = req.body.label.trim();
    if (CUSTOM_FIELD_TYPES.includes(req.body.type)) doc.type = req.body.type;
    if (typeof req.body.order === "number") doc.order = req.body.order;
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteCustomField(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await CustomField.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Campo não encontrado." });
      return;
    }
    await OptionItem.deleteMany({ list: `field:${doc._id}` });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
