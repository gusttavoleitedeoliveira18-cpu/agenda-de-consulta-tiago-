import { DateTime, IANAZone } from "luxon";

// Conversões explícitas de fuso. Nunca usamos o fuso do servidor ou do navegador
// para interpretar o horário do profissional.

export type ResultadoConversao =
  | { ok: true; instante: Date }
  | { ok: false; erro: "formato" | "inexistente" | "ambiguo" };

/**
 * Converte data (YYYY-MM-DD) + hora (HH:MM) LOCAIS do fuso informado em um instante UTC.
 * Rejeita horários inexistentes (salto do horário de verão) e ambíguos (recuo),
 * em vez de aceitar uma conversão silenciosamente incorreta.
 */
export function localParaInstante(data: string, hora: string, fuso: string): ResultadoConversao {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!m || !h) return { ok: false, erro: "formato" };
  const [ano, mes, dia, hh, mm] = [+m[1], +m[2], +m[3], +h[1], +h[2]];
  const zona = IANAZone.create(fuso);
  if (!zona.isValid) return { ok: false, erro: "formato" };
  const ingenuo = Date.UTC(ano, mes - 1, dia, hh, mm);
  const check = new Date(ingenuo);
  if (check.getUTCFullYear() !== ano || check.getUTCMonth() !== mes - 1 || check.getUTCDate() !== dia) {
    return { ok: false, erro: "formato" }; // ex.: 31/02
  }
  // Candidatos: offsets vigentes em torno do horário. Um candidato é válido quando
  // o offset no instante resultante é o mesmo usado na conversão.
  const offsets = new Set([-26, -12, 0, 12, 26].map((d) => zona.offset(ingenuo + d * 3600_000)));
  const validos = new Set<number>();
  for (const o of offsets) {
    const utc = ingenuo - o * 60_000;
    if (zona.offset(utc) === o) validos.add(utc);
  }
  if (validos.size === 0) return { ok: false, erro: "inexistente" };
  if (validos.size > 1) return { ok: false, erro: "ambiguo" };
  return { ok: true, instante: new Date([...validos][0]) };
}

/** Data de hoje (YYYY-MM-DD) no fuso do profissional. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return DateTime.fromJSDate(agora, { zone: fuso }).toISODate() ?? "";
}

const NOMES_FUSO: Record<string, string> = { "America/Sao_Paulo": "horário de Brasília" };

/** Rótulo do fuso, ex.: "horário de Brasília (UTC−03:00)" ou "America/Bahia (UTC−03:00)". */
export function rotuloFuso(fuso: string, agora: Date = new Date()): string {
  const off = DateTime.fromJSDate(agora, { zone: fuso }).toFormat("ZZ").replace("-", "−");
  return `${NOMES_FUSO[fuso] ?? fuso} (UTC${off})`;
}

export const nomeFuso = (fuso: string) => NOMES_FUSO[fuso] ?? fuso;
