import nodemailer from "nodemailer";
import { env } from "../config/env";

function getTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });
}

export async function sendMail(params: { to: string; subject: string; text: string }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log("[email:skipped] SMTP não configurado.");
    return false;
  }

  if (!params.to) {
    return false;
  }

  await transporter.sendMail({
    from: env.smtpFrom,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });

  console.log(`[email:sent] ${params.subject} → ${params.to}`);
  return true;
}

export async function sendAgendaNotification(params: {
  contactName: string;
  contactEmail: string;
  dealTitle: string;
  date: Date;
  dossieLink: string;
  to?: string;
}) {
  const dateLabel = params.date.toLocaleDateString("pt-BR");
  const timeLabel = params.date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const text = `Nova reunião confirmada:
Nome: ${params.contactName}
Horário: ${dateLabel} às ${timeLabel}
E-mail: ${params.contactEmail}
Tema: ${params.dealTitle}
Link do dossiê: ${params.dossieLink}`;

  return sendMail({
    to: params.to || env.agendaNotifyEmail,
    subject: `Nova reunião confirmada — ${params.contactName}`,
    text,
  });
}
