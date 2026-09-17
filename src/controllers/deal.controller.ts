import type { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import Contact from "../models/Contact";
import Company from "../models/Company";
import Deal from "../models/Deal";
import type { IDealNote } from "../models/Deal";
import Form from "../models/Form";
import FormInvite from "../models/FormInvite";
import FormResponse from "../models/FormResponse";
import Funnel from "../models/Funnel";
import Task from "../models/Task";
import User from "../models/User";
import { handleStageChangeAutomations, intakeLead } from "../lib/automations";
import { generateDossierSummary, isAiConfigured } from "../lib/ai";
import { buildFormInviteUrl } from "../lib/formInvite";
import { notifyUser } from "../lib/notifications";

export async function createDeal(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const deal = await intakeLead({
      title: req.body.title,
      contactId: req.body.contactId,
      funnelId: req.body.funnelId,
      creatorUserId: req.user._id.toString(),
      ownerUserId: req.body.ownerUserId || req.user._id.toString(),
      source: req.body.source || "manual",
      value: Number(req.body.value) || 0,
      companyId: req.body.companyId,
      temperature: req.body.temperature || "cold",
    });

    res.status(201).json({ data: deal });
  } catch (error) {
    next(error);
  }
}

export async function getDeal(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const [contact, company, funnel, tasks, creator, owner, formResponses, formInvites] = await Promise.all([
      Contact.findById(deal.contactId),
      deal.companyId ? Company.findById(deal.companyId) : null,
      Funnel.findById(deal.funnelId),
      Task.find({ dealId: deal._id }).sort({ dueDate: 1 }),
      User.findById(deal.creatorUserId),
      deal.ownerUserId ? User.findById(deal.ownerUserId) : null,
      FormResponse.find({ dealId: deal._id }).sort({ submittedAt: -1 }),
      FormInvite.find({ dealId: deal._id }).sort({ createdAt: -1 }),
    ]);

    const forms = await Form.find({ _id: { $in: formInvites.map((invite) => invite.formId) } });
    const formsById = new Map(forms.map((form) => [form._id.toString(), form]));
    const responsesById = new Map(formResponses.map((response) => [response._id.toString(), response]));

    const noteUsers = await User.find({
      _id: { $in: deal.notes.map((note) => note.userId) },
    });

    const usersById = new Map(noteUsers.map((user) => [user._id.toString(), user]));

    res.json({
      data: {
        ...deal.toJSON(),
        contact,
        company,
        funnel,
        tasks,
        creator,
        owner,
        formResponses,
        formInvites: formInvites.map((invite) => ({
          _id: invite._id,
          code: invite.code,
          formId: invite.formId,
          formName: formsById.get(invite.formId.toString())?.name || "Formulário",
          dealId: invite.dealId,
          contactId: invite.contactId,
          status: invite.status,
          url: buildFormInviteUrl(invite.code),
          sentAt: invite.sentAt,
          submittedAt: invite.submittedAt,
          response: invite.responseId ? responsesById.get(invite.responseId.toString()) || null : null,
        })),
        notesDetailed: deal.notes
          .slice()
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .map((note) => ({
            _id: note._id.toString(),
            stageId: note.stageId.toString(),
            date: note.date.toISOString(),
            text: note.text,
            userId: note.userId.toString(),
            user: usersById.get(note.userId.toString()) || null,
            stage: funnel?.stages.find((stage) => stage._id.toString() === note.stageId.toString()),
          })),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listDeals(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.funnelId) {
      filter.funnelId = req.query.funnelId;
    }

    const deals = await Deal.find(filter).sort({ createdAt: -1 });
    const contactIds = deals.map((deal) => deal.contactId);
    const companyIds = deals.flatMap((deal) => (deal.companyId ? [deal.companyId] : []));
    const ownerIds = deals.flatMap((deal) => (deal.ownerUserId ? [deal.ownerUserId] : []));

    const [contacts, companies, owners] = await Promise.all([
      Contact.find({ _id: { $in: contactIds } }),
      Company.find({ _id: { $in: companyIds } }),
      User.find({ _id: { $in: ownerIds } }),
    ]);

    const contactsById = new Map(contacts.map((item) => [item._id.toString(), item]));
    const companiesById = new Map(companies.map((item) => [item._id.toString(), item]));
    const ownersById = new Map(owners.map((item) => [item._id.toString(), item]));

    res.json({
      data: deals.map((deal) => ({
        ...deal.toJSON(),
        contact: contactsById.get(deal.contactId.toString()) || null,
        company: deal.companyId ? companiesById.get(deal.companyId.toString()) || null : null,
        owner: deal.ownerUserId ? ownersById.get(deal.ownerUserId.toString()) || null : null,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateDealStage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const { stageId, movementDate } = req.body;
    if (!stageId || !mongoose.Types.ObjectId.isValid(stageId)) {
      res.status(400).json({ error: "Etapa inválida." });
      return;
    }

    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const funnel = await Funnel.findById(deal.funnelId);
    const stage = funnel?.stages.find((item) => item._id.toString() === String(stageId));
    if (!stage) {
      res.status(400).json({ error: "Etapa não encontrada neste funil." });
      return;
    }

    const parsedMovementDate = movementDate ? new Date(movementDate) : undefined;
    if (stage.type === "closure" && !deal.closedTransactionId) {
      if (!parsedMovementDate || Number.isNaN(parsedMovementDate.getTime())) {
        res.status(400).json({ error: "Informe a data da movimentação para fechar a venda." });
        return;
      }
    }

    deal.currentStageId = new mongoose.Types.ObjectId(stageId);
    await deal.save();
    const automation = await handleStageChangeAutomations(
      deal._id.toString(),
      stageId,
      req.user._id.toString(),
      { movementDate: parsedMovementDate },
    );

    const canViewFinance = req.user?.role === "admin";
    res.json({
      data: await Deal.findById(deal._id),
      ...(canViewFinance && automation.financeRemoved
        ? {
            meta: {
              financeRemoved: true,
              message: "O lançamento no financeiro foi removido porque a negociação saiu do fechamento.",
            },
          }
        : {}),
    });
  } catch (error) {
    next(error);
  }
}

export async function addDealNote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const text = String(req.body.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Informe o parecer." });
      return;
    }

    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    deal.notes.push({
      stageId: deal.currentStageId,
      date: new Date(),
      text,
      userId: req.user._id,
    } as IDealNote);

    await deal.save();
    res.status(201).json({ data: deal.notes[deal.notes.length - 1] });
  } catch (error) {
    next(error);
  }
}

export async function updateDeal(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const previousOwner = deal.ownerUserId?.toString();
    const nextOwner = req.body.ownerUserId ? String(req.body.ownerUserId) : previousOwner;
    const { closedTransactionId: _closed, dossier: _dossier, creatorUserId: _creator, ...safeBody } = req.body;
    Object.assign(deal, safeBody);
    await deal.save();

    if (nextOwner && nextOwner !== previousOwner) {
      await notifyUser({
        userId: nextOwner,
        type: "owner_changed",
        title: "Você recebeu uma nova negociação",
        body: `A negociação "${deal.title}" agora está sob sua responsabilidade.`,
        dealId: deal._id.toString(),
      }).catch(() => undefined);
    }

    res.json({ data: deal });
  } catch (error) {
    next(error);
  }
}

export async function deleteDeal(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findByIdAndDelete(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }
    await Task.deleteMany({ dealId: deal._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

const uploadsRoot = path.resolve(process.cwd(), "uploads");

export async function addDealFile(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const { fileName, contentBase64, url } = req.body;

    if (url && typeof url === "string") {
      deal.files.push(url);
      await deal.save();
      res.status(201).json({ data: deal.files });
      return;
    }

    if (!fileName || !contentBase64) {
      res.status(400).json({ error: "Informe fileName e contentBase64, ou url." });
      return;
    }

    const safeName = String(fileName).replace(/[^\w.\-() ]/g, "_");
    const dealDir = path.join(uploadsRoot, deal._id.toString());
    await fs.mkdir(dealDir, { recursive: true });

    const buffer = Buffer.from(String(contentBase64), "base64");
    const filePath = path.join(dealDir, safeName);
    await fs.writeFile(filePath, buffer);

    const publicPath = `/api/uploads/${deal._id}/${encodeURIComponent(safeName)}`;
    deal.files.push(publicPath);
    await deal.save();

    res.status(201).json({ data: deal.files });
  } catch (error) {
    next(error);
  }
}

export async function removeDealFile(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const fileRef = decodeURIComponent(String(req.params.fileRef || ""));
    deal.files = deal.files.filter((file) => file !== fileRef && !file.endsWith(fileRef));
    await deal.save();

    if (fileRef.startsWith("/api/uploads/")) {
      const relative = fileRef.replace("/api/uploads/", "");
      const diskPath = path.join(uploadsRoot, relative);
      await fs.unlink(diskPath).catch(() => undefined);
    }

    res.json({ data: deal.files });
  } catch (error) {
    next(error);
  }
}

export async function getKanban(req: Request, res: Response, next: NextFunction) {
  try {
    const funnel = await Funnel.findById(req.params.funnelId);
    if (!funnel) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }

    const deals = await Deal.find({ funnelId: funnel._id }).sort({ createdAt: -1 });
    const contactIds = deals.map((deal) => deal.contactId);
    const companyIds = deals.flatMap((deal) => (deal.companyId ? [deal.companyId] : []));
    const ownerIds = deals.flatMap((deal) => (deal.ownerUserId ? [deal.ownerUserId] : []));

    const [contacts, companies, owners] = await Promise.all([
      Contact.find({ _id: { $in: contactIds } }),
      Company.find({ _id: { $in: companyIds } }),
      User.find({ _id: { $in: ownerIds } }),
    ]);

    const contactsById = new Map(contacts.map((item) => [item._id.toString(), item]));
    const companiesById = new Map(companies.map((item) => [item._id.toString(), item]));
    const ownersById = new Map(owners.map((item) => [item._id.toString(), item]));

    const enrichedDeals = deals.map((deal) => ({
      ...deal.toJSON(),
      contact: contactsById.get(deal.contactId.toString()) || null,
      company: deal.companyId ? companiesById.get(deal.companyId.toString()) || null : null,
      owner: deal.ownerUserId ? ownersById.get(deal.ownerUserId.toString()) || null : null,
    }));

    const stages = funnel.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => {
        const stageDeals = enrichedDeals.filter(
          (deal) => deal.currentStageId.toString() === stage._id.toString(),
        );
        const totalValue = stageDeals.reduce((sum, deal) => sum + (deal.value || 0), 0);

        return {
          _id: stage._id.toString(),
          name: stage.name,
          order: stage.order,
          type: stage.type,
          deals: stageDeals,
          totalValue,
        };
      });

    res.json({
      data: {
        funnel,
        stages,
        totalValue: enrichedDeals.reduce((sum, deal) => sum + (deal.value || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getDealDossier(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const [contact, company, formResponses] = await Promise.all([
      Contact.findById(deal.contactId),
      deal.companyId ? Company.findById(deal.companyId) : null,
      FormResponse.find({ dealId: deal._id }).sort({ submittedAt: -1 }),
    ]);

    res.json({
      data: {
        dossier: deal.dossier,
        contact,
        company,
        notes: deal.notes,
        formResponses,
        aiConfigured: isAiConfigured(),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateDealDossier(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    deal.dossier = {
      ...deal.dossier,
      manualNotes: String(req.body.manualNotes ?? deal.dossier?.manualNotes ?? ""),
    };
    await deal.save();
    res.json({ data: deal.dossier });
  } catch (error) {
    next(error);
  }
}

export async function generateDealDossier(req: Request, res: Response, next: NextFunction) {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }

    const [contact, company, funnel, formResponses, owner] = await Promise.all([
      Contact.findById(deal.contactId),
      deal.companyId ? Company.findById(deal.companyId) : null,
      Funnel.findById(deal.funnelId),
      FormResponse.find({ dealId: deal._id }).sort({ submittedAt: -1 }),
      deal.ownerUserId ? User.findById(deal.ownerUserId) : null,
    ]);

    const stage = funnel?.stages.find((item) => item._id.toString() === deal.currentStageId.toString());
    const answers = formResponses.flatMap((response) =>
      response.answers.map((answer) => `${answer.label}: ${JSON.stringify(answer.value)}`),
    );

    const prompt = [
      `Negociação: ${deal.title}`,
      `Valor: ${deal.value}`,
      `Etapa: ${stage?.name || "—"}`,
      `Origem: ${deal.source}`,
      `Responsável: ${owner?.name || "—"}`,
      `Lead: ${contact?.name || "—"} | ${contact?.email || "—"} | ${contact?.phone || "—"}`,
      `Empresa: ${company?.name || "—"} | cliente ativo: ${company?.isActive ? "sim" : "não"}`,
      `Observações manuais do dossiê:\n${deal.dossier?.manualNotes || "(vazio)"}`,
      `Pareceres:\n${deal.notes.map((note) => `- ${note.text}`).join("\n") || "(vazio)"}`,
      `Respostas de formulário:\n${answers.join("\n") || "(vazio)"}`,
    ].join("\n");

    const result = await generateDossierSummary(prompt);
    deal.dossier = {
      manualNotes: deal.dossier?.manualNotes || "",
      aiSummary: result.summary,
      aiGeneratedAt: new Date(),
      aiModel: result.model,
    };
    await deal.save();

    res.json({ data: deal.dossier });
  } catch (error) {
    next(error);
  }
}
