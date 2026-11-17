import { CheckCircle2, Clock, Hourglass, XCircle, Ban, TimerOff } from "lucide-react";

// Estado comunicado por texto + ícone (não somente por cor).
const MAPA = {
  pendente: { t: "Pendente", I: Clock, c: "border-lima/50 text-lima" },
  aguardando_resposta: { t: "Aguardando resposta", I: Hourglass, c: "border-[#9ad0ff]/60 text-[#9ad0ff]" },
  confirmado: { t: "Confirmado", I: CheckCircle2, c: "border-lima bg-lima text-grafite" },
  recusado: { t: "Recusado", I: XCircle, c: "border-[#ff9d8a]/60 text-[#ff9d8a]" },
  cancelado: { t: "Cancelado", I: Ban, c: "border-white/30 text-neblina" },
  expirado: { t: "Expirado", I: TimerOff, c: "border-white/30 text-neblina" },
} as const;

export const ESTADOS = Object.keys(MAPA) as Array<keyof typeof MAPA>;
export const rotuloEstado = (s: string) => (MAPA as Record<string, { t: string }>)[s]?.t ?? s;

export default function Status({ s }: { s: string }) {
  const m = (MAPA as Record<string, (typeof MAPA)[keyof typeof MAPA]>)[s];
  if (!m) return <span>{s}</span>;
  const { t, I, c } = m;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium ${c}`}><I size={15} aria-hidden />{t}</span>;
}
