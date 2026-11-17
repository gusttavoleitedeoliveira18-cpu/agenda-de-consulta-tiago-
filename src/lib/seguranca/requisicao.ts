import "server-only";
import { siteUrl } from "@/lib/env";

/**
 * IP do cliente obtido SOMENTE de cabeçalho confiável do ambiente de hospedagem.
 * Na Vercel, x-real-ip / x-forwarded-for são definidos pela própria plataforma
 * (valores enviados pelo cliente são sobrescritos). Fora da Vercel, use
 * TRUSTED_IP_HEADER com o cabeçalho que o seu proxy reverso garante.
 */
export function ipConfiavel(req: Request): string {
  return ipDeHeaders(req.headers);
}

export function ipDeHeaders(headers: Headers): string {
  const h = process.env.VERCEL ? "x-real-ip" : process.env.TRUSTED_IP_HEADER?.toLowerCase();
  if (!h) return "sem-ip-confiavel";
  const valor = headers.get(h)?.split(",")[0]?.trim();
  return valor || "sem-ip-confiavel";
}

/** Verificação de origem (proteção CSRF para rotas POST públicas). */
export function origemPermitida(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const site = siteUrl();
  if (site && origin === site) return true;
  // Mesmo host da requisição (ex.: previews da Vercel ou localhost)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Lê JSON com limite de tamanho. */
export async function lerJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown> | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return null;
  const txt = await req.text();
  if (txt.length > maxBytes) return null;
  try {
    const j: unknown = JSON.parse(txt);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const SEM_CACHE = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer" } as const;
