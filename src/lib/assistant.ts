import Anthropic from "@anthropic-ai/sdk";
import type { Request } from "express";
import { isValidObjectId } from "mongoose";
import Contact from "../models/Contact";
import FinanceEntry from "../models/FinanceEntry";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import ProposalLink from "../models/ProposalLink";
import ProposalView from "../models/ProposalView";
import Task from "../models/Task";
import ToolDocument from "../models/ToolDocument";
import User from "../models/User";
import type { ModuleKey } from "../types";
import { aiClient, FALLBACK_MODELS } from "./ai";
import { entryTotal } from "./lateCharge";
import { ownerScopeFor } from "./ownership";

/*
 * Assistente do Noma: o Claude responde perguntas sobre o CRM, a agenda, as propostas, os contatos
 * e o financeiro, consultando os dados da empresa ativa por ferramentas SÓ DE LEITURA. Cada ferramenta
 * respeita o acesso do usuário: módulo sem acesso = recusa; nível "só os dele" = só os registros dele.
 */

const MAX_TOOL_ROUNDS = 8;
const MAX_ROWS = 25;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  reply: string;
  /** Áreas consultadas nesta resposta (para a tela mostrar "Consultei: CRM, Agenda"). */
  sources: string[];
}

export class AssistantUnavailableError extends Error {}

type Input = Record<string, unknown>;

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (input: Input, key: string, max = 120) => (typeof input[key] === "string" ? (input[key] as string).trim().slice(0, max) : "");
const todayBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function canUse(req: Request, module: ModuleKey) {
  const level = req.access?.levels[module];
  return Boolean(level && level !== "none");
}

const TOOLS: (Anthropic.Beta.BetaTool & { module: ModuleKey; area: string })[] = [
  {
    name: "resumo_crm",
    area: "CRM",
    module: "crm",
    description:
      "Resumo do funil de vendas: para cada funil e etapa, quantas negociações em aberto e o valor somado; e as vendas feitas e perdidas no mês informado. Use para perguntas como 'como está o funil', 'quanto tenho em negociação', 'quanto vendi este mês'.",
    input_schema: {
      type: "object",
      properties: { mes: { type: "string", description: "Mês das vendas feitas/perdidas, no formato AAAA-MM. Padrão: mês atual." } },
      additionalProperties: false,
    },
  },
  {
    name: "buscar_negociacoes",
    area: "CRM",
    module: "crm",
    description:
      "Lista negociações do CRM com nome, cliente, valor, funil, etapa, temperatura, próxima ação, responsável e o último parecer. Filtre por texto (nome da negociação, empresa ou contato), situação ou próxima ação atrasada. Devolve no máximo 25, as atualizadas mais recentemente primeiro.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Parte do nome da negociação, da empresa ou do contato." },
        situacao: { type: "string", enum: ["aberta", "ganha", "perdida", "todas"], description: "Padrão: aberta." },
        acao_atrasada: { type: "boolean", description: "Só negociações com a próxima ação para hoje ou já vencida." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agenda",
    area: "Agenda",
    module: "agenda",
    description:
      "Compromissos e atividades com data num período (inclui reuniões marcadas pelo link de agendamento). Devolve data, horário, título, tipo, se foi concluído e a negociação ligada.",
    input_schema: {
      type: "object",
      properties: {
        de: { type: "string", description: "Data inicial AAAA-MM-DD." },
        ate: { type: "string", description: "Data final AAAA-MM-DD (até 62 dias depois da inicial)." },
      },
      required: ["de", "ate"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_propostas",
    area: "Propostas",
    module: "propostas",
    description:
      "Lista propostas comerciais com cliente, valor do investimento, quando foi atualizada e o rastreio do link enviado: se está ativo, quantas vezes foi aberto, a última abertura, o tempo total de leitura e se o cliente aceitou.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string", description: "Parte do nome do cliente ou do título da proposta." } },
      additionalProperties: false,
    },
  },
  {
    name: "buscar_contatos",
    area: "Base de dados",
    module: "base",
    description: "Procura contatos da base (clientes, fornecedores, parceiros) pelo nome, telefone ou e-mail. Devolve nome, telefone, e-mail, empresa, nicho, aniversário e tipo.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string", description: "Nome, telefone ou e-mail (ou parte)." } },
      required: ["texto"],
      additionalProperties: false,
    },
  },
  {
    name: "resumo_financeiro",
    area: "Financeiro",
    module: "financeiro",
    description:
      "Totais do financeiro num mês: recebido, despesas pagas, resultado, a receber (com quantos vencidos) e despesas previstas, já com juros. Inclui as 5 maiores entradas e despesas.",
    input_schema: {
      type: "object",
      properties: { mes: { type: "string", description: "Mês no formato AAAA-MM. Padrão: mês atual." } },
      additionalProperties: false,
    },
  },
];

async function funnelNames() {
  const funnels = await Funnel.find().select("name stages._id stages.name").lean();
  const funnel = new Map(funnels.map((item) => [String(item._id), item.name]));
  const stage = new Map(funnels.flatMap((item) => item.stages.map((s) => [String(s._id), s.name] as [string, string])));
  return { funnel, stage };
}

async function ownerNames(ids: unknown[]) {
  const valid = [...new Set(ids.map(String))].filter((id) => isValidObjectId(id));
  const users = await User.find({ _id: { $in: valid } }).select("name").lean();
  return new Map(users.map((user) => [String(user._id), user.name]));
}

async function resumoCrm(req: Request, input: Input) {
  const mes = MONTH.test(text(input, "mes")) ? text(input, "mes") : todayBR().slice(0, 7);
  const scope = ownerScopeFor(req, "crm");
  const [open, closed, names] = await Promise.all([
    Lead.find({ ...scope, status: "open" }).select("funnelId stageId value").lean(),
    Lead.find({ ...scope, status: { $in: ["won", "lost"] }, updatedAt: { $gte: new Date(`${mes}-01T00:00:00-03:00`) } })
      .select("status value updatedAt closedAt")
      .lean(),
    funnelNames(),
  ]);
  const byStage = new Map<string, { funil: string; etapa: string; negociacoes: number; valor: number }>();
  for (const lead of open) {
    const key = `${lead.funnelId}|${lead.stageId}`;
    const row = byStage.get(key) || {
      funil: names.funnel.get(String(lead.funnelId)) || "Funil",
      etapa: names.stage.get(String(lead.stageId)) || "Etapa",
      negociacoes: 0,
      valor: 0,
    };
    row.negociacoes += 1;
    row.valor += lead.value || 0;
    byStage.set(key, row);
  }
  const inMonth = closed.filter((lead) => {
    const at = (lead as { closedAt?: Date }).closedAt || lead.updatedAt;
    return new Date(at).toISOString().slice(0, 7) === mes;
  });
  const won = inMonth.filter((lead) => lead.status === "won");
  return {
    em_aberto: { negociacoes: open.length, valor: money(open.reduce((sum, lead) => sum + (lead.value || 0), 0)) },
    por_etapa: [...byStage.values()].map((row) => ({ ...row, valor: money(row.valor) })),
    mes,
    vendas_feitas_no_mes: { quantidade: won.length, valor: money(won.reduce((sum, lead) => sum + (lead.value || 0), 0)) },
    perdidas_no_mes: inMonth.length - won.length,
  };
}

async function buscarNegociacoes(req: Request, input: Input) {
  const filter: Record<string, unknown> = { ...ownerScopeFor(req, "crm") };
  const situacao = text(input, "situacao") || "aberta";
  const status = { aberta: "open", ganha: "won", perdida: "lost" }[situacao];
  if (status) filter.status = status;
  const busca = text(input, "texto");
  if (busca) {
    const regex = new RegExp(escapeRegex(busca), "i");
    filter.$or = [{ name: regex }, { company: regex }, { contactName: regex }];
  }
  if (input.acao_atrasada === true) {
    filter.nextActionDate = { $lte: new Date(`${todayBR()}T23:59:59-03:00`) };
    filter.status = "open";
  }
  const [leads, names] = await Promise.all([
    Lead.find(filter)
      .sort({ updatedAt: -1 })
      .limit(MAX_ROWS)
      .select("name company contactName value status funnelId stageId temperature nextActionDate ownerId source comments updatedAt")
      .lean(),
    funnelNames(),
  ]);
  const owners = await ownerNames(leads.map((lead) => lead.ownerId));
  return leads.map((lead) => {
    const last = lead.comments?.[lead.comments.length - 1];
    return {
      negociacao: lead.name,
      cliente: lead.company || lead.contactName || "",
      valor: money(lead.value || 0),
      situacao: lead.status === "open" ? "aberta" : lead.status === "won" ? "venda feita" : "perdida",
      funil: names.funnel.get(String(lead.funnelId)) || "",
      etapa: names.stage.get(String(lead.stageId)) || "",
      temperatura: lead.temperature,
      proxima_acao: lead.nextActionDate ? new Date(lead.nextActionDate).toISOString().slice(0, 10) : "",
      responsavel: owners.get(String(lead.ownerId)) || "",
      origem: lead.source || "",
      ultimo_parecer: last ? `${last.text.slice(0, 280)} (${last.authorName}, ${new Date(last.createdAt).toISOString().slice(0, 10)})` : "",
      link: `/crm/${lead._id}`,
    };
  });
}

async function agenda(req: Request, input: Input) {
  const de = text(input, "de");
  const ate = text(input, "ate");
  if (!DATE.test(de) || !DATE.test(ate) || ate < de) return { erro: "Informe 'de' e 'ate' no formato AAAA-MM-DD." };
  const days = (Date.parse(ate) - Date.parse(de)) / 86_400_000;
  if (days > 62) return { erro: "Período muito longo: use no máximo 62 dias." };
  const tasks = await Task.find({ ...ownerScopeFor(req, "agenda"), dueDate: { $gte: de, $lte: ate } })
    .sort({ dueDate: 1, time: 1 })
    .limit(100)
    .select("title type dueDate time duration done leadId notes")
    .lean();
  const leads = await Lead.find({ _id: { $in: tasks.flatMap((task) => (task.leadId ? [task.leadId] : [])) } }).select("name").lean();
  const leadNames = new Map(leads.map((lead) => [String(lead._id), lead.name]));
  return tasks.map((task) => ({
    data: task.dueDate,
    horario: task.time || "sem horário",
    duracao_min: task.time ? task.duration : undefined,
    titulo: task.title,
    tipo: task.type,
    concluido: task.done,
    negociacao: task.leadId ? leadNames.get(String(task.leadId)) || "" : "",
    notas: (task.notes || "").slice(0, 200),
  }));
}

/** Valor do investimento como aparece na proposta (valor único ou os pacotes). */
function proposalValue(data: Record<string, unknown>) {
  const investment = (data.investment || {}) as { mode?: string; single?: { value?: string }; packages?: { name?: string; value?: string }[] };
  if (investment.mode === "packages" && investment.packages?.length) {
    return investment.packages.map((pkg) => `${pkg.name || "Pacote"}: ${pkg.value || ""}`).join(" · ");
  }
  return investment.single?.value || "";
}

async function buscarPropostas(req: Request, input: Input) {
  const filter: Record<string, unknown> = { ...ownerScopeFor(req, "propostas"), tool: "proposal" };
  const busca = text(input, "texto");
  if (busca) {
    const regex = new RegExp(escapeRegex(busca), "i");
    filter.$or = [{ title: regex }, { "data.client.company": regex }, { "data.client.name": regex }];
  }
  const docs = await ToolDocument.find(filter).sort({ updatedAt: -1 }).limit(15).select("title data.client data.investment data.leadId updatedAt").lean();
  const links = await ProposalLink.find({ documentId: { $in: docs.map((doc) => doc._id) } }).lean();
  const views = await ProposalView.aggregate<{ _id: unknown; opens: number; seconds: number; last: Date }>([
    { $match: { linkId: { $in: links.map((link) => link._id) } } },
    { $group: { _id: "$linkId", opens: { $sum: 1 }, seconds: { $sum: "$durationSeconds" }, last: { $max: "$openedAt" } } },
  ]);
  return docs.map((doc) => {
    const data = (doc.data || {}) as Record<string, unknown>;
    const client = (data.client || {}) as { company?: string; name?: string };
    const link = links.find((item) => String(item.documentId) === String(doc._id));
    const view = link ? views.find((item) => String(item._id) === String(link._id)) : undefined;
    return {
      proposta: doc.title,
      cliente: client.company || client.name || "",
      investimento: proposalValue(data),
      atualizada_em: new Date(doc.updatedAt as Date).toISOString().slice(0, 10),
      link_enviado: link ? (link.isActive ? "ativo" : "desativado") : "não criado",
      aberturas: view?.opens || 0,
      ultima_abertura: view?.last ? new Date(view.last).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "",
      minutos_de_leitura: view ? Math.round((view.seconds || 0) / 60) : 0,
      aceita: link?.acceptedAt ? `sim, em ${new Date(link.acceptedAt).toISOString().slice(0, 10)} por ${link.acceptedName || "cliente"}` : "não",
      negociacao: data.leadId ? `/crm/${data.leadId}` : "",
    };
  });
}

async function buscarContatos(req: Request, input: Input) {
  const busca = text(input, "texto", 80);
  if (!busca) return { erro: "Informe um nome, telefone ou e-mail." };
  const regex = new RegExp(escapeRegex(busca), "i");
  const digits = busca.replace(/\D/g, "");
  const contacts = await Contact.find({
    ...ownerScopeFor(req, "base"),
    $or: [{ name: regex }, { email: regex }, { nickname: regex }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits) }, { phoneKey: new RegExp(digits) }] : [])],
  })
    .limit(MAX_ROWS)
    .select("name nickname phone email niche birthDate kinds companyId")
    .populate("companyId", "name")
    .lean();
  return contacts.map((contact) => ({
    nome: contact.name,
    apelido: contact.nickname || "",
    telefone: contact.phone || "",
    email: contact.email || "",
    empresa: (contact.companyId as unknown as { name?: string } | undefined)?.name || "",
    nicho: contact.niche || "",
    aniversario: contact.birthDate || "",
    tipo: (contact.kinds || []).join(", "),
    link: `/contatos/${contact._id}`,
  }));
}

async function resumoFinanceiro(req: Request, input: Input) {
  const mes = MONTH.test(text(input, "mes")) ? text(input, "mes") : todayBR().slice(0, 7);
  const entries = await FinanceEntry.find({ ...ownerScopeFor(req, "financeiro"), date: { $regex: `^${mes}-` } }).lean();
  const today = todayBR();
  const sum = (list: typeof entries) => list.reduce((total, entry) => total + entryTotal(entry), 0);
  const received = entries.filter((entry) => entry.type === "income" && entry.status === "received");
  const pending = entries.filter((entry) => entry.type === "income" && entry.status === "pending");
  const paid = entries.filter((entry) => entry.type === "expense" && entry.status === "paid");
  const planned = entries.filter((entry) => entry.type === "expense" && entry.status === "planned");
  const top = (list: typeof entries) =>
    [...list]
      .sort((a, b) => entryTotal(b) - entryTotal(a))
      .slice(0, 5)
      .map((entry) => ({ descricao: entry.description, cliente: entry.client || "", categoria: entry.category, valor: money(entryTotal(entry)), data: entry.date }));
  return {
    mes,
    recebido: money(sum(received)),
    despesas_pagas: money(sum(paid)),
    resultado: money(sum(received) - sum(paid)),
    a_receber: money(sum(pending)),
    a_receber_vencidos: pending.filter((entry) => entry.date < today).length,
    despesas_previstas: money(sum(planned)),
    maiores_entradas: top(received),
    maiores_despesas: top(paid),
  };
}

const RUNNERS: Record<string, (req: Request, input: Input) => Promise<unknown>> = {
  resumo_crm: resumoCrm,
  buscar_negociacoes: buscarNegociacoes,
  agenda,
  buscar_propostas: buscarPropostas,
  buscar_contatos: buscarContatos,
  resumo_financeiro: resumoFinanceiro,
};

/** Executa uma chamada de ferramenta do Claude, conferindo o acesso do usuário ao módulo dela. */
export async function runToolCall(
  req: Request,
  call: Pick<Anthropic.Beta.BetaToolUseBlock, "id" | "name" | "input">,
  sources = new Set<string>(),
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = TOOLS.find((item) => item.name === call.name);
  const run = RUNNERS[call.name];
  if (!tool || !run) return { type: "tool_result", tool_use_id: call.id, content: "Ferramenta desconhecida.", is_error: true };
  if (!canUse(req, tool.module)) {
    return { type: "tool_result", tool_use_id: call.id, content: `O usuário não tem acesso à área ${tool.area}.`, is_error: true };
  }
  try {
    const input = call.input && typeof call.input === "object" ? (call.input as Input) : {};
    const data = await run(req, input);
    sources.add(tool.area);
    return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(data) };
  } catch (error) {
    console.error("[assistente]", call.name, error instanceof Error ? error.message : error);
    return { type: "tool_result", tool_use_id: call.id, content: "Não foi possível consultar agora.", is_error: true };
  }
}

function systemPrompt(companyName: string, userName: string) {
  return [
    `Você é o assistente do Noma, o sistema de gestão da ${companyName} (produtora audiovisual). Responda em português do Brasil, de forma direta e útil, para ${userName}.`,
    "Você consulta os dados reais do sistema pelas ferramentas (CRM, agenda, propostas, contatos e financeiro). Sempre que a pergunta depender de dados, use as ferramentas antes de responder; nunca invente números, nomes ou datas.",
    "Você só lê: não cria, altera nem apaga nada. Se pedirem uma alteração, explique onde fazer no sistema.",
    "Se uma ferramenta disser que o usuário não tem acesso a uma área, diga isso com clareza e não tente contornar.",
    "Formate valores em reais e datas como DD/MM/AAAA. Quando citar uma negociação ou contato, inclua o link do sistema como link em Markdown (ex.: [Clipe Aurora](/crm/123)).",
    "Respostas curtas: listas com marcadores quando houver vários itens, sem tabelas largas. Se não houver dados, diga isso.",
  ].join("\n");
}

/** Conversa com o assistente: a última mensagem é a pergunta; as anteriores, o histórico (só texto). */
export async function askAssistant(req: Request, turns: ChatTurn[], companyName: string): Promise<AssistantReply> {
  const ai = await aiClient();
  if (!ai) throw new AssistantUnavailableError("Configure a chave da Anthropic em Configurações → Integrações para usar o assistente.");

  const history = turns.slice(-20);
  const today = todayBR();
  // A data de hoje vai na pergunta (e não no system) para não quebrar o cache do início da conversa.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn, index) => ({
    role: turn.role,
    content: index === history.length - 1 ? `[Hoje é ${today.split("-").reverse().join("/")}]\n${turn.content}` : turn.content,
  }));
  const tools = TOOLS.map(({ module: _module, area: _area, ...tool }) => tool);
  const sources = new Set<string>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await ai.client.beta.messages.create({
      model: ai.model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: systemPrompt(companyName, req.user!.name),
      tools,
      messages,
      ...(FALLBACK_MODELS.includes(ai.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") {
      return { reply: "Não consigo ajudar com esse pedido. Tente perguntar de outro jeito.", sources: [...sources] };
    }
    const reply = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (response.stop_reason !== "tool_use") {
      if (response.stop_reason === "max_tokens" && !reply) return { reply: "A resposta ficou longa demais. Tente uma pergunta mais específica.", sources: [...sources] };
      return { reply: reply || "Não encontrei uma resposta.", sources: [...sources] };
    }

    // Conteúdo completo de volta (inclui os blocos de raciocínio e as chamadas de ferramenta).
    messages.push({ role: "assistant", content: response.content });
    const calls = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    // Todas as respostas das ferramentas voltam numa única mensagem.
    const results = await Promise.all(calls.map((call) => runToolCall(req, call, sources)));
    messages.push({ role: "user", content: results });
  }
  return { reply: "A consulta ficou longa demais. Tente uma pergunta mais específica.", sources: [...sources] };
}
