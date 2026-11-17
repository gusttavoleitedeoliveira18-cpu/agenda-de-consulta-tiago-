"use client";
import { useActionState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { EstadoAcao } from "@/app/admin/acoes";

export const campoAdmin = "w-full min-h-[48px] rounded-xl bg-grafite border border-white/15 px-4 text-base text-marfim placeholder:text-neblina/70 focus:border-lima";

export default function AcaoForm({ acao, id, rotulo, confirmar, variante = "primaria", children, extras }: {
  acao: (s: EstadoAcao, fd: FormData) => Promise<EstadoAcao>;
  id: string; rotulo: string; confirmar?: string; variante?: "primaria" | "secundaria" | "perigo";
  children?: ReactNode; extras?: Record<string, string>;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const estilo = variante === "primaria" ? "bg-lima text-grafite" : variante === "perigo" ? "border border-[#ff9d8a]/60 text-[#ff9d8a]" : "border border-white/20 text-marfim";
  return (
    <form action={enviar} onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }} className="grid gap-3" aria-busy={pendente}>
      <input type="hidden" name="id" value={id} />
      {extras && Object.entries(extras).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button disabled={pendente || estado.ok} className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 font-semibold transition active:scale-[.98] disabled:opacity-60 ${estilo}`}>
        {pendente ? <><Loader2 className="animate-spin" size={18} aria-hidden /> Processando…</> : rotulo}</button>
      {estado.erro && <p role="alert" className="rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">{estado.erro}</p>}
      {estado.msg && <p role="status" className="rounded-lg border border-lima/40 p-3 text-sm">{estado.msg}</p>}
    </form>);
}
