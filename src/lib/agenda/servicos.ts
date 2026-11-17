import "server-only";
import { agenda, type CodigoServico } from "@/config/agenda";
import { site } from "@/config/site";
import { duracoesDeTeste } from "@/lib/env";

export type ServicoEfetivo = { codigo: CodigoServico; nome: string; duracaoMinutos: number | null; bufferMinutos: number; ativo: boolean };

/** Configuração operacional efetiva (em modo de teste local, durações podem vir de TEST_SERVICE_DURATIONS). */
export function servico(codigo: string): ServicoEfetivo | null {
  const op = agenda.servicos[codigo as CodigoServico];
  const t = site.tipos.find((x) => x.v === codigo);
  if (!op || !t) return null;
  const teste = duracoesDeTeste();
  return {
    codigo: codigo as CodigoServico, nome: t.l,
    duracaoMinutos: teste?.[codigo] ?? op.duracaoMinutos,
    bufferMinutos: op.bufferMinutos, ativo: op.ativo,
  };
}

export function servicosDisponiveis(): string[] {
  return site.tipos.map((t) => servico(t.v)).filter((s): s is ServicoEfetivo => !!s && s.ativo && !!s.duracaoMinutos).map((s) => s.codigo);
}

export function nomeServico(codigo: string): string {
  return site.tipos.find((t) => t.v === codigo)?.l ?? codigo;
}
