import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  LEAD_SERVICES,
  PAYMENT_METHODS,
} from "../types";

export interface DefaultOption {
  value?: string;
  label: string;
  meta?: Record<string, unknown>;
}

const labels = (items: readonly string[]): DefaultOption[] => items.map((label) => ({ label }));

/**
 * Listas de opções configuráveis e seus valores iniciais. Nas listas com `value`
 * explícito, o valor é uma chave estável usada pelo sistema (ex.: textos da prospecção).
 */
export const OPTION_LIST_DEFAULTS: Record<string, DefaultOption[]> = {
  leadService: labels(LEAD_SERVICES),
  leadSource: labels(["Instagram", "Indicação", "Google", "Site", "Evento/networking", "Prospecção ativa", "Formulário", "Outro"]),
  niche: labels([
    "Restaurante/Gastronomia",
    "Academia/Fitness",
    "Clínica/Saúde",
    "Indústria",
    "Arquitetura/Construção",
    "Loja/Varejo",
    "Prestador de serviços",
    "Eventos",
    "Educação",
    "Outro",
  ]),
  jobRole: labels([
    "Sócio(a)/Proprietário(a)",
    "Diretor(a)",
    "Gerente de marketing",
    "Analista de marketing",
    "Social media",
    "Assistente/Secretária",
    "Outro",
  ]),
  relationship: [
    { value: "client", label: "Cliente" },
    { value: "lead", label: "Lead" },
    { value: "supplier", label: "Fornecedor" },
    { value: "partner", label: "Parceiro" },
  ],
  supplierCategory: labels([
    "Editor(a) de vídeo",
    "Filmmaker",
    "Fotógrafo(a)",
    "Motion designer",
    "Drone",
    "Locação de equipamento",
    "Estúdio/Locação",
    "Maquiagem",
    "Modelo/Ator",
    "Transporte",
    "Outro",
  ]),
  incomeCategory: labels(INCOME_CATEGORIES),
  expenseCategory: labels(EXPENSE_CATEGORIES),
  paymentMethod: labels(PAYMENT_METHODS),
  financeCashbox: labels(["Noma", "Brava"]),
  bankAccount: [],
  budgetProjectType: labels([
    "Conteúdo para redes sociais",
    "Evento",
    "Vídeo institucional",
    "Captação avulsa",
    "Edição",
    "Outro",
  ]),
  // Catálogo de itens da Calculadora de Orçamento: meta = { unit, value } (valor unitário padrão)
  budgetItem: [
    { label: "Assistente", meta: { unit: "diária", value: 250 } },
    { label: "Fotógrafa", meta: { unit: "diária", value: 600 } },
    { label: "Storymaker", meta: { unit: "diária", value: 400 } },
    { label: "Editor(a) de vídeo", meta: { unit: "hora", value: 80 } },
    { label: "Deslocamento", meta: { unit: "unidade", value: 120 } },
    { label: "Aluguel de equipamento", meta: { unit: "diária", value: 200 } },
  ],
  briefingFormat: labels(["Vertical 9:16", "Horizontal 16:9", "Quadrado 1:1", "Formatos variados"]),
  briefingChannel: labels(["Instagram", "Instagram + TikTok", "YouTube", "Site/institucional", "Outro"]),
  briefingRevisions: labels(["1", "2", "3", "A definir"]),
  briefingStyle: labels(["Clean", "Lifestyle", "Comercial", "Premium", "A definir"]),
  taskType: [
    { value: "meeting", label: "Reunião" },
    { value: "call", label: "Ligação" },
    { value: "email", label: "E-mail" },
    { value: "followup", label: "Follow-up" },
  ],
  prospectSegment: [
    { value: "restaurant", label: "Restaurante/Gastronomia" },
    { value: "fitness", label: "Academia/Fitness" },
    { value: "health", label: "Clínica/Saúde" },
    { value: "industry", label: "Indústria" },
    { value: "architecture", label: "Arquitetura/Construção" },
    { value: "retail", label: "Loja/Varejo" },
    { value: "services", label: "Prestador de serviços" },
    { value: "other", label: "Outro" },
  ],
  prospectSource: [
    { value: "instagram", label: "Instagram" },
    { value: "referral", label: "Indicação" },
    { value: "google", label: "Google" },
    { value: "event", label: "Evento/networking" },
    { value: "local", label: "Cliente da região" },
    { value: "other", label: "Outro" },
  ],
  prospectOpportunity: [
    { value: "recurring_content", label: "Conteúdo recorrente para redes sociais" },
    { value: "institutional", label: "Vídeo institucional" },
    { value: "event_coverage", label: "Cobertura de evento" },
    { value: "product", label: "Conteúdo de produto" },
    { value: "testimonials", label: "Depoimentos de clientes" },
    { value: "photo_video", label: "Fotografia + vídeo" },
    { value: "unsure", label: "Ainda não sei" },
  ],
  prospectGoal: [
    { value: "start_conversation", label: "Iniciar uma conversa" },
    { value: "meeting", label: "Conseguir uma reunião" },
    { value: "present_idea", label: "Apresentar uma ideia" },
    { value: "portfolio", label: "Enviar portfólio" },
    { value: "marketing_contact", label: "Pedir contato do marketing" },
  ],
};

export const OPTION_LISTS = Object.keys(OPTION_LIST_DEFAULTS);

/** Listas cujo valor é uma chave (slug); nas demais o valor gravado é o próprio texto. */
export const KEYED_LISTS = OPTION_LISTS.filter((list) => OPTION_LIST_DEFAULTS[list].some((item) => item.value));

export function defaultItems(list: string) {
  return (OPTION_LIST_DEFAULTS[list] || []).map((item, order) => ({
    list,
    value: item.value || item.label,
    label: item.label,
    order,
    ...(item.meta ? { meta: item.meta } : {}),
  }));
}

/** Listas válidas: as do catálogo e as opções de campos personalizados (`field:<id>`). */
export function isValidList(list: unknown): list is string {
  return typeof list === "string" && (OPTION_LISTS.includes(list) || /^field:[a-f0-9]{24}$/.test(list));
}

export function slugify(label: string, fallback = "opcao") {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

/** Gera um valor que ainda não existe na lista (valor_2, valor_3...). */
export function uniqueValue(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
