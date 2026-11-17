import { DateTime, IANAZone } from "luxon";
import type { HorarioFuncionamento, DiaSemana } from "@/config/agenda";

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

export function formatarDataHora(iso: string | Date | null | undefined, fuso: string): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? DateTime.fromISO(iso, { zone: fuso }) : DateTime.fromJSDate(iso, { zone: fuso });
  if (!d.isValid) return "—";
  return d.setLocale("pt-BR").toFormat("cccc, dd/MM/yyyy 'às' HH:mm");
}

export function formatarCurto(iso: string | null | undefined, fuso: string): string {
  if (!iso) return "—";
  const d = DateTime.fromISO(iso, { zone: fuso });
  return d.isValid ? d.setLocale("pt-BR").toFormat("dd/MM/yyyy HH:mm") : "—";
}

/** Rótulo do fuso, ex.: "America/Bahia (UTC−03:00)". */
export function rotuloFuso(fuso: string, agora: Date = new Date()): string {
  const off = DateTime.fromJSDate(agora, { zone: fuso }).toFormat("ZZ").replace("-", "−");
  return `${fuso} (UTC${off})`;
}

/** Partes locais (data/hora) de um instante no fuso informado. */
export function partesLocais(iso: string, fuso: string) {
  const d = DateTime.fromISO(iso, { zone: fuso });
  return { data: d.toISODate() ?? "", hora: d.toFormat("HH:mm") };
}

/** Limites [início, fim) de um dia local, em ISO UTC. */
export function limitesDoDia(data: string, fuso: string) {
  const ini = DateTime.fromISO(data, { zone: fuso }).startOf("day");
  return { inicio: ini.toUTC().toISO()!, fim: ini.plus({ days: 1 }).toUTC().toISO()! };
}

/**
 * Verifica se [início, início+duração) cabe em alguma faixa de funcionamento.
 * Retorna true quando a agenda semanal não está configurada (sem validação).
 */
export function dentroDoFuncionamento(
  inicio: Date, duracaoMin: number, fuso: string, horario: HorarioFuncionamento | null,
): boolean {
  if (!horario) return true;
  const ini = DateTime.fromJSDate(inicio, { zone: fuso });
  const fim = ini.plus({ minutes: duracaoMin });
  if (fim.toISODate() !== ini.toISODate() && !(fim.hour === 0 && fim.minute === 0)) return false;
  const faixas = horario[ini.weekday as DiaSemana] ?? [];
  const minIni = ini.hour * 60 + ini.minute;
  const minFim = minIni + duracaoMin;
  return faixas.some(([a, b]) => {
    const [ah, am] = a.split(":").map(Number);
    const [bh, bm] = b.split(":").map(Number);
    return minIni >= ah * 60 + am && minFim <= bh * 60 + bm;
  });
}
