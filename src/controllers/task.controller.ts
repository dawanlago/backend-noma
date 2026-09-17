import type { Request, Response, NextFunction } from "express";
import Contact from "../models/Contact";
import Deal from "../models/Deal";
import Task from "../models/Task";
import { env } from "../config/env";
import { notifyUser } from "../lib/notifications";
import { deleteAgendaEvent, syncTaskToGoogle } from "../lib/googleCalendar";
import type { TaskStatus } from "../types";

async function syncTaskCalendar(task: InstanceType<typeof Task>) {
  const deal = task.dealId ? await Deal.findById(task.dealId) : null;
  const contact = deal ? await Contact.findById(deal.contactId) : null;
  const dossieLink = deal
    ? `${env.frontendUrl}/funis/${deal.funnelId}/negociacao/${deal._id}`
    : env.frontendUrl;

  try {
    const eventId = await syncTaskToGoogle({
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      googleEventId: task.googleEventId,
      contactName: contact?.name || "Contato",
      contactEmail: contact?.email || "—",
      dealTitle: deal?.title || task.title,
      dossieLink,
    });

    if (eventId) {
      task.googleEventId = eventId;
      task.googleSyncedAt = new Date();
      await task.save();
    }
  } catch (error) {
    console.log("[calendar:sync-failed]", error instanceof Error ? error.message : error);
  }

  return task;
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const status: TaskStatus = req.body.status || (req.body.isCompleted ? "done" : "todo");
    const title = String(req.body.title || "").trim();
    if (!title) {
      res.status(400).json({ error: "Informe o título do compromisso." });
      return;
    }
    if (!req.body.dueDate) {
      res.status(400).json({ error: "Informe a data do compromisso." });
      return;
    }

    const task = await Task.create({
      title,
      description: req.body.description,
      dueDate: req.body.dueDate,
      dealId: req.body.dealId || undefined,
      status,
      isCompleted: status === "done",
      userId: req.user._id,
    });

    const deal = req.body.dealId
      ? await Deal.findByIdAndUpdate(req.body.dealId, { $addToSet: { taskIds: task._id } })
      : null;

    await syncTaskCalendar(task);

    if (deal?.ownerUserId && deal.ownerUserId.toString() !== req.user._id.toString()) {
      await notifyUser({
        userId: deal.ownerUserId.toString(),
        type: "task_created",
        title: "Novo compromisso na negociação",
        body: `Foi criado o compromisso "${task.title}" em ${deal.title}.`,
        dealId: deal._id.toString(),
        taskId: task._id.toString(),
      }).catch(() => undefined);
    }

    res.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function listTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.dealId) filter.dealId = req.query.dealId;
    if (req.query.status) filter.status = req.query.status;

    const data = await Task.find(filter).sort({ dueDate: -1, createdAt: -1 }).populate("dealId", "title funnelId");
    res.json({
      data: data.map((task) => {
        const json = task.toJSON() as unknown as Record<string, unknown>;
        const deal = json.dealId as { _id?: unknown; title?: string; funnelId?: unknown } | string | undefined;
        return {
          ...json,
          dealId: typeof deal === "object" && deal?._id ? String(deal._id) : deal,
          deal:
            typeof deal === "object"
              ? { title: deal.title || "Negociação", funnelId: deal.funnelId ? String(deal.funnelId) : "" }
              : undefined,
          status: task.status || (task.isCompleted ? "done" : "todo"),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Tarefa não encontrada." });
      return;
    }

    if (req.body.status) {
      task.status = req.body.status;
    }
    if (req.body.title !== undefined) task.title = req.body.title;
    if (req.body.description !== undefined) task.description = req.body.description;
    if (req.body.dueDate !== undefined) task.dueDate = new Date(req.body.dueDate);
    await task.save();
    await syncTaskCalendar(task);

    res.json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function updateTaskStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Tarefa não encontrada." });
      return;
    }

    const status = String(req.body.status || "") as TaskStatus;
    if (!["todo", "doing", "done"].includes(status)) {
      res.status(400).json({ error: "Status inválido." });
      return;
    }

    task.status = status;
    await task.save();
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function toggleTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Tarefa não encontrada." });
      return;
    }

    task.status = task.status === "done" ? "todo" : "done";
    await task.save();
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Tarefa não encontrada." });
      return;
    }

    if (task.googleEventId) {
      await deleteAgendaEvent(task.googleEventId).catch(() => undefined);
    }

    if (task.dealId) {
      await Deal.findByIdAndUpdate(task.dealId, { $pull: { taskIds: task._id } });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
