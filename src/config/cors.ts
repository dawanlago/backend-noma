import type { CorsOptions } from "cors";
import { env } from "./env";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const extraOrigins = (process.env.FRONTEND_URLS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set(
  [
    env.frontendUrl,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    ...extraOrigins,
  ]
    .map(normalizeOrigin)
    .filter(Boolean),
);

function isTrustedHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "netlify.app" ||
    hostname.endsWith(".netlify.app") ||
    hostname === "vercel.app" ||
    hostname.endsWith(".vercel.app") ||
    // Domínio próprio da Noma (com ou sem www / subdomínios).
    hostname === "nomacria.com" ||
    hostname.endsWith(".nomacria.com")
  );
}

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) {
    return true;
  }

  try {
    const url = new URL(normalized);
    return isTrustedHost(url.hostname);
  } catch {
    return false;
  }
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id"],
  optionsSuccessStatus: 204,
};
