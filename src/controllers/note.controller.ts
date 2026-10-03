import type { NextFunction, Request, Response } from "express";
import { notify } from "../lib/notifications";
import { isValidObjectId } from "mongoose";
import Note from "../models/Note";
import NoteGroup from "../models/NoteGroup";
import User from "../models/User";

/*
 * Anotações livres: cada usuário tem as suas e pode compartilhar com quem é da empresa,
 * para visualizar ou editar. Excluir, mover de grupo e gerenciar o compartilhamento: só o dono.
 */

type ShareLike = { userId: unknown; permission?: string };

const permissionOf = (value: unknown) => (value === "edit" ? "edit" : "view");

async function withNames<T extends { ownerId: unknown; shares?: ShareLike[] }>(notes: T[]) {
  const ids = [...new Set(notes.flatMap((note) => [String(note.ownerId), ...(note.shares || []).map((share) => String(share.userId))]))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return notes.map((note) => ({
    ...note,
    ownerName: names.get(String(note.ownerId)) || "",
    shares: (note.shares || []).map((share) => ({
      userId: String(share.userId),
      name: names.get(String(share.userId)) || "",
      // Compartilhamentos de antes da permissão eram só leitura.
      permission: permissionOf(share.permission),
    })),
  }));
}

function notFound(res: Response, what = "Anotação") {
  res.status(404).json({ error: `${what} não encontrada.` });
}

export async function listGroups(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await NoteGroup.find({ ownerId: req.user!._id }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function createGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Informe o nome do grupo." });
      return;
    }
    const last = await NoteGroup.findOne({ ownerId: req.user!._id }).sort({ order: -1 }).lean();
    const doc = await NoteGroup.create({ ownerId: req.user!._id, name, order: (last?.order ?? -1) + 1 });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NoteGroup.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res, "Grupo");
    if (typeof req.body.name === "string" && req.body.name.trim()) doc.name = req.body.name.trim();
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

/** Excluir um grupo não apaga as anotações: elas passam para "sem grupo". */
export async function deleteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NoteGroup.findOneAndDelete({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res, "Grupo");
    await Note.updateMany({ ownerId: req.user!._id, groupId: doc._id }, { $unset: { groupId: 1 } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** Minhas anotações e as compartilhadas comigo. */
export async function listNotes(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!._id;
    const notes = await Note.find({ $or: [{ ownerId: userId }, { "shares.userId": userId }] })
      .sort({ order: 1, updatedAt: -1 })
      .lean();
    res.json({ data: await withNames(notes) });
  } catch (error) {
    next(error);
  }
}

async function ownedGroupId(req: Request, value: unknown) {
  if (!value || !isValidObjectId(value)) return undefined;
  const group = await NoteGroup.exists({ _id: value, ownerId: req.user!._id });
  return group ? group._id : undefined;
}

export async function createNote(req: Request, res: Response, next: NextFunction) {
  try {
    const groupId = await ownedGroupId(req, req.body.groupId);
    const doc = await Note.create({
      ownerId: req.user!._id,
      groupId,
      title: String(req.body.title || "Nova anotação").trim() || "Nova anotação",
      content: String(req.body.content || ""),
      order: -Date.now(),
    });
    const [data] = await withNames([doc.toJSON()]);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
}

/** Filtro de quem enxerga a anotação: o dono ou alguém com quem ela foi compartilhada. */
function visibleTo(req: Request) {
  const userId = req.user!._id;
  return { $or: [{ ownerId: userId }, { "shares.userId": userId }] };
}

/**
 * PATCH /notes/:id { title?, content?, rev? } — dono ou compartilhada com "edit".
 * Com `rev` (a revisão que o editor abriu), recusa com 409 se outra pessoa salvou antes.
 */
export async function updateNote(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = String(req.user!._id);
    const doc = await Note.findOne({ _id: req.params.id, ...visibleTo(req) }).lean();
    if (!doc) return notFound(res);
    const isOwner = String(doc.ownerId) === userId;
    const share = doc.shares.find((item) => String(item.userId) === userId);
    if (!isOwner && permissionOf(share?.permission) !== "edit") {
      res.status(403).json({ error: "Você só pode visualizar esta anotação." });
      return;
    }
    const set: Record<string, string> = {};
    if (typeof req.body.title === "string") set.title = req.body.title.trim() || "Sem título";
    if (typeof req.body.content === "string") set.content = req.body.content;
    if (!Object.keys(set).length) {
      const [data] = await withNames([doc]);
      res.json({ data });
      return;
    }
    const filter: Record<string, unknown> = { _id: doc._id };
    if (req.body.rev !== undefined) {
      const rev = Number(req.body.rev);
      // Anotações antigas não têm `rev`: valem como revisão 0.
      filter.rev = rev > 0 ? rev : { $in: [0, null] };
    }
    const saved = await Note.findOneAndUpdate(filter, { $set: set, $inc: { rev: 1 } }, { returnDocument: "after" }).lean();
    if (!saved) {
      const current = await Note.findById(doc._id).lean();
      const [data] = current ? await withNames([current]) : [null];
      res.status(409).json({ error: "Esta nota foi alterada por outra pessoa — recarregue.", data });
      return;
    }
    const [data] = await withNames([saved]);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function deleteNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOneAndDelete({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** PUT /notes/:id/group { groupId } — arrastar para outro grupo (vazio = sem grupo). */
export async function moveNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    const groupId = await ownedGroupId(req, req.body.groupId);
    if (req.body.groupId && !groupId) return notFound(res, "Grupo");
    doc.groupId = groupId;
    doc.order = -Date.now();
    await doc.save();
    const [data] = await withNames([doc.toJSON()]);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

/** POST /notes/:id/share { userId, permission } — adiciona ou troca a permissão de alguém da empresa. */
export async function shareNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    const userId = String(req.body.userId || "");
    const orgId = req.access!.org._id;
    const valid =
      isValidObjectId(userId) &&
      userId !== String(req.user!._id) &&
      (await User.exists({ _id: userId, $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] }));
    if (!valid) {
      res.status(400).json({ error: "Escolha um usuário válido." });
      return;
    }
    const permission = permissionOf(req.body.permission);
    const share = doc.shares.find((item) => String(item.userId) === userId);
    if (share) share.permission = permission;
    else doc.shares.push({ userId: userId as never, permission });
    doc.markModified("shares");
    await doc.save();
    // Avisa só quando a pessoa ganha acesso (não a cada troca de permissão).
    if (!share) {
      await notify([userId], {
        type: "note_shared",
        title: `${req.user!.name} compartilhou uma anotação com você`,
        body: `"${doc.title || "Sem título"}" · ${permission === "edit" ? "você pode editar" : "somente leitura"}`,
        link: "/anotacoes",
      });
    }
    const [data] = await withNames([doc.toJSON()]);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function unshareNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    doc.shares = doc.shares.filter((share) => String(share.userId) !== req.params.userId);
    await doc.save();
    const [data] = await withNames([doc.toJSON()]);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}
