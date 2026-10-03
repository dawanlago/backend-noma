import type { NextFunction, Request, Response } from "express";
import Notification from "../models/Notification";
import User from "../models/User";

/** GET /notifications — os últimos avisos de quem está logado e quantos não foram lidos. */
export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!._id;
    const [items, unread] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ userId, readAt: { $exists: false } }),
    ]);
    res.json({ data: { items, unread } });
  } catch (error) {
    next(error);
  }
}

/** POST /notifications/read { ids? } — marca como lidos (sem ids: todos). */
export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    await Notification.updateMany({ userId: req.user!._id, readAt: { $exists: false }, ...(ids ? { _id: { $in: ids } } : {}) }, { $set: { readAt: new Date() } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** GET/PATCH /notifications/prefs — quando lembrar dos compromissos e se manda por e-mail. */
export async function getPrefs(req: Request, res: Response) {
  res.json({ data: req.user!.notificationPrefs });
}

export async function updatePrefs(req: Request, res: Response, next: NextFunction) {
  try {
    const set: Record<string, unknown> = {};
    if (req.body?.reminderMinutes !== undefined) set["notificationPrefs.reminderMinutes"] = Math.min(10080, Math.max(0, Math.round(Number(req.body.reminderMinutes) || 0)));
    if (typeof req.body?.emailReminders === "boolean") set["notificationPrefs.emailReminders"] = req.body.emailReminders;
    if (typeof req.body?.dailyDigest === "boolean") set["notificationPrefs.dailyDigest"] = req.body.dailyDigest;
    const user = await User.findByIdAndUpdate(req.user!._id, { $set: set }, { new: true }).lean();
    res.json({ data: user?.notificationPrefs });
  } catch (error) {
    next(error);
  }
}
