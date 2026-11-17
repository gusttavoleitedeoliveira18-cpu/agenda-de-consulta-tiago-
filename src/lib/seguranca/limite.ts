import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { modoTeste, supabaseConfig } from "@/lib/env";
import { pseudonimo, subchave } from "./cripto";

// Rate limiting persistente e compartilhado entre instâncias serverless:
// contador atômico no PostgreSQL (função consumir_limite). As chaves são
// pseudonimizadas com HMAC (chave derivada da chave secreta do servidor) —
// nem IP nem e-mail são gravados em claro. Retenção: 2 dias (pg_cron diário).

export type Regra = { nome: string; janelaSegundos: number; max: number };

export const REGRAS = {
  solicitacaoPorIp: { nome: "sol-ip", janelaSegundos: 3600, max: 8 },
  solicitacaoPorEmail: { nome: "sol-email", janelaSegundos: 86400, max: 5 },
} satisfies Record<string, Regra>;

export type ResultadoLimite = "ok" | "excedido" | "erro";

export async function consumir(db: SupabaseClient, regra: Regra, identificador: string): Promise<ResultadoLimite> {
  const { secret } = supabaseConfig();
  if (!secret) return "erro";
  const chave = subchave(Buffer.from(secret, "utf8"), "rate-limit-v1");
  const id = pseudonimo(`${regra.nome}:${identificador}`, chave);
  const { data, error } = await db.rpc("consumir_limite", {
    p_chave: `${regra.nome}:${id}`, p_janela_segundos: regra.janelaSegundos, p_max: regra.max,
  });
  if (error) return "erro";
  return data === true ? "ok" : "excedido";
}

/** Em modo de teste local o limite pode ser desligado explicitamente. */
export const limiteDesligadoEmTeste = () => modoTeste() && process.env.TEST_DISABLE_RATE_LIMIT === "1";
