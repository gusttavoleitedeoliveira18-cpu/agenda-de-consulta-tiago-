"use client";
import { useActionState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { EstadoForm } from "@/app/admin/acesso";

export const campo = "w-full min-h-[52px] rounded-xl bg-grafite border border-white/15 px-4 text-base text-marfim placeholder:text-neblina/70 focus:border-lima";

export default function FormAcesso({ acao, botao, children }: {
  acao: (s: EstadoForm, fd: FormData) => Promise<EstadoForm>; botao: string; children: ReactNode;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="grid gap-5 rounded-2xl bg-floresta p-6 sm:p-8" aria-busy={pendente}>
      {children}
      {estado.erro && <p role="alert" className="rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">{estado.erro}</p>}
      {estado.msg && <p role="status" className="rounded-lg border border-lima/40 p-3 text-sm">{estado.msg}</p>}
      <button disabled={pendente} className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-lima px-6 text-lg font-semibold text-grafite transition active:scale-[.98] disabled:opacity-60">
        {pendente ? <><Loader2 className="animate-spin" aria-hidden /> Aguarde…</> : botao}</button>
    </form>);
}
