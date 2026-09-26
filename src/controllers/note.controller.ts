import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Note from "../models/Note";
import NoteGroup from "../models/NoteGroup";
import User from "../models/User";

/* Anotações livres: cada usuário tem as suas; compartilhar dá acesso só de leitura. */

async function withNames<T extends { ownerId: unknown; shares?: { userId: unknown }[] }>(notes: T[]) {
  const ids = [...new Set(notes.flatMap((note) => [String(note.ownerId), ...(note.shares || []).map((share) => String(share.userId))]))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return notes.map((note) => ({
    ...note,
    ownerName: names.get(String(note.ownerId)) || "",
    shares: (note.shares || []).map((share) => ({ userId: String(share.userId), name: names.get(String(share.userId)) || "" })),
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

export async function updateNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    if (typeof req.body.title === "string") doc.title = req.body.title.trim() || "Sem título";
    if (typeof req.body.content === "string") doc.content = req.body.content;
    await doc.save();
    const [data] = await withNames([doc.toJSON()]);
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

export async function shareNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) return notFound(res);
    const userId = String(req.body.userId || "");
    if (!isValidObjectId(userId) || userId === String(req.user!._id) || !(await User.exists({ _id: userId }))) {
      res.status(400).json({ error: "Escolha um usuário válido." });
      return;
    }
    if (!doc.shares.some((share) => String(share.userId) === userId)) doc.shares.push({ userId: userId as never });
    await doc.save();
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
