import type { IIntegration } from "../models/Integration";
import { findIntegration, secret } from "./integrations";

/**
 * Cliente mínimo da API da Assinafy (https://api.assinafy.com.br/v1/docs).
 * Autenticação pelo header `X-Api-Key`; as respostas vêm em `{ status, message, data }`.
 */

const BASE_URLS = {
  production: "https://api.assinafy.com.br/v1",
  sandbox: "https://sandbox.assinafy.com.br/v1",
} as const;

/** Erro com a mensagem pronta para mostrar ao usuário (e o status HTTP da resposta). */
export class AssinafyError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface AssinafyClient {
  accountId: string;
  environment: keyof typeof BASE_URLS;
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  download(path: string): Promise<{ buffer: Buffer; contentType: string }>;
}

/** Status do documento na Assinafy (catálogo de GET /documents/statuses). */
export type AssinafyDocumentStatus =
  | "uploading"
  | "uploaded"
  | "metadata_processing"
  | "metadata_ready"
  | "pending_signature"
  | "pending_identity_review"
  | "ready"
  | "certificating"
  | "certificated"
  | "expired"
  | "rejected_by_signer"
  | "rejected_by_user"
  | "failed";

export interface AssinafySigner {
  id: string;
  full_name: string;
  email?: string;
  government_id?: string;
}

export interface AssinafyAssignmentSigner extends AssinafySigner {
  completed?: boolean;
  notified?: boolean;
}

export interface AssinafyAssignment {
  id: string;
  signers?: AssinafyAssignmentSigner[];
  items?: { signer?: { id?: string }; completed?: boolean }[];
  signing_urls?: { signer_id?: string; url?: string }[] | Record<string, string>;
  expires_at?: string | null;
}

export interface AssinafyDocument {
  id: string;
  name?: string;
  status: AssinafyDocumentStatus | string;
  is_closed?: boolean;
  signing_url?: string;
  artifacts?: Record<string, string>;
  assignment?: AssinafyAssignment | null;
}

/** Mensagem de erro da Assinafy (o corpo costuma trazer `message`). */
function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
  }
  return fallback;
}

/** Monta o cliente a partir da integração da empresa (lança AssinafyError com orientação se faltar algo). */
export function clientFor(integration: IIntegration | null | undefined): AssinafyClient {
  if (!integration) {
    throw new AssinafyError(
      "A assinatura eletrônica não está configurada. Cadastre a chave da Assinafy em Configurações → Integrações.",
      400,
    );
  }
  if (!integration.enabled) {
    throw new AssinafyError("A integração com a Assinafy está desativada. Ative-a em Configurações → Integrações.", 400);
  }
  const apiKey = secret(integration, "apiKey");
  const accountId = String(integration.config?.accountId || "").trim();
  if (!apiKey || !accountId) {
    throw new AssinafyError(
      "Faltam a chave de API ou o ID da conta da Assinafy. Complete em Configurações → Integrações.",
      400,
    );
  }
  const environment = integration.config?.environment === "sandbox" ? "sandbox" : "production";
  const base = BASE_URLS[environment];

  async function send(method: string, path: string, body?: unknown) {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
          ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      });
    } catch {
      throw new AssinafyError("Não foi possível falar com a Assinafy. Tente de novo em instantes.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new AssinafyError("A Assinafy recusou a chave de API. Confira a chave e o ambiente em Configurações → Integrações.", 400);
    }
    return response;
  }

  return {
    accountId,
    environment,
    async request<T>(method: string, path: string, body?: unknown) {
      const response = await send(method, path, body);
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!response.ok) {
        throw new AssinafyError(`Assinafy: ${errorMessage(json, `erro ${response.status}`)}`, response.status >= 500 ? 502 : 400);
      }
      // Respostas comuns vêm em `{ status, message, data }`.
      const record = json as { data?: unknown } | null;
      return (record && typeof record === "object" && "data" in record ? record.data : json) as T;
    },
    async download(path: string) {
      const response = await send("GET", path);
      if (!response.ok) {
        throw new AssinafyError(`Assinafy: não foi possível baixar o arquivo (erro ${response.status}).`, response.status >= 500 ? 502 : 400);
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "application/pdf",
      };
    },
  };
}

/** Cliente da empresa atual. */
export async function currentClient() {
  return clientFor(await findIntegration("assinafy"));
}

/* ---- Chamadas usadas pelo envio de contratos ---- */

/** POST /accounts/{accountId}/documents (multipart, campo `file`; PDF até 25 MB). */
export function uploadDocument(client: AssinafyClient, pdf: Buffer, fileName: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), fileName);
  return client.request<AssinafyDocument>("POST", `/accounts/${client.accountId}/documents`, form);
}

/** GET /documents/{documentId} (status, artifacts e assignment com os signatários). */
export function getDocument(client: AssinafyClient, documentId: string) {
  return client.request<AssinafyDocument>("GET", `/documents/${encodeURIComponent(documentId)}`);
}

/** DELETE /documents/{documentId} (só nos status em que a Assinafy permite excluir). */
export function deleteDocument(client: AssinafyClient, documentId: string) {
  return client.request("DELETE", `/documents/${encodeURIComponent(documentId)}`);
}

/** GET /documents/{documentId}/download/{artifact} (original, certificated, certificate-page, pades, bundle). */
export function downloadArtifact(client: AssinafyClient, documentId: string, artifact = "certificated") {
  return client.download(`/documents/${encodeURIComponent(documentId)}/download/${artifact}`);
}

/**
 * Signatário pelo e-mail ou criado na hora. A API não tem busca exata por e-mail:
 * lista com `search` e compara sem diferenciar maiúsculas.
 */
export async function findOrCreateSigner(
  client: AssinafyClient,
  input: { name: string; email: string; governmentId?: string },
): Promise<AssinafySigner> {
  const email = input.email.trim().toLowerCase();
  const query = new URLSearchParams({ search: email, "per-page": "100" });
  try {
    const found = await client.request<AssinafySigner[] | { data?: AssinafySigner[] }>(
      "GET",
      `/accounts/${client.accountId}/signers?${query}`,
    );
    const list = Array.isArray(found) ? found : found?.data || [];
    const match = list.find((signer) => (signer.email || "").toLowerCase() === email);
    if (match) return match;
  } catch (error) {
    // A busca é só um atalho: se falhar, tenta criar.
    if (error instanceof AssinafyError && /recusou a chave/.test(error.message)) throw error;
  }
  return client.request<AssinafySigner>("POST", `/accounts/${client.accountId}/signers`, {
    full_name: input.name.trim(),
    email,
    ...(input.governmentId ? { government_id: input.governmentId } : {}),
  });
}

/** POST /documents/{documentId}/assignments: dispara os convites (método virtual, aviso por e-mail). */
export function createAssignment(
  client: AssinafyClient,
  documentId: string,
  signerIds: string[],
  options: { message?: string; expiresAt?: string } = {},
) {
  return client.request<AssinafyAssignment>("POST", `/documents/${encodeURIComponent(documentId)}/assignments`, {
    method: "virtual",
    signers: signerIds.map((id) => ({ id })),
    ...(options.message ? { message: options.message } : {}),
    ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
  });
}

/** Status em que o PDF já foi processado e aceita o envio para assinatura. */
export const READY_FOR_ASSIGNMENT = new Set(["metadata_ready"]);
/** Status em que o processamento do PDF falhou ou o fluxo terminou sem assinatura. */
export const FAILED_STATUSES = new Set(["failed", "expired", "rejected_by_signer", "rejected_by_user"]);
