import type { NextFunction, Request, Response } from "express";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Form from "../models/Form";
import FormResponse from "../models/FormResponse";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import { answersSummary, contactFromAnswers, newPublicId, normalizeFormFields, validateAnswers } from "../lib/forms";
import { firstOpenStage } from "../lib/funnels";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";

function notFound(res: Response) {
  res.status(404).json({ error: "Formulário não encontrado." });
}

function applyBody(form: InstanceType<typeof Form>, body: Record<string, unknown>) {
  if (typeof body.name === "string" && body.name.trim()) form.name = body.name.trim();
  if (typeof body.description === "string") form.description = body.description;
  if (typeof body.successMessage === "string") form.successMessage = body.successMessage;
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
