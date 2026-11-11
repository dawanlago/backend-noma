import type { NextFunction, Request, Response } from "express";
import Notification from "../models/Notification";
import User from "../models/User";
import { acrossOrgs } from "../lib/tenant";

/** Empresas que a pessoa acessa: os avisos são dela, mas vêm de todas essas empresas. */
function orgIdsOf(req: Request) {
  return (req.access?.orgs || []).map((org) => org._id);
}

/**
 * GET /notifications — os últimos avisos de quem está logado e quantos não foram lidos,
 * de todas as empresas que a pessoa acessa (ex.: reunião marcada pelo link de outra empresa).
 * Cada aviso traz `orgName` para o sino mostrar de qual empresa ele é.
 */
export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!._id;
    const filter = { userId, orgId: { $in: orgIdsOf(req) } };
    const [items, unread] = await acrossOrgs(() =>
      Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean().exec(),
        Notification.countDocuments({ ...filter, readAt: { $exists: false } }).exec(),
      ]),
    );
    const names = new Map((req.access?.orgs || []).map((org) => [org._id, org.name]));
    res.json({ data: { items: items.map((item) => ({ ...item, orgName: names.get(String((item as { orgId?: unknown }).orgId)) || "" })), unread } });
  } catch (error) {
    next(error);
  }
}

/** POST /notifications/read { ids? } — marca como lidos (sem ids: todos). */
export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    await acrossOrgs(() =>
      Notification.updateMany(
        { userId: req.user!._id, orgId: { $in: orgIdsOf(req) }, readAt: { $exists: false }, ...(ids ? { _id: { $in: ids } } : {}) },
        { $set: { readAt: new Date() } },
      ).exec(),
    );
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
