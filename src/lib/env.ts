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

/** Produção = deploy de produção na Vercel ou NODE_ENV=production sem modo de teste. */
export function emProducao(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.NODE_ENV === "production" && !modoTeste();
}

export function supabaseConfig() {
  const url = v("NEXT_PUBLIC_SUPABASE_URL") ?? v("SUPABASE_URL"); // SUPABASE_URL: nome legado do projeto
  const publishable = v("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? v("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secret = v("SUPABASE_SECRET_KEY") ?? v("SUPABASE_SERVICE_ROLE_KEY");
  return { url, publishable, secret };
}

export function fusoProfissional(): string {
  const tz = v("PROFESSIONAL_TIME_ZONE") ?? "America/Bahia";
  if (!IANAZone.isValidZone(tz)) throw new Error("PROFESSIONAL_TIME_ZONE inválido");
  return tz;
}

export function siteUrl(): string | undefined {
  const u = v("PUBLIC_SITE_URL");
  if (!u) return undefined;
  try {
    const p = new URL(u);
    if (emProducao() && p.protocol !== "https:") return undefined;
    return p.origin;
  } catch {
    return undefined;
  }
}

export function emailConfig() {
  return {
    apiKey: v("RESEND_API_KEY"),
    from: v("EMAIL_FROM"),
    admin: v("ADMIN_NOTIFICATION_EMAIL"),
    webhookSecret: v("RESEND_WEBHOOK_SECRET"),
    // Somente em modo de teste: permite apontar para um servidor falso local.
    apiUrl: (modoTeste() && v("TEST_RESEND_API_URL")) || "https://api.resend.com",
  };
}

export function turnstileConfig() {
  return {
    secret: v("TURNSTILE_SECRET_KEY"),
    siteKey: v("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
    verifyUrl: (modoTeste() && v("TEST_TURNSTILE_VERIFY_URL")) || "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  };
}

export const cronSecret = () => v("CRON_SECRET");

/** Chave AES-256 (32 bytes em base64). */
export function chaveCriptografia(): Buffer | undefined {
  const k = v("TOKEN_ENCRYPTION_KEY");
  if (!k) return undefined;
  const b = Buffer.from(k, "base64");
  return b.length === 32 ? b : undefined;
}

/** Durações substitutas SOMENTE para testes locais automatizados (nunca em produção). */
export function duracoesDeTeste(): Record<string, number> | undefined {
  if (!modoTeste()) return undefined;
  const raw = v("TEST_SERVICE_DURATIONS");
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([, n]) => typeof n === "number" && n >= 5)) as Record<string, number>;
  } catch {
    return undefined;
  }
}

/** Relatório de configuração (sem valores) para logs e README. */
export function pendenciasDeConfiguracao(): string[] {
  const p: string[] = [];
  const s = supabaseConfig();
  if (!s.url) p.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!s.publishable) p.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!s.secret) p.push("SUPABASE_SECRET_KEY");
  if (!siteUrl()) p.push("PUBLIC_SITE_URL");
  const e = emailConfig();
  if (!e.apiKey) p.push("RESEND_API_KEY");
  if (!e.from) p.push("EMAIL_FROM");
  if (!e.admin) p.push("ADMIN_NOTIFICATION_EMAIL");
  const t = turnstileConfig();
  if (!t.secret) p.push("TURNSTILE_SECRET_KEY");
  if (!t.siteKey) p.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  if (!cronSecret()) p.push("CRON_SECRET");
  if (!chaveCriptografia()) p.push("TOKEN_ENCRYPTION_KEY");
  return p;
}
