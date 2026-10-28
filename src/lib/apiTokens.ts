import crypto from "crypto";

/**
 * API de automação: tokens, validação do corpo dos leads e limite de requisições.
 * Tudo aqui é puro (sem banco), para ser testado direto.
 */

export const TOKEN_PREFIX = "noma_live_";
const TOKEN_RE = /^noma_live_[A-Za-z0-9_-]{32}$/;
/** Quantos caracteres do token ficam visíveis na lista ("noma_live_" + 4). */
const VISIBLE_CHARS = TOKEN_PREFIX.length + 4;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Token novo: o texto puro (mostrado uma vez), o hash (guardado) e o começo (para exibir). */
export function generateToken() {
  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, VISIBLE_CHARS) };
}

export function isTokenFormat(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** Token do header `Authorization: Bearer <token>` ("" se ausente). */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header || "");
  return match ? match[1] : "";
}

// ---------- Validação ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

/**
 * Telefone brasileiro com ou sem DDI 55 (máscara e espaços são ignorados).
 * Devolve só dígitos com o 55 na frente (ex.: "5511987654321") ou null se inválido.
 */
export function normalizeBrPhone(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw || !/^[\d\s()+.-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  // DDD sem zero (11 a 99).
  if (!/^[1-9][1-9]$/.test(digits.slice(0, 2))) return null;
  // Celular: 9 + 8 dígitos. Fixo (ou celular antigo sem o 9): 8 dígitos começando de 2 a 9.
  if (digits.length === 11 && digits[2] !== "9") return null;
  if (digits.length === 10 && !/[2-9]/.test(digits[2])) return null;
  return `55${digits}`;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface LeadPayload {
  name: string;
  phone: string;
  email: string;
  instagram: string;
  source: string;
  funnelId?: string;
  stageId?: string;
  qualify: boolean;
  notes: string;
  custom: Record<string, unknown>;
  externalId: string;
}

/** Campos aceitos no POST /public/v1/leads (também é a documentação do GET /schema). */
export const LEAD_FIELDS = [
  { name: "name", type: "string", required: false, maxLength: 200, description: "Nome do lead. Se vier vazio, o contato recebe o telefone ou e-mail como nome." },
  {
    name: "phone",
    type: "string",
    required: "phone ou email",
    maxLength: 30,
    description: "Telefone brasileiro com DDD, com ou sem 55 (máscara é ignorada). Chave principal para não duplicar o contato.",
    example: "+55 (11) 98765-4321",
  },
  { name: "email", type: "string", required: "phone ou email", maxLength: 254, description: "E-mail válido. Usado para achar o contato quando não há telefone." },
  { name: "instagram", type: "string", required: false, maxLength: 120, description: "Perfil do Instagram (ex.: @produtora)." },
  { name: "source", type: "string", required: false, maxLength: 80, default: "API", description: "Origem gravada na negociação nova (ex.: WhatsApp, Formulário de briefing)." },
  { name: "funnelId", type: "string (id)", required: false, description: "Funil da negociação nova. Padrão: o definido nas configurações ou o primeiro funil." },
  { name: "stageId", type: "string (id)", required: false, description: "Etapa do funil. Na negociação nova, onde ela entra; na existente, para onde ela vai." },
  { name: "stage", type: "\"qualified\"", required: false, description: "Leva a negociação (nova ou existente) para a etapa \"qualificado\" do funil. Equivale a qualify: true." },
  { name: "qualify", type: "boolean", required: false, description: "Mesmo que stage: \"qualified\"." },
  { name: "notes", type: "string", required: false, maxLength: 5000, description: "Observações. Na negociação existente, são acrescentadas às anteriores." },
  { name: "custom", type: "object", required: false, description: "Campos personalizados da negociação: { \"<chave>\": valor }. Só chaves existentes (veja customFields)." },
  { name: "externalId", type: "string", required: false, maxLength: 120, description: "Identificador no sistema de origem. Fica registrado no histórico da negociação." },
] as const;

const KNOWN_FIELDS: Set<string> = new Set(LEAD_FIELDS.map((field) => field.name));

function text(body: Record<string, unknown>, field: string, max: number, errors: FieldError[]): string {
  const value = body[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    errors.push({ field, message: "Deve ser texto." });
    return "";
  }
  const result = String(value).trim();
  if (result.length > max) errors.push({ field, message: `Máximo de ${max} caracteres.` });
  return result;
}

function customValue(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return typeof value !== "string" || value.length <= 2000;
  return Array.isArray(value) && value.length <= 100 && value.every((item) => ["string", "number"].includes(typeof item));
}

/**
 * Valida o corpo do POST de lead. `customKeys` são as chaves dos campos personalizados da empresa.
 * Campos desconhecidos não bloqueiam: voltam em `ignored` para o parceiro perceber.
 */
export function parseLeadPayload(body: unknown, customKeys: string[]): { value?: LeadPayload; errors: FieldError[]; ignored: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [{ field: "body", message: "O corpo deve ser um objeto JSON." }], ignored: [] };
  }
  const input = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  const ignored = Object.keys(input).filter((key) => !KNOWN_FIELDS.has(key));

  const name = text(input, "name", 200, errors);
  const rawPhone = text(input, "phone", 30, errors);
  const email = text(input, "email", 254, errors).toLowerCase();
  const instagram = text(input, "instagram", 120, errors);
  const source = text(input, "source", 80, errors) || "API";
  const notes = text(input, "notes", 5000, errors);
  const externalId = text(input, "externalId", 120, errors);

  let phone = "";
  if (rawPhone) {
    const normalized = normalizeBrPhone(rawPhone);
    if (normalized) phone = normalized;
    else errors.push({ field: "phone", message: "Telefone inválido. Use DDD + número, com ou sem 55 (ex.: 11987654321)." });
  }
  if (email && !isEmail(email)) errors.push({ field: "email", message: "E-mail inválido." });
  if (!rawPhone && !email) errors.push({ field: "phone", message: "Informe phone ou email." });

  for (const field of ["funnelId", "stageId"] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && value !== "" && !isObjectId(value)) errors.push({ field, message: "Id inválido." });
  }

  const stage = input.stage;
  if (stage !== undefined && stage !== null && stage !== "" && stage !== "qualified") {
    errors.push({ field: "stage", message: "Único valor aceito: \"qualified\"." });
  }
  if (input.qualify !== undefined && typeof input.qualify !== "boolean") errors.push({ field: "qualify", message: "Deve ser true ou false." });
  const qualify = stage === "qualified" || input.qualify === true;
  if (qualify && isObjectId(input.stageId)) errors.push({ field: "stageId", message: "Use stageId ou stage: \"qualified\", não os dois." });

  const custom: Record<string, unknown> = {};
  if (input.custom !== undefined && input.custom !== null) {
    if (typeof input.custom !== "object" || Array.isArray(input.custom)) {
      errors.push({ field: "custom", message: "Deve ser um objeto { chave: valor }." });
    } else {
      for (const [key, value] of Object.entries(input.custom as Record<string, unknown>)) {
        if (!customKeys.includes(key)) errors.push({ field: `custom.${key}`, message: "Campo personalizado inexistente." });
        else if (!customValue(value)) errors.push({ field: `custom.${key}`, message: "Valor inválido (texto, número, booleano ou lista)." });
        else custom[key] = value;
      }
    }
  }

  if (errors.length) return { errors, ignored };
  return {
    value: {
      name,
      phone,
      email,
      instagram,
      source,
      funnelId: isObjectId(input.funnelId) ? input.funnelId : undefined,
      stageId: isObjectId(input.stageId) ? input.stageId : undefined,
      qualify,
      notes,
      custom,
      externalId,
    },
    errors,
    ignored,
  };
}

// ---------- Limite de requisições ----------

/** Janela fixa em memória por chave (ex.: id do token). Suficiente para uma instância. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    limit,
    hit(key: string, now = Date.now()) {
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        // Limpa janelas vencidas de vez em quando para o mapa não crescer.
        if (hits.size > 1000) for (const [other, item] of hits) if (item.resetAt <= now) hits.delete(other);
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
    },
  };
}
