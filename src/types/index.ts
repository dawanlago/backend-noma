export type UserRole = "admin" | "manager" | "seller";
export type TransactionType = "income" | "expense";
export type FinanceStatus = "received" | "pending" | "paid" | "planned";
export type ToolKey = "proposal" | "contract" | "budget" | "briefing";

export const LEAD_STAGES = [
  "new",
  "first_contact",
  "meeting",
  "proposal_sent",
  "awaiting",
  "negotiation",
  "won",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SERVICES = [
  "Conteúdo mensal",
  "Institucional",
  "Evento",
  "Produto",
  "Depoimentos",
  "Foto + Vídeo",
  "Outro",
] as const;

export const INCOME_CATEGORIES = [
  "Contrato mensal",
  "Evento",
  "Produção avulsa",
  "Edição",
  "Fotografia",
  "Outro",
] as const;

export const EXPENSE_CATEGORIES = [
  "Software",
  "Equipamento",
  "Transporte",
  "Alimentação",
  "Freelancer",
  "Marketing",
  "Contabilidade",
  "Impostos",
  "Estrutura",
  "Outros",
] as const;

export const PAYMENT_METHODS = ["Pix", "Transferência", "Cartão", "Dinheiro", "Boleto", "Outro"] as const;
