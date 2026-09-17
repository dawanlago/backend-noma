import type { Request, Response, NextFunction } from "express";
import Contact from "../models/Contact";
import Deal from "../models/Deal";
import Form from "../models/Form";
import FormInvite from "../models/FormInvite";
import FormResponse from "../models/FormResponse";
import Funnel from "../models/Funnel";
import User from "../models/User";
import { intakeLead, qualifyLead } from "../lib/automations";
import { normalizeFormFields, pickResponseValue } from "../lib/formFields";
import { buildFormInviteUrl, generateUniqueFormInviteCode } from "../lib/formInvite";
import { notifyUser } from "../lib/notifications";
import { sendMail } from "../lib/email";
import { env } from "../config/env";

function serializeForm(form: InstanceType<typeof Form>) {
    const json = form.toJSON() as unknown as Record<string, unknown>;
  return {
    ...json,
    fields: normalizeFormFields(form.fields).sort((a, b) => a.order - b.order),
  };
}

export async function listForms(_req: Request, res: Response, next: NextFunction) {
  try {
    const forms = await Form.find().sort({ createdAt: -1 });
    res.json({ data: forms.map(serializeForm) });
  } catch (error) {
    next(error);
  }
}

export async function getForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }
    res.json({ data: serializeForm(form) });
  } catch (error) {
    next(error);
  }
}

export async function getPublicForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findById(req.params.id);
    if (!form || form.isActive === false) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    res.json({
      data: {
        _id: form._id,
        name: form.name,
        fields: normalizeFormFields(form.fields).sort((a, b) => a.order - b.order),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createForm(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.body.funnelId) {
      res.status(400).json({ error: "Vincule o formulário a um funil." });
      return;
    }

    const funnel = await Funnel.findById(req.body.funnelId);
    if (!funnel) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }

    const form = await Form.create({
      name: req.body.name,
      funnelId: req.body.funnelId,
      isActive: req.body.isActive !== false,
      fields: normalizeFormFields(req.body.fields),
    });

    res.status(201).json({ data: serializeForm(form) });
  } catch (error) {
    next(error);
  }
}

export async function updateForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    if (req.body.funnelId) {
      const funnel = await Funnel.findById(req.body.funnelId);
      if (!funnel) {
        res.status(404).json({ error: "Funil não encontrado." });
        return;
      }
      form.funnelId = funnel._id;
    }

    if (req.body.name) form.name = req.body.name;
    if (req.body.isActive !== undefined) form.isActive = Boolean(req.body.isActive);
    if (req.body.fields) form.set("fields", normalizeFormFields(req.body.fields));

    await form.save();
    res.json({ data: serializeForm(form) });
  } catch (error) {
    next(error);
  }
}

export async function listDealFormResponses(req: Request, res: Response, next: NextFunction) {
  try {
    const responses = await FormResponse.find({ dealId: req.params.id }).sort({ submittedAt: -1 });
    res.json({ data: responses });
  } catch (error) {
    next(error);
  }
}

export async function submitForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findById(req.params.id);
    if (!form || form.isActive === false) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    const fields = normalizeFormFields(form.fields).sort((a, b) => a.order - b.order);
    const responses = (req.body.responses || req.body) as Record<string, unknown>;

    for (const field of fields) {
      if (!field.required) continue;
      const value = responses[field.key];
      const emptyArray = Array.isArray(value) && value.length === 0;
      if (value === undefined || value === null || value === false || String(value).trim() === "" || emptyArray) {
        res.status(400).json({ error: `Preencha o campo obrigatório: ${field.label}.` });
        return;
      }
    }

    const name = pickResponseValue(responses, ["nome", "name"]);
    const email = pickResponseValue(responses, ["email", "e-mail"]);
    const phone = pickResponseValue(responses, ["telefone", "phone", "whatsapp"]);

    if (!name) {
      res.status(400).json({ error: "Informe o nome no formulário." });
      return;
    }

    let contact = email ? await Contact.findOne({ email: email.toLowerCase() }) : null;
    if (!contact && phone) {
      contact = await Contact.findOne({ phone });
    }
    if (!contact) {
      contact = await Contact.create({
        name,
        email: email || `${Date.now()}@form.noma.local`,
        phone: phone || "—",
      });
    } else {
      contact.name = name;
      if (email) contact.email = email.toLowerCase();
      if (phone) contact.phone = phone;
      await contact.save();
    }

    const funnel = form.funnelId
      ? await Funnel.findById(form.funnelId)
      : req.body.funnelId
        ? await Funnel.findById(req.body.funnelId)
        : await Funnel.findOne().sort({ createdAt: 1 });

    if (!funnel) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }

    const admin = await User.findOne({ role: "admin" }).sort({ createdAt: 1 });
    if (!admin) {
      res.status(500).json({ error: "Nenhum usuário administrador encontrado." });
      return;
    }

    const deal = await intakeLead({
      title: `Formulário — ${form.name}`,
      contactId: contact._id.toString(),
      funnelId: funnel._id.toString(),
      creatorUserId: admin._id.toString(),
      source: "landing_page",
      value: 0,
      temperature: "warm",
      reuseOpenDeal: true,
    });

    const answers = fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      value: responses[field.key] ?? "",
    }));

    const formResponse = await FormResponse.create({
      formId: form._id,
      dealId: deal._id,
      contactId: contact._id,
      answers,
      submittedAt: new Date(),
    });

    await qualifyLead(deal._id.toString());

    res.status(201).json({
      data: {
        form: { _id: form._id, name: form.name },
        contact,
        deal,
        response: formResponse,
        publicUrl: `${env.frontendUrl}/formularios/${form._id}`,
      },
    });
  } catch (error) {
    next(error);
  }
}

function serializeInvite(
  invite: InstanceType<typeof FormInvite>,
  extras: {
    formName?: string;
    response?: InstanceType<typeof FormResponse> | null;
    emailed?: boolean;
  } = {},
) {
  return {
    _id: invite._id,
    code: invite.code,
    formId: invite.formId,
    formName: extras.formName || "",
    dealId: invite.dealId,
    contactId: invite.contactId,
    status: invite.status,
    url: buildFormInviteUrl(invite.code),
    sentAt: invite.sentAt,
    submittedAt: invite.submittedAt,
    response: extras.response || null,
    emailed: extras.emailed || false,
  };
}

export async function createDealFormInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const form = await Form.findById(req.body.formId);
    if (!form || form.isActive === false) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    const contact = await Contact.findById(deal.contactId);
    if (!contact) {
      res.status(404).json({ error: "Contato da negociação não encontrado." });
      return;
    }

    const existing = await FormInvite.findOne({
      dealId: deal._id,
      formId: form._id,
    }).sort({ createdAt: -1 });

    if (existing?.status === "submitted") {
      res.status(400).json({ error: "Este formulário já foi preenchido nesta negociação." });
      return;
    }

    let invite = existing;
    if (!invite) {
      invite = await FormInvite.create({
        code: await generateUniqueFormInviteCode(),
        formId: form._id,
        dealId: deal._id,
        contactId: contact._id,
        status: "pending",
        sentAt: new Date(),
      });
    } else {
      invite.sentAt = new Date();
      await invite.save();
    }

    const url = buildFormInviteUrl(invite.code);
    const emailLooksReal = Boolean(contact.email && !contact.email.endsWith("@form.noma.local"));
    const emailed = emailLooksReal
      ? await sendMail({
          to: contact.email,
          subject: `Formulário — ${form.name}`,
          text: `Olá, ${contact.name.split(" ")[0]}.

Preencha o formulário da Noma:
${url}

Código: ${invite.code}`,
        }).catch((error) => {
          console.log("[email:form-invite-failed]", error instanceof Error ? error.message : error);
          return false;
        })
      : false;

    res.status(201).json({
      data: serializeInvite(invite, { formName: form.name, emailed: Boolean(emailed) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function getPublicFormInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code });
    if (!invite) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    const form = await Form.findById(invite.formId);
    if (!form || form.isActive === false) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    const [contact, response] = await Promise.all([
      Contact.findById(invite.contactId),
      invite.responseId ? FormResponse.findById(invite.responseId) : null,
    ]);

    const fields = normalizeFormFields(form.fields).sort((a, b) => a.order - b.order);
    const prefill: Record<string, string> = {};
    const name = contact?.name || "";
    const email = contact?.email && !contact.email.endsWith("@form.noma.local") ? contact.email : "";
    const phone = contact?.phone && contact.phone !== "—" ? contact.phone : "";
    for (const field of fields) {
      const key = field.key.toLowerCase();
      if (["nome", "name"].includes(key) && name) prefill[field.key] = name;
      if (["email", "e-mail"].includes(key) && email) prefill[field.key] = email;
      if (["telefone", "phone", "whatsapp"].includes(key) && phone) prefill[field.key] = phone;
    }

    res.json({
      data: {
        code: invite.code,
        status: invite.status,
        form: {
          _id: form._id,
          name: form.name,
          fields,
        },
        contactFirstName: contact?.name.split(" ")[0] || "",
        prefill,
        answers: response?.answers || [],
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function submitFormInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code });
    if (!invite) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    if (invite.status === "submitted") {
      res.status(400).json({ error: "Este formulário já foi preenchido." });
      return;
    }

    const alreadyAnswered = await FormResponse.exists({
      dealId: invite.dealId,
      formId: invite.formId,
    });
    if (alreadyAnswered) {
      invite.status = "submitted";
      invite.responseId = alreadyAnswered._id;
      invite.submittedAt = invite.submittedAt || new Date();
      await invite.save();
      res.status(400).json({ error: "Este formulário já foi preenchido." });
      return;
    }

    const [form, deal, contact] = await Promise.all([
      Form.findById(invite.formId),
      Deal.findById(invite.dealId),
      Contact.findById(invite.contactId),
    ]);

    if (!form || form.isActive === false || !deal || !contact) {
      res.status(404).json({ error: "Formulário não encontrado." });
      return;
    }

    const fields = normalizeFormFields(form.fields).sort((a, b) => a.order - b.order);
    const responses = (req.body.responses || req.body) as Record<string, unknown>;

    for (const field of fields) {
      if (!field.required) continue;
      const value = responses[field.key];
      const emptyArray = Array.isArray(value) && value.length === 0;
      if (value === undefined || value === null || value === false || String(value).trim() === "" || emptyArray) {
        res.status(400).json({ error: `Preencha o campo obrigatório: ${field.label}.` });
        return;
      }
    }

    const name = pickResponseValue(responses, ["nome", "name"]);
    const email = pickResponseValue(responses, ["email", "e-mail"]);
    const phone = pickResponseValue(responses, ["telefone", "phone", "whatsapp"]);
    if (name) contact.name = name;
    if (email) contact.email = email.toLowerCase();
    if (phone) contact.phone = phone;
    await contact.save();

    const answers = fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      value: responses[field.key] ?? "",
    }));

    const formResponse = await FormResponse.create({
      formId: form._id,
      dealId: deal._id,
      contactId: contact._id,
      answers,
      submittedAt: new Date(),
    });

    invite.status = "submitted";
    invite.responseId = formResponse._id;
    invite.submittedAt = formResponse.submittedAt;
    await invite.save();

    await qualifyLead(deal._id.toString());

    const notifyTarget = deal.ownerUserId?.toString() || deal.creatorUserId.toString();
    await notifyUser({
      userId: notifyTarget,
      type: "form_submitted",
      title: "Formulário preenchido",
      body: `${contact.name} preencheu "${form.name}" na negociação "${deal.title}".`,
      dealId: deal._id.toString(),
    }).catch(() => undefined);

    res.status(201).json({
      data: {
        ok: true,
        response: formResponse,
      },
    });
  } catch (error) {
    next(error);
  }
}
