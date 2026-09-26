import { isValidObjectId, Types } from "mongoose";
import type { StageKind } from "../types";

export interface SubStageInput {
  _id: Types.ObjectId;
  name: string;
}

export interface StageInput {
  _id: Types.ObjectId;
  name: string;
  kind: StageKind;
  color: string;
  key?: string;
  subStages: SubStageInput[];
}

interface StageLike {
  _id: Types.ObjectId | string;
  kind: StageKind;
}

const KINDS: StageKind[] = ["open", "won", "lost"];

/** Microetapas de uma etapa: mantém o id das que já existiam (as negociações apontam para ele). */
function normalizeSubStages(raw: unknown, previous: { _id: Types.ObjectId }[] = []): SubStageInput[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(previous.map((item) => String(item._id)));
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.name === "string" && item.name.trim())
    .map((item) => {
      const id = typeof item._id === "string" && isValidObjectId(item._id) && known.has(item._id) ? item._id : null;
      return { _id: id ? new Types.ObjectId(id) : new Types.ObjectId(), name: String(item.name).trim() };
    });
}

/** Valida as etapas vindas do formulário; etapas novas ganham id. */
export function normalizeStages(
  raw: unknown,
  previous: { _id: Types.ObjectId; key?: string; subStages?: { _id: Types.ObjectId }[] }[] = [],
): StageInput[] {
  if (!Array.isArray(raw)) return [];
  const known = new Map(previous.map((stage) => [String(stage._id), stage]));
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.name === "string" && item.name.trim())
    .map((item) => {
      const id = typeof item._id === "string" && isValidObjectId(item._id) && known.has(item._id) ? item._id : null;
      return {
        _id: id ? new Types.ObjectId(id) : new Types.ObjectId(),
        name: String(item.name).trim(),
        kind: KINDS.includes(item.kind as StageKind) ? (item.kind as StageKind) : "open",
        color: typeof item.color === "string" ? item.color : "",
        ...(id && known.get(id)?.key ? { key: known.get(id)!.key } : {}),
        subStages: normalizeSubStages(item.subStages, id ? known.get(id)?.subStages : []),
      };
    });
}

export function removedStageIds(previous: StageLike[], next: StageLike[]) {
  const kept = new Set(next.map((stage) => String(stage._id)));
  return previous.map((stage) => String(stage._id)).filter((id) => !kept.has(id));
}

/** Etapa inicial de um funil: a primeira em andamento (ou a primeira de todas). */
export function firstOpenStage<T extends StageLike>(stages: T[]): T | undefined {
  return stages.find((stage) => stage.kind === "open") || stages[0];
}

export function firstStageOfKind<T extends StageLike>(stages: T[], kind: StageKind): T | undefined {
  return stages.find((stage) => stage.kind === kind);
}
