import { exigirAdminPagina } from "@/lib/admin/auth";
import { COLUNAS_LISTA, termoBusca, type Linha } from "@/lib/admin/consultas";
import { fusoProfissional } from "@/lib/env";
import { formatarCurto, limitesDoDia } from "@/lib/tempo";
import { nomeServico } from "@/lib/agenda/servicos";
import Status, { ESTADOS, rotuloEstado } from "@/components/admin/Status";
import { campoAdmin } from "@/components/admin/AcaoForm";

const POR_PAGINA = 20;
const dataValida = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function Agendamentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await exigirAdminPagina();
  const fuso = fusoProfissional();
  const status = ESTADOS.includes(sp.status as (typeof ESTADOS)[number]) ? sp.status! : "";
  const q = termoBusca(sp.q);
  const de = dataValida(sp.de) ? sp.de : "";
  const ate = dataValida(sp.ate) ? sp.ate : "";
  const pagina = Math.max(1, Math.min(10_000, Number.parseInt(sp.p ?? "1", 10) || 1));

  let consulta = supabase.from("agendamentos").select(COLUNAS_LISTA, { count: "exact" });
  if (status) consulta = consulta.eq("status", status);
  if (q) consulta = consulta.ilike("nome", `%${q}%`);
  if (de) consulta = consulta.gte("inicio_referencia", limitesDoDia(de, fuso).inicio);
  if (ate) consulta = consulta.lt("inicio_referencia", limitesDoDia(ate, fuso).fim);
  const asc = status === "pendente" || status === "aguardando_resposta" || status === "confirmado";
  const { data, count, error } = await consulta
    .order("inicio_referencia", { ascending: asc })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  const linhas = (data ?? []) as Linha[];
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const link = (p: number) => `/admin/agendamentos?${new URLSearchParams({ ...(status && { status }), ...(q && { q }), ...(de && { de }), ...(ate && { ate }), p: String(p) })}`;

  return (<>
    <h1 className="font-display text-3xl font-bold sm:text-4xl">Agendamentos</h1>
    <form method="get" className="mt-6 grid gap-4 rounded-2xl bg-floresta p-5 sm:grid-cols-2 lg:grid-cols-5" role="search">
      <div className="lg:col-span-2"><label htmlFor="q" className="mb-1.5 block text-sm font-medium">Nome do aluno</label><input id="q" name="q" defaultValue={q} className={campoAdmin} /></div>
      <div><label htmlFor="status" className="mb-1.5 block text-sm font-medium">Estado</label>
        <select id="status" name="status" defaultValue={status} className={campoAdmin}><option value="">Todos</option>{ESTADOS.map((s) => <option key={s} value={s}>{rotuloEstado(s)}</option>)}</select></div>
      <div><label htmlFor="de" className="mb-1.5 block text-sm font-medium">De</label><input id="de" name="de" type="date" defaultValue={de} className={campoAdmin} /></div>
      <div><label htmlFor="ate" className="mb-1.5 block text-sm font-medium">Até</label><input id="ate" name="ate" type="date" defaultValue={ate} className={campoAdmin} /></div>
      <div className="flex gap-3 sm:col-span-2 lg:col-span-5">
        <button className="min-h-[48px] rounded-xl bg-lima px-5 font-semibold text-grafite">Filtrar</button>
        <a href="/admin/agendamentos" className="flex min-h-[48px] items-center rounded-xl border border-white/20 px-5">Limpar</a>
      </div>
    </form>

    {error && <p role="alert" className="mt-4 rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">Não foi possível carregar os agendamentos.</p>}
    <p className="mt-5 text-sm text-neblina" aria-live="polite">{total} registro(s){status && ` · ${rotuloEstado(status)}`}{q && ` · "${q}"`}</p>

    {linhas.length === 0 ? <p className="mt-4 rounded-2xl border border-white/10 p-6 text-neblina">Nenhum agendamento encontrado com estes filtros.</p> : (
      <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10">{linhas.map((l) => (
        <li key={l.id}><a href={`/admin/agendamentos/${l.id}`} className="grid gap-1 p-4 hover:bg-floresta sm:grid-cols-[1fr_auto] sm:items-center">
          <span><span className="font-semibold">{l.nome}</span> <span className="text-sm text-neblina">· {l.protocolo}</span>
            <span className="block text-sm text-neblina">{nomeServico(l.tipo_atendimento)} · {formatarCurto(l.inicio_referencia, fuso)} · recebido {formatarCurto(l.created_at, fuso)}{l.legado ? " · registro antigo" : ""}</span></span>
          <Status s={l.status} /></a></li>))}</ul>)}

    {paginas > 1 && (
      <nav aria-label="Paginação" className="mt-5 flex items-center justify-between gap-3">
        {pagina > 1 ? <a href={link(pagina - 1)} className="rounded-xl border border-white/20 px-4 py-2">← Anterior</a> : <span />}
        <span className="text-sm text-neblina">Página {pagina} de {paginas}</span>
        {pagina < paginas ? <a href={link(pagina + 1)} className="rounded-xl border border-white/20 px-4 py-2">Próxima →</a> : <span />}
      </nav>)}
  </>);
}
