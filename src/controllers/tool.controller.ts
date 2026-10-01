import type { NextFunction, Request, Response } from "express";
import ToolDocument from "../models/ToolDocument";
import { hasModule } from "../lib/permissions";
import { ownerScope, recordScope, useModuleScope, withOwnerNames } from "../lib/ownership";
import { TOOL_MODULES, type ToolKey } from "../types";
import { removeProposalShare, shareSummaries } from "./proposalLink.controller";

const TOOLS: ToolKey[] = ["proposal", "contract", "budget", "briefing"];

function toolParam(req: Request, res: Response): ToolKey | null {
  const tool = req.params.tool as ToolKey;
  if (!TOOLS.includes(tool)) {
    res.status(404).json({ error: "Ferramenta não encontrada." });
    return null;
  }
  if (!hasModule(req.user!, TOOL_MODULES[tool])) {
    res.status(403).json({ error: "Seu usuário não tem acesso a esta ferramenta." });
    return null;
  }
  useModuleScope(req, TOOL_MODULES[tool]);
  return tool;
}

export async function listToolDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    // A listagem não traz `data`: propostas podem carregar imagens pesadas.
    const docs = await ToolDocument.find({ tool, ...ownerScope(req) })
      .select("-data")
      .sort({ updatedAt: -1 })
      .lean();
    const withNames = await withOwnerNames(docs);
    if (tool !== "proposal") {
      res.json({ data: withNames });
      return;
    }
    // Propostas levam o resumo do link público (selo "Visto há…").
    const shares = await shareSummaries(docs.map((doc) => doc._id));
    res.json({ data: withNames.map((doc) => ({ ...doc, share: shares.get(String(doc._id)) || null })) });
  } catch (error) {
    next(error);
  }
}

export async function getToolDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    const doc = await ToolDocument.findOne({ _id: req.params.id, tool, ...recordScope(req) }).lean();
    if (!doc) {
      res.status(404).json({ error: "Documento não encontrado." });
      return;
    }
    const [withName] = await withOwnerNames([doc]);
    res.json({ data: withName });
  } catch (error) {
    next(error);
  }
}

export async function createToolDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    const doc = await ToolDocument.create({
      tool,
      ownerId: req.user!._id,
      title: req.body.title,
      data: req.body.data || {},
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateToolDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    const doc = await ToolDocument.findOne({ _id: req.params.id, tool, ...recordScope(req) });
    if (!doc) {
      res.status(404).json({ error: "Documento não encontrado." });
      return;
    }
    if (typeof req.body.title === "string") doc.title = req.body.title;
    if (req.body.data && typeof req.body.data === "object") {
      doc.data = req.body.data;
      doc.markModified("data");
    }
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function duplicateToolDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    const source = await ToolDocument.findOne({ _id: req.params.id, tool, ...recordScope(req) }).lean();
    if (!source) {
      res.status(404).json({ error: "Documento não encontrado." });
      return;
    }
    const doc = await ToolDocument.create({
      tool,
      ownerId: req.user!._id,
      title: `${source.title} (cópia)`,
      data: source.data,
    });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteToolDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const tool = toolParam(req, res);
    if (!tool) return;
    const doc = await ToolDocument.findOneAndDelete({ _id: req.params.id, tool, ...recordScope(req) });
    if (!doc) {
      res.status(404).json({ error: "Documento não encontrado." });
      return;
    }
    if (tool === "proposal") await removeProposalShare(doc._id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
