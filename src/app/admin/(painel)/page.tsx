import { exigirAdminPagina } from "@/lib/admin/auth";
import { COLUNAS_LISTA, prazoRestante, type Linha } from "@/lib/admin/consultas";
import { fusoProfissional, pendenciasDeConfiguracao } from "@/lib/env";
import { formatarCurto, hojeNoFuso, limitesDoDia } from "@/lib/tempo";
import { nomeServico, servico } from "@/lib/agenda/servicos";
import { linkWhatsApp } from "@/lib/telefone";
import { site } from "@/config/site";
import { agenda } from "@/config/agenda";
import Status, { ESTADOS, rotuloEstado } from "@/components/admin/Status";

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await exigirAdminPagina();
  const fuso = fusoProfissional();
  const hoje = limitesDoDia(hojeNoFuso(fuso), fuso);
  const agora = new Date().toISOString();
  const ativos = ["pendente", "aguardando_resposta", "confirmado"];

  const [contagens, doDia, proximos, pendentes, aguardando, falhas, legados] = await Promise.all([
    supabase.rpc("admin_contagens"),
    supabase.from("agendamentos").select(COLUNAS_LISTA).in("status", ativos).gte("inicio_referencia", hoje.inicio).lt("inicio_referencia", hoje.fim).order("inicio_referencia"),
    supabase.from("agendamentos").select(COLUNAS_LISTA).eq("status", "confirmado").gte("inicio_referencia", agora).order("inicio_referencia").limit(8),
    supabase.from("agendamentos").select(COLUNAS_LISTA).eq("status", "pendente").order("expira_em", { nullsFirst: false }).limit(8),
    supabase.from("agendamentos").select(COLUNAS_LISTA).eq("status", "aguardando_resposta").order("expira_em").limit(8),
    supabase.from("notificacoes").select("id, agendamento_id, tipo, estado, ultimo_erro, atualizado_em").in("estado", ["falhou", "incerto", "devolvida"]).order("atualizado_em", { ascending: false }).limit(10),
    supabase.from("agendamentos_legados_pendentes").select("id, protocolo, status, data_solicitada, horario_solicitado"),
  ]);
  const erroConsulta = [contagens, doDia, proximos, pendentes, aguardando, falhas, legados].some((r) => r.error);
  const n = (contagens.data ?? {}) as Record<string, number>;

  const pendConfig = [
    ...site.tipos.filter((t) => !servico(t.v)?.duracaoMinutos).map((t) => `Duração do serviço "${t.l}" (src/config/agenda.ts)`),
    ...(linkWhatsApp(site.whatsapp) ? [] : ["WhatsApp oficial do profissional (src/config/site.ts)"]),
    ...(agenda.horarioFuncionamento ? [] : ["Dias e horários de atendimento (opcional, src/config/agenda.ts)"]),
    ...pendenciasDeConfiguracao().map((v) => `Variável de ambiente ${v}`),
  ];

  const Lista = ({ titulo, linhas, vazio, prazo }: { titulo: string; linhas: Linha[] | null; vazio: string; prazo?: boolean }) => (
    <section className="rounded-2xl border border-white/10 bg-floresta p-5">
      <h2 className="font-display text-xl font-semibold">{titulo}</h2>
      {!linhas?.length ? <p className="mt-3 text-neblina">{vazio}</p> : (
        <ul className="mt-3 divide-y divide-white/10">{linhas.map((l) => (
          <li key={l.id}><a href={`/admin/agendamentos/${l.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-lima">
            <span><span className="font-semibold">{l.nome}</span><span className="block text-sm text-neblina">{nomeServico(l.tipo_atendimento)} · {formatarCurto(l.inicio_referencia, fuso)}{prazo && l.expira_em ? ` · prazo: ${prazoRestante(l.expira_em)}` : ""}</span></span>
            <Status s={l.status} /></a></li>))}</ul>)}
    </section>);

  return (<>
    <h1 className="font-display text-3xl font-bold sm:text-4xl">Visão geral</h1>
    <p className="mt-2 text-neblina">Horários no fuso {fuso}.</p>
    {sp.senha === "alterada" && <p role="status" className="mt-4 rounded-lg border border-lima/40 p-3 text-sm">Senha alterada com sucesso.</p>}
    {erroConsulta && <p role="alert" className="mt-4 rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">Não foi possível carregar parte dos dados. Atualize a página.</p>}

    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{ESTADOS.map((s) => (
      <li key={s}><a href={`/admin/agendamentos?status=${s}`} className="block rounded-xl border border-white/10 bg-grafite p-4 hover:border-lima">
        <span className="text-sm text-neblina">{rotuloEstado(s)}</span><span className="block font-display text-3xl font-bold">{n[s] ?? 0}</span></a></li>))}</ul>

    {(n.notificacoes_falhas ?? 0) > 0 && (
      <section className="mt-6 rounded-2xl border border-[#ff9d8a]/50 p-5" aria-labelledby="falhas">
        <h2 id="falhas" className="font-display text-xl font-semibold">Notificações com falha ({n.notificacoes_falhas})</h2>
        <ul className="mt-3 divide-y divide-white/10">{(falhas.data ?? []).map((f) => (
          <li key={f.id} className="py-2 text-sm"><a href={`/admin/agendamentos/${f.agendamento_id}#notificacoes`} className="underline">{f.tipo}</a> — {f.estado}{f.ultimo_erro ? `: ${f.ultimo_erro}` : ""}</li>))}</ul>
      </section>)}

    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <Lista titulo="Hoje" linhas={doDia.data as Linha[] | null} vazio="Nenhum atendimento ou solicitação para hoje." />
      <Lista titulo="Próximos atendimentos confirmados" linhas={proximos.data as Linha[] | null} vazio="Nenhum atendimento confirmado à frente." />
      <Lista titulo="Solicitações pendentes" linhas={pendentes.data as Linha[] | null} vazio="Nenhuma solicitação aguardando análise." prazo />
      <Lista titulo="Propostas aguardando resposta" linhas={aguardando.data as Linha[] | null} vazio="Nenhuma proposta aguardando o aluno." prazo />
    </div>

    {!!legados.data?.length && (
      <section className="mt-6 rounded-2xl border border-lima/40 p-5">
        <h2 className="font-display text-xl font-semibold">Registros antigos para revisar ({legados.data.length})</h2>
        <p className="mt-2 text-sm text-neblina">Criados antes da configuração de duração. Não ocupam intervalo e bloqueiam novas solicitações no mesmo dia até serem confirmados, recusados ou cancelados.</p>
        <ul className="mt-3 text-sm">{legados.data.map((l) => <li key={l.id}><a className="underline" href={`/admin/agendamentos/${l.id}`}>{l.protocolo}</a> — {rotuloEstado(l.status)} — {l.data_solicitada} {String(l.horario_solicitado).slice(0, 5)}</li>)}</ul>
      </section>)}

    {pendConfig.length > 0 && (
      <section className="mt-6 rounded-2xl border border-white/10 p-5">
        <h2 className="font-display text-xl font-semibold">Configurações pendentes</h2>
        <ul className="mt-3 list-disc pl-5 text-sm text-neblina">{pendConfig.map((p) => <li key={p}>{p}</li>)}</ul>
      </section>)}
  </>);
}
