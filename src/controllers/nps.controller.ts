import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Lead from "../models/Lead";
import NPSInvite from "../models/NPSInvite";
import NPSRating from "../models/NPSRating";
import NPSSurvey, { type INPSSurvey } from "../models/NPSSurvey";
import { npsGroup, npsScore } from "../lib/nps";

function firstName(name?: string) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

function applySurvey(doc: INPSSurvey, body: Record<string, unknown>) {
  for (const key of ["name", "question", "commentPrompt", "thankYouMessage"] as const) {
    if (typeof body[key] === "string") doc[key] = (body[key] as string).trim();
  }
  if (typeof body.isActive === "boolean") doc.isActive = body.isActive;
}

export async function listSurveys(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await NPSSurvey.find().sort({ createdAt: -1 }).lean() });
  } catch (error) {
    next(error);
  }
}

export async function createSurvey(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = new NPSSurvey();
    applySurvey(doc, req.body);
    await doc.save();
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateSurvey(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NPSSurvey.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Pesquisa não encontrada." });
      return;
    }
    applySurvey(doc, req.body);
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteSurvey(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NPSSurvey.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Pesquisa não encontrada." });
      return;
    }
    await NPSInvite.deleteMany({ surveyId: doc._id, status: "pending" });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** POST /nps/invites { surveyId, contactId, leadId? } — gera (ou reaproveita) o link do contato. */
export async function createInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const [survey, contact] = await Promise.all([
      isValidObjectId(req.body.surveyId) ? NPSSurvey.findById(req.body.surveyId) : null,
      isValidObjectId(req.body.contactId) ? Contact.findById(req.body.contactId) : null,
    ]);
    if (!survey || !survey.isActive) {
      res.status(404).json({ error: "Pesquisa NPS não encontrada ou inativa." });
      return;
    }
    if (!contact) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }
    const leadId = isValidObjectId(req.body.leadId) ? req.body.leadId : undefined;
    let invite = await NPSInvite.findOne({ surveyId: survey._id, contactId: contact._id, status: "pending" });
    if (!invite) {
      invite = await NPSInvite.create({
        token: crypto.randomBytes(18).toString("base64url"),
        surveyId: survey._id,
        contactId: contact._id,
        companyId: contact.companyId,
        leadId,
        ownerId: req.user!._id,
      });
    }
    res.status(201).json({
      data: { _id: invite._id, token: invite.token, status: invite.status, surveyName: survey.name, contactName: contact.name, phone: contact.phone },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /nps/ratings?contactId= — respostas com nome do contato e da pesquisa. */
export async function listRatings(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    if (isValidObjectId(req.query.contactId)) filter.contactId = req.query.contactId;
    if (isValidObjectId(req.query.companyId)) filter.companyId = req.query.companyId;
    const ratings = await NPSRating.find(filter).sort({ date: -1 }).lean();
    const [contacts, surveys, companies] = await Promise.all([
      Contact.find({ _id: { $in: ratings.map((item) => item.contactId) } }).select("name").lean(),
      NPSSurvey.find({ _id: { $in: ratings.map((item) => item.surveyId) } }).select("name").lean(),
      Company.find({ _id: { $in: ratings.flatMap((item) => (item.companyId ? [item.companyId] : [])) } }).select("name").lean(),
    ]);
    const name = (list: { _id: unknown; name: string }[], id: unknown) => list.find((item) => String(item._id) === String(id))?.name || "";
    const values = ratings.map((rating) => rating.rating);
    res.json({
      meta: {
        score: npsScore(values),
        promoters: values.filter((value) => npsGroup(value) === "promoter").length,
        passives: values.filter((value) => npsGroup(value) === "passive").length,
        detractors: values.filter((value) => npsGroup(value) === "detractor").length,
      },
      data: ratings.map((rating) => ({
        ...rating,
        contactName: name(contacts, rating.contactId),
        surveyName: name(surveys, rating.surveyId),
        companyName: name(companies, rating.companyId),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteRating(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await NPSRating.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Resposta não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* --------------------------------- Público --------------------------------- */

export async function getPublicInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await NPSInvite.findOne({ token: req.params.token }).lean();
    const survey = invite ? await NPSSurvey.findById(invite.surveyId).lean() : null;
    if (!invite || !survey) {
      res.status(404).json({ error: "Este link de pesquisa é inválido." });
      return;
    }
    const contact = await Contact.findById(invite.contactId).select("name").lean();
    res.json({
      data: {
        status: invite.status,
        contactFirstName: firstName(contact?.name),
        survey: {
          name: survey.name,
          question: survey.question,
          commentPrompt: survey.commentPrompt,
          thankYouMessage: survey.thankYouMessage,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function respondPublicInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await NPSInvite.findOne({ token: req.params.token });
    if (!invite) {
      res.status(404).json({ error: "Este link de pesquisa é inválido." });
      return;
    }
    if (invite.status === "answered") {
      res.status(409).json({ error: "Esta pesquisa já foi respondida." });
      return;
    }
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 10) {
      res.status(400).json({ error: "Escolha uma nota de 0 a 10." });
      return;
    }
    await NPSRating.create({
      surveyId: invite.surveyId,
      inviteId: invite._id,
      contactId: invite.contactId,
      companyId: invite.companyId,
      leadId: invite.leadId,
      rating,
      comment: typeof req.body.comment === "string" ? req.body.comment.trim().slice(0, 3000) : "",
    });
    invite.status = "answered";
    invite.answeredAt = new Date();
    await invite.save();
    if (invite.leadId) {
      await Lead.updateOne(
        { _id: invite.leadId },
        { $push: { history: { at: new Date(), text: `NPS respondido: nota ${rating}`, userName: "Cliente" } } },
      );
    }
    res.status(201).json({ data: { ok: true } });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({ error: "Esta pesquisa já foi respondida." });
      return;
    }
    next(error);
  }
}
