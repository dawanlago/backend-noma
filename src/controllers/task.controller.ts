import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Lead from "../models/Lead";
import Task, { type ITask } from "../models/Task";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";

function applyBody(task: ITask, body: Record<string, unknown>) {
  if (typeof body.title === "string") task.title = body.title.trim();
  if (typeof body.notes === "string") task.notes = body.notes;
  if (typeof body.dueDate === "string") task.dueDate = body.dueDate.slice(0, 10);
  if (typeof body.done === "boolean") task.done = body.done;
  if (body.leadId !== undefined) {
    task.leadId = typeof body.leadId === "string" && isValidObjectId(body.leadId) ? (body.leadId as never) : undefined;
  }
}

/** Anexa o nome da negociação para mostrar no checklist. */
async function withLeadNames<T extends { leadId?: unknown }>(tasks: T[]) {
  const ids = [...new Set(tasks.map((task) => String(task.leadId || "")).filter(Boolean))];
  const leads = ids.length ? await Lead.find({ _id: { $in: ids } }).select("name").lean() : [];
  const names = new Map(leads.map((lead) => [String(lead._id), lead.name]));
  return tasks.map((task) => ({ ...task, leadName: task.leadId ? names.get(String(task.leadId)) || "" : "" }));
}

/** GET /tasks?leadId=&status=pending|done */
export async function listTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = { ...ownerScope(req) };
    if (typeof req.query.leadId === "string" && isValidObjectId(req.query.leadId)) {
      // No painel da negociação, mostra as atividades dela de qualquer pessoa com acesso.
      delete filter.ownerId;
      filter.leadId = req.query.leadId;
      const lead = await Lead.exists({ _id: req.query.leadId, ...recordScope(req) });
      if (!lead) {
        res.json({ data: [] });
        return;
      }
    }
    if (req.query.status === "pending") filter.done = false;
    if (req.query.status === "done") filter.done = true;
    const docs = await Task.find(filter).sort({ done: 1, dueDate: 1, createdAt: 1 }).lean();
    // Sem data vai para o fim da lista de pendentes.
    docs.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    res.json({ data: await withOwnerNames(await withLeadNames(docs)) });
  } catch (error) {
    next(error);
  }
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = new Task({ ownerId: req.user!._id });
    applyBody(task, req.body);
    await task.save();
    const [data] = await withLeadNames([task.toJSON()]);
    res.status(201).json({ data: { ...data, ownerName: req.user!.name } });
  } catch (error) {
    next(error);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!task) {
      res.status(404).json({ error: "Atividade não encontrada." });
      return;
    }
    applyBody(task, req.body);
    await task.save();
    const [data] = await withLeadNames([task.toJSON()]);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!task) {
      res.status(404).json({ error: "Atividade não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
