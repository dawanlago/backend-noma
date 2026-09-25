import type { Types } from "mongoose";
import type { StageKind } from "../types";

interface StageRef {
  _id: Types.ObjectId;
  key?: string;
  kind: StageKind;
}

/** Campos que um lead do CRM antigo (etapa fixa em `stage`) ganha ao entrar no funil padrão. */
export function legacyLeadPatch(doc: Record<string, unknown>, funnelId: Types.ObjectId, stages: StageRef[]) {
  const firstOpen = stages.find((stage) => stage.kind === "open") || stages[0];
  const stage = stages.find((item) => item.key && item.key === doc.stage) || firstOpen;
  const value = Number(doc.value) || 0;
  return {
    funnelId,
    stageId: stage._id,
    status: stage.kind,
    customValue: value,
    value,
    products: [],
    temperature: "warm",
    contactName: typeof doc.contactName === "string" ? doc.contactName : "",
    custom: {},
    comments: [],
    history: [],
  };
}
