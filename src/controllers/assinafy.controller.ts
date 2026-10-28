import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import ContractSignature, { type IContractSignature, type SignatureStatus } from "../models/ContractSignature";
import type { IIntegration } from "../models/Integration";
import ToolDocument from "../models/ToolDocument";
import {
  AssinafyError,
  FAILED_STATUSES,
  READY_FOR_ASSIGNMENT,
  clientFor,
  createAssignment,
  deleteDocument,
  downloadArtifact,
  findOrCreateSigner,
  getDocument,
  uploadDocument,
  type AssinafyClient,
  type AssinafyDocument,
  type AssinafySigner,
} from "../lib/assinafy";
import { findIntegration } from "../lib/integrations";
import { notify } from "../lib/notifications";
import { recordScope, useModuleScope } from "../lib/ownership";
import { hasModule } from "../lib/permissions";
import { TOOL_MODULES } from "../types";

/* Assinatura eletrônica de contratos pela Assinafy: envio, acompanhamento e webhook. */

/** O corpo chega em JSON (limite 10 MB no Express, ~4,5 MB na Vercel): o PDF em base64 cabe folgado até 3 MB. */
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const MAX_SIGNERS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Quanto esperar a Assinafy processar o PDF antes de responder (o resto segue pelo webhook ou "Atualizar"). */
const READY_WAIT_MS = 6000;
const ACTIVE: SignatureStatus[] = ["processing", "pending", "finishing"];

function sendError(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof AssinafyError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

/** Contrato que o usuário pode ver/alterar (mesmas regras de dono das ferramentas). */
async function ownedContract(req: Request, res: Response) {
  if (!hasModule(req.user!, TOOL_MODULES.contract)) {
    res.status(403).json({ error: "Seu usuário não tem acesso aos contratos." });
    return null;
  }
  useModuleScope(req, TOOL_MODULES.contract);
  const doc = isValidObjectId(req.params.documentId)
    ? await ToolDocument.findOne({ _id: req.params.documentId, tool: "contract", ...recordScope(req) })
        .select("_id ownerId title")
        .lean()
    : null;
  if (!doc) {
    res.status(404).json({ error: "Contrato não encontrado." });
    return null;
  }
  return doc;
}

/** Situação da integração para a tela (sem segredos). */
function integrationState(integration: IIntegration | null) {
  if (!integration) return { configured: false, enabled: false, environment: "production" };
  const environment = integration.config?.environment === "sandbox" ? "sandbox" : "production";
  try {
    clientFor(integration);
    return { configured: true, enabled: true, environment };
  } catch {
    return { configured: Boolean(integration.config?.accountId && integration.secrets?.apiKey), enabled: integration.enabled, environment };
  }
}

function serialize(sig: IContractSignature | null) {
  if (!sig) return null;
  return {
    _id: String(sig._id),
    status: sig.status,
    assinafyStatus: sig.assinafyStatus,
    environment: sig.environment,
    message: sig.message,
    error: sig.lastError,
    sentAt: sig.sentAt,
    completedAt: sig.completedAt,
    lastSyncedAt: sig.lastSyncedAt,
    createdAt: sig.createdAt,
    hasSignedFile: sig.status === "signed",
    signers: sig.signers.map((signer) => ({
      name: signer.name,
      email: signer.email,
      governmentId: signer.governmentId,
      role: signer.role,
      status: signer.status,
      signingUrl: signer.signingUrl,
      viewedAt: signer.viewedAt,
      signedAt: signer.signedAt,
      rejectedAt: signer.rejectedAt,
    })),
  };
}

/** Último envio do contrato. */
function latestSignature(documentId: Types.ObjectId) {
  return ContractSignature.findOne({ documentId }).sort({ createdAt: -1 });
}

/** Status da Assinafy → status do envio. */
function statusFrom(remote: string, hasAssignment: boolean): SignatureStatus {
  if (remote === "certificated") return "signed";
  if (remote === "ready" || remote === "certificating") return "finishing";
  if (remote === "expired") return "expired";
  if (remote === "rejected_by_signer" || remote === "rejected_by_user") return "rejected";
  if (remote === "failed") return "failed";
  return hasAssignment ? "pending" : "processing";
}

/** Links de assinatura por signatário (a forma exata do campo varia: lista ou mapa). */
function signingUrls(remote: AssinafyDocument): Map<string, string> {
  const urls = new Map<string, string>();
  const raw = remote.assignment?.signing_urls;
  if (Array.isArray(raw)) {
    for (const item of raw) if (item?.signer_id && item.url) urls.set(String(item.signer_id), item.url);
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") urls.set(key, value);
  }
  return urls;
}

/** Avisa o dono do contrato uma única vez quando todos assinaram. */
async function notifyCompletion(sig: IContractSignature) {
  if (sig.status !== "signed" || sig.notifiedAt) return;
  sig.notifiedAt = new Date();
  await sig.save();
  const doc = await ToolDocument.findById(sig.documentId).select("title").lean();
  await notify([sig.ownerId], {
    type: "contract_signed",
    title: `Contrato assinado: ${doc?.title || "contrato"}`,
    body: `Todos os signatários assinaram (${sig.signers.map((signer) => signer.name).join(", ")}). O PDF assinado já pode ser baixado.`,
    link: `/contratos?id=${sig.documentId}`,
    email: true,
  });
}

/**
 * Consulta o documento na Assinafy e atualiza o envio. Se o PDF já foi processado e os
 * convites ainda não saíram (o processamento é assíncrono), dispara o envio aqui.
 */
async function sync(client: AssinafyClient, sig: IContractSignature, remote?: AssinafyDocument) {
  let current = remote || (await getDocument(client, sig.assinafyDocumentId));

  if (!sig.assinafyAssignmentId && !current.assignment?.id && READY_FOR_ASSIGNMENT.has(current.status)) {
    const ids = sig.signers.map((signer) => signer.assinafyId).filter(Boolean);
    const assignment = await createAssignment(client, sig.assinafyDocumentId, ids, { message: sig.message });
    sig.assinafyAssignmentId = String(assignment.id || "");
    sig.sentAt = new Date();
    current = await getDocument(client, sig.assinafyDocumentId);
  }

  const assignment = current.assignment;
  if (assignment?.id && !sig.assinafyAssignmentId) sig.assinafyAssignmentId = String(assignment.id);
  if (sig.assinafyAssignmentId && !sig.sentAt) sig.sentAt = new Date();

  sig.assinafyStatus = current.status;
  sig.status = statusFrom(current.status, Boolean(sig.assinafyAssignmentId));
  sig.lastError = current.status === "failed" ? "A Assinafy não conseguiu processar o PDF." : "";

  // Assinado por signatário: `completed` em assignment.signers (ou todos os itens dele concluídos).
  const allSigned = sig.status === "signed" || sig.status === "finishing";
  const remoteSigners = new Map((assignment?.signers || []).map((signer) => [String(signer.id), signer]));
  const items = assignment?.items || [];
  const urls = signingUrls(current);
  const now = new Date();
  for (const signer of sig.signers) {
    const remoteSigner = remoteSigners.get(signer.assinafyId);
    const own = items.filter((item) => String(item.signer?.id || "") === signer.assinafyId);
    const completed = allSigned || remoteSigner?.completed === true || (own.length > 0 && own.every((item) => item.completed));
    if (completed && signer.status !== "signed") {
      signer.status = "signed";
      signer.signedAt = signer.signedAt || now;
    }
    const url = urls.get(signer.assinafyId);
    if (url) signer.signingUrl = url;
  }
  if (sig.status === "signed" && !sig.completedAt) sig.completedAt = now;
  sig.lastSyncedAt = now;
  sig.markModified("signers");
  await sig.save();
  await notifyCompletion(sig);
  return sig;
}

/** Espera o PDF ficar pronto na Assinafy (por pouco tempo; depois segue pelo webhook/atualização). */
async function waitForProcessing(client: AssinafyClient, documentId: string) {
  const started = Date.now();
  let remote = await getDocument(client, documentId);
  while (Date.now() - started < READY_WAIT_MS && !READY_FOR_ASSIGNMENT.has(remote.status) && !FAILED_STATUSES.has(remote.status) && !remote.assignment?.id) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    remote = await getDocument(client, documentId);
  }
  return remote;
}

interface SignerInput {
  name: string;
  email: string;
  governmentId: string;
  role: string;
}

/** Valida os signatários enviados pela tela. Devolve a mensagem de erro ou a lista limpa. */
function parseSigners(body: unknown): string | SignerInput[] {
  if (!Array.isArray(body) || !body.length) return "Informe ao menos um signatário.";
  if (body.length > MAX_SIGNERS) return `No máximo ${MAX_SIGNERS} signatários por contrato.`;
  const seen = new Set<string>();
  const signers: SignerInput[] = [];
  for (const raw of body as Record<string, unknown>[]) {
    const name = String(raw?.name || "").trim();
    const email = String(raw?.email || "").trim().toLowerCase();
    const governmentId = String(raw?.governmentId || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!name) return "Preencha o nome de todos os signatários.";
    if (!EMAIL_PATTERN.test(email)) return `E-mail inválido para ${name}.`;
    if (seen.has(email)) return `O e-mail ${email} aparece mais de uma vez.`;
    if (governmentId && governmentId.length !== 11 && governmentId.length !== 14) return `CPF/CNPJ inválido para ${name}.`;
    seen.add(email);
    signers.push({ name, email, governmentId, role: String(raw?.role || "").trim().slice(0, 60) });
  }
  return signers;
}

/** GET /contracts/:documentId/signature: último envio + situação da integração. */
export async function getSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedContract(req, res);
    if (!doc) return;
    const [integration, sig] = await Promise.all([findIntegration("assinafy"), latestSignature(doc._id)]);
    res.json({ data: { integration: integrationState(integration), signature: serialize(sig) } });
  } catch (error) {
    next(error);
  }
}

/** POST /contracts/:documentId/signature: sobe o PDF, cria os signatários e envia os convites. */
export async function createSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedContract(req, res);
    if (!doc) return;
    const client = clientFor(await findIntegration("assinafy"));

    const existing = await latestSignature(doc._id);
    if (existing && ACTIVE.includes(existing.status)) {
      res.status(409).json({ error: "Este contrato já está em assinatura. Cancele o envio atual antes de enviar de novo." });
      return;
    }

    const signers = parseSigners(req.body?.signers);
    if (typeof signers === "string") {
      res.status(400).json({ error: signers });
      return;
    }

    const base64 = String(req.body?.pdf || "").replace(/^data:application\/pdf;base64,/, "");
    const pdf = Buffer.from(base64, "base64");
    if (!pdf.length || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      res.status(400).json({ error: "Não foi possível ler o PDF do contrato. Tente gerar de novo." });
      return;
    }
    if (pdf.length > MAX_PDF_BYTES) {
      res.status(413).json({ error: "O PDF do contrato passou de 3 MB. Use um logo menor e tente de novo." });
      return;
    }

    const message = String(req.body?.message || "").trim().slice(0, 500);
    const fileName = `${String(req.body?.fileName || doc.title || "contrato").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 80) || "contrato"}.pdf`;

    // 1) PDF  2) signatários (enquanto a Assinafy processa o arquivo)  3) convites.
    const uploaded = await uploadDocument(client, pdf, fileName);
    const remoteSigners: AssinafySigner[] = [];
    for (const signer of signers) {
      remoteSigners.push(await findOrCreateSigner(client, signer));
    }

    const sig = await ContractSignature.create({
      documentId: doc._id,
      ownerId: doc.ownerId || req.user!._id,
      createdBy: req.user!._id,
      environment: client.environment,
      assinafyDocumentId: String(uploaded.id),
      assinafyStatus: uploaded.status || "",
      status: "processing",
      message,
      signers: signers.map((signer, index) => ({ ...signer, assinafyId: String(remoteSigners[index].id) })),
    });

    const remote = await waitForProcessing(client, sig.assinafyDocumentId);
    try {
      await sync(client, sig, remote);
    } catch (error) {
      // O PDF e os signatários já estão na Assinafy: guarda o erro e deixa tentar de novo pelo "Atualizar".
      sig.lastError = error instanceof Error ? error.message : "Falha ao enviar os convites.";
      await sig.save();
    }
    res.status(201).json({ data: serialize(sig) });
  } catch (error) {
    sendError(res, next, error);
  }
}

/** POST /contracts/:documentId/signature/refresh: consulta a Assinafy agora. */
export async function refreshSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedContract(req, res);
    if (!doc) return;
    const sig = await latestSignature(doc._id);
    if (!sig) {
      res.status(404).json({ error: "Este contrato ainda não foi enviado para assinatura." });
      return;
    }
    if (sig.status === "cancelled") {
      res.json({ data: serialize(sig) });
      return;
    }
    const client = clientFor(await findIntegration("assinafy"));
    await sync(client, sig);
    res.json({ data: serialize(sig) });
  } catch (error) {
    sendError(res, next, error);
  }
}

/**
 * DELETE /contracts/:documentId/signature: cancela o envio. A Assinafy não tem rota de cancelamento:
 * exclui o documento lá (só é aceito nos status em que ela permite) e marca como cancelado aqui.
 */
export async function cancelSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedContract(req, res);
    if (!doc) return;
    const sig = await latestSignature(doc._id);
    if (!sig || sig.status === "cancelled") {
      res.status(404).json({ error: "Não há envio para cancelar." });
      return;
    }
    if (sig.status === "signed") {
      res.status(409).json({ error: "O contrato já foi assinado por todos e não pode ser cancelado." });
      return;
    }
    // Envios já encerrados (recusado, expirado, falhou) só são descartados aqui, para permitir novo envio.
    if (ACTIVE.includes(sig.status)) {
      const client = clientFor(await findIntegration("assinafy"));
      try {
        await deleteDocument(client, sig.assinafyDocumentId);
      } catch (error) {
        if (error instanceof AssinafyError && error.status === 400 && !/recusou a chave/.test(error.message)) {
          res.status(409).json({
            error: `A Assinafy não permitiu cancelar este envio (${error.message.replace(/^Assinafy:\s*/, "")}). Cancele pelo painel da Assinafy.`,
          });
          return;
        }
        throw error;
      }
    }
    sig.status = "cancelled";
    sig.lastError = "";
    await sig.save();
    res.json({ data: serialize(sig) });
  } catch (error) {
    sendError(res, next, error);
  }
}

/** GET /contracts/:documentId/signature/file: PDF assinado (baixado da Assinafy com a chave da empresa). */
export async function downloadSignedFile(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedContract(req, res);
    if (!doc) return;
    const sig = await ContractSignature.findOne({ documentId: doc._id, status: "signed" }).sort({ createdAt: -1 });
    if (!sig) {
      res.status(404).json({ error: "O PDF assinado ainda não está disponível." });
      return;
    }
    const client = clientFor(await findIntegration("assinafy"));
    const file = await downloadArtifact(client, sig.assinafyDocumentId, "certificated");
    const name = `${String(doc.title || "contrato").replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || "contrato"} - assinado.pdf`;
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(file.buffer);
  } catch (error) {
    sendError(res, next, error);
  }
}

/** Id do documento da Assinafy no corpo do webhook (`object` do tipo Document, ou campos soltos). */
function webhookDocumentId(body: Record<string, unknown>): string {
  const object = body.object as { type?: string; id?: unknown } | undefined;
  if (object?.id && (!object.type || /document/i.test(object.type))) return String(object.id);
  const payload = (body.payload || {}) as Record<string, unknown>;
  const candidate = payload.document_id || body.document_id || (payload.document as { id?: unknown } | undefined)?.id;
  return candidate ? String(candidate) : "";
}

/**
 * POST /public/webhooks/assinafy/:hookKey. O corpo só aponta qual documento mudou: o status
 * de verdade é sempre consultado na API com a chave da empresa (não confia no conteúdo recebido).
 */
export async function assinafyWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const integration = res.locals.integration as IIntegration;
    const body = (req.body || {}) as Record<string, unknown>;
    const event = String(body.event || "");
    const documentId = webhookDocumentId(body);
    const sig = documentId ? await ContractSignature.findOne({ assinafyDocumentId: documentId }).sort({ createdAt: -1 }) : null;
    if (!sig || sig.status === "cancelled") {
      res.json({ ok: true, ignored: true });
      return;
    }

    // Eventos de um signatário específico: guarda a data (a API não devolve quando cada um assinou/viu).
    const subject = body.subject as { type?: string; id?: unknown } | undefined;
    const at = typeof body.created_at === "number" ? new Date(body.created_at * 1000) : new Date();
    const signer = subject?.id && /signer/i.test(subject.type || "") ? sig.signers.find((item) => item.assinafyId === String(subject.id)) : null;
    if (signer) {
      if (event === "signer_viewed_document" && !signer.viewedAt) signer.viewedAt = at;
      if (event === "signer_signed_document") {
        signer.status = "signed";
        signer.signedAt = signer.signedAt || at;
      }
      if (event === "signer_rejected_document") {
        signer.status = "rejected";
        signer.rejectedAt = at;
      }
      sig.markModified("signers");
    }

    try {
      await sync(clientFor(integration), sig);
    } catch (error) {
      // Falha ao consultar: guarda o que veio no evento e responde 200 (a tela pode atualizar depois).
      console.error("[assinafy:webhook]", error instanceof Error ? error.message : error);
      await sig.save();
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}
