import type { NextFunction, Request, Response } from "express";
import type { Model } from "mongoose";
import { runWithOrg } from "../lib/tenant";

/**
 * Rotas públicas (sem login): descobre a empresa pelo próprio link (id público, código ou token)
 * e roda o restante da requisição dentro dela.
 */
export function publicOrg(model: Model<never>, field: string, param: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const doc = await model.findOne({ [field]: req.params[param] } as never).select("orgId").lean<{ orgId?: unknown }>();
      if (doc?.orgId) runWithOrg(String(doc.orgId), () => next());
      else next();
    } catch (error) {
      next(error);
    }
  };
}
