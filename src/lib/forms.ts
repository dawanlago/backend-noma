import { randomBytes, randomInt } from "crypto";
import { FORM_FIELD_TARGETS, FORM_FIELD_TYPES, type FormFieldTarget, type FormFieldType } from "../types";
import type { IFormField } from "../models/Form";
import { slugify, uniqueValue } from "./optionLists";

/** Código de 6 dígitos dos formulários enviados pela negociação. */
export function newInviteCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newPublicId() {
  return randomBytes(6).toString("base64url");
}

/** Valida e completa os campos vindos do construtor de formulários. */
export function normalizeFormFields(raw: unknown): IFormField[] {
  if (!Array.isArray(raw)) return [];
  const used: string[] = [];
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.label === "string" && item.label.trim())
    .map((item) => {
      const label = String(item.label).trim();
      const requested = typeof item.key === "string" && item.key.trim() ? slugify(item.key, "campo") : slugify(label, "campo");
      const key = uniqueValue(requested, used);
      used.push(key);
      const type = FORM_FIELD_TYPES.includes(item.type as FormFieldType) ? (item.type as FormFieldType) : "text";
      return {
        key,
        label,
        type,
        required: Boolean(item.required),
        options: Array.isArray(item.options) ? item.options.map((option) => String(option).trim()).filter(Boolean) : [],
        placeholder: typeof item.placeholder === "string" ? item.placeholder.trim() : "",
        target: FORM_FIELD_TARGETS.includes(item.target as FormFieldTarget) ? (item.target as FormFieldTarget) : "",
      };
    });
}

export type Answers = Record<string, string | string[] | boolean>;

/** E-mail com cara de e-mail (algo@dominio.ext). */
export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Telefone brasileiro: DDD + número (10 ou 11 dígitos), com ou sem +55 e máscara. */
export function isValidPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  return /^[1-9]{2}\d{8,9}$/.test(digits) && (digits.length === 10 || digits[2] === "9");
}

/** Data no formato YYYY-MM-DD que existe no calendário. */
export function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Limpa as respostas e aponta o primeiro erro (campo obrigatório vazio, opção inválida...).
 * `partial`: progresso de quem ainda está respondendo — só valida o que já veio preenchido.
 */
export function validateAnswers(fields: IFormField[], raw: unknown, options: { partial?: boolean } = {}): { answers: Answers; error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers: Answers = {};
  const required = (field: IFormField) => field.required && !options.partial;
  for (const field of fields) {
    const value = input[field.key];
    if (field.type === "checkbox") {
      answers[field.key] = value === true || value === "true";
      if (required(field) && !answers[field.key]) return { answers, error: `Marque "${field.label}".` };
      continue;
    }
    if (field.type === "multiselect") {
      const list = (Array.isArray(value) ? value : []).map(String).filter((option) => field.options.includes(option));
      answers[field.key] = list;
      if (required(field) && !list.length) return { answers, error: `Escolha ao menos uma opção em "${field.label}".` };
      continue;
    }
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, 5000) : "";
    if (field.type === "select" && text && !field.options.includes(text)) {
      return { answers, error: `Opção inválida em "${field.label}".` };
    }
    if (field.type === "email" && text && !isValidEmail(text)) {
      return { answers, error: `Informe um e-mail válido em "${field.label}".` };
    }
    if (field.type === "phone" && text && !isValidPhone(text)) {
      return { answers, error: `Informe um telefone válido com DDD em "${field.label}".` };
    }
    if ((field.type === "eventDate" || field.type === "date") && text && !isValidDateKey(text)) {
      return { answers, error: `Informe uma data válida em "${field.label}".` };
    }
    answers[field.key] = text;
    if (required(field) && !text) return { answers, error: `Preencha "${field.label}".` };
  }
  return { answers, error: "" };
}

export interface FormAvailability {
  /** Antecedência mínima em dias (0 = sem limite). */
  minNoticeDays: number;
  /** Datas/períodos sem atendimento (YYYY-MM-DD, `to` inclusive). */
  blockedDates: { from: string; to: string }[];
  /** Aviso mostrado quando a data cai numa regra. */
  message: string;
}

export const DEFAULT_UNAVAILABLE_MESSAGE =
  "Infelizmente não temos disponibilidade para essa data. Você pode enviar mesmo assim que nossa equipe entra em contato.";

/** Valida a regra de disponibilidade vinda das configurações do formulário. */
export function normalizeAvailability(raw: unknown): FormAvailability {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = Math.floor(Number(input.minNoticeDays));
  const blockedDates = (Array.isArray(input.blockedDates) ? input.blockedDates : [])
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .map((item) => {
      const from = String(item.from || "").trim();
      const to = String(item.to || "").trim() || from;
      return from <= to ? { from, to } : { from: to, to: from };
    })
    .filter((item) => isValidDateKey(item.from) && isValidDateKey(item.to))
    .slice(0, 100);
  return {
    minNoticeDays: Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 0,
    blockedDates,
    message: typeof input.message === "string" ? input.message.trim().slice(0, 1000) : "",
  };
}

/** Hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface EventInfo {
  eventDate: string;
  daysUntilEvent: number;
  unavailable: boolean;
}

/** Data do evento (primeira pergunta do tipo "Data do evento") e se ela cai na regra de indisponibilidade. */
export function eventInfo(fields: IFormField[], answers: Answers, availability: Partial<FormAvailability> | undefined, today = todayKey()): EventInfo | null {
  const field = fields.find((item) => item.type === "eventDate");
  const eventDate = field ? answerText(answers[field.key]).trim() : "";
  if (!eventDate || !isValidDateKey(eventDate)) return null;
  const daysUntilEvent = daysBetween(today, eventDate);
  const rule = normalizeAvailability(availability);
  const unavailable =
    daysUntilEvent < 0 ||
    (rule.minNoticeDays > 0 && daysUntilEvent < rule.minNoticeDays) ||
    rule.blockedDates.some((range) => eventDate >= range.from && eventDate <= range.to);
  return { eventDate, daysUntilEvent, unavailable };
}

/** Quantas perguntas já têm resposta (para o progresso parcial). */
export function answeredCount(fields: IFormField[], answers: Answers) {
  return fields.filter((field) => {
    const value = answers[field.key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    return Boolean(value);
  }).length;
}

/** Normaliza nome de etapa para comparar sem acento/caixa ("Qualificado" = "qualificado"). */
export function plainText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Etapa para onde vai a negociação aberta de um contato que respondeu de novo. */
export function qualifiedStage<T extends { _id: unknown; name: string; kind: string }>(stages: T[], qualifiedStageId?: unknown): T | undefined {
  if (qualifiedStageId) {
    const chosen = stages.find((stage) => String(stage._id) === String(qualifiedStageId));
    if (chosen) return chosen;
  }
  return stages.find((stage) => {
    const name = plainText(stage.name);
    return stage.kind === "open" && /(^|[^a-z])qualificad/.test(name) && !/nao qualificad/.test(name);
  });
}

export function answerText(value: Answers[string] | undefined) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return value || "";
}

/** Dados do contato vindos dos campos marcados com destino (nome, e-mail...). */
export function contactFromAnswers(fields: IFormField[], answers: Answers) {
  const pick = (target: FormFieldTarget) => {
    const field = fields.find((item) => item.target === target);
    return field ? answerText(answers[field.key]).trim() : "";
  };
  return {
    name: pick("name"),
    email: pick("email").toLowerCase(),
    phone: pick("phone"),
    company: pick("company"),
    instagram: pick("instagram"),
  };
}

/** Resumo das respostas para as observações da negociação criada. */
export function answersSummary(fields: IFormField[], answers: Answers) {
  return fields
    .map((field) => {
      const text = answerText(answers[field.key]);
      // Datas no formato brasileiro (DD/MM/AAAA).
      const value = (field.type === "date" || field.type === "eventDate") && isValidDateKey(text) ? text.split("-").reverse().join("/") : text;
      return `${field.label}: ${value || "—"}`;
    })
    .join("\n");
}
