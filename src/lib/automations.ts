import type { Types } from "mongoose";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Deal from "../models/Deal";
import FinancialCategory from "../models/FinancialCategory";
import Funnel, { type IFunnelStage } from "../models/Funnel";
import Task from "../models/Task";
import Transaction from "../models/Transaction";
import User from "../models/User";
import { env } from "../config/env";
import { sendAgendaNotification } from "./email";
import { buildDistribution } from "./financialDistribution";
import { notifyUser } from "./notifications";
import { syncTaskToGoogle } from "./googleCalendar";

function findStageByName(stages: IFunnelStage[], name: string) {
  return stages.find((stage) => stage.name.toUpperCase() === name.toUpperCase());
}

export async function assignDealToStageByName(
  dealId: Types.ObjectId,
  funnelId: Types.ObjectId,
  stageName: string,
) {
  const funnel = await Funnel.findById(funnelId);
  if (!funnel) return;

  const stage = findStageByName(funnel.stages, stageName);
  if (!stage) return;

  await Deal.findByIdAndUpdate(dealId, { currentStageId: stage._id });
}

async function findOpenDealForContact(contactId: string, funnelId: string) {
  const funnel = await Funnel.findById(funnelId);
  if (!funnel) return null;

  const closureStageIds = funnel.stages
    .filter((stage) => stage.type === "closure")
    .map((stage) => stage._id);

  return Deal.findOne({
    contactId,
    funnelId,
    ...(closureStageIds.length ? { currentStageId: { $nin: closureStageIds } } : {}),
  }).sort({ createdAt: -1 });
}

export async function handleStageChangeAutomations(
  dealId: string,
  newStageId: string,
  userId: string,
  options: { movementDate?: Date } = {},
): Promise<{ financeRemoved?: boolean }> {
  const deal = await Deal.findById(dealId);
  if (!deal) return {};

  const funnel = await Funnel.findById(deal.funnelId);
  if (!funnel) return {};

  const stage = funnel.stages.find((item) => item._id.toString() === newStageId);
  if (!stage) return {};

  const notifyTarget = deal.ownerUserId?.toString() || deal.creatorUserId.toString();
  if (notifyTarget && notifyTarget !== userId) {
    await notifyUser({
      userId: notifyTarget,
      type: "deal_stage_changed",
      title: "Negociação atualizada",
      body: `A negociação "${deal.title}" avançou para ${stage.name}.`,
      dealId: deal._id.toString(),
    }).catch(() => undefined);
  }

  let financeRemoved = false;
  if (stage.type !== "closure" && deal.closedTransactionId) {
    await Transaction.deleteOne({ _id: deal.closedTransactionId });
    await Deal.updateOne({ _id: deal._id }, { $unset: { closedTransactionId: 1 } });
    deal.closedTransactionId = undefined;
    financeRemoved = true;

    const message = `A negociação "${deal.title}" saiu do fechamento. O lançamento no financeiro foi removido.`;
    const admins = await User.find({ role: "admin", isActive: true }).select("_id");
    const recipients = [...new Set(admins.map((admin) => admin._id.toString()))];
    for (const recipient of recipients) {
      await notifyUser({
        userId: recipient,
        type: "finance_reverted",
        title: "Lançamento financeiro removido",
        body: message,
        dealId: deal._id.toString(),
        email: false,
      }).catch(() => undefined);
    }

    console.log(`[automation:closure-reverted] Lançamento financeiro removido — ${deal.title}`);
  }

  if (stage.type === "agenda") {
    const contact = await Contact.findById(deal.contactId);
    const meetingDate = new Date();
    meetingDate.setDate(meetingDate.getDate() + 1);
    meetingDate.setHours(10, 0, 0, 0);

    const dossieLink = `${env.frontendUrl}/funis/${deal.funnelId}/negociacao/${deal._id}`;
    const taskTitle = `Reunião — ${deal.title}`;

    let task = await Task.findOne({ dealId: deal._id, title: taskTitle, status: { $ne: "done" } });
    if (!task) {
      task = await Task.create({
        dealId: deal._id,
        title: taskTitle,
        description: `Reunião de agendamento com ${contact?.name || "contato"}.`,
        dueDate: meetingDate,
        status: "todo",
        userId,
      });
      await Deal.findByIdAndUpdate(deal._id, { $addToSet: { taskIds: task._id } });
    }

    const recipient =
      (deal.ownerUserId && (await User.findById(deal.ownerUserId))) || (await User.findById(userId));

    await sendAgendaNotification({
      contactName: contact?.name || "Contato",
      contactEmail: contact?.email || "—",
      dealTitle: deal.title,
      date: task.dueDate,
      dossieLink,
      to: recipient?.email,
    }).catch(() => undefined);

    try {
      const eventId = await syncTaskToGoogle({
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        googleEventId: task.googleEventId,
        contactName: contact?.name || "Contato",
        contactEmail: contact?.email || "—",
        dealTitle: deal.title,
        dossieLink,
      });

      if (eventId) {
        task.googleEventId = eventId;
        task.googleSyncedAt = new Date();
        await task.save();
      }
    } catch (error) {
      console.log("[calendar:sync-failed]", error instanceof Error ? error.message : error);
    }

    if (deal.ownerUserId) {
      await notifyUser({
        userId: deal.ownerUserId.toString(),
        type: "task_created",
        title: "Novo compromisso na negociação",
        body: `Foi criado o compromisso "${task.title}" para ${deal.title}.`,
        dealId: deal._id.toString(),
        taskId: task._id.toString(),
      }).catch(() => undefined);
    }

    console.log(
      `[automation:agenda] Reunião confirmada — ${contact?.name || "Contato"} | ${deal.title}`,
    );
  }

  if (stage.type === "closure") {
    if (deal.companyId) {
      await Company.findByIdAndUpdate(deal.companyId, { isActive: true });
    }

    if (deal.closedTransactionId) {
      console.log(`[automation:closure] Venda já lançada — ${deal.title}`);
      return { financeRemoved };
    }

    if (!options.movementDate) {
      throw new Error("Informe a data da movimentação financeira para fechar a venda.");
    }

    const categories = await FinancialCategory.find({ isActive: true }).sort({ order: 1, name: 1 });
    const distribution = buildDistribution(deal.value, categories);

    const transaction = await Transaction.create({
      type: "income",
      dealId: deal._id,
      value: deal.value,
      description: deal.title,
      category: "sale",
      distribution,
      date: options.movementDate,
      userId,
    });

    deal.closedTransactionId = transaction._id;
    await deal.save();

    console.log(`[automation:closure] Venda concluída e rateio registrado — ${deal.title}`);
  }

  return { financeRemoved };
}

export async function intakeLead(params: {
  title: string;
  contactId: string;
  funnelId: string;
  creatorUserId: string;
  source: "whatsapp" | "instagram" | "landing_page" | "manual";
  value?: number;
  companyId?: string;
  temperature?: "cold" | "warm" | "hot";
  ownerUserId?: string;
  reuseOpenDeal?: boolean;
}) {
  const funnel = await Funnel.findById(params.funnelId);
  if (!funnel) {
    throw new Error("Funil não encontrado.");
  }

  if (params.reuseOpenDeal) {
    const existing = await findOpenDealForContact(params.contactId, params.funnelId);
    if (existing) {
      return existing;
    }
  }

  const leadStage =
    findStageByName(funnel.stages, "LEAD") || funnel.stages.sort((a, b) => a.order - b.order)[0];

  if (!leadStage) {
    throw new Error("Funil sem etapas configuradas.");
  }

  const ownerUserId = params.ownerUserId || params.creatorUserId;

  const deal = await Deal.create({
    title: params.title,
    contactId: params.contactId,
    companyId: params.companyId,
    funnelId: params.funnelId,
    currentStageId: leadStage._id,
    value: params.value ?? 0,
    temperature: params.temperature ?? "cold",
    creatorUserId: params.creatorUserId,
    ownerUserId,
    source: params.source,
    productIds: [],
    files: [],
    notes: [],
    taskIds: [],
    labelIds: [],
    dossier: { manualNotes: "", aiSummary: "" },
  });

  if (ownerUserId) {
    await notifyUser({
      userId: ownerUserId,
      type: "deal_assigned",
      title: "Você recebeu uma nova negociação",
      body: `A negociação "${deal.title}" foi atribuída a você.`,
      dealId: deal._id.toString(),
    }).catch(() => undefined);
  }

  return deal;
}

export async function qualifyLead(dealId: string) {
  const deal = await Deal.findById(dealId);
  if (!deal) return;

  await assignDealToStageByName(deal._id, deal.funnelId, "QUALIFICADO");
}
