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

/** Limpa as respostas e aponta o primeiro erro (campo obrigatório vazio, opção inválida...). */
export function validateAnswers(fields: IFormField[], raw: unknown): { answers: Answers; error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers: Answers = {};
  for (const field of fields) {
    const value = input[field.key];
    if (field.type === "checkbox") {
      answers[field.key] = value === true || value === "true";
      if (field.required && !answers[field.key]) return { answers, error: `Marque "${field.label}".` };
      continue;
    }
    if (field.type === "multiselect") {
      const list = (Array.isArray(value) ? value : []).map(String).filter((option) => field.options.includes(option));
      answers[field.key] = list;
      if (field.required && !list.length) return { answers, error: `Escolha ao menos uma opção em "${field.label}".` };
      continue;
    }
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, 5000) : "";
    if (field.type === "select" && text && !field.options.includes(text)) {
      return { answers, error: `Opção inválida em "${field.label}".` };
    }
    if (field.type === "email" && text && !/^\S+@\S+\.\S+$/.test(text)) {
      return { answers, error: `Informe um e-mail válido em "${field.label}".` };
    }
    answers[field.key] = text;
    if (field.required && !text) return { answers, error: `Preencha "${field.label}".` };
  }
  return { answers, error: "" };
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
    .map((field) => `${field.label}: ${answerText(answers[field.key]) || "—"}`)
    .join("\n");
}
