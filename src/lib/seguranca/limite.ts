import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveCriptografia, modoTeste } from "@/lib/env";
import { pseudonimo, subchave } from "./cripto";

// Rate limiting persistente e compartilhado entre instâncias serverless:
// contador atômico no PostgreSQL (função consumir_limite). As chaves são
// pseudonimizadas com HMAC — nem IP nem e-mail são gravados em claro.
// Retenção: janelas com mais de 2 dias são apagadas diariamente (limpar_temporarios).

export type Regra = { nome: string; janelaSegundos: number; max: number };

export const REGRAS = {
  solicitacaoPorIp: { nome: "sol-ip", janelaSegundos: 3600, max: 8 },
  solicitacaoPorEmail: { nome: "sol-email", janelaSegundos: 86400, max: 5 },
  propostaPorIp: { nome: "prop-ip", janelaSegundos: 600, max: 30 },
  loginPorIp: { nome: "login-ip", janelaSegundos: 900, max: 10 },
  recuperacaoPorIp: { nome: "rec-ip", janelaSegundos: 3600, max: 5 },
} satisfies Record<string, Regra>;

export type ResultadoLimite = "ok" | "excedido" | "nao_configurado" | "erro";

export async function consumir(db: SupabaseClient, regra: Regra, identificador: string): Promise<ResultadoLimite> {
  const chave = chaveCriptografia();
  if (!chave) return "nao_configurado";
  const id = pseudonimo(`${regra.nome}:${identificador}`, subchave(chave, "rate-limit-v1"));
  const { data, error } = await db.rpc("consumir_limite", {
    p_chave: `${regra.nome}:${id}`, p_janela_segundos: regra.janelaSegundos, p_max: regra.max,
  });
  if (error) return "erro";
  return data === true ? "ok" : "excedido";
}

/** Em modo de teste local o limite pode ser desligado explicitamente. */
export const limiteDesligadoEmTeste = () => modoTeste() && process.env.TEST_DISABLE_RATE_LIMIT === "1";
