import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Company from "../models/Company";
import BucketMovement from "../models/BucketMovement";
import Contact from "../models/Contact";
import FinanceEntry, { type IFinanceEntry } from "../models/FinanceEntry";
import MonthlyGoal from "../models/MonthlyGoal";
import RecurringExpense from "../models/RecurringExpense";
import { ownerScope, recordScope, stripOwner, withOwnerNames } from "../lib/ownership";

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthParam(value: unknown) {
  if (typeof value === "string" && MONTH_RE.test(value)) return value;
  return new Date().toISOString().slice(0, 7);
}

/** Filtro opcional por caixa (?cashbox=Noma). */
function cashboxFilter(req: Request): Record<string, unknown> {
  return typeof req.query.cashbox === "string" && req.query.cashbox ? { cashbox: req.query.cashbox } : {};
}

function lastDayOfMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 0).getDate();
}

/** Cria as despesas recorrentes previstas do mês que ainda não existem. */
async function materializeRecurring(scope: Record<string, unknown>, month: string) {
  const recurring = await RecurringExpense.find({
    ...scope,
    active: true,
    startMonth: { $lte: month },
    skippedMonths: { $ne: month },
  });
  for (const item of recurring) {
    const exists = await FinanceEntry.exists({
      recurringId: item._id,
      date: { $regex: `^${month}-` },
    });
    if (exists) continue;
    const day = Math.min(item.day, lastDayOfMonth(month));
    await FinanceEntry.create({
      ownerId: item.ownerId,
      type: "expense",
      description: item.description,
      category: item.category,
      value: item.value,
      date: `${month}-${String(day).padStart(2, "0")}`,
      status: "planned",
      payment: item.payment,
      cashbox: item.cashbox || "",
      bank: item.bank || "",
      recurringId: item._id,
    });
  }
}

type EntryBody = Partial<IFinanceEntry> & { recurring?: boolean };

/** Vínculos com negociação/contato/empresa: id válido ou vazio (remove o vínculo). */
function linkUpdates(body: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of ["leadId", "contactId", "companyId"]) {
    if (body[key] === undefined) continue;
    if (typeof body[key] === "string" && isValidObjectId(body[key])) set[key] = body[key];
    else unset.push(key);
    delete body[key];
  }
  return { set, unset };
}

/** Sem cliente digitado, usa o nome do contato ou da empresa vinculados. */
async function fillClientName(entry: IFinanceEntry) {
  if (entry.type !== "income" || entry.client) return;
  const company = entry.companyId ? await Company.findById(entry.companyId).select("name").lean() : null;
  const contact = !company && entry.contactId ? await Contact.findById(entry.contactId).select("name").lean() : null;
  entry.client = company?.name || contact?.name || "";
}

function goalOwner(req: Request) {
  const scoped = ownerScope(req).ownerId;
  return scoped || req.user!._id;
}

/** GET /finance/entries?month=YYYY-MM | ?year=YYYY (planilha) | ?leadId= (parcelas da venda); &cashbox= filtra o caixa. */
export async function listEntries(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = ownerScope(req);
    const box = cashboxFilter(req);
    if (typeof req.query.leadId === "string" && isValidObjectId(req.query.leadId)) {
      const entries = await FinanceEntry.find({ ...recordScope(req), leadId: req.query.leadId }).sort({ date: 1, createdAt: 1 }).lean();
      res.json({ data: await withOwnerNames(entries) });
      return;
    }
    if (typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year)) {
      const year = req.query.year;
      for (let m = 1; m <= 12; m += 1) await materializeRecurring(scope, `${year}-${String(m).padStart(2, "0")}`);
      const entries = await FinanceEntry.find({ ...scope, ...box, date: { $regex: `^${year}-` } })
        .sort({ date: 1, createdAt: 1 })
        .lean();
      res.json({ data: await withOwnerNames(entries), meta: { year } });
      return;
    }
    const month = monthParam(req.query.month);
    await materializeRecurring(scope, month);
    const entries = await FinanceEntry.find({ ...scope, ...box, date: { $regex: `^${month}-` } })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const goal = await MonthlyGoal.findOne({ ownerId: goalOwner(req), month, cashbox: String(box.cashbox || "") }).lean();
    // Entradas que já foram distribuídas nas caixas de distribuição.
    const distributed = new Set(
      (await BucketMovement.distinct("entryId", { entryId: { $in: entries.map((entry) => entry._id) } })).map(String),
    );
    const data = entries.map((entry) => ({ ...entry, distributed: distributed.has(String(entry._id)) }));
    res.json({ data: await withOwnerNames(data), meta: { month, goal: goal?.value || 0 } });
  } catch (error) {
    next(error);
  }
}

export async function createEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const { recurring, ...body } = stripOwner(req.body) as EntryBody;
    const links = linkUpdates(body as Record<string, unknown>);
    const entry = new FinanceEntry({ ...body, ...links.set, ownerId: req.user!._id });
    await fillClientName(entry);
    await entry.validate();
    if (recurring && entry.type === "expense") {
      const series = await RecurringExpense.create({
        ownerId: entry.ownerId,
        description: entry.description,
        category: entry.category,
        value: entry.value,
        day: Number(entry.date.slice(8, 10)),
        payment: entry.payment,
        cashbox: entry.cashbox,
        bank: entry.bank,
        startMonth: entry.date.slice(0, 7),
      });
      entry.recurringId = series._id;
    }
    await entry.save();
    res.status(201).json({ data: entry.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await FinanceEntry.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!entry) {
      res.status(404).json({ error: "Movimentação não encontrada." });
      return;
    }
    const { recurring, ...body } = stripOwner(req.body) as EntryBody;
    delete body.recurringId;
    const links = linkUpdates(body as Record<string, unknown>);
    entry.set({ ...body, ...links.set });
    links.unset.forEach((key) => entry.set(key, undefined));
    await fillClientName(entry);

    if (recurring === false && entry.recurringId) {
      await RecurringExpense.updateOne({ _id: entry.recurringId }, { active: false });
      entry.recurringId = undefined;
    } else if (recurring === true && !entry.recurringId && entry.type === "expense") {
      const series = await RecurringExpense.create({
        ownerId: entry.ownerId,
        description: entry.description,
        category: entry.category,
        value: entry.value,
        day: Number(entry.date.slice(8, 10)),
        payment: entry.payment,
        cashbox: entry.cashbox,
        bank: entry.bank,
        startMonth: entry.date.slice(0, 7),
        skippedMonths: [],
      });
      entry.recurringId = series._id;
    }
    await entry.save();
    res.json({ data: entry.toJSON() });
  } catch (error) {
    next(error);
  }
}

/** `?scope=series` encerra a recorrência; sem isso, só pula este mês. */
export async function deleteEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await FinanceEntry.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!entry) {
      res.status(404).json({ error: "Movimentação não encontrada." });
      return;
    }
    if (entry.recurringId) {
      if (req.query.scope === "series") {
        await RecurringExpense.updateOne({ _id: entry.recurringId }, { active: false });
        await FinanceEntry.deleteMany({
          recurringId: entry.recurringId,
          status: "planned",
          date: { $gt: entry.date },
        });
      } else {
        await RecurringExpense.updateOne(
          { _id: entry.recurringId },
          { $addToSet: { skippedMonths: entry.date.slice(0, 7) } },
        );
      }
    }
    await entry.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function getYearSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : String(new Date().getFullYear());
    const entries = await FinanceEntry.find({ ...ownerScope(req), ...cashboxFilter(req), date: { $regex: `^${year}-` } }).lean();
    const months = Array.from({ length: 12 }, (_, index) => ({
      month: `${year}-${String(index + 1).padStart(2, "0")}`,
      received: 0,
      expenses: 0,
      result: 0,
      pending: 0,
    }));
    for (const entry of entries) {
      const row = months[Number(entry.date.slice(5, 7)) - 1];
      if (entry.type === "income" && entry.status === "received") row.received += entry.value;
      if (entry.type === "income" && entry.status === "pending") row.pending += entry.value;
      if (entry.type === "expense" && entry.status === "paid") row.expenses += entry.value;
    }
    months.forEach((row) => {
      row.result = row.received - row.expenses;
    });
    res.json({ data: { year, months } });
  } catch (error) {
    next(error);
  }
}

export async function setGoal(req: Request, res: Response, next: NextFunction) {
  try {
    const month = monthParam(req.params.month);
    const value = Math.max(0, Number(req.body.value) || 0);
    const cashbox = typeof req.body.cashbox === "string" ? req.body.cashbox : "";
    const goal = await MonthlyGoal.findOneAndUpdate(
      { ownerId: req.user!._id, month, cashbox },
      { value },
      { returnDocument: "after", upsert: true },
    );
    res.json({ data: goal.toJSON() });
  } catch (error) {
    next(error);
  }
}

const MONEY = (value: number) => Math.round(value * 100) / 100;

/**
 * POST /finance/installments — lança uma venda no financeiro, à vista ou em
 * parcelas (ex.: boletos). Cada parcela vira uma entrada ligada à negociação.
 */
export async function createInstallments(req: Request, res: Response, next: NextFunction) {
  try {
    const body = stripOwner(req.body) as Record<string, unknown>;
    const items = Array.isArray(body.installments) ? (body.installments as Record<string, unknown>[]) : [];
    const parcels = items
      .map((item) => ({ value: MONEY(Math.max(0, Number(item.value) || 0)), date: String(item.date || "") }))
      .filter((item) => item.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
    if (!parcels.length || parcels.length !== items.length || parcels.length > 60) {
      res.status(400).json({ error: "Informe valor e data de cada parcela." });
      return;
    }
    const description = String(body.description || "").trim();
    if (!description) {
      res.status(400).json({ error: "Informe a descrição." });
      return;
    }
    const links = linkUpdates(body);
    const received = body.firstReceived === true;
    const docs = [];
    for (const [index, parcel] of parcels.entries()) {
      const entry = new FinanceEntry({
        ownerId: req.user!._id,
        type: "income",
        description,
        client: String(body.client || "").trim(),
        category: String(body.category || "Outro"),
        value: parcel.value,
        date: parcel.date,
        status: received && index === 0 ? "received" : "pending",
        payment: String(body.payment || "Pix"),
        cashbox: String(body.cashbox || ""),
        bank: String(body.bank || ""),
        notes: String(body.notes || ""),
        ...(parcels.length > 1 ? { installment: { number: index + 1, total: parcels.length } } : {}),
        ...links.set,
      });
      await fillClientName(entry);
      docs.push(entry);
    }
    await Promise.all(docs.map((doc) => doc.validate()));
    const saved = await FinanceEntry.insertMany(docs);
    res.status(201).json({ data: saved.map((doc) => doc.toJSON()) });
  } catch (error) {
    next(error);
  }
}
