import type { NextFunction, Request, Response } from "express";
import Product, { type IProductCost } from "../models/Product";

const DEFAULT_COST_LABEL = "Custo operacional";
const round = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

/** Linhas de custo válidas (com nome ou valor); linha sem nome ganha o rótulo padrão. */
function costLines(input: unknown): IProductCost[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({ label: String(item?.label || "").trim(), value: round(item?.value) }))
    .filter((item) => item.label || item.value > 0)
    .map((item) => ({ label: item.label || DEFAULT_COST_LABEL, value: item.value }));
}

/**
 * Campos aceitos no cadastro. O custo operacional é sempre a soma das linhas de custo;
 * quem envia só `operationalCost` (formato antigo) fica com uma linha única.
 */
function productFields(body: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  if (typeof body.name === "string") fields.name = body.name.trim();
  if (typeof body.description === "string") fields.description = body.description.trim();
  if (typeof body.category === "string") fields.category = body.category.trim();
  if (body.profit !== undefined) fields.profit = round(body.profit);
  if (Array.isArray(body.costs)) {
    const costs = costLines(body.costs);
    fields.costs = costs;
    fields.operationalCost = round(costs.reduce((total, item) => total + item.value, 0));
  } else if (body.operationalCost !== undefined) {
    const total = round(body.operationalCost);
    fields.operationalCost = total;
    fields.costs = total > 0 ? [{ label: DEFAULT_COST_LABEL, value: total }] : [];
  }
  return fields;
}

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const fields = productFields(req.body || {});
    if (!fields.name) {
      res.status(400).json({ error: "Informe o nome do produto." });
      return;
    }
    const doc = await Product.create(fields);
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Product.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Registro não encontrado." });
      return;
    }
    const fields = productFields(req.body || {});
    if (fields.name === "") delete fields.name;
    doc.set(fields);
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}
