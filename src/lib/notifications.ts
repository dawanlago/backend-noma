import type { Types } from "mongoose";
import Notification from "../models/Notification";
import User from "../models/User";
import { emailConfigured, sendMail } from "./email";
import { currentOrgId } from "./tenant";

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Também manda por e-mail (respeita quem não tem e-mail). */
  email?: boolean;
}

/**
 * Cria avisos para os usuários (na empresa atual). Nunca derruba a ação que gerou o aviso:
 * qualquer falha só é registrada no log.
 */
export async function notify(userIds: (Types.ObjectId | string | undefined | null)[], input: NotifyInput) {
  try {
    if (!currentOrgId()) return;
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    await Notification.insertMany(ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body || "", link: input.link || "" })));
    if (input.email && emailConfigured()) {
      const users = await User.find({ _id: { $in: ids }, isActive: true }).select("email").lean();
      const base = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
      await Promise.allSettled(
        users
          .filter((user) => user.email)
          .map((user) =>
            sendMail({
              to: user.email,
              subject: input.title,
              text: [input.body, input.link && base ? `${base}${input.link}` : ""].filter(Boolean).join("\n\n"),
            }),
          ),
      );
    }
  } catch (error) {
    console.error("[avisos]", error instanceof Error ? error.message : error);
  }
}

/** Administradores da empresa atual (para avisos gerais, ex.: formulário respondido sem responsável). */
export async function orgAdmins(): Promise<string[]> {
  const orgId = currentOrgId();
  if (!orgId) return [];
  const users = await User.find({ isActive: true, $or: [{ isSuperAdmin: true }, { memberships: { $elemMatch: { orgId, role: "admin" } } }] })
    .select("_id")
    .lean();
  return users.map((user) => String(user._id));
}
