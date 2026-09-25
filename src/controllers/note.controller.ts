import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Note from "../models/Note";
import NoteGroup from "../models/NoteGroup";

/* Anotações são pessoais: cada usuário vê só o próprio quadro. */

const DEFAULT_GROUPS = ["A fazer", "Em andamento", "Concluído"];

export async function getBoard(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = req.user!._id;
    let groups = await NoteGroup.find({ ownerId }).sort({ order: 1, createdAt: 1 }).lean();
    if (!groups.length) {
      await NoteGroup.insertMany(DEFAULT_GROUPS.map((name, order) => ({ ownerId, name, order })));
      groups = await NoteGroup.find({ ownerId }).sort({ order: 1 }).lean();
    }
    const notes = await Note.find({ ownerId }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ data: { groups, notes } });
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
    const doc = await NoteGroup.create({
      ownerId: req.user!._id,
      name,
      color: typeof req.body.color === "string" ? req.body.color : "",
      order: (last?.order ?? -1) + 1,
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NoteGroup.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) {
      res.status(404).json({ error: "Grupo não encontrado." });
      return;
    }
    if (typeof req.body.name === "string" && req.body.name.trim()) doc.name = req.body.name.trim();
    if (typeof req.body.color === "string") doc.color = req.body.color;
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NoteGroup.findOneAndDelete({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) {
      res.status(404).json({ error: "Grupo não encontrado." });
      return;
    }
    await Note.deleteMany({ groupId: doc._id, ownerId: req.user!._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** PUT /note-groups/reorder { ids } */
export async function reorderGroups(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((id: unknown) => isValidObjectId(id)) : [];
    await NoteGroup.bulkWrite(
      ids.map((id: string, order: number) => ({
        updateOne: { filter: { _id: id, ownerId: req.user!._id }, update: { $set: { order } } },
      })),
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function createNote(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await NoteGroup.findOne({ _id: req.body.groupId, ownerId: req.user!._id }).lean();
    if (!group) {
      res.status(400).json({ error: "Escolha um grupo válido." });
      return;
    }
    const last = await Note.findOne({ groupId: group._id }).sort({ order: -1 }).lean();
    const doc = await Note.create({
      ownerId: req.user!._id,
      groupId: group._id,
      title: String(req.body.title || "").trim(),
      content: String(req.body.content || ""),
      color: typeof req.body.color === "string" ? req.body.color : "",
      order: (last?.order ?? -1) + 1,
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }
    if (typeof req.body.title === "string") doc.title = req.body.title.trim();
    if (typeof req.body.content === "string") doc.content = req.body.content;
    if (typeof req.body.color === "string") doc.color = req.body.color;
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteNote(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Note.findOneAndDelete({ _id: req.params.id, ownerId: req.user!._id });
    if (!doc) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** PUT /notes/move { noteId, groupId, orderedIds } — orderedIds é a ordem final do grupo de destino. */
export async function moveNote(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = req.user!._id;
    const group = await NoteGroup.findOne({ _id: req.body.groupId, ownerId }).lean();
    const note = await Note.findOne({ _id: req.body.noteId, ownerId });
    if (!group || !note) {
      res.status(404).json({ error: "Anotação ou grupo não encontrado." });
      return;
    }
    note.groupId = group._id;
    await note.save();
    const ids: string[] = Array.isArray(req.body.orderedIds)
      ? req.body.orderedIds.filter((id: unknown) => isValidObjectId(id))
      : [String(note._id)];
    await Note.bulkWrite(
      ids.map((id, order) => ({
        updateOne: { filter: { _id: id, ownerId, groupId: group._id }, update: { $set: { order } } },
      })),
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
