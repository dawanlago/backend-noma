import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Note from "../models/Note";
import NoteGroup from "../models/NoteGroup";

function canAccessNote(note: InstanceType<typeof Note>, userId: string) {
  return note.userId.toString() === userId || note.shares.some((share) => share.userId.toString() === userId);
}

function isOwner(note: InstanceType<typeof Note>, userId: string) {
  return note.userId.toString() === userId;
}

export async function listNoteGroups(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const groups = await NoteGroup.find({ userId: req.user._id }).sort({ order: 1, name: 1 });
    res.json({ data: groups });
  } catch (error) {
    next(error);
  }
}

export async function createNoteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const count = await NoteGroup.countDocuments({ userId: req.user._id });
    const group = await NoteGroup.create({
      userId: req.user._id,
      name: req.body.name || "Novo grupo",
      order: Number(req.body.order ?? count + 1),
    });

    res.status(201).json({ data: group });
  } catch (error) {
    next(error);
  }
}

export async function updateNoteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const group = await NoteGroup.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name: req.body.name, order: req.body.order },
      { new: true },
    );

    if (!group) {
      res.status(404).json({ error: "Grupo não encontrado." });
      return;
    }

    res.json({ data: group });
  } catch (error) {
    next(error);
  }
}

export async function deleteNoteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const group = await NoteGroup.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!group) {
      res.status(404).json({ error: "Grupo não encontrado." });
      return;
    }

    await Note.updateMany({ userId: req.user._id, groupId: group._id }, { $unset: { groupId: 1 } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listNotes(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const userId = req.user._id;
    const notes = await Note.find({
      $or: [{ userId }, { "shares.userId": userId }],
    })
      .sort({ updatedAt: -1 })
      .populate("shares.userId", "name email");

    res.json({ data: notes });
  } catch (error) {
    next(error);
  }
}

export async function createNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.create({
      userId: req.user._id,
      groupId: req.body.groupId || undefined,
      title: req.body.title || "Sem título",
      content: req.body.content || "",
    });

    res.status(201).json({ data: note });
  } catch (error) {
    next(error);
  }
}

export async function getNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.findById(req.params.id).populate("shares.userId", "name email");
    if (!note || !canAccessNote(note, req.user._id.toString())) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }

    res.json({ data: note });
  } catch (error) {
    next(error);
  }
}

export async function updateNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.findById(req.params.id);
    if (!note || !canAccessNote(note, req.user._id.toString())) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }

    if (!isOwner(note, req.user._id.toString())) {
      res.status(403).json({ error: "Somente o proprietário pode editar esta anotação." });
      return;
    }

    if (req.body.title !== undefined) note.title = req.body.title;
    if (req.body.content !== undefined) note.content = req.body.content;
    if (req.body.groupId !== undefined) {
      note.groupId = req.body.groupId ? new mongoose.Types.ObjectId(String(req.body.groupId)) : undefined;
    }
    await note.save();

    res.json({ data: note });
  } catch (error) {
    next(error);
  }
}

export async function deleteNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.findById(req.params.id);
    if (!note || !isOwner(note, req.user._id.toString())) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }

    await note.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function shareNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.findById(req.params.id);
    if (!note || !isOwner(note, req.user._id.toString())) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }

    const userId = String(req.body.userId || "");
    if (!userId || userId === req.user._id.toString()) {
      res.status(400).json({ error: "Informe um usuário válido para compartilhar." });
      return;
    }

    const permission = req.body.permission === "edit" ? "edit" : "view";
    note.shares = note.shares.filter((share) => share.userId.toString() !== userId);
    note.shares.push({ userId: new mongoose.Types.ObjectId(userId), permission });
    await note.save();

    res.json({ data: await note.populate("shares.userId", "name email") });
  } catch (error) {
    next(error);
  }
}

export async function unshareNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const note = await Note.findById(req.params.id);
    if (!note || !isOwner(note, req.user._id.toString())) {
      res.status(404).json({ error: "Anotação não encontrada." });
      return;
    }

    note.shares = note.shares.filter((share) => share.userId.toString() !== req.params.userId);
    await note.save();
    res.json({ data: note });
  } catch (error) {
    next(error);
  }
}
