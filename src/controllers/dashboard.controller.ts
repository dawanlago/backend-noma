import type { NextFunction, Request, Response } from "express";
import FinanceEntry from "../models/FinanceEntry";
import Contact from "../models/Contact";
import Lead from "../models/Lead";
import { upcomingBirthdays } from "../lib/birthdays";
import Task from "../models/Task";
import ToolDocument from "../models/ToolDocument";
import { hasModule } from "../lib/permissions";
import { ownerScope, ownerScopeFor } from "../lib/ownership";

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = ownerScope(req);
    const month = new Date().toISOString().slice(0, 7);
    const canSeeFinance = hasModule(req.user!, "financeiro");
    const [leads, entries, documents, tasks, people] = await Promise.all([
      // Cada bloco respeita o alcance do usuário no seu módulo.
      Lead.find(ownerScopeFor(req, "crm")).select("status value nextActionDate").lean(),
      canSeeFinance
        ? FinanceEntry.find({ ...ownerScopeFor(req, "financeiro"), date: { $regex: `^${month}-` } }).select("type status value").lean()
        : Promise.resolve([]),
      ToolDocument.aggregate<{ _id: string; count: number }>([
        { $match: scope },
        { $group: { _id: "$tool", count: { $sum: 1 } } },
      ]),
      // A prévia do checklist mostra só as atividades de quem está logado.
      Task.find({ ownerId: req.user!._id, done: false }).lean(),
      Contact.find({ birthDate: { $regex: /^\d{4}-\d{2}-\d{2}$/ } }).select("name birthDate phone photo").lean(),
    ]);

    const sum = (filter: (entry: (typeof entries)[number]) => boolean) =>
      entries.filter(filter).reduce((total, entry) => total + entry.value, 0);
    const received = sum((e) => e.type === "income" && e.status === "received");
    const expenses = sum((e) => e.type === "expense" && e.status === "paid");
    const today = new Date().toISOString().slice(0, 10);
    const pendingTasks = tasks.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

    res.json({
      data: {
        leadsCount: leads.length,
        openPipeline: leads.filter((l) => l.status === "open").reduce((t, l) => t + l.value, 0),
        wonValue: leads.filter((l) => l.status === "won").reduce((t, l) => t + l.value, 0),
        leadsDueToday: leads.filter(
          (l) => l.status === "open" && l.nextActionDate && l.nextActionDate.toISOString().slice(0, 10) <= today,
        ).length,
        month,
        finance: canSeeFinance
          ? {
              monthReceived: received,
              monthExpenses: expenses,
              monthResult: received - expenses,
              monthPending: sum((e) => e.type === "income" && e.status === "pending"),
            }
          : null,
        documents: Object.fromEntries(documents.map((d) => [d._id, d.count])),
        // Aniversariantes da base nos próximos 15 dias (hoje primeiro).
        birthdays: upcomingBirthdays(
          people.map((person) => ({ ...person, name: person.name, birthDate: person.birthDate })),
          today,
          15,
        ).slice(0, 8),
        tasks: {
          pending: pendingTasks.length,
          overdue: pendingTasks.filter((task) => task.dueDate && task.dueDate < today).length,
          preview: pendingTasks.slice(0, 6),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
