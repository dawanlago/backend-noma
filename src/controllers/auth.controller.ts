import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { isAllowedOrigin } from "../config/cors";
import { env } from "../config/env";
import { emailConfigured, sendMail } from "../lib/email";
import User from "../models/User";
import { resolveAccess, sessionUser } from "../lib/access";

function createToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as SignOptions);
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      res.status(400).json({ error: "Informe e-mail e senha." });
      return;
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !user.isActive || !(await user.comparePassword(password))) {
      res.status(401).json({ error: "E-mail ou senha inválidos." });
      return;
    }

    const access = await resolveAccess(user, req.headers["x-org-id"]);
    if (!access) {
      res.status(403).json({ error: "Seu usuário não tem acesso a nenhuma empresa. Fale com um administrador." });
      return;
    }

    const token = createToken(user._id.toString());

    res.json({
      token,
      user: sessionUser(user, access),
    });
  } catch (error) {
    next(error);
  }
}

export function me(req: Request, res: Response) {
  res.json({ user: sessionUser(req.user!, req.access!) });
}

const MIN_PASSWORD = 8;
const RESET_MINUTES = 60;

function passwordError(password: string) {
  return password.length < MIN_PASSWORD ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` : "";
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Endereço do sistema para montar o link: o site de onde veio o pedido (se confiável) ou o FRONTEND_URL. */
function appUrl(req: Request) {
  const origin = req.headers.origin;
  return (origin && isAllowedOrigin(origin) ? origin : env.frontendUrl).replace(/\/+$/, "");
}

/**
 * POST /auth/forgot-password { email } — manda o link de redefinição.
 * Responde igual exista ou não a conta, para não revelar quem tem cadastro.
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: "Informe o e-mail." });
      return;
    }
    if (!emailConfigured()) {
      res.status(503).json({ error: "O envio de e-mail não está configurado. Peça a um administrador para redefinir a sua senha." });
      return;
    }
    const user = await User.findOne({ email, isActive: true }).select("+resetTokenExpiresAt");
    // Pedido repetido em menos de 2 minutos: não manda outro e-mail (evita abuso).
    const lastRequest = user?.resetTokenExpiresAt ? user.resetTokenExpiresAt.getTime() - RESET_MINUTES * 60_000 : 0;
    if (user && Date.now() - lastRequest > 2 * 60_000) {
      const token = crypto.randomBytes(32).toString("base64url");
      user.resetTokenHash = hashToken(token);
      user.resetTokenExpiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
      await user.save();
      const link = `${appUrl(req)}/redefinir-senha?token=${token}`;
      const firstName = user.name.split(" ")[0];
      await sendMail({
        to: user.email,
        subject: "Redefinir a sua senha · Noma",
        text: `Olá, ${firstName}!\n\nRecebemos um pedido para redefinir a sua senha do Noma. Abra o link abaixo (vale por ${RESET_MINUTES} minutos):\n${link}\n\nSe não foi você, ignore este e-mail: a sua senha continua a mesma.`,
        html: `<p>Olá, ${firstName}!</p><p>Recebemos um pedido para redefinir a sua senha do <strong>Noma</strong>.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#C8102E;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Criar nova senha</a></p><p style="color:#666;font-size:13px">O link vale por ${RESET_MINUTES} minutos. Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>`,
      });
    }
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}

/** POST /auth/reset-password { token, password } — troca a senha com o código do e-mail (uso único). */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    const invalid = passwordError(password);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const user = token
      ? await User.findOne({ resetTokenHash: hashToken(token), resetTokenExpiresAt: { $gt: new Date() }, isActive: true }).select("+password")
      : null;
    if (!user) {
      res.status(400).json({ error: "Este link expirou ou já foi usado. Peça um novo em “Esqueci a senha”." });
      return;
    }
    user.password = password;
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}

/** POST /auth/change-password { currentPassword, newPassword } — usuário logado troca a própria senha. */
export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const current = String(req.body?.currentPassword || "");
    const password = String(req.body?.newPassword || "");
    const invalid = passwordError(password);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const user = await User.findById(req.user!._id).select("+password");
    if (!user || !(await user.comparePassword(current))) {
      res.status(400).json({ error: "A senha atual não confere." });
      return;
    }
    user.password = password;
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}
