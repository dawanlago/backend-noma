export type UserRole = "admin" | "manager" | "seller";
export type DealTemperature = "cold" | "warm" | "hot";
export type StageType = "agenda" | "closure" | "general";
export type TransactionType = "income" | "expense";
export type DealSource = "whatsapp" | "instagram" | "landing_page" | "manual";
export type TaskStatus = "todo" | "doing" | "done";
export type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "select"
  | "multiselect"
  | "boolean";
export type NotificationType =
  | "deal_assigned"
  | "owner_changed"
  | "task_created"
  | "deal_stage_changed"
  | "form_submitted"
  | "finance_reverted";
export type NotePermission = "view" | "edit";
