import type { NextFunction, Request, Response } from "express";
import ContractTemplate from "../models/ContractTemplate";

export async function listContractTemplates(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await ContractTemplate.find().sort({ isDefault: -1, name: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

async function applyDefault(id: string) {
  await ContractTemplate.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
}

export async function createContractTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Dê um nome ao modelo." });
      return;
    }
    const isFirst = !(await ContractTemplate.exists({}));
    const doc = await ContractTemplate.create({
      name,
      body: String(req.body.body || ""),
      isDefault: isFirst || Boolean(req.body.isDefault),
    });
    if (doc.isDefault) await applyDefault(String(doc._id));
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateContractTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ContractTemplate.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Modelo não encontrado." });
      return;
    }
    if (typeof req.body.name === "string" && req.body.name.trim()) doc.name = req.body.name.trim();
    if (typeof req.body.body === "string") doc.body = req.body.body;
    if (req.body.isDefault === true) doc.isDefault = true;
    await doc.save();
    if (doc.isDefault) await applyDefault(String(doc._id));
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteContractTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ContractTemplate.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Modelo não encontrado." });
      return;
    }
    if (doc.isDefault) {
      const fallback = await ContractTemplate.findOne().sort({ createdAt: 1 });
      if (fallback) await ContractTemplate.updateOne({ _id: fallback._id }, { isDefault: true });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
