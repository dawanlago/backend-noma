import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, Types } from "mongoose";
import BucketMovement from "../models/BucketMovement";
import DistributionBucket from "../models/DistributionBucket";
import FinanceEntry from "../models/FinanceEntry";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Caixas da primeira versão do sistema (as mesmas porcentagens de antes). */
const DEFAULT_BUCKETS = [
  { name: "Operacional", percentage: 30, color: "#3B82F6" },
  { name: "Imposto", percentage: 6, color: "#F59E0B" },
  { name: "Lucro", percentage: 64, color: "#22C55E" },
];

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function bucketsOrDefaults() {
  let buckets = await DistributionBucket.find().sort({ order: 1, createdAt: 1 }).lean();
  if (!buckets.length) {
    await DistributionBucket.insertMany(DEFAULT_BUCKETS.map((item, order) => ({ ...item, order })));
    buckets = await DistributionBucket.find().sort({ order: 1, createdAt: 1 }).lean();
  }
  return buckets;
}

function cashboxFilter(req: Request): Record<string, unknown> {
  return typeof req.query.cashbox === "string" && req.query.cashbox ? { cashbox: req.query.cashbox } : {};
}

/**
 * GET /finance/distribution?year=&cashbox=&ownerId=
 * Caixas com saldo (desde sempre) e os movimentos do ano.
 */
export async function getDistribution(req: Request, res: Response, next: NextFunction) {
  try {
    const buckets = await bucketsOrDefaults();
    const scope = { ...ownerScope(req), ...cashboxFilter(req) };
    const year = typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year) ? req.query.year : String(new Date().getFullYear());
    const [sums, movements] = await Promise.all([
      BucketMovement.aggregate<{ _id: { bucketId: Types.ObjectId; kind: "in" | "out" }; total: number }>([
        { $match: scope },
        { $group: { _id: { bucketId: "$bucketId", kind: "$kind" }, total: { $sum: "$value" } } },
      ]),
      BucketMovement.find({ ...scope, date: { $regex: `^${year}-` } }).sort({ date: -1, createdAt: -1 }).lean(),
    ]);
    const totalOf = (id: Types.ObjectId, kind: "in" | "out") =>
      sums.find((item) => String(item._id.bucketId) === String(id) && item._id.kind === kind)?.total || 0;
    res.json({
      data: {
        buckets: buckets.map((bucket) => {
          const received = roundMoney(totalOf(bucket._id, "in"));
          const withdrawn = roundMoney(totalOf(bucket._id, "out"));
          return { ...bucket, received, withdrawn, balance: roundMoney(received - withdrawn) };
        }),
        movements: await withOwnerNames(movements),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /finance/distribution/buckets { buckets: [{ _id?, name, percentage, color }] } — a soma precisa dar 100%. */
export async function saveBuckets(req: Request, res: Response, next: NextFunction) {
  try {
    const input = Array.isArray(req.body.buckets) ? (req.body.buckets as Record<string, unknown>[]) : [];
    const items = input
      .map((item) => ({
        _id: typeof item._id === "string" && isValidObjectId(item._id) ? item._id : undefined,
        name: String(item.name || "").trim(),
        percentage: roundMoney(Math.min(100, Math.max(0, Number(item.percentage) || 0))),
        color: typeof item.color === "string" ? item.color.trim() : "",
      }))
      .filter((item) => item.name);
    if (!items.length) {
      res.status(400).json({ error: "Cadastre pelo menos uma caixa." });
      return;
    }
    const total = roundMoney(items.reduce((sum, item) => sum + item.percentage, 0));
    if (total !== 100) {
      res.status(400).json({ error: `A soma das porcentagens precisa ser 100%. Soma atual: ${total}%.` });
      return;
    }
    const keep: string[] = [];
    for (const [order, item] of items.entries()) {
      const fields = { name: item.name, percentage: item.percentage, color: item.color, order };
      const saved = item._id
        ? await DistributionBucket.findByIdAndUpdate(item._id, fields, { new: true })
        : await DistributionBucket.create(fields);
      if (saved) keep.push(String(saved._id));
    }
    // Caixa removida: sai da configuração, mas o histórico guarda o nome dela.
    await DistributionBucket.deleteMany({ _id: { $nin: keep } });
    res.json({ data: await DistributionBucket.find().sort({ order: 1 }).lean() });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /finance/distributions { date, description, cashbox, entryId?, items: [{ bucketId, value, percentage? }] }
 * Lançamento manual: os valores de cada caixa vêm do formulário (sugeridos pelas porcentagens).
 */
export async function createDistribution(req: Request, res: Response, next: NextFunction) {
  try {
    const date = typeof req.body.date === "string" && DATE_RE.test(req.body.date) ? req.body.date : "";
    if (!date) {
      res.status(400).json({ error: "Informe a data." });
      return;
    }
    const buckets = await DistributionBucket.find().lean();
    const input = Array.isArray(req.body.items) ? (req.body.items as Record<string, unknown>[]) : [];
    const items = input
      .map((item) => ({
        bucket: buckets.find((bucket) => String(bucket._id) === String(item.bucketId)),
        value: roundMoney(Math.max(0, Number(item.value) || 0)),
        percentage: item.percentage !== undefined ? Number(item.percentage) || 0 : undefined,
      }))
      .filter((item) => item.bucket && item.value > 0);
    if (!items.length) {
      res.status(400).json({ error: "Informe o valor de pelo menos uma caixa." });
      return;
    }
    let entryId: Types.ObjectId | undefined;
    if (typeof req.body.entryId === "string" && isValidObjectId(req.body.entryId)) {
      const entry = await FinanceEntry.findOne({ _id: req.body.entryId, ...recordScope(req) }).select("_id").lean();
      entryId = entry?._id;
    }
    const groupId = new Types.ObjectId();
    const docs = await BucketMovement.insertMany(
      items.map((item) => ({
        ownerId: req.user!._id,
        kind: "in",
        bucketId: item.bucket!._id,
        bucketName: item.bucket!.name,
        value: item.value,
        percentage: item.percentage,
        date,
        description: String(req.body.description || "").trim(),
        groupId,
        entryId,
        cashbox: typeof req.body.cashbox === "string" ? req.body.cashbox.trim() : "",
      })),
    );
    res.status(201).json({ data: docs });
  } catch (error) {
    next(error);
  }
}

/** POST /finance/bucket-movements { bucketId, value, date, description, cashbox } — retirada de uma caixa. */
export async function createWithdrawal(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = isValidObjectId(req.body.bucketId) ? await DistributionBucket.findById(req.body.bucketId).lean() : null;
    const value = roundMoney(Number(req.body.value) || 0);
    const date = typeof req.body.date === "string" && DATE_RE.test(req.body.date) ? req.body.date : "";
    if (!bucket || value <= 0 || !date) {
      res.status(400).json({ error: "Informe a caixa, o valor e a data." });
      return;
    }
    const doc = await BucketMovement.create({
      ownerId: req.user!._id,
      kind: "out",
      bucketId: bucket._id,
      bucketName: bucket.name,
      value,
      date,
      description: String(req.body.description || "").trim(),
      cashbox: typeof req.body.cashbox === "string" ? req.body.cashbox.trim() : "",
    });
    res.status(201).json({ data: doc });
  } catch (error) {
    next(error);
  }
}

/** DELETE /finance/bucket-movements/:id — numa distribuição, apaga a distribuição inteira. */
export async function deleteMovement(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await BucketMovement.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!doc) {
      res.status(404).json({ error: "Movimento não encontrado." });
      return;
    }
    if (doc.groupId) await BucketMovement.deleteMany({ groupId: doc.groupId, ...recordScope(req) });
    else await doc.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
