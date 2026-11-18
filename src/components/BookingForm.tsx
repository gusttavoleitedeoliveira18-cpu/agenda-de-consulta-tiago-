"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import PhoneInput, { isValidPhoneNumber, type Country, type Value } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import pt from "react-phone-number-input/locale/pt.json";
import "react-phone-number-input/style.css";
import { site } from "@/config/site";
import { validate, type Erros } from "@/lib/validate";
import Turnstile, { type TurnstileHandle } from "@/components/Turnstile";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";

const input = "w-full min-h-[52px] rounded-xl bg-grafite border border-white/15 px-4 text-base text-marfim placeholder:text-neblina/70 focus:border-lima";

type Props = {
  fuso: string;
  rotuloFuso: string;
  turnstileSiteKey?: string;
};

type Resultado = { protocolo: string; whatsapp: string | null };

const SERVICOS = site.tipos.map((t) => t.v);

/** Link wa.me para o profissional com a solicitação já escrita (o aluno só aperta enviar). */
function linkParaProfissional(d: Record<string, string>, protocolo: string, rotuloFuso: string): string | null {
  const numero = site.whatsapp.replace(/\D/g, "");
  if (numero.length < 10) return null;
  const [ano, mes, dia] = (d.data_solicitada ?? "").split("-");
  const servico = site.tipos.find((t) => t.v === d.tipo_atendimento)?.l ?? d.tipo_atendimento;
  const linhas = [
    `Olá, ${site.nome.split(" ")[0]}! Gostaria de agendar uma avaliação.`,
    "",
    `Nome: ${d.nome}`,
    `Atendimento: ${servico}`,
    `Data desejada: ${dia}/${mes}/${ano} às ${d.horario_solicitado}, ${rotuloFuso}`,
    ...(d.objetivo?.trim() ? [`Objetivo: ${d.objetivo.trim()}`] : []),
    `Protocolo: ${protocolo}`,
  ];
  return `https://wa.me/${numero}?text=${encodeURIComponent(linhas.join("\n"))}`;
}

/** Data de hoje (YYYY-MM-DD) no fuso do profissional, independente do fuso do aparelho. */
function hojeNoFuso(fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Definido FORA do componente: antes ficava dentro do render e, a cada nova renderização
// (ex.: ao exibir erros), o React remontava os campos e apagava o que o aluno digitou.
function Field({ id, label, erro, children }: { id: string; label: string; erro?: string; children: ReactNode }) {
  return (
    <div><label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>{children}
      {erro && <p id={`${id}-e`} role="alert" className="mt-1.5 text-sm text-[#ff9d8a]">{erro}</p>}</div>);
}

function novaChave() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0");
}

export default function BookingForm({ fuso, rotuloFuso, turnstileSiteKey }: Props) {
  const [errs, setErrs] = useState<Erros>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [fail, setFail] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [tel, setTel] = useState<Value | undefined>();
  const [pais, setPais] = useState<Country | undefined>("BR");
  const [hoje, setHoje] = useState<string | undefined>();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaErro, setCaptchaErro] = useState(false);
  const chave = useRef<string>("");
  const turnstile = useRef<TurnstileHandle>(null);
  const enviando = useRef(false);
  const sucessoRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { setHoje(hojeNoFuso(fuso)); chave.current = novaChave(); }, [fuso]);
  useEffect(() => { if (state === "done") sucessoRef.current?.focus(); }, [state]);

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enviando.current) return; // evita clique duplo antes do re-render
    setFail("");
    const dados: Record<string, string> = {};
    // FormData é iterável com a lib "dom.iterable" do tsconfig; valores são string | File.
    for (const [k, v] of new FormData(ev.currentTarget)) if (typeof v === "string") dados[k] = v;
    dados.whatsapp = tel ?? "";
    dados.whatsapp_pais = pais ?? "";
    const { e, ok } = validate(dados, { hoje: hojeNoFuso(fuso), servicosDisponiveis: SERVICOS, telefoneValido: isValidPhoneNumber });
    setErrs(e);
    if (!ok) { document.getElementById(Object.keys(e)[0])?.focus(); return; }
    if (turnstileSiteKey && !captcha) {
      setFail(captchaErro ? "A verificação de segurança não carregou. Recarregue a página e tente novamente." : "Aguarde a verificação de segurança terminar e envie novamente.");
      return;
    }
    enviando.current = true;
    setState("sending");
    try {
      const r = await fetch("/api/agendamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, turnstile: captcha, idempotency_key: chave.current }),
      });
      const j = (await r.json().catch(() => ({}))) as { protocolo?: string; errors?: Erros; error?: string };
      if (r.ok && j.protocolo) {
        setResultado({ protocolo: j.protocolo, whatsapp: linkParaProfissional(dados, j.protocolo, rotuloFuso) });
        chave.current = novaChave();
        setState("done");
        return;
      }
      setErrs(j.errors ?? {});
      setFail(j.error ?? (j.errors ? "" : "Não foi possível registrar sua solicitação. Tente novamente."));
      if (j.errors) document.getElementById(Object.keys(j.errors)[0])?.focus();
    } catch {
      setFail("Sem conexão. Verifique a internet e tente de novo. Se o envio já tiver sido registrado, ele não será duplicado.");
    } finally {
      enviando.current = false;
      turnstile.current?.reset(); // tokens do Turnstile são de uso único
      setState((s) => (s === "done" ? s : "idle"));
    }
  }

  if (state === "done" && resultado) return (
    <div role="status" className="rounded-2xl border border-lima/40 bg-floresta p-8 text-center">
      <CheckCircle2 className="mx-auto mb-4 text-lima" size={44} aria-hidden />
      <h3 ref={sucessoRef} tabIndex={-1} className="font-display text-2xl font-semibold">Solicitação registrada!</h3>
      {resultado.whatsapp ? (<>
        <p className="mt-3 text-neblina">Agora é só enviar sua solicitação ao profissional pelo WhatsApp. A mensagem já está pronta: basta tocar em enviar.</p>
        <a href={resultado.whatsapp} target="_blank" rel="noopener noreferrer" className="mt-6 flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-lima px-6 text-lg font-semibold text-grafite transition active:scale-[.98]">
          <MessageCircle aria-hidden /> Enviar pelo WhatsApp</a>
      </>) : <p className="mt-3 text-neblina">O profissional irá analisar a disponibilidade e entrar em contato com você.</p>}
      <p className="mt-4 text-marfim">Protocolo: <strong className="font-display tracking-wide">{resultado.protocolo}</strong></p>
      <p className="mt-3 text-sm text-neblina">O horário só é confirmado após a resposta do profissional.</p>
    </div>);

  const a = (id: keyof Erros) => ({ id, name: id, className: input, "aria-invalid": !!errs[id], "aria-describedby": errs[id] ? `${id}-e` : undefined });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 rounded-2xl bg-floresta p-6 sm:p-8" aria-busy={state === "sending"}>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <Field id="nome" label="Nome completo *" erro={errs.nome}><input {...a("nome")} autoComplete="name" maxLength={120} /></Field>
      <Field id="email" label="E-mail *" erro={errs.email}><input {...a("email")} type="email" inputMode="email" autoComplete="email" maxLength={160} /></Field>
      <Field id="whatsapp" label="WhatsApp com DDD *" erro={errs.whatsapp}>
        <PhoneInput
          id="whatsapp" value={tel} onChange={setTel} country={pais} onCountryChange={setPais} defaultCountry="BR"
          international countryCallingCodeEditable={false} flags={flags} labels={pt} autoComplete="tel"
          countrySelectProps={{ "aria-label": "País do WhatsApp" }}
          aria-invalid={!!errs.whatsapp} aria-describedby={errs.whatsapp ? "whatsapp-e" : "whatsapp-d"}
          className={`${input} phone-field gap-3 focus-within:border-lima`}
          numberInputProps={{ className: "min-h-[50px] w-full flex-1 bg-transparent text-base text-marfim placeholder:text-neblina/70 focus-visible:outline-none", inputMode: "tel" }}
        />
        <p id="whatsapp-d" className="mt-1.5 text-sm text-neblina">Selecione o país pela bandeira. Números de outros países são aceitos.</p>
      </Field>
      <Field id="tipo_atendimento" label="Tipo de atendimento *" erro={errs.tipo_atendimento}>
        <select {...a("tipo_atendimento")} defaultValue=""><option value="" disabled>Selecione</option>
          {site.tipos.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="data_solicitada" label="Data desejada *" erro={errs.data_solicitada}><input {...a("data_solicitada")} type="date" min={hoje} /></Field>
        <Field id="horario_solicitado" label="Horário desejado *" erro={errs.horario_solicitado}><input {...a("horario_solicitado")} type="time" /></Field>
      </div>
      <p className="-mt-2 text-sm text-neblina">Horário no fuso do profissional: {rotuloFuso}. O envio é uma solicitação e ainda não confirma o horário.</p>
      <Field id="objetivo" label="Objetivo do treinamento (opcional)" erro={errs.objetivo}><textarea {...a("objetivo")} rows={3} maxLength={600} className={`${input} py-3`} /></Field>
      <p className="text-sm text-neblina">Seus dados serão utilizados para tratar sua solicitação de agendamento. Seu contato não será exibido publicamente. <a href="/privacidade" className="text-lima underline">Aviso de Privacidade</a></p>
      <div>
        <label htmlFor="privacidade" className="flex cursor-pointer items-start gap-3 text-sm">
          <input id="privacidade" name="privacidade" value="ciente" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-lima"
            aria-invalid={!!errs.privacidade} aria-describedby={errs.privacidade ? "privacidade-e" : undefined} />
          <span>Li e estou ciente do Aviso de Privacidade *</span>
        </label>
        {errs.privacidade && <p id="privacidade-e" role="alert" className="mt-1.5 text-sm text-[#ff9d8a]">{errs.privacidade}</p>}
      </div>
      {turnstileSiteKey && <Turnstile ref={turnstile} siteKey={turnstileSiteKey} onToken={setCaptcha} onErro={() => setCaptchaErro(true)} />}
      {fail && <p role="alert" className="rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">{fail}</p>}
      <button disabled={state === "sending"} className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-lima px-6 text-lg font-semibold text-grafite transition active:scale-[.98] disabled:opacity-60">
        {state === "sending" ? <><Loader2 className="animate-spin" aria-hidden /> Enviando…</> : "Solicitar avaliação"}</button>
      <p className="sr-only" aria-live="polite">{state === "sending" ? "Enviando solicitação…" : ""}</p>
    </form>);
}
