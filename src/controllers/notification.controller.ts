import type { Request, Response, NextFunction } from "express";
import Notification from "../models/Notification";

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const query: Record<string, unknown> = { userId: req.user._id };
    if (req.user.role !== "admin") {
      query.type = { $ne: "finance_reverted" };
    }

    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({
      ...query,
      readAt: { $exists: false },
    });

    res.json({ data: notifications, meta: { unreadCount } });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const notification = await Notification.findOne({ _id: req.params.id, userId: req.user._id });
    if (!notification) {
      res.status(404).json({ error: "Notificação não encontrada." });
      return;
    }

    notification.readAt = new Date();
    await notification.save();
    res.json({ data: notification });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    await Notification.updateMany(
      { userId: req.user._id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );

    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}
