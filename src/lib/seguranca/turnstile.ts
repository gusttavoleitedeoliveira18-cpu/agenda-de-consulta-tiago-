import "server-only";
import { turnstileConfig, modoTeste } from "@/lib/env";

export type ResultadoTurnstile = "ok" | "invalido" | "nao_configurado" | "indisponivel";

/** Verificação server-side do Cloudflare Turnstile (siteverify). */
export async function verificarTurnstile(token: unknown, ip: string): Promise<ResultadoTurnstile> {
  const { secret, verifyUrl } = turnstileConfig();
  if (!secret) return "nao_configurado";
  if (typeof token !== "string" || !token || token.length > 2048) return "invalido";
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "sem-ip-confiavel") body.set("remoteip", ip);
  try {
    const r = await fetch(verifyUrl, { method: "POST", body, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) return "indisponivel";
    const j = (await r.json()) as { success?: boolean };
    return j.success === true ? "ok" : "invalido";
  } catch {
    return "indisponivel";
  }
}

/** Em modo de teste local sem chave, a verificação é dispensada explicitamente. */
export function turnstileDispensado(): boolean {
  return modoTeste() && !turnstileConfig().secret;
}
