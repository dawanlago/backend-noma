import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import Contact from "../models/Contact";
import NPSInvite from "../models/NPSInvite";
import NPSRating from "../models/NPSRating";
import NPSSurvey from "../models/NPSSurvey";
import type { INPSSurvey } from "../models/NPSSurvey";

function buildInviteUrl(token: string) {
  return `${env.frontendUrl.replace(/\/$/, "")}/nps/responder/${token}`;
}

function firstName(name?: string) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

export async function createNpsInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const surveyId = String(req.body.surveyId || "");
    const contactId = String(req.body.contactId || "");

    const [survey, contact] = await Promise.all([
      NPSSurvey.findById(surveyId),
      Contact.findById(contactId),
    ]);

    if (!survey || !survey.isActive) {
      res.status(404).json({ error: "Pesquisa NPS não encontrada ou inativa." });
      return;
    }

    if (!contact) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }

    let invite = await NPSInvite.findOne({
      surveyId: survey._id,
      contactId: contact._id,
      status: "pending",
    });

    if (!invite) {
      invite = await NPSInvite.create({
        token: crypto.randomBytes(24).toString("hex"),
        surveyId: survey._id,
        contactId: contact._id,
        companyId: contact.companyId,
      });
    }

    res.status(201).json({
      data: {
        _id: invite._id,
        token: invite.token,
        url: buildInviteUrl(invite.token),
        status: invite.status,
        survey: { _id: survey._id, name: survey.name },
        contact: { _id: contact._id, name: contact.name },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPublicNpsInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await NPSInvite.findOne({ token: req.params.token }).populate("surveyId");

    if (!invite) {
      res.status(404).json({ error: "Este link de NPS é inválido." });
      return;
    }

    const survey = invite.surveyId as unknown as INPSSurvey | null;
    if (!survey) {
      res.status(404).json({ error: "Pesquisa NPS não encontrada." });
      return;
    }

    const contact = await Contact.findById(invite.contactId);

    res.json({
      data: {
        status: invite.status,
        contactFirstName: firstName(contact?.name),
        survey: {
          name: survey.name,
          question: survey.question,
          commentPrompt: survey.commentPrompt || "",
          thankYouMessage: survey.thankYouMessage,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function respondPublicNpsInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await NPSInvite.findOne({ token: req.params.token });

    if (!invite) {
      res.status(404).json({ error: "Este link de NPS é inválido." });
      return;
    }

    if (invite.status === "answered") {
      res.status(409).json({ error: "Esta pesquisa já foi respondida." });
      return;
    }

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 10) {
      res.status(400).json({ error: "Informe uma nota de 0 a 10." });
      return;
    }

    const contact = await Contact.findById(invite.contactId);

    await NPSRating.create({
      surveyId: invite.surveyId,
      inviteId: invite._id,
      contactId: invite.contactId,
      companyId: invite.companyId || contact?.companyId,
      rating,
      comment: typeof req.body.comment === "string" ? req.body.comment.trim() : "",
      date: new Date(),
    });

    invite.status = "answered";
    invite.answeredAt = new Date();
    await invite.save();

    res.status(201).json({ data: { ok: true } });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({ error: "Esta pesquisa já foi respondida." });
      return;
    }
    next(error);
  }
}

export async function listNpsRatings(_req: Request, res: Response, next: NextFunction) {
  try {
    const ratings = await NPSRating.find()
      .sort({ date: -1 })
      .populate("contactId", "name")
      .populate("surveyId", "name");

    res.json({
      data: ratings.map((rating) => {
        const json = rating.toJSON() as unknown as Record<string, unknown>;
        const contact = json.contactId as { _id?: unknown; name?: string } | string | undefined;
        const survey = json.surveyId as { _id?: unknown; name?: string } | string | undefined;

        return {
          ...json,
          contactId: typeof contact === "object" && contact?._id ? String(contact._id) : contact,
          surveyId: typeof survey === "object" && survey?._id ? String(survey._id) : survey,
          contact: typeof contact === "object" ? { name: contact.name || "Contato" } : undefined,
          survey: typeof survey === "object" ? { name: survey.name || "Pesquisa" } : undefined,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}
