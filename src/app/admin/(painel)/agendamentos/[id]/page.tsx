import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { exigirAdminPagina } from "@/lib/admin/auth";
import { prazoRestante } from "@/lib/admin/consultas";
import { fusoProfissional } from "@/lib/env";
import { formatarCurto, formatarDataHora, hojeNoFuso, partesLocais } from "@/lib/tempo";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";
import { nomeServico, servico } from "@/lib/agenda/servicos";
import Status, { rotuloEstado } from "@/components/admin/Status";
import AcaoForm, { campoAdmin } from "@/components/admin/AcaoForm";
import { cancelar, confirmar, propor, recusar, reprocessar } from "@/app/admin/acoes";

const COLUNAS = "id, protocolo, nome, email, whatsapp, whatsapp_pais, tipo_atendimento, objetivo, status, created_at, fuso_horario, inicio_solicitado, inicio_proposto, inicio_confirmado, reserva_inicio, reserva_fim, duracao_minutos, buffer_minutos, expira_em, confirmado_em, recusado_em, cancelado_em, expirado_em, respondido_em, motivo, privacidade_versao, privacidade_registrada_em, privacidade_base_legal, token_expira_em, legado";

const EVENTOS: Record<string, string> = {
  solicitacao_recebida: "Solicitação recebida", privacidade_registrada: "Ciência do Aviso de Privacidade registrada",
  solicitacao_confirmada: "Solicitação confirmada", solicitacao_recusada: "Solicitação recusada",
  proposta_enviada: "Novo horário proposto", proposta_aceita: "Aluno aceitou a proposta", proposta_recusada: "Aluno recusou a proposta",
  cancelamento: "Cancelamento", solicitacao_expirada: "Solicitação expirou", proposta_expirada: "Proposta expirou",
  notificacao_reenviada: "Reenvio de notificação solicitado",
};
const ATOR: Record<string, string> = { aluno: "Aluno", admin: "Profissional", sistema: "Sistema" };
const NOTIF_ESTADO: Record<string, string> = {
  pendente: "Na fila", processando: "Enviando", enviado_ao_provedor: "Aceito pelo provedor", entrega_confirmada: "Entregue (confirmado)",
  falhou: "Falhou", incerto: "Incerto — verificar", cancelada: "Cancelada", devolvida: "Devolvida/reclamação",
};

const SUCESSO: Record<string, string> = {
  confirmado: "Horário confirmado. O aluno será avisado por e-mail.",
  recusado: "Solicitação recusada. O horário foi liberado e o aluno será avisado.",
  cancelado: "Atendimento cancelado. O horário foi liberado e o aluno será avisado.",
  proposta: "Proposta registrada. O aluno receberá um e-mail para aceitar ou recusar.",
  reenvio: "Notificação colocada novamente na fila de envio.",
};

export default async function Detalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { id } = await params;
  const aviso = SUCESSO[(await searchParams).ok ?? ""];
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await exigirAdminPagina();
  const [{ data: a }, { data: eventos }, { data: notificacoes }] = await Promise.all([
    supabase.from("agendamentos").select(COLUNAS).eq("id", id).maybeSingle(),
    supabase.from("agendamento_eventos").select("id, tipo, status_anterior, status_novo, ator, motivo, criado_em, dados").eq("agendamento_id", id).order("id"),
    supabase.from("notificacoes").select("id, tipo, destinatario, estado, tentativas, ultimo_erro, enviado_em, entregue_em, criado_em").eq("agendamento_id", id).order("criado_em"),
  ]);
  if (!a) notFound();

  const fuso = a.fuso_horario ?? fusoProfissional();
  const sv = servico(a.tipo_atendimento);
  const wa = linkWhatsApp(a.whatsapp, `Olá, ${String(a.nome).split(" ")[0]}! Aqui é o Tiago, sobre sua solicitação ${a.protocolo}.`);
  const base = a.inicio_proposto ?? a.inicio_solicitado;
  const sugestao = base ? partesLocais(base, fuso) : { data: "", hora: "" };
  const hoje = hojeNoFuso(fuso);
  const prazo = prazoRestante(a.expira_em);

  const dados: Array<[string, string]> = [
    ["Protocolo", a.protocolo], ["E-mail", a.email], ["WhatsApp", formatarTelefone(a.whatsapp)],
    ["Atendimento", nomeServico(a.tipo_atendimento)],
    ["Horário originalmente solicitado", formatarDataHora(a.inicio_solicitado, fuso)],
    ...(a.inicio_proposto ? [["Horário proposto", formatarDataHora(a.inicio_proposto, fuso)] as [string, string]] : []),
    ...(a.inicio_confirmado ? [["Horário confirmado", formatarDataHora(a.inicio_confirmado, fuso)] as [string, string]] : []),
    ["Duração", a.duracao_minutos ? `${a.duracao_minutos} min${a.buffer_minutos ? ` + ${a.buffer_minutos} min de intervalo` : ""}` : sv?.duracaoMinutos ? `${sv.duracaoMinutos} min (configuração atual)` : "Não configurada"],
    ["Fuso horário", fuso],
    ["Recebido em", formatarDataHora(a.created_at, fuso)],
    ...(prazo && ["pendente", "aguardando_resposta"].includes(a.status) ? [["Prazo restante", `${prazo} (até ${formatarCurto(a.expira_em, fuso)})`] as [string, string]] : []),
    ...(a.respondido_em ? [["Resposta do aluno em", formatarDataHora(a.respondido_em, fuso)] as [string, string]] : []),
    ...(a.motivo ? [["Motivo / observação", a.motivo] as [string, string]] : []),
    ["Aviso de Privacidade", a.privacidade_versao ? `versão ${a.privacidade_versao}, ciência em ${formatarCurto(a.privacidade_registrada_em, fuso)}` : "Registro anterior ao novo formulário"],
  ];

  return (<>
    <a href="/admin/agendamentos" className="text-lima underline">← Agendamentos</a>
    {aviso && <p role="status" className="mt-4 rounded-lg border border-lima/40 bg-floresta p-3">{aviso}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{a.nome}</h1><Status s={a.status} />
    </div>
    {a.legado && !a.reserva_inicio && ["pendente", "confirmado"].includes(a.status) && (
      <p className="mt-4 rounded-lg border border-lima/40 p-3 text-sm">Registro antigo, sem duração registrada: não ocupa intervalo na agenda e bloqueia novas solicitações neste dia até ser resolvido.</p>)}

    <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-2xl border border-white/10 bg-floresta p-5">
        <dl className="grid gap-3 sm:grid-cols-2">{dados.map(([k, v]) => (
          <div key={k}><dt className="text-sm text-neblina">{k}</dt><dd className="break-words font-medium">{v}</dd></div>))}</dl>
        {a.objetivo && <div className="mt-4"><h2 className="text-sm text-neblina">Objetivo informado</h2><p className="mt-1 whitespace-pre-wrap">{a.objetivo}</p></div>}
        {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-lima px-5 font-semibold text-lima"><MessageCircle size={18} aria-hidden /> Conversar no WhatsApp</a>
          : <p className="mt-5 text-sm text-neblina">Número de WhatsApp inválido para gerar link.</p>}
      </section>

      <section className="grid content-start gap-5 rounded-2xl border border-white/10 p-5" aria-labelledby="acoes">
        <h2 id="acoes" className="font-display text-xl font-semibold">Ações</h2>
        {a.status === "pendente" && <AcaoForm acao={confirmar} id={a.id} rotulo="Confirmar horário solicitado" confirmar="Confirmar este horário e avisar o aluno por e-mail?" />}
        {(a.status === "pendente" || a.status === "aguardando_resposta") && (
          <details className="rounded-xl border border-white/10 p-4" open={a.status === "aguardando_resposta"}>
            <summary className="cursor-pointer font-semibold">{a.status === "pendente" ? "Propor outro horário" : "Substituir a proposta por outro horário"}</summary>
            <div className="mt-4"><AcaoForm acao={propor} id={a.id} rotulo="Enviar proposta" variante="secundaria" confirmar="Enviar esta proposta ao aluno? O horário atual será liberado.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor="data" className="mb-1.5 block text-sm">Data</label><input id="data" name="data" type="date" min={hoje} defaultValue={sugestao.data} required className={campoAdmin} /></div>
                <div><label htmlFor="hora" className="mb-1.5 block text-sm">Horário ({fuso})</label><input id="hora" name="hora" type="time" defaultValue={sugestao.hora} required className={campoAdmin} /></div>
              </div>
              <div><label htmlFor="motivo-p" className="mb-1.5 block text-sm">Observação interna (opcional)</label><input id="motivo-p" name="motivo" maxLength={500} className={campoAdmin} /></div>
            </AcaoForm></div>
          </details>)}
        {a.status === "pendente" && (
          <details className="rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-semibold">Recusar solicitação</summary>
            <div className="mt-4"><AcaoForm acao={recusar} id={a.id} rotulo="Recusar" variante="perigo" confirmar="Recusar esta solicitação? O aluno será avisado e o horário liberado.">
              <div><label htmlFor="motivo-r" className="mb-1.5 block text-sm">Mensagem ao aluno (opcional)</label><textarea id="motivo-r" name="motivo" maxLength={500} rows={2} className={`${campoAdmin} py-3`} /></div>
            </AcaoForm></div></details>)}
        {a.status === "confirmado" && (
          <details className="rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-semibold">Cancelar atendimento</summary>
            <div className="mt-4"><AcaoForm acao={cancelar} id={a.id} rotulo="Cancelar atendimento" variante="perigo" confirmar="Cancelar este atendimento confirmado? O aluno será avisado e o horário liberado.">
              <div><label htmlFor="motivo-c" className="mb-1.5 block text-sm">Motivo (enviado ao aluno, opcional)</label><textarea id="motivo-c" name="motivo" maxLength={500} rows={2} className={`${campoAdmin} py-3`} /></div>
            </AcaoForm></div></details>)}
        {["recusado", "cancelado", "expirado"].includes(a.status) && <p className="text-neblina">Registro encerrado ({rotuloEstado(a.status).toLowerCase()}). Uma nova tentativa deve ser feita por nova solicitação.</p>}
        {a.status === "aguardando_resposta" && <p className="text-sm text-neblina">Aguardando o aluno aceitar ou recusar pelo link enviado por e-mail.</p>}
      </section>
    </div>

    <section className="mt-6 rounded-2xl border border-white/10 p-5" aria-labelledby="hist">
      <h2 id="hist" className="font-display text-xl font-semibold">Histórico</h2>
      <ol className="mt-3 grid gap-3">{(eventos ?? []).map((e) => (
        <li key={e.id} className="rounded-xl bg-floresta p-3">
          <span className="font-semibold">{EVENTOS[e.tipo] ?? e.tipo}</span>
          <span className="block text-sm text-neblina">{formatarCurto(e.criado_em, fuso)} · {ATOR[e.ator] ?? e.ator}{e.status_novo ? ` · ${e.status_anterior ? `${rotuloEstado(e.status_anterior)} → ` : ""}${rotuloEstado(e.status_novo)}` : ""}</span>
          {e.motivo && <span className="mt-1 block text-sm">{e.motivo}</span>}
        </li>))}</ol>
    </section>

    <section id="notificacoes" className="mt-6 rounded-2xl border border-white/10 p-5" aria-labelledby="notif">
      <h2 id="notif" className="font-display text-xl font-semibold">Notificações por e-mail</h2>
      <p className="mt-1 text-sm text-neblina">“Aceito pelo provedor” não garante entrega na caixa de entrada; “Entregue” só aparece com webhook configurado.</p>
      {!notificacoes?.length ? <p className="mt-3 text-neblina">Nenhuma notificação.</p> : (
        <ul className="mt-3 grid gap-3">{notificacoes.map((n) => (
          <li key={n.id} className="grid gap-2 rounded-xl bg-floresta p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <span><span className="font-semibold">{n.tipo}</span> → {n.destinatario === "admin" ? "profissional" : "aluno"}
              <span className="block text-sm text-neblina">{NOTIF_ESTADO[n.estado] ?? n.estado} · {n.tentativas} tentativa(s){n.enviado_em ? ` · enviado ${formatarCurto(n.enviado_em, fuso)}` : ""}{n.ultimo_erro ? ` · ${n.ultimo_erro}` : ""}</span></span>
            {["falhou", "incerto"].includes(n.estado) && <AcaoForm acao={reprocessar} id={a.id} extras={{ notificacao: n.id }} rotulo="Reenviar" variante="secundaria"
              confirmar={n.estado === "incerto" ? "O envio anterior pode ter chegado. Verifique no painel do provedor antes. Reenviar mesmo assim?" : "Reenviar esta notificação?"} />}
          </li>))}</ul>)}
    </section>
  </>);
}
