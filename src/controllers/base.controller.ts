import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import Company, { type ICompany } from "../models/Company";
import Contact, { type IContact } from "../models/Contact";
import FinanceEntry from "../models/FinanceEntry";
import Lead from "../models/Lead";
import NPSRating from "../models/NPSRating";
import StoredFile from "../models/StoredFile";
import { recordScope, withOwnerNames } from "../lib/ownership";

/* Base de dados: contatos (pessoas) e empresas, com perfil e históricos. */

const CONTACT_TEXT = ["name", "email", "phone", "cpf", "birthDate", "photo", "niche", "jobRole", "instagram", "supplierCategory", "pixKey", "notes"] as const;
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

function applyContact(doc: IContact, body: Record<string, unknown>) {
  for (const key of CONTACT_TEXT) if (typeof body[key] === "string") doc[key] = body[key] as string;
  if (body.companyId !== undefined) {
    doc.companyId = (typeof body.companyId === "string" && isValidObjectId(body.companyId) ? body.companyId : undefined) as never;
  }
  applyCommon(doc, body);
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
    if (typeof req.query.companyId === "string" && isValidObjectId(req.query.companyId)) filter.companyId = req.query.companyId;
    const data = await Contact.find(filter).sort({ name: 1 }).lean();
    res.json({ data });
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
    applyContact(doc, req.body);
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
    applyContact(doc, req.body);
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
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* --------------------------------- Empresas -------------------------------- */

export async function listCompanies(req: Request, res: Response, next: NextFunction) {
  try {
    const companies = await Company.find(kindFilter(req)).sort({ name: 1 }).lean();
    const counts = await Contact.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { companyId: { $ne: null } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
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
    await Contact.updateMany({ companyId: doc._id }, { $unset: { companyId: 1 } });
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
  const received = entries.filter((entry) => entry.type === "income" && entry.status === "received");
  return {
    leads: await withOwnerNames(leads.map(({ comments: list, ...lead }) => ({ ...lead, commentsCount: list?.length || 0 }))),
    comments,
    entries,
    files,
    nps,
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
    const company = contact.companyId ? await Company.findById(contact.companyId).select("name logo").lean() : null;
    const data = await history(req, { contactId: contact._id }, { contactId: contact._id }, { contactId: contact._id });
    res.json({ data: { contact, company, ...data } });
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
    const contacts = await Contact.find({ companyId: company._id }).sort({ name: 1 }).lean();
    const contactIds = contacts.map((contact) => contact._id);
    const either = { $or: [{ companyId: company._id }, { contactId: { $in: contactIds } }] };
    const data = await history(req, either, either, either);
    res.json({ data: { company, contacts, ...data } });
  } catch (error) {
    next(error);
  }
}
