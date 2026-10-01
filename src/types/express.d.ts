import type { AccessLevels, ResolvedAccess } from "../lib/access";
import type { IUser } from "../models/User";
import type { AccessLevel } from "./index";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      /** Empresa ativa e níveis de acesso do usuário nela. */
      access?: ResolvedAccess & { levels: AccessLevels };
      /** Alcance do módulo desta rota: "own" (só os registros dele) ou "all". */
      scopeLevel?: AccessLevel;
    }
  }
}

export {};
