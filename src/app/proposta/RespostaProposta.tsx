"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type Proposta = {
  primeiro_nome: string; servico: string; inicio_solicitado: string; inicio_proposto: string;
  duracao_minutos: number | null; fuso_horario: string; expira_em: string; protocolo: string;
};
type Estado =
  | { k: "carregando" } | { k: "sem_token" } | { k: "erro"; msg: string }
  | { k: "proposta"; p: Proposta } | { k: "enviando"; p: Proposta; acao: "aceitar" | "recusar" }
  | { k: "concluido"; acao: "aceitar" | "recusar"; p: Proposta };

const MENSAGENS: Record<string, string> = {
  token_invalido: "Este link não é válido. Verifique se copiou o endereço completo do e-mail.",
  token_usado: "Esta proposta já foi respondida. Se precisar de ajuda, fale com o profissional.",
  token_expirado: "O prazo para responder a esta proposta terminou e o horário foi liberado. Você pode fazer uma nova solicitação no site.",
  proposta_inativa: "Esta proposta não está mais disponível. Ela pode ter sido substituída ou encerrada.",
  limite: "Muitas tentativas em pouco tempo. Aguarde alguns minutos.",
  indisponivel: "Serviço temporariamente indisponível. Tente novamente em instantes.",
};
const msg = (c?: string) => MENSAGENS[c ?? ""] ?? "Não foi possível concluir. Tente novamente em instantes.";

function quando(iso: string, fuso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function RespostaProposta() {
  const [e, setE] = useState<Estado>({ k: "carregando" });
  const token = useRef<string | null>(null); // somente em memória
  const titulo = useRef<HTMLHeadingElement>(null);

  async function chamar(acao: "consultar" | "aceitar" | "recusar") {
    const r = await fetch("/api/proposta", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer",
      body: JSON.stringify({ token: token.current, acao }),
    });
    return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }

  useEffect(() => {
    const carregar = (inicial: boolean) => {
      const t = new URLSearchParams(window.location.hash.slice(1)).get("t");
      // Remove o token da barra de endereço e do histórico.
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
      if (!t) { if (inicial) setE({ k: "sem_token" }); return; }
      token.current = t;
      setE({ k: "carregando" });
      chamar("consultar")
        .then(({ ok, j }) => setE(ok ? { k: "proposta", p: j as unknown as Proposta } : { k: "erro", msg: msg(j.erro as string) }))
        .catch(() => setE({ k: "erro", msg: "Sem conexão. Verifique a internet e recarregue o link do e-mail." }));
    };
    carregar(true);
    const aoMudar = () => carregar(false); // link colado numa aba já aberta
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  useEffect(() => { if (e.k === "concluido" || e.k === "erro") titulo.current?.focus(); }, [e.k]);

  async function responder(acao: "aceitar" | "recusar", p: Proposta) {
    if (acao === "recusar" && !window.confirm("Confirma que NÃO aceita o horário proposto? A solicitação será encerrada.")) return;
    setE({ k: "enviando", p, acao });
    try {
      const { ok, j } = await chamar(acao);
      if (ok) { token.current = null; setE({ k: "concluido", acao, p }); }
      else setE({ k: "erro", msg: msg(j.erro as string) });
    } catch {
      setE({ k: "proposta", p });
      window.alert("Sem conexão. Sua resposta não foi enviada; tente novamente.");
    }
  }

  const caixa = "mt-8 rounded-2xl bg-floresta p-6 sm:p-8";
  if (e.k === "carregando") return <p className="mt-8 flex items-center gap-2 text-neblina" role="status"><Loader2 className="animate-spin" aria-hidden /> Carregando proposta…</p>;
  if (e.k === "sem_token") return <div className={caixa}><p className="text-neblina">Abra esta página pelo botão do e-mail que você recebeu. O link contém um código pessoal.</p></div>;
  if (e.k === "erro") return <div className={caixa} role="alert"><XCircle className="mb-3 text-[#ff9d8a]" size={36} aria-hidden /><h2 ref={titulo} tabIndex={-1} className="font-display text-xl font-semibold">Não foi possível usar este link</h2><p className="mt-2 text-neblina">{e.msg}</p><a href="/#agendamento" className="mt-6 inline-block font-semibold text-lima underline">Fazer nova solicitação</a></div>;
  if (e.k === "concluido") return (
    <div className={`${caixa} border border-lima/40`} role="status">
      <CheckCircle2 className="mb-3 text-lima" size={40} aria-hidden />
      <h2 ref={titulo} tabIndex={-1} className="font-display text-2xl font-semibold">{e.acao === "aceitar" ? "Horário confirmado!" : "Resposta registrada"}</h2>
      <p className="mt-3 text-neblina">{e.acao === "aceitar"
        ? `Seu atendimento está confirmado para ${quando(e.p.inicio_proposto, e.p.fuso_horario)} (${e.p.fuso_horario === "America/Sao_Paulo" ? "horário de Brasília" : e.p.fuso_horario}). Você também receberá a confirmação por e-mail.`
        : "Registramos que você não aceitou o horário proposto. A solicitação foi encerrada e você pode enviar uma nova quando quiser."}</p>
      <p className="mt-4 text-sm text-neblina">Protocolo: <strong className="text-marfim">{e.p.protocolo}</strong></p>
    </div>);

  const p = e.p;
  const ocupado = e.k === "enviando";
  return (
    <div className={caixa}>
      <p className="text-lg">Olá, {p.primeiro_nome}! O profissional propôs um novo horário para o seu atendimento.</p>
      <dl className="mt-6 grid gap-3">
        {[["Atendimento", p.servico], ["Você solicitou", quando(p.inicio_solicitado, p.fuso_horario)], ["Horário proposto", quando(p.inicio_proposto, p.fuso_horario)],
          ["Fuso horário", p.fuso_horario === "America/Sao_Paulo" ? "Horário de Brasília" : p.fuso_horario],
          ["Responda até", quando(p.expira_em, p.fuso_horario)], ["Protocolo", p.protocolo]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-grafite p-4"><dt className="text-sm text-neblina">{k}</dt><dd className="font-display text-lg font-semibold">{v}</dd></div>))}
      </dl>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={ocupado} onClick={() => responder("aceitar", p)} className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-lima px-6 text-lg font-semibold text-grafite transition active:scale-[.98] disabled:opacity-60">
          {ocupado && e.acao === "aceitar" ? <><Loader2 className="animate-spin" aria-hidden /> Enviando…</> : "Aceitar horário"}</button>
        <button type="button" disabled={ocupado} onClick={() => responder("recusar", p)} className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl border border-white/20 px-6 text-lg font-semibold text-marfim transition active:scale-[.98] disabled:opacity-60">
          {ocupado && e.acao === "recusar" ? <><Loader2 className="animate-spin" aria-hidden /> Enviando…</> : "Não aceito"}</button>
      </div>
      <p className="mt-4 text-sm text-neblina">Sua resposta só é registrada ao clicar em um dos botões.</p>
    </div>);
}
