import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import Company, { type ICompany } from "../models/Company";
import Contact, { type IContact } from "../models/Contact";
import FinanceEntry from "../models/FinanceEntry";
import FormInvite from "../models/FormInvite";
import FormResponse from "../models/FormResponse";
import Lead from "../models/Lead";
import NPSInvite from "../models/NPSInvite";
import NPSRating from "../models/NPSRating";
import Relation from "../models/Relation";
import StoredFile from "../models/StoredFile";
import Task from "../models/Task";
import { recordScope, withOwnerNames } from "../lib/ownership";
import { phoneKey } from "../lib/phone";

/* Base de dados: contatos (pessoas) e empresas, com perfil e históricos. */

const CONTACT_TEXT = [
  "name",
  "fullName",
  "nickname",
  "email",
  "phone",
  "cpf",
  "birthDate",
  "photo",
  "niche",
  "jobRole",
  "instagram",
  "location",
  "leadSource",
  "supplierCategory",
  "pixKey",
  "notes",
] as const;
const COMPANY_TEXT = ["name", "taxId", "logo", "niche", "email", "phone", "instagram", "website", "supplierCategory", "pixKey", "notes"] as const;

function stringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : [];
}

function applyCommon(doc: IContact | ICompany, body: Record<string, unknown>) {
  if (body.affinity !== undefined) doc.affinity = Math.min(5, Math.max(0, Math.round(Number(body.affinity) || 0)));
  if (body.kinds !== undefined) doc.kinds = stringList(body.kinds);
  if (body.custom && typeof body.custom === "object") {
    doc.custom = body.custom as Record<string, unknown>;
    doc.markModified("custom");
  }
}

/** Só empresas que existem nesta empresa (organização), na ordem recebida. */
async function existingCompanyIds(ids: string[]) {
  const valid = [...new Set(ids.filter((id) => isValidObjectId(id)))];
  if (!valid.length) return [];
  const found = new Set((await Company.find({ _id: { $in: valid } }).select("_id").lean()).map((company) => String(company._id)));
  return valid.filter((id) => found.has(id));
}

async function applyContact(doc: IContact, body: Record<string, unknown>) {
  for (const key of CONTACT_TEXT) if (typeof body[key] === "string") doc[key] = body[key] as string;
  const current = (doc.companyIds || []).map(String);
  if (Array.isArray(body.companyIds)) {
    // A primeira da lista é a empresa principal.
    doc.companyIds = (await existingCompanyIds(body.companyIds.map(String))) as never;
  } else if (body.companyId !== undefined) {
    // Quem ainda envia uma empresa só (extensão, atalhos): troca a principal e mantém as demais.
    const [primary] = await existingCompanyIds([String(body.companyId || "")]);
    doc.companyIds = (primary ? [primary, ...current.filter((id) => id !== primary)] : current.slice(1)) as never;
  }
  applyCommon(doc, body);
}

type DuplicateField = "phone" | "email";

/** Outro contato da mesma empresa (organização) com o mesmo telefone ou e-mail. */
async function findDuplicate(doc: IContact, fields: DuplicateField[]) {
  const key = phoneKey(doc.phone);
  const email = String(doc.email || "").trim().toLowerCase();
  const or: Record<string, unknown>[] = [];
  if (fields.includes("phone") && key) or.push({ phoneKey: key });
  if (fields.includes("email") && email) or.push({ email });
  if (!or.length) return null;
  const found = await Contact.findOne({ _id: { $ne: doc._id }, $or: or }).select("name phone email phoneKey").lean();
  if (!found) return null;
  const field: DuplicateField = key && found.phoneKey === key ? "phone" : "email";
  return { field, duplicate: { _id: found._id, name: found.name, phone: found.phone, email: found.email } };
}

/** Responde 409 se houver duplicado (a não ser que venha `allowDuplicate: true`). Devolve true se respondeu. */
async function rejectDuplicate(req: Request, res: Response, doc: IContact, fields: DuplicateField[]) {
  if (req.body?.allowDuplicate === true || !fields.length) return false;
  const match = await findDuplicate(doc, fields);
  if (!match) return false;
  res.status(409).json({
    error: `Já existe um contato com este ${match.field === "phone" ? "telefone" : "e-mail"}: ${match.duplicate.name}`,
    field: match.field,
    duplicate: match.duplicate,
  });
  return true;
}

function applyCompany(doc: ICompany, body: Record<string, unknown>) {
  for (const key of COMPANY_TEXT) if (typeof body[key] === "string") doc[key] = body[key] as string;
  if (typeof body.isActive === "boolean") doc.isActive = body.isActive;
  applyCommon(doc, body);
}

function kindFilter(req: Request) {
  return typeof req.query.kind === "string" && req.query.kind ? { kinds: req.query.kind } : {};
}

/** Mantém o nome copiado nas negociações quando o contato/empresa é renomeado. */
async function syncLeadNames(kind: "contact" | "company", id: Types.ObjectId, name: string) {
  if (kind === "contact") await Lead.updateMany({ contactId: id }, { $set: { contactName: name } });
  else await Lead.updateMany({ companyId: id }, { $set: { company: name } });
}

/* --------------------------------- Contatos -------------------------------- */

export async function listContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = kindFilter(req);
    if (typeof req.query.companyId === "string" && isValidObjectId(req.query.companyId)) filter.companyIds = req.query.companyId;
    const data = await Contact.find(filter).sort({ name: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

/** Contatos com o mesmo telefone (usado pela extensão do WhatsApp). GET /contacts/by-phone?phone= */
export async function findContactsByPhone(req: Request, res: Response, next: NextFunction) {
  try {
    const key = phoneKey(String(req.query.phone || ""));
    if (!key) {
      res.json({ data: [] });
      return;
    }
    res.json({ data: await Contact.find({ phoneKey: key }).sort({ createdAt: 1 }).lean() });
  } catch (error) {
    next(error);
  }
}

export async function getContact(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Contact.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }
    res.json({ data: doc });
  } catch (error) {
    next(error);
  }
}

export async function createContact(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = new Contact();
    await applyContact(doc, req.body);
    if (await rejectDuplicate(req, res, doc, ["phone", "email"])) return;
    await doc.save();
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateContact(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Contact.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }
    await applyContact(doc, req.body);
    // Só confere o que mudou: editar outro campo de um contato já duplicado não trava.
    const changed = (["phone", "email"] as const).filter((field) => doc.isModified(field));
    if (await rejectDuplicate(req, res, doc, changed)) return;
    const renamed = doc.isModified("name");
    await doc.save();
    if (renamed) await syncLeadNames("contact", doc._id, doc.name);
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteContact(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Contact.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }
    await Relation.deleteMany({ $or: [{ "from.kind": "contact", "from.id": doc._id }, { "to.kind": "contact", "to.id": doc._id }] });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* -------------------------------- Duplicados ------------------------------- */

/** Grupos de contatos com o mesmo telefone ou e-mail. GET /contacts/duplicates */
export async function listDuplicateContacts(_req: Request, res: Response, next: NextFunction) {
  try {
    const contacts = await Contact.find({ $or: [{ phoneKey: { $ne: "" } }, { email: { $ne: "" } }] })
      .select("name fullName phone email phoneKey companyId kinds createdAt")
      .sort({ createdAt: 1 })
      .lean();
    // Junta em um mesmo grupo quem divide telefone OU e-mail (A=B pelo telefone, B=C pelo e-mail → A, B e C).
    const parent = new Map<string, string>();
    const root = (id: string): string => {
      const up = parent.get(id) || id;
      if (up === id) return id;
      const top = root(up);
      parent.set(id, top);
      return top;
    };
    const seen = new Map<string, string>();
    const reasons = new Map<string, Set<DuplicateField>>();
    for (const contact of contacts) {
      const id = String(contact._id);
      const keys: [DuplicateField, string][] = [];
      if (contact.phoneKey) keys.push(["phone", contact.phoneKey]);
      if (contact.email) keys.push(["email", contact.email]);
      for (const [field, value] of keys) {
        const first = seen.get(`${field}:${value}`);
        if (!first) {
          seen.set(`${field}:${value}`, id);
          continue;
        }
        const top = root(first);
        const merged = new Set([...(reasons.get(top) || []), ...(reasons.get(root(id)) || []), field]);
        parent.set(root(id), top);
        reasons.set(top, merged);
      }
    }
    const groups = new Map<string, typeof contacts>();
    for (const contact of contacts) {
      const top = root(String(contact._id));
      groups.set(top, [...(groups.get(top) || []), contact]);
    }
    const duplicated = [...groups.entries()].filter(([, list]) => list.length > 1);
    const ids = duplicated.flatMap(([, list]) => list.map((contact) => contact._id));
    const counts = ids.length
      ? await Lead.aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { contactId: { $in: ids } } },
          { $group: { _id: "$contactId", count: { $sum: 1 } } },
        ])
      : [];
    const leadsOf = new Map(counts.map((row) => [String(row._id), row.count]));
    res.json({
      data: duplicated.map(([top, list]) => ({
        key: top,
        fields: [...(reasons.get(top) || [])],
        contacts: list.map(({ phoneKey: _key, ...contact }) => ({ ...contact, leadsCount: leadsOf.get(String(contact._id)) || 0 })),
      })),
    });
  } catch (error) {
    next(error);
  }
}

const MERGE_TEXT = CONTACT_TEXT.filter((key) => key !== "name" && key !== "notes");

/**
 * Mescla o contato `fromId` neste: negociações, financeiro, arquivos, NPS, formulários e relações
 * passam para este; os campos vazios daqui são preenchidos com os de lá; o outro é excluído.
 * POST /contacts/:id/merge { fromId }
 */
export async function mergeContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const fromId = String(req.body?.fromId || "");
    if (!isValidObjectId(fromId) || fromId === String(req.params.id)) {
      res.status(400).json({ error: "Escolha outro contato para mesclar." });
      return;
    }
    const [target, source] = await Promise.all([Contact.findById(req.params.id), Contact.findById(fromId)]);
    if (!target || !source) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }

    for (const key of MERGE_TEXT) if (!target[key] && source[key]) target[key] = source[key];
    if (source.notes && source.notes !== target.notes) target.notes = [target.notes, source.notes].filter(Boolean).join("\n\n");
    target.kinds = [...new Set([...target.kinds, ...source.kinds])];
    target.affinity = Math.max(target.affinity || 0, source.affinity || 0);
    target.companyIds = [...new Set([...target.companyIds, ...source.companyIds].map(String))] as never;
    target.custom = { ...(source.custom || {}), ...Object.fromEntries(Object.entries(target.custom || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined)) };
    target.markModified("custom");
    await target.save();

    const moved = { contactId: source._id };
    await Promise.all([
      Lead.updateMany(moved, { $set: { contactId: target._id, contactName: target.name } }, { timestamps: false }),
      FinanceEntry.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      StoredFile.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      NPSRating.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      NPSInvite.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      FormResponse.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      FormInvite.updateMany(moved, { $set: { contactId: target._id } }, { timestamps: false }),
      Relation.updateMany({ "from.kind": "contact", "from.id": source._id }, { $set: { "from.id": target._id } }),
      Relation.updateMany({ "to.kind": "contact", "to.id": source._id }, { $set: { "to.id": target._id } }),
    ]);
    // Uma relação entre os dois viraria uma relação do contato com ele mesmo.
    await Relation.deleteMany({ "from.kind": "contact", "from.id": target._id, "to.kind": "contact", "to.id": target._id });
    await Contact.deleteOne({ _id: source._id });

    res.json({ data: target.toJSON() });
  } catch (error) {
    next(error);
  }
}

/* --------------------------------- Empresas -------------------------------- */

export async function listCompanies(req: Request, res: Response, next: NextFunction) {
  try {
    const companies = await Company.find(kindFilter(req)).sort({ name: 1 }).lean();
    const counts = await Contact.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $unwind: "$companyIds" },
      { $group: { _id: "$companyIds", count: { $sum: 1 } } },
    ]);
    const byCompany = new Map(counts.map((row) => [String(row._id), row.count]));
    res.json({ data: companies.map((company) => ({ ...company, contactsCount: byCompany.get(String(company._id)) || 0 })) });
  } catch (error) {
    next(error);
  }
}

export async function getCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Company.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ error: "Empresa não encontrada." });
      return;
    }
    res.json({ data: doc });
  } catch (error) {
    next(error);
  }
}

export async function createCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = new Company();
    applyCompany(doc, req.body);
    await doc.save();
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Company.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Empresa não encontrada." });
      return;
    }
    applyCompany(doc, req.body);
    const renamed = doc.isModified("name");
    await doc.save();
    if (renamed) await syncLeadNames("company", doc._id, doc.name);
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Company.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Empresa não encontrada." });
      return;
    }
    // Tira a empresa dos contatos; ao salvar, a principal passa a ser a próxima da lista.
    const linked = await Contact.find({ $or: [{ companyIds: doc._id }, { companyId: doc._id }] });
    for (const contact of linked) {
      contact.companyIds = contact.companyIds.filter((id) => String(id) !== String(doc._id)) as never;
      await contact.save();
    }
    await Relation.deleteMany({ $or: [{ "from.kind": "company", "from.id": doc._id }, { "to.kind": "company", "to.id": doc._id }] });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* ---------------------------------- Perfis --------------------------------- */

async function history(req: Request, leadFilter: Record<string, unknown>, entryFilter: Record<string, unknown>, fileFilter: Record<string, unknown>) {
  const scope = recordScope(req);
  const [leads, entries, files, nps] = await Promise.all([
    Lead.find({ ...leadFilter, ...scope }).select("-history").sort({ updatedAt: -1 }).lean(),
    FinanceEntry.find({ ...entryFilter, ...scope }).sort({ date: -1 }).lean(),
    StoredFile.find({ ...fileFilter, ...scope, complete: true }).sort({ createdAt: -1 }).lean(),
    NPSRating.find(fileFilter).sort({ date: -1 }).select("rating comment date contactId").lean(),
  ]);
  const comments = leads
    .flatMap((lead) =>
      (lead.comments || []).map((comment) => ({ ...comment, leadId: lead._id, leadName: lead.name })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const won = leads.filter((lead) => lead.status === "won");
  const open = leads.filter((lead) => lead.status === "open");
  // Última interação: parecer, atividade concluída, negociação mexida, arquivo ou NPS.
  const doneTasks = leads.length
    ? await Task.find({ leadId: { $in: leads.map((lead) => lead._id) }, done: true }).select("doneAt").sort({ doneAt: -1 }).limit(1).lean()
    : [];
  const times = (dates: (Date | string | undefined)[]) =>
    dates.map((date) => (date ? new Date(date).getTime() : NaN)).filter((time) => !Number.isNaN(time));
  const interactions = times([
    ...comments.map((comment) => comment.createdAt),
    ...leads.map((lead) => lead.updatedAt),
    ...doneTasks.map((task) => task.doneAt),
    ...files.map((file) => file.createdAt),
    ...nps.map((rating) => rating.date),
  ]);
  const firstLead = times(leads.map((lead) => lead.createdAt));
  const received = entries.filter((entry) => entry.type === "income" && entry.status === "received");
  return {
    leads: await withOwnerNames(leads.map(({ comments: list, ...lead }) => ({ ...lead, commentsCount: list?.length || 0 }))),
    comments,
    entries,
    files,
    nps,
    system: {
      firstLeadAt: firstLead.length ? new Date(Math.min(...firstLead)) : null,
      lastInteractionAt: interactions.length ? new Date(Math.max(...interactions)) : null,
    },
    totals: {
      wonCount: won.length,
      wonValue: won.reduce((total, lead) => total + (lead.value || 0), 0),
      openCount: open.length,
      openValue: open.reduce((total, lead) => total + (lead.value || 0), 0),
      received: received.reduce((total, entry) => total + entry.value, 0),
    },
  };
}

export async function getContactProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await Contact.findById(req.params.id).lean();
    if (!contact) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }
    const ids = (contact.companyIds?.length ? contact.companyIds : contact.companyId ? [contact.companyId] : []).map(String);
    const found = ids.length ? await Company.find({ _id: { $in: ids } }).select("name logo").lean() : [];
    // Na ordem do cadastro: a primeira é a principal.
    const companies = ids.map((id) => found.find((company) => String(company._id) === id)).filter((company): company is (typeof found)[number] => Boolean(company));
    const data = await history(req, { contactId: contact._id }, { contactId: contact._id }, { contactId: contact._id });
    res.json({ data: { contact, company: companies[0] || null, companies, ...data } });
  } catch (error) {
    next(error);
  }
}

/** O histórico da empresa inclui o dos contatos vinculados a ela. */
export async function getCompanyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const company = await Company.findById(req.params.id).lean();
    if (!company) {
      res.status(404).json({ error: "Empresa não encontrada." });
      return;
    }
    const contacts = await Contact.find({ companyIds: company._id }).sort({ name: 1 }).lean();
    const contactIds = contacts.map((contact) => contact._id);
    const either = { $or: [{ companyId: company._id }, { contactId: { $in: contactIds } }] };
    const data = await history(req, either, either, either);
    res.json({ data: { company, contacts, ...data } });
  } catch (error) {
    next(error);
  }
}
