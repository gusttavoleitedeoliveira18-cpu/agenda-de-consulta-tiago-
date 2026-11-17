import "server-only";

export const COLUNAS_LISTA = "id, protocolo, nome, tipo_atendimento, status, inicio_referencia, inicio_solicitado, expira_em, created_at, legado, reserva_inicio";

export type Linha = {
  id: string; protocolo: string; nome: string; tipo_atendimento: string; status: string; inicio_referencia: string;
  inicio_solicitado: string; expira_em: string | null; created_at: string; legado: boolean; reserva_inicio: string | null;
};

/** Remove caracteres com significado especial em filtros (%, _, *, vírgulas, parênteses). */
export function termoBusca(q: unknown): string {
  return typeof q === "string" ? q.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim().slice(0, 60) : "";
}

export function prazoRestante(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "vencido";
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
