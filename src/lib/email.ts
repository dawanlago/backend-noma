import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

let transporter: Transporter | null = null;

export function emailConfigured() {
  return Boolean(env.smtp);
}

function getTransporter() {
  if (!env.smtp) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      // 465 = SSL direto; 587 = STARTTLS.
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/** Envia um e-mail pelo SMTP configurado. Sem SMTP no .env, avisa em vez de quebrar. */
export async function sendMail(input: MailInput) {
  const client = getTransporter();
  if (!client || !env.smtp) throw new Error("Envio de e-mail não configurado (SMTP_HOST, SMTP_USER e SMTP_PASS).");
  const info = await client.sendMail({ from: env.smtp.from, ...input });
  return { messageId: info.messageId, accepted: info.accepted.map(String), rejected: info.rejected.map(String) };
}

/** Mensagem de teste do envio de e-mail. */
export function testMail(to: string): MailInput {
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return {
    to,
    subject: "Teste de envio · Noma",
    text: `Este é um e-mail de teste do Noma, enviado em ${when}. Se chegou, o envio está configurado.`,
    html: `<p>Este é um e-mail de teste do <strong>Noma</strong>, enviado em ${when}.</p><p>Se chegou, o envio está configurado. ✅</p>`,
  };
}
