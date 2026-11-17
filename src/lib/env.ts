import "server-only";
import { IANAZone } from "luxon";

// Leitura e validação centralizada das variáveis de ambiente do SERVIDOR.
// Nenhum valor daqui pode ser importado por componentes "use client".

const v = (k: string) => {
  const x = process.env[k];
  return x && x.trim() ? x.trim() : undefined;
};

/** Modo de teste local: só existe fora da Vercel e exige APP_TEST_MODE=1 explicitamente. */
export function modoTeste(): boolean {
  return v("APP_TEST_MODE") === "1" && !process.env.VERCEL;
}

export function supabaseConfig() {
  const url = v("SUPABASE_URL") ?? v("NEXT_PUBLIC_SUPABASE_URL");
  const secret = v("SUPABASE_SECRET_KEY") ?? v("SUPABASE_SERVICE_ROLE_KEY"); // SERVICE_ROLE: nome legado
  return { url, secret };
}

export function fusoProfissional(): string {
  const tz = v("PROFESSIONAL_TIME_ZONE") ?? "America/Sao_Paulo"; // horário de Brasília
  if (!IANAZone.isValidZone(tz)) throw new Error("PROFESSIONAL_TIME_ZONE inválido");
  return tz;
}

/** URL pública do site (opcional): usada na verificação de origem das requisições. */
export function siteUrl(): string | undefined {
  const u = v("PUBLIC_SITE_URL");
  if (!u) return undefined;
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
}

/** Turnstile é OPCIONAL: ativado quando as duas chaves estiverem configuradas. */
export function turnstileConfig() {
  return {
    secret: v("TURNSTILE_SECRET_KEY"),
    siteKey: v("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
    verifyUrl: (modoTeste() && v("TEST_TURNSTILE_VERIFY_URL")) || "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  };
}
