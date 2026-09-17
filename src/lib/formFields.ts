import type { IFormField } from "../models/Form";
import type { FormFieldType } from "../types";
import { FORM_FIELD_TYPES } from "./constants";

export function slugifyKey(label: string) {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return slug || "campo";
}

function isFormFieldType(value: unknown): value is FormFieldType {
  return FORM_FIELD_TYPES.includes(value as FormFieldType);
}

export function normalizeFormFields(fields: unknown): IFormField[] {
  if (!Array.isArray(fields)) return [];

  const usedKeys = new Set<string>();

  return fields.map((field, index) => {
    if (typeof field === "string") {
      let key = slugifyKey(field);
      while (usedKeys.has(key)) key = `${key}_${index}`;
      usedKeys.add(key);
      return {
        key,
        label: field,
        type: "text" as FormFieldType,
        required: ["nome", "name", "email"].includes(field.toLowerCase()),
        options: [],
        order: index,
      };
    }

    const raw = (field || {}) as Record<string, unknown>;
    const label = String(raw.label || raw.key || `Campo ${index + 1}`);
    let key = slugifyKey(String(raw.key || label));
    while (usedKeys.has(key)) key = `${key}_${index}`;
    usedKeys.add(key);

    return {
      key,
      label,
      type: isFormFieldType(raw.type) ? raw.type : "text",
      required: Boolean(raw.required),
      options: Array.isArray(raw.options)
        ? raw.options.map((option) => String(option).trim()).filter(Boolean)
        : [],
      order: Number(raw.order ?? index),
    };
  });
}

export function pickResponseValue(responses: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = responses[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) {
      return String(direct).trim();
    }

    const match = Object.entries(responses).find(
      ([field]) => field.toLowerCase() === key.toLowerCase(),
    );
    if (match?.[1] !== undefined && match[1] !== null && String(match[1]).trim()) {
      return String(match[1]).trim();
    }
  }
  return "";
}
