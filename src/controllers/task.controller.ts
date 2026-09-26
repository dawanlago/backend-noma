import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Lead from "../models/Lead";
import Task, { type ITask } from "../models/Task";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";
import { removeEvent, syncTask } from "../lib/googleCalendar";

function applyBody(task: ITask, body: Record<string, unknown>) {
  if (typeof body.title === "string") task.title = body.title.trim();
  if (typeof body.notes === "string") task.notes = body.notes;
  if (typeof body.dueDate === "string") task.dueDate = body.dueDate.slice(0, 10);
  if (typeof body.time === "string") task.time = body.time.slice(0, 5);
  if (body.duration !== undefined) task.duration = Math.min(1440, Math.max(5, Math.round(Number(body.duration) || 60)));
  if (typeof body.status === "string" && ["todo", "doing", "done"].includes(body.status)) {
    task.status = body.status as ITask["status"];
  } else if (typeof body.done === "boolean") {
    task.done = body.done;
  }
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

/** GET /tasks?leadId=&status=pending|done&from=YYYY-MM-DD&to=YYYY-MM-DD */
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
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) filter.dueDate = { $gte: from, $lte: to };
    const docs = await Task.find(filter).sort({ done: 1, dueDate: 1, createdAt: 1 }).lean();
    // Sem data vai para o fim da lista de pendentes.
    docs.sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        `${a.dueDate || "9999"} ${a.time || "99:99"}`.localeCompare(`${b.dueDate || "9999"} ${b.time || "99:99"}`),
    );
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
    await syncTask(task);
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
    await syncTask(task);
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
    if (task.googleEventId) await removeEvent(String(task.ownerId), task.googleEventId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
