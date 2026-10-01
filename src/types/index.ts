export type UserRole = "admin" | "manager" | "seller";
export type TransactionType = "income" | "expense";
export type FinanceStatus = "received" | "pending" | "paid" | "planned";
export type ToolKey = "proposal" | "contract" | "budget" | "briefing";

/** Áreas do sistema que podem ser liberadas por usuário. */
export const MODULES = [
  "crm",
  "atividades",
  "agenda",
  "anotacoes",
  "formularios",
  "nps",
  "prospeccao",
  "followup",
  "propostas",
  "orcamento",
  "contratos",
  "briefing",
  "financeiro",
  "base",
  "produtos",
  "configuracoes",
] as const;
export type ModuleKey = (typeof MODULES)[number];

const COMMERCIAL: ModuleKey[] = [
  "crm",
  "atividades",
  "agenda",
  "anotacoes",
  "formularios",
  "nps",
  "prospeccao",
  "followup",
  "propostas",
  "orcamento",
  "contratos",
  "briefing",
  "base",
  "produtos",
];

/** Acessos sugeridos ao criar um usuário (o admin sempre tem tudo). */
export const DEFAULT_PERMISSIONS: Record<UserRole, ModuleKey[]> = {
  admin: [...MODULES],
  manager: [...COMMERCIAL, "financeiro"],
  seller: COMMERCIAL,
};

export const TOOL_MODULES: Record<ToolKey, ModuleKey> = {
  proposal: "propostas",
  contract: "contratos",
  budget: "orcamento",
  briefing: "briefing",
};

/** Etapas do antigo funil fixo; usadas para migrar os leads para o funil padrão. */
export const LEGACY_LEAD_STAGES = [
  { key: "new", name: "Novo lead" },
  { key: "first_contact", name: "Primeiro contato" },
  { key: "meeting", name: "Reunião marcada" },
  { key: "proposal_sent", name: "Proposta enviada" },
  { key: "awaiting", name: "Aguardando resposta" },
  { key: "negotiation", name: "Em negociação" },
  { key: "won", name: "Fechado / ganho" },
] as const;

export type StageKind = "open" | "won" | "lost";
export type LeadStatus = StageKind;
export type LeadTemperature = "cold" | "warm" | "hot";

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

/** Até onde o usuário enxerga num módulo: nada, só o que criou, ou tudo da empresa. */
export const ACCESS_LEVELS = ["none", "own", "all"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const CUSTOM_FIELD_ENTITIES = ["lead", "contact", "company", "prospecting"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Para qual dado do contato/negociação a resposta do formulário vai. */
export const FORM_FIELD_TARGETS = ["", "name", "email", "phone", "company", "instagram"] as const;
export type FormFieldTarget = (typeof FORM_FIELD_TARGETS)[number];
