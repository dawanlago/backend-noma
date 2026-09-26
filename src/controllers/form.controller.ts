import type { NextFunction, Request, Response } from "express";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Form, { type IForm } from "../models/Form";
import FormInvite from "../models/FormInvite";
import FormResponse from "../models/FormResponse";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import {
  answersSummary,
  answerText,
  contactFromAnswers,
  newInviteCode,
  newPublicId,
  normalizeFormFields,
  validateAnswers,
} from "../lib/forms";
import { firstOpenStage } from "../lib/funnels";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";
import { getSettings } from "../lib/seedDefaults";

/** Identidade mostrada no topo do formulário público: a do próprio formulário ou a da produtora. */
async function publicBrand(form?: { logo?: string; accentColor?: string }) {
  const settings = await getSettings();
  return {
    logo: form?.logo || settings.brand?.logo || "",
    companyName: settings.companyName || "Noma",
    color: form?.accentColor || settings.brand?.defaultColor || "",
  };
}

function notFound(res: Response) {
  res.status(404).json({ error: "Formulário não encontrado." });
}

function applyBody(form: InstanceType<typeof Form>, body: Record<string, unknown>) {
  if (typeof body.name === "string" && body.name.trim()) form.name = body.name.trim();
  if (typeof body.description === "string") form.description = body.description;
  if (typeof body.successMessage === "string") form.successMessage = body.successMessage;
  if (typeof body.logo === "string") form.logo = body.logo.trim();
  if (typeof body.accentColor === "string") form.accentColor = /^#[0-9a-fA-F]{6}$/.test(body.accentColor.trim()) ? body.accentColor.trim() : "";
  if (typeof body.isActive === "boolean") form.isActive = body.isActive;
  if (typeof body.createLead === "boolean") form.createLead = body.createLead;
  if (body.fields !== undefined) form.set("fields", normalizeFormFields(body.fields));
  if (body.funnelId !== undefined) form.funnelId = (body.funnelId || undefined) as never;
  if (body.stageId !== undefined) form.stageId = (body.stageId || undefined) as never;
}

export async function listForms(req: Request, res: Response, next: NextFunction) {
  try {
    const forms = await Form.find(ownerScope(req)).sort({ createdAt: -1 }).lean();
    const counts = await FormResponse.aggregate<{ _id: string; count: number }>([
      { $match: { formId: { $in: forms.map((form) => form._id) } } },
      { $group: { _id: "$formId", count: { $sum: 1 } } },
    ]);
    const byForm = new Map(counts.map((row) => [String(row._id), row.count]));
    const data = forms.map((form) => ({ ...form, responsesCount: byForm.get(String(form._id)) || 0 }));
    res.json({ data: await withOwnerNames(data) });
  } catch (error) {
    next(error);
  }
}

export async function getForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).lean();
    if (!form) return notFound(res);
    res.json({ data: form });
  } catch (error) {
    next(error);
  }
}

export async function createForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = new Form({ ownerId: req.user!._id, publicId: newPublicId(), name: "Novo formulário" });
    applyBody(form, req.body);
    if (!form.fields.length) {
      form.set(
        "fields",
        normalizeFormFields([
          { label: "Nome", type: "text", required: true, target: "name" },
          { label: "E-mail", type: "email", required: true, target: "email" },
          { label: "WhatsApp", type: "phone", target: "phone" },
          { label: "Empresa", type: "text", target: "company" },
          { label: "Como podemos ajudar?", type: "textarea" },
        ]),
      );
    }
    await form.save();
    res.status(201).json({ data: form.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!form) return notFound(res);
    applyBody(form, req.body);
    await form.save();
    res.json({ data: form.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!form) return notFound(res);
    await FormResponse.deleteMany({ formId: form._id });
    await FormInvite.deleteMany({ formId: form._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listResponses(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!form) return notFound(res);
    const data = await FormResponse.find({ formId: form._id }).sort({ createdAt: -1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function deleteResponse(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!form) return notFound(res);
    await FormResponse.deleteOne({ _id: req.params.responseId, formId: form._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* ------------------------------ Rotas públicas ----------------------------- */

export async function getPublicForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true }).lean();
    if (!form) return notFound(res);
    res.json({
      data: {
        name: form.name,
        description: form.description,
        fields: form.fields,
        successMessage: form.successMessage,
        brand: await publicBrand(form),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** Salva a resposta e, se configurado, cria/atualiza o contato e abre uma negociação no funil. */
export async function submitPublicForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true });
    if (!form) return notFound(res);
    // Campo invisível: robôs costumam preenchê-lo.
    if (req.body?.website) {
      res.status(201).json({ data: { message: form.successMessage } });
      return;
    }
    const { answers, error } = validateAnswers(form.fields, req.body?.answers);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const response = new FormResponse({ formId: form._id, ownerId: form.ownerId, answers });
    const info = contactFromAnswers(form.fields, answers);
    if (form.createLead && (info.name || info.email || info.phone)) {
      let contact = info.email ? await Contact.findOne({ email: info.email }) : null;
      if (!contact && info.phone) contact = await Contact.findOne({ phone: info.phone });
      let companyId = contact?.companyId;
      if (!companyId && info.company) {
        const company =
          (await Company.findOne({ name: new RegExp(`^${info.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) ||
          (await Company.create({ name: info.company, kinds: ["lead"] }));
        companyId = company._id;
      }
      if (!contact) {
        contact = await Contact.create({
          name: info.name || info.email || info.phone,
          email: info.email,
          phone: info.phone,
          instagram: info.instagram,
          companyId,
          kinds: ["lead"],
        });
      }
      response.contactId = contact._id;

      const funnel = (form.funnelId && (await Funnel.findById(form.funnelId))) || (await Funnel.findOne().sort({ order: 1 }));
      const stage = funnel && (funnel.stages.find((item) => String(item._id) === String(form.stageId)) || firstOpenStage(funnel.stages));
      if (funnel && stage) {
        const lead = await Lead.create({
          ownerId: form.ownerId,
          name: contact.name,
          contactId: contact._id,
          contactName: contact.name,
          companyId,
          company: info.company,
          funnelId: funnel._id,
          stageId: stage._id,
          status: stage.kind,
          source: `Formulário: ${form.name}`,
          notes: answersSummary(form.fields, answers),
          history: [{ at: new Date(), text: `Recebida pelo formulário "${form.name}"`, userName: "Formulário" }],
        });
        response.leadId = lead._id;
      }
    }
    await response.save();
    res.status(201).json({ data: { message: form.successMessage } });
  } catch (error) {
    next(error);
  }
}

/* -------------------- Formulário enviado pela negociação -------------------- */

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = newInviteCode();
    if (!(await FormInvite.exists({ code }))) return code;
  }
  throw new Error("Não foi possível gerar o código do formulário.");
}

/** GET /leads/:id/form-invites — formulários enviados nesta negociação, com as respostas. */
export async function listLeadInvites(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!lead) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }
    const invites = await FormInvite.find({ leadId: lead._id }).sort({ createdAt: -1 }).lean();
    const [forms, responses] = await Promise.all([
      Form.find({ _id: { $in: invites.map((invite) => invite.formId) } }).select("name fields").lean(),
      FormResponse.find({ _id: { $in: invites.flatMap((invite) => (invite.responseId ? [invite.responseId] : [])) } }).lean(),
    ]);
    res.json({
      data: invites.map((invite) => {
        const form = forms.find((item) => String(item._id) === String(invite.formId));
        const response = responses.find((item) => String(item._id) === String(invite.responseId));
        return {
          ...invite,
          formName: form?.name || "Formulário",
          answers: response
            ? (form?.fields || []).map((field) => ({ label: field.label, value: answerText(response.answers[field.key] as never) }))
            : [],
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

/** POST /leads/:id/form-invites { formId } — gera o código (ou reaproveita o pendente). */
export async function createLeadInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }
    const form = await Form.findOne({ _id: req.body.formId, isActive: true }).lean();
    if (!form) {
      res.status(404).json({ error: "Formulário não encontrado ou pausado." });
      return;
    }
    let invite = await FormInvite.findOne({ leadId: lead._id, formId: form._id });
    if (invite?.status === "submitted") {
      res.status(400).json({ error: "Este formulário já foi preenchido nesta negociação." });
      return;
    }
    if (invite) {
      invite.sentAt = new Date();
      await invite.save();
    } else {
      invite = await FormInvite.create({
        code: await uniqueInviteCode(),
        formId: form._id,
        leadId: lead._id,
        contactId: lead.contactId,
        ownerId: req.user!._id,
      });
      lead.history.push({ at: new Date(), text: `Formulário "${form.name}" enviado (código ${invite.code})`, userName: req.user!.name });
      await lead.save();
    }
    res.status(201).json({ data: { ...invite.toJSON(), formName: form.name, answers: [] } });
  } catch (error) {
    next(error);
  }
}

/** Valores já conhecidos do contato para preencher o formulário. */
function prefillFor(form: IForm, contact: { name?: string; email?: string; phone?: string; instagram?: string } | null, company: string) {
  const values: Record<string, string> = {};
  if (!contact) return values;
  for (const field of form.fields) {
    const value =
      field.target === "name" ? contact.name
      : field.target === "email" ? contact.email
      : field.target === "phone" ? contact.phone
      : field.target === "instagram" ? contact.instagram
      : field.target === "company" ? company
      : "";
    if (value) values[field.key] = value;
  }
  return values;
}

export async function getInviteByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code }).lean();
    const form = invite ? await Form.findOne({ _id: invite.formId, isActive: true }) : null;
    if (!invite || !form) return notFound(res);
    const [contact, lead, response] = await Promise.all([
      invite.contactId ? Contact.findById(invite.contactId).lean() : null,
      Lead.findById(invite.leadId).select("company").lean(),
      invite.responseId ? FormResponse.findById(invite.responseId).lean() : null,
    ]);
    res.json({
      data: {
        name: form.name,
        description: form.description,
        fields: form.fields,
        successMessage: form.successMessage,
        status: invite.status,
        brand: await publicBrand(form),
        contactFirstName: (contact?.name || "").split(" ")[0] || "",
        prefill: prefillFor(form, contact, lead?.company || ""),
        answers: response
          ? form.fields.map((field) => ({ label: field.label, value: answerText(response.answers[field.key] as never) }))
          : [],
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function submitInviteByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code });
    const form = invite ? await Form.findOne({ _id: invite.formId, isActive: true }) : null;
    if (!invite || !form) return notFound(res);
    if (invite.status === "submitted") {
      res.status(409).json({ error: "Este formulário já foi preenchido." });
      return;
    }
    const { answers, error } = validateAnswers(form.fields, req.body?.answers);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const response = await FormResponse.create({
      formId: form._id,
      ownerId: form.ownerId,
      answers,
      contactId: invite.contactId,
      leadId: invite.leadId,
      inviteId: invite._id,
    });
    invite.status = "submitted";
    invite.responseId = response._id;
    invite.submittedAt = new Date();
    await invite.save();

    // Atualiza o contato com o que ele informou nos campos ligados ao cadastro.
    const info = contactFromAnswers(form.fields, answers);
    if (invite.contactId) {
      const update: Record<string, string> = {};
      for (const key of ["name", "email", "phone", "instagram"] as const) if (info[key]) update[key] = info[key];
      if (Object.keys(update).length) await Contact.updateOne({ _id: invite.contactId }, { $set: update });
    }
    await Lead.updateOne(
      { _id: invite.leadId },
      { $push: { history: { at: new Date(), text: `Formulário "${form.name}" preenchido pelo cliente`, userName: "Cliente" } } },
    );
    res.status(201).json({ data: { message: form.successMessage } });
  } catch (error) {
    next(error);
  }
}
