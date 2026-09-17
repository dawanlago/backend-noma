export const APP_NAME = "Noma";

export const USER_ROLES = ["admin", "manager", "seller"] as const;
export const DEAL_TEMPERATURES = ["cold", "warm", "hot"] as const;
export const STAGE_TYPES = ["agenda", "closure", "general"] as const;
export const TRANSACTION_TYPES = ["income", "expense"] as const;
export const DEAL_SOURCES = [
  "whatsapp",
  "instagram",
  "landing_page",
  "manual",
] as const;
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "email",
  "phone",
  "select",
  "multiselect",
  "boolean",
] as const;
export const NOTIFICATION_TYPES = [
  "deal_assigned",
  "owner_changed",
  "task_created",
  "deal_stage_changed",
] as const;
export const NOTE_PERMISSIONS = ["view", "edit"] as const;

export const FINANCIAL_DISTRIBUTION = {
  marketing: 0.1,
  tax: 0.08,
  equipment: 0.07,
  cash: 0.05,
  profit: 0.25,
} as const;
