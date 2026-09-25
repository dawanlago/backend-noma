import type { NextFunction, Request, Response } from "express";
import FinanceEntry from "../models/FinanceEntry";
import Lead from "../models/Lead";
import ToolDocument from "../models/ToolDocument";
import { ownerScope } from "../lib/ownership";

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = ownerScope(req);
    const month = new Date().toISOString().slice(0, 7);
    const [leads, entries, documents] = await Promise.all([
      Lead.find(scope).select("stage value nextActionDate").lean(),
      FinanceEntry.find({ ...scope, date: { $regex: `^${month}-` } }).select("type status value").lean(),
      ToolDocument.aggregate<{ _id: string; count: number }>([
        { $match: scope },
        { $group: { _id: "$tool", count: { $sum: 1 } } },
      ]),
    ]);

    const sum = (filter: (entry: (typeof entries)[number]) => boolean) =>
      entries.filter(filter).reduce((total, entry) => total + entry.value, 0);
    const received = sum((e) => e.type === "income" && e.status === "received");
    const expenses = sum((e) => e.type === "expense" && e.status === "paid");
    const today = new Date().toISOString().slice(0, 10);

    res.json({
      data: {
        leadsCount: leads.length,
        openPipeline: leads.filter((l) => l.stage !== "won").reduce((t, l) => t + l.value, 0),
        wonValue: leads.filter((l) => l.stage === "won").reduce((t, l) => t + l.value, 0),
        leadsDueToday: leads.filter(
          (l) => l.stage !== "won" && l.nextActionDate && l.nextActionDate.toISOString().slice(0, 10) <= today,
        ).length,
        month,
        monthReceived: received,
        monthExpenses: expenses,
        monthResult: received - expenses,
        monthPending: sum((e) => e.type === "income" && e.status === "pending"),
        documents: Object.fromEntries(documents.map((d) => [d._id, d.count])),
      },
    });
  } catch (error) {
    next(error);
  }
}
