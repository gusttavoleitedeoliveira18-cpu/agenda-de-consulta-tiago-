"use client";
import { useState } from "react";
import { site } from "@/config/site";
import { validate } from "@/lib/validate";
import { CheckCircle2, Loader2 } from "lucide-react";
const input = "w-full min-h-[52px] rounded-xl bg-grafite border border-white/15 px-4 text-base text-marfim placeholder:text-neblina/70 focus:border-lima";
export default function BookingForm() {
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [fail, setFail] = useState("");
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setFail("");
    const data = Object.fromEntries(new FormData(ev.currentTarget).entries());
    const { e, ok } = validate(data);
    setErrs(e); if (!ok) { document.getElementById(Object.keys(e)[0])?.focus(); return; }
    setState("sending");
    try {
      const r = await fetch("/api/agendamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const j = await r.json();
      if (r.ok) setState("done"); else { setErrs(j.errors ?? {}); setFail(j.error ?? ""); setState("idle"); }
    } catch { setFail("Sem conexão. Verifique a internet e tente de novo."); setState("idle"); }
  }
  if (state === "done") return (
    <div role="status" className="rounded-2xl border border-lima/40 bg-floresta p-8 text-center">
      <CheckCircle2 className="mx-auto mb-4 text-lima" size={44} aria-hidden />
      <h3 className="font-display text-2xl font-semibold">Solicitação enviada com sucesso!</h3>
      <p className="mt-3 text-neblina">O profissional irá analisar a disponibilidade e você receberá um retorno por e-mail. O horário só é confirmado após essa resposta.</p>
    </div>);
  const F = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
    <div><label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>{children}
      {errs[id] && <p id={`${id}-e`} role="alert" className="mt-1.5 text-sm text-[#ff9d8a]">{errs[id]}</p>}</div>);
  const a = (id: string) => ({ id, name: id, className: input, "aria-invalid": !!errs[id], "aria-describedby": errs[id] ? `${id}-e` : undefined });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 rounded-2xl bg-floresta p-6 sm:p-8">
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <F id="nome" label="Nome completo *"><input {...a("nome")} autoComplete="name" /></F>
      <F id="email" label="E-mail *"><input {...a("email")} type="email" inputMode="email" autoComplete="email" /></F>
      <F id="whatsapp" label="WhatsApp com DDD *"><input {...a("whatsapp")} type="tel" inputMode="tel" autoComplete="tel" placeholder="(71) 99999-9999" /></F>
      <F id="tipo_atendimento" label="Tipo de atendimento *">
        <select {...a("tipo_atendimento")} defaultValue=""><option value="" disabled>Selecione</option>{site.tipos.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></F>
      <div className="grid gap-5 sm:grid-cols-2">
        <F id="data_solicitada" label="Data desejada *"><input {...a("data_solicitada")} type="date" min={new Date().toISOString().slice(0, 10)} /></F>
        <F id="horario_solicitado" label="Horário desejado *"><input {...a("horario_solicitado")} type="time" /></F>
      </div>
      <F id="objetivo" label="Objetivo do treinamento (opcional)"><textarea {...a("objetivo")} rows={3} maxLength={600} className={`${input} py-3`} /></F>
      <p className="text-sm text-neblina">Seus dados serão utilizados para tratar sua solicitação de agendamento. Seu contato não será exibido publicamente. <a href="/privacidade" className="text-lima underline">Aviso de Privacidade</a></p>
      {fail && <p role="alert" className="rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">{fail}</p>}
      <button disabled={state === "sending"} className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-lima px-6 text-lg font-semibold text-grafite transition active:scale-[.98] disabled:opacity-60">
        {state === "sending" ? <><Loader2 className="animate-spin" aria-hidden /> Enviando…</> : "Solicitar avaliação"}</button>
    </form>);
}
