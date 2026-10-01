import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Lead from "../models/Lead";
import Relation, { RELATION_KINDS, type IRelationEnd, type RelationKind } from "../models/Relation";

/* Relações entre registros (contato, empresa, negociação): sócio, cônjuge, indicou... */

interface Party {
  kind: RelationKind;
  id: string;
  name: string;
  image: string;
}

function parseEnd(value: unknown): { kind: RelationKind; id: string } | null {
  const end = (value || {}) as { kind?: unknown; id?: unknown };
  const kind = String(end.kind || "") as RelationKind;
  const id = String(end.id || "");
  return RELATION_KINDS.includes(kind) && isValidObjectId(id) ? { kind, id } : null;
}

/** Nome e imagem dos registros desta empresa (organização); o que não existe mais fica de fora. */
async function loadParties(ends: { kind: RelationKind; id: Types.ObjectId | string }[]) {
  const ids = (kind: RelationKind) => [...new Set(ends.filter((end) => end.kind === kind).map((end) => String(end.id)))];
  const [contacts, companies, leads] = await Promise.all([
    ids("contact").length ? Contact.find({ _id: { $in: ids("contact") } }).select("name photo").lean() : [],
    ids("company").length ? Company.find({ _id: { $in: ids("company") } }).select("name logo").lean() : [],
    ids("lead").length ? Lead.find({ _id: { $in: ids("lead") } }).select("name").lean() : [],
  ]);
  const parties = new Map<string, Party>();
  for (const item of contacts) parties.set(`contact:${item._id}`, { kind: "contact", id: String(item._id), name: item.name, image: item.photo || "" });
  for (const item of companies) parties.set(`company:${item._id}`, { kind: "company", id: String(item._id), name: item.name, image: item.logo || "" });
  for (const item of leads) parties.set(`lead:${item._id}`, { kind: "lead", id: String(item._id), name: item.name, image: "" });
  return parties;
}

const keyOf = (end: IRelationEnd | { kind: string; id: unknown }) => `${end.kind}:${end.id}`;

/** Relações de um registro, nas duas direções. GET /relations?kind=&id= */
export async function listRelations(req: Request, res: Response, next: NextFunction) {
  try {
    const self = parseEnd(req.query);
    if (!self) {
      res.status(400).json({ error: "Informe o registro (kind e id)." });
      return;
    }
    const relations = await Relation.find({
      $or: [
        { "from.kind": self.kind, "from.id": self.id },
        { "to.kind": self.kind, "to.id": self.id },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();
    const parties = await loadParties(relations.flatMap((relation) => [relation.from, relation.to]));
    const data = [];
    const orphans: Types.ObjectId[] = [];
    for (const relation of relations) {
      const outgoing = keyOf(relation.from) === keyOf(self);
      const other = parties.get(keyOf(outgoing ? relation.to : relation.from));
      // O outro registro foi excluído: a relação some junto.
      if (!other) {
        orphans.push(relation._id);
        continue;
      }
      data.push({ _id: relation._id, type: relation.type, note: relation.note, direction: outgoing ? "out" : "in", other, createdAt: relation.createdAt });
    }
    if (orphans.length) await Relation.deleteMany({ _id: { $in: orphans } });
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

/** POST /relations { from: { kind, id }, to: { kind, id }, type, note? } */
export async function createRelation(req: Request, res: Response, next: NextFunction) {
  try {
    const from = parseEnd(req.body?.from);
    const to = parseEnd(req.body?.to);
    const type = String(req.body?.type || "").trim();
    if (!from || !to || !type) {
      res.status(400).json({ error: "Informe os dois registros e o tipo da relação." });
      return;
    }
    if (keyOf(from) === keyOf(to)) {
      res.status(400).json({ error: "Escolha outro registro: não dá para relacionar um registro com ele mesmo." });
      return;
    }
    // Os dois lados precisam existir nesta empresa.
    const parties = await loadParties([from, to]);
    if (!parties.has(keyOf(from)) || !parties.has(keyOf(to))) {
      res.status(404).json({ error: "Registro não encontrado." });
      return;
    }
    const existing = await Relation.findOne({ "from.kind": from.kind, "from.id": from.id, "to.kind": to.kind, "to.id": to.id, type });
    if (existing) {
      res.status(409).json({ error: "Essa relação já está cadastrada." });
      return;
    }
    const doc = await Relation.create({ from, to, type, note: typeof req.body?.note === "string" ? req.body.note : "" });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteRelation(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Relation.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Relação não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
