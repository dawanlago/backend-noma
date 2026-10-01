import type { NextFunction, Request, Response } from "express";
import { orgFilter } from "../lib/tenant";
import Funnel from "../models/Funnel";
import Form from "../models/Form";
import Lead from "../models/Lead";
import { firstOpenStage, normalizeStages, removedStageIds } from "../lib/funnels";

export async function listFunnels(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await Funnel.find().sort({ order: 1, createdAt: 1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function createFunnel(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.body.name || "").trim();
    const stages = normalizeStages(req.body.stages);
    if (!name || !stages.length) {
      res.status(400).json({ error: "Informe o nome do funil e pelo menos uma etapa." });
      return;
    }
    const last = await Funnel.findOne().sort({ order: -1 }).select("order").lean();
    const doc = await Funnel.create({ name, stages, order: (last?.order ?? -1) + 1 });
    res.status(201).json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

/** PUT /funnels/reorder { ids } — ordem dos funis no seletor do CRM. */
export async function reorderFunnels(req: Request, res: Response, next: NextFunction) {
  try {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: "Ordem inválida." });
      return;
    }
    await Funnel.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: String(id), ...orgFilter() }, update: { $set: { order } } } })));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** Ao remover etapas, as negociações delas vão para a primeira etapa em andamento. */
export async function updateFunnel(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Funnel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }
    if (typeof req.body.name === "string" && req.body.name.trim()) doc.name = req.body.name.trim();
    if (typeof req.body.order === "number") doc.order = req.body.order;
    if (req.body.stages !== undefined) {
      const previous = doc.stages.map((stage) => ({
        _id: stage._id,
        kind: stage.kind,
        key: stage.key,
        subStages: (stage.subStages || []).map((sub) => ({ _id: sub._id })),
      }));
      const stages = normalizeStages(req.body.stages, previous);
      if (!stages.length) {
        res.status(400).json({ error: "O funil precisa de pelo menos uma etapa." });
        return;
      }
      const removed = removedStageIds(previous, stages);
      doc.set("stages", stages);
      await doc.save();
      const target = firstOpenStage(stages)!;
      if (removed.length) {
        await Lead.updateMany(
          { funnelId: doc._id, stageId: { $in: removed } },
          { $set: { stageId: target._id, status: target.kind, stageEnteredAt: new Date() } },
        );
        await Form.updateMany({ funnelId: doc._id, stageId: { $in: removed } }, { $set: { stageId: target._id } });
      }
      // Microetapas removidas: as negociações ficam só na etapa.
      const subIds = stages.flatMap((stage) => stage.subStages.map((sub) => sub._id));
      await Lead.updateMany(
        { funnelId: doc._id, subStageId: { $exists: true, $nin: subIds } },
        { $unset: { subStageId: 1 }, $set: { subStageEnteredAt: new Date() } },
      );
      // Etapas que mudaram de tipo (ex.: virou "venda feita") atualizam o status das negociações.
      await Promise.all(
        stages.map((stage) =>
          Lead.updateMany(
            { funnelId: doc._id, stageId: stage._id, status: { $ne: stage.kind } },
            { $set: { status: stage.kind } },
          ),
        ),
      );
    } else {
      await doc.save();
    }
    res.json({ data: doc.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteFunnel(req: Request, res: Response, next: NextFunction) {
  try {
    const total = await Funnel.countDocuments();
    if (total <= 1) {
      res.status(400).json({ error: "Mantenha pelo menos um funil." });
      return;
    }
    const leads = await Lead.countDocuments({ funnelId: req.params.id });
    if (leads) {
      res.status(409).json({
        error: `Este funil tem ${leads} negociação(ões). Mova-as para outro funil antes de excluí-lo.`,
      });
      return;
    }
    const doc = await Funnel.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Funil não encontrado." });
      return;
    }
    await Form.updateMany({ funnelId: doc._id }, { $unset: { funnelId: 1, stageId: 1 } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
