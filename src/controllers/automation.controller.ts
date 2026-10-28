import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import ApiToken, { type IApiToken } from "../models/ApiToken";
import CustomField from "../models/CustomField";
import Funnel, { type IFunnel } from "../models/Funnel";
import Lead from "../models/Lead";
import OptionItem from "../models/OptionItem";
import User from "../models/User";
import {
  LEAD_FIELDS,
  bearerToken,
  createRateLimiter,
  generateToken,
  hashToken,
  isObjectId,
  isTokenFormat,
  isEmail,
  normalizeBrPhone,
  parseLeadPayload,
  type FieldError,
} from "../lib/apiTokens";
import { firstOpenStage } from "../lib/funnels";
import { qualifiedStage } from "../lib/forms";
import { findIntegration, saveIntegration } from "../lib/integrations";
import { findContact, intakeLead } from "../lib/leadIntake";
import { acrossOrgs, runWithOrg } from "../lib/tenant";

const ACTOR = "Automação";
const limiter = createRateLimiter(60, 60_000);

function fail(res: Response, status: number, error: string, details?: FieldError[]) {
  res.status(status).json(details?.length ? { error, details } : { error });
}

/** Padrões da API (Configurações → Automação e API), guardados na integração "automation". */
async function readDefaults() {
  const doc = await findIntegration("automation");
  const config = (doc?.config || {}) as Record<string, unknown>;
  return {
    funnelId: isObjectId(config.funnelId) ? config.funnelId : "",
    stageId: isObjectId(config.stageId) ? config.stageId : "",
    ownerId: isObjectId(config.ownerId) ? config.ownerId : "",
  };
}

async function defaultFunnel(funnelId?: string) {
  return (funnelId && (await Funnel.findById(funnelId))) || (await Funnel.findOne().sort({ order: 1, createdAt: 1 }));
}

function stageView(funnel: IFunnel | null, stageId: unknown) {
  const stage = funnel?.stages.find((item) => String(item._id) === String(stageId));
  if (!funnel || !stage) return null;
  const qualified = qualifiedStage(funnel.stages, funnel.qualifiedStageId);
  return {
    id: String(stage._id),
    name: stage.name,
    kind: stage.kind,
    qualified: Boolean(qualified && String(qualified._id) === String(stage._id)),
    funnelId: String(funnel._id),
    funnelName: funnel.name,
  };
}

/** Campos aceitos, funis/etapas e campos personalizados da empresa atual. */
async function buildSchema() {
  const [funnels, fields, defaults] = await Promise.all([
    Funnel.find().sort({ order: 1, createdAt: 1 }),
    CustomField.find({ entity: "lead" }).sort({ order: 1, createdAt: 1 }),
    readDefaults(),
  ]);
  const options = fields.length
    ? await OptionItem.find({ list: { $in: fields.map((field) => `field:${field._id}`) } }).sort({ order: 1 })
    : [];
  const fallback = funnels.find((funnel) => String(funnel._id) === defaults.funnelId) || funnels[0];
  return {
    version: "v1",
    authentication: "Header Authorization: Bearer <token>",
    contentType: "application/json",
    rateLimit: { requests: limiter.limit, perSeconds: 60 },
    fields: LEAD_FIELDS,
    rules: [
      "Obrigatório: phone ou email.",
      "phone: telefone brasileiro com DDD, com ou sem 55. Celular com 9 dígitos começando por 9; fixo com 8.",
      "email: formato nome@dominio.com.",
      "O contato é encontrado pelo telefone (ignorando máscara, 55 e o 9 extra) e depois pelo e-mail: nunca é duplicado.",
      "Se o contato já tem negociação aberta, ela é atualizada em vez de criar outra.",
      "stage: \"qualified\" (ou qualify: true) move a negociação para a etapa de qualificado do funil.",
      "custom aceita só chaves de customFields; campos desconhecidos no corpo são ignorados e listados em warnings.",
    ],
    defaults: {
      funnelId: fallback ? String(fallback._id) : null,
      stageId: defaults.stageId || (fallback ? String(firstOpenStage(fallback.stages)?._id || "") || null : null),
    },
    funnels: funnels.map((funnel) => {
      const qualified = qualifiedStage(funnel.stages, funnel.qualifiedStageId);
      return {
        id: String(funnel._id),
        name: funnel.name,
        stages: funnel.stages.map((stage) => ({
          id: String(stage._id),
          name: stage.name,
          kind: stage.kind,
          qualified: Boolean(qualified && String(qualified._id) === String(stage._id)),
        })),
      };
    }),
    customFields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      funnelId: field.funnelId ? String(field.funnelId) : null,
      options: ["select", "multiselect"].includes(field.type)
        ? options.filter((item) => item.list === `field:${field._id}`).map((item) => item.value)
        : undefined,
    })),
  };
}

// ---------- Rotas públicas (token) ----------

/** Autentica pelo token, aplica o limite por token e roda o resto dentro da empresa dele. */
export async function requireApiToken(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) return fail(res, 401, "Token ausente. Envie o header Authorization: Bearer <token>.");
    if (!isTokenFormat(token)) return fail(res, 401, "Token inválido.");
    const doc = await acrossOrgs(() => ApiToken.findOne({ hash: hashToken(token) }).exec());
    if (!doc) return fail(res, 401, "Token inválido.");
    if (doc.revokedAt) return fail(res, 401, "Token revogado.");

    const rate = limiter.hit(String(doc._id));
    res.setHeader("X-RateLimit-Limit", String(limiter.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1000)));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
      return fail(res, 429, `Limite de ${limiter.limit} requisições por minuto excedido.`);
    }

    res.locals.apiToken = doc;
    runWithOrg(doc.orgId, () => {
      // Último uso: grava no máximo uma vez por minuto (não atrasa a resposta).
      if (!doc.lastUsedAt || Date.now() - doc.lastUsedAt.getTime() > 60_000) {
        void ApiToken.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
      }
      next();
    });
  } catch (error) {
    next(error);
  }
}

/** Só aceita corpo em JSON. */
export function requireJson(req: Request, res: Response, next: NextFunction) {
  if (!req.is("application/json")) return fail(res, 415, "Envie o corpo em JSON (Content-Type: application/json).");
  next();
}

/** GET /public/v1/schema */
export async function getPublicSchema(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await buildSchema() });
  } catch (error) {
    next(error);
  }
}

/** POST /public/v1/leads — cria ou atualiza o lead (sem duplicar contato nem negociação). */
export async function upsertPublicLead(req: Request, res: Response, next: NextFunction) {
  try {
    const fields = await CustomField.find({ entity: "lead" }).select("key");
    const parsed = parseLeadPayload(req.body, fields.map((field) => field.key));
    if (!parsed.value) return fail(res, 422, "Dados inválidos.", parsed.errors);
    const input = parsed.value;
    const defaults = await readDefaults();

    // Funil e etapa informados precisam existir nesta empresa; a etapa sozinha já indica o funil.
    if (input.funnelId && !(await Funnel.exists({ _id: input.funnelId }))) {
      return fail(res, 422, "Dados inválidos.", [{ field: "funnelId", message: "Funil não encontrado." }]);
    }
    let stageFunnelId = "";
    if (input.stageId) {
      const owner = await Funnel.findOne({ "stages._id": new Types.ObjectId(input.stageId) }).select("_id");
      if (!owner || (input.funnelId && String(owner._id) !== input.funnelId)) {
        return fail(res, 422, "Dados inválidos.", [{ field: "stageId", message: "Etapa não encontrada no funil." }]);
      }
      stageFunnelId = String(owner._id);
    }

    // Sem funil explícito: se o contato já tem negociação aberta (ex.: veio do WhatsApp), ela é reaproveitada
    // em qualquer funil; o funil da etapa ou o padrão só valem para negociação nova.
    let funnelId = input.funnelId;
    if (!funnelId) {
      const existing = await findContact(input.phone, input.email);
      const open = existing ? await Lead.exists({ contactId: existing._id, status: "open" }) : null;
      if (!open) funnelId = stageFunnelId || defaults.funnelId || undefined;
    }
    const stageId = input.stageId || (!input.funnelId ? defaults.stageId : "") || undefined;

    const result = await intakeLead({
      name: input.name,
      phone: input.phone,
      email: input.email,
      instagram: input.instagram,
      source: input.source,
      actor: ACTOR,
      funnelId,
      stageId,
      qualify: input.qualify,
      ownerId: defaults.ownerId || undefined,
      notes: input.notes,
      custom: input.custom,
    });

    const warnings: string[] = parsed.ignored.map((key) => `Campo "${key}" ignorado (não existe na API).`);
    const lead = result.lead;
    let funnel: IFunnel | null = null;
    if (lead) {
      funnel = await Funnel.findById(lead.funnelId);
      const now = new Date();
      // Negociação existente com etapa pedida: move (intakeLead só usa stageId na nova).
      if (!result.createdLead && input.stageId && String(lead.stageId) !== input.stageId) {
        const stage = funnel?.stages.find((item) => String(item._id) === input.stageId);
        if (stage) {
          lead.stageId = stage._id;
          lead.status = stage.kind;
          lead.subStageId = undefined;
          lead.history.push({ at: now, text: `Movida para "${stage.name}" (${ACTOR})`, userName: ACTOR });
        } else {
          warnings.push("stageId não pertence ao funil da negociação existente; etapa mantida.");
        }
      }
      if (input.externalId) lead.history.push({ at: now, text: `ID externo: ${input.externalId}`, userName: ACTOR });
      if (lead.isModified()) await lead.save();
    } else {
      warnings.push("Contato salvo, mas nenhuma negociação foi aberta (sem funil, etapa ou responsável disponível).");
    }

    res.status(result.createdLead ? 201 : 200).json({
      data: {
        contactId: String(result.contact._id),
        leadId: lead ? String(lead._id) : null,
        created: result.createdLead,
        contactCreated: result.createdContact,
        stage: lead ? stageView(funnel, lead.stageId) : null,
        externalId: input.externalId || undefined,
      },
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (error) {
    next(error);
  }
}

/** GET /public/v1/leads?phone=...|email=... — negociação aberta do contato (se houver). */
export async function findPublicLead(req: Request, res: Response, next: NextFunction) {
  try {
    const rawPhone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    const details: FieldError[] = [];
    const phone = rawPhone ? normalizeBrPhone(rawPhone) : "";
    if (!rawPhone && !email) details.push({ field: "phone", message: "Informe phone ou email na query." });
    if (rawPhone && !phone) details.push({ field: "phone", message: "Telefone inválido." });
    if (email && !isEmail(email)) details.push({ field: "email", message: "E-mail inválido." });
    if (details.length) return fail(res, 422, "Dados inválidos.", details);

    const contact = await findContact(phone || "", email);
    if (!contact) return fail(res, 404, "Contato não encontrado.");
    const lead = await Lead.findOne({ contactId: contact._id, status: "open" }).sort({ updatedAt: -1 });
    const funnel = lead ? await Funnel.findById(lead.funnelId) : null;
    res.json({
      data: {
        contactId: String(contact._id),
        contact: { name: contact.name, phone: contact.phone, email: contact.email, instagram: contact.instagram },
        lead: lead
          ? {
              leadId: String(lead._id),
              status: lead.status,
              source: lead.source,
              stage: stageView(funnel, lead.stageId),
              createdAt: lead.createdAt,
              updatedAt: lead.updatedAt,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** Qualquer outro caminho em /public/v1. */
export function publicNotFound(_req: Request, res: Response) {
  fail(res, 404, "Rota não encontrada na API de automação.");
}

// ---------- Rotas internas (Configurações → Automação e API) ----------

function tokenView(doc: IApiToken) {
  return {
    _id: String(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    createdByName: doc.createdByName,
    createdAt: doc.createdAt,
    lastUsedAt: doc.lastUsedAt || null,
    revokedAt: doc.revokedAt || null,
  };
}

/** GET /automation/tokens */
export async function listTokens(_req: Request, res: Response, next: NextFunction) {
  try {
    const docs = await ApiToken.find().sort({ revokedAt: 1, createdAt: -1 });
    res.json({ data: docs.map(tokenView) });
  } catch (error) {
    next(error);
  }
}

/** POST /automation/tokens { name } — o token só volta nesta resposta. */
export async function createToken(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String((req.body || {}).name || "").trim().slice(0, 80) || "Token de automação";
    const active = await ApiToken.countDocuments({ revokedAt: { $exists: false } });
    if (active >= 20) return fail(res, 400, "Limite de 20 tokens ativos. Revogue algum antes de criar outro.");
    const { token, hash, prefix } = generateToken();
    const doc = await ApiToken.create({ name, hash, prefix, createdBy: req.user?._id, createdByName: req.user?.name || "" });
    res.status(201).json({ data: { token, item: tokenView(doc) } });
  } catch (error) {
    next(error);
  }
}

/** DELETE /automation/tokens/:id — revoga (o registro fica na lista). */
export async function revokeToken(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isObjectId(req.params.id)) return fail(res, 404, "Token não encontrado.");
    const doc = await ApiToken.findById(req.params.id);
    if (!doc) return fail(res, 404, "Token não encontrado.");
    if (!doc.revokedAt) {
      doc.revokedAt = new Date();
      doc.revokedByName = req.user?.name || "";
      await doc.save();
    }
    res.json({ data: tokenView(doc) });
  } catch (error) {
    next(error);
  }
}

/** GET /automation/defaults */
export async function getDefaults(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await readDefaults() });
  } catch (error) {
    next(error);
  }
}

/** PUT /automation/defaults { funnelId, stageId, ownerId } ("" = automático). */
export async function updateDefaults(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const pick = (key: string) => (isObjectId(body[key]) ? String(body[key]) : "");
    const funnelId = pick("funnelId");
    let stageId = pick("stageId");
    const ownerId = pick("ownerId");
    const funnel = funnelId ? await Funnel.findById(funnelId) : null;
    if (funnelId && !funnel) return fail(res, 422, "Funil não encontrado.");
    if (stageId) {
      const target = funnel || (await defaultFunnel());
      if (!target?.stages.some((stage) => String(stage._id) === stageId)) stageId = "";
    }
    if (ownerId && !(await User.exists({ _id: ownerId, isActive: true }))) return fail(res, 422, "Responsável não encontrado.");
    await saveIntegration("automation", { enabled: true, config: { funnelId, stageId, ownerId } });
    res.json({ data: await readDefaults() });
  } catch (error) {
    next(error);
  }
}

/** GET /automation/schema — o mesmo do GET /public/v1/schema, para a documentação na tela. */
export async function getSchema(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await buildSchema() });
  } catch (error) {
    next(error);
  }
}
