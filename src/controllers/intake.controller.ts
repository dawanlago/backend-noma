import type { Request, Response, NextFunction } from "express";
import Contact from "../models/Contact";
import Funnel from "../models/Funnel";
import User from "../models/User";
import { intakeLead } from "../lib/automations";

type LeadSource = "whatsapp" | "instagram" | "landing_page";

async function resolveFunnel(funnelId?: string) {
  if (funnelId) {
    return Funnel.findById(funnelId);
  }
  return Funnel.findOne().sort({ createdAt: 1 });
}

async function resolveCreatorUserId() {
  const admin = await User.findOne({ role: "admin" }).sort({ createdAt: 1 });
  if (!admin) {
    throw new Error("Nenhum usuário administrador encontrado.");
  }
  return admin._id.toString();
}

async function upsertContact(params: {
  name: string;
  email?: string;
  phone?: string;
  companyId?: string;
}) {
  const email = params.email?.trim().toLowerCase();
  const phone = params.phone?.trim();

  if (email) {
    const existing = await Contact.findOne({ email });
    if (existing) return existing;
  }

  if (phone) {
    const existing = await Contact.findOne({ phone });
    if (existing) return existing;
  }

  return Contact.create({
    name: params.name.trim(),
    email: email || `${Date.now()}@lead.noma.local`,
    phone: phone || "—",
    companyId: params.companyId,
  });
}

async function handleLeadIntake(
  req: Request,
  res: Response,
  next: NextFunction,
  source: LeadSource,
) {
  try {
    const { name, email, phone, title, funnelId, companyId, value, temperature } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Informe o nome do lead." });
      return;
    }

    const funnel = await resolveFunnel(funnelId);
    if (!funnel) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }

    const contact = await upsertContact({ name, email, phone, companyId });
    const creatorUserId = await resolveCreatorUserId();

    const deal = await intakeLead({
      title: title || `Lead ${source} — ${contact.name}`,
      contactId: contact._id.toString(),
      funnelId: funnel._id.toString(),
      creatorUserId,
      source,
      value: Number(value) || 0,
      companyId,
      temperature: temperature || "cold",
    });

    res.status(201).json({ data: { contact, deal } });
  } catch (error) {
    next(error);
  }
}

export function intakeWhatsAppLead(req: Request, res: Response, next: NextFunction) {
  return handleLeadIntake(req, res, next, "whatsapp");
}

export function intakeInstagramLead(req: Request, res: Response, next: NextFunction) {
  return handleLeadIntake(req, res, next, "instagram");
}

export function intakeLandingPageLead(req: Request, res: Response, next: NextFunction) {
  return handleLeadIntake(req, res, next, "landing_page");
}
