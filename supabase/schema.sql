-- ARQUIVO GERADO por `npm run db:schema` — não edite à mão.
-- Fonte de verdade: supabase/migrations/*.sql (aplique com `supabase db push`).
-- Alternativa manual: executar este arquivo inteiro no SQL Editor do Supabase.
-- Todas as migrações são incrementais e podem ser reexecutadas sem apagar dados.
-- FAÇA BACKUP ANTES (veja README → "Banco de dados").

-- >>> 20261117000000_baseline.sql
-- Baseline: schema original do projeto (supabase/schema.sql da etapa 1), idempotente.
-- Em bancos onde o schema.sql já foi executado manualmente, esta migração não altera nada.
create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 3 and 120),
  email text not null check (char_length(email) <= 160),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,11}$'),
  tipo_atendimento text not null check (tipo_atendimento in ('consultoria_online','acompanhamento_presencial','aula_futebol','nao_sei')),
  data_solicitada date not null,
  horario_solicitado time not null,
  objetivo text check (char_length(objetivo) <= 600),
  status text not null default 'pendente' check (status in ('pendente','confirmado','recusado','cancelado')),
  created_at timestamptz not null default now()
);
-- RLS ligada e SEM policies para anon/authenticated: visitantes não leem nem escrevem direto.
-- A API (servidor) grava com a service role. Na etapa 2 (painel), crie policies restritas ao personal autenticado.
alter table public.agendamentos enable row level security;
revoke all on public.agendamentos from anon, authenticated;
create index if not exists agendamentos_status_idx on public.agendamentos (status, created_at desc);

-- >>> 20261117000100_estrutura_agendamentos.sql
-- =====================================================================
-- Migração 2 — Estrutura de agendamentos v2 (incremental, sem DROP TABLE)
-- ---------------------------------------------------------------------
-- * Preserva todos os registros existentes de public.agendamentos.
-- * Pode ser reexecutada (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).
-- * Transformações de dados legados (documentadas):
--   1. whatsapp: o formulário antigo aceitava SOMENTE números brasileiros
--      com DDD (10 ou 11 dígitos, sem DDI). Esses valores recebem o prefixo
--      "+55" para virar E.164 e whatsapp_pais = 'BR'. Reversível: remover "+55".
--   2. inicio_solicitado: calculado a partir de data_solicitada + horario_solicitado
--      (colunas preservadas) interpretados no fuso 'America/Bahia' — o fuso inicial
--      sugerido e sujeito a confirmação do proprietário. O valor original
--      continua disponível nas colunas antigas.
--   3. Registros antigos são marcados legado = true. Como não havia duração
--      configurada, NÃO recebem reserva de intervalo (nenhuma duração é inventada).
--      Pendentes/confirmados legados aparecem na view
--      public.agendamentos_legados_pendentes e bloqueiam novas solicitações
--      no mesmo dia até serem resolvidos no painel.
-- =====================================================================

-- ---------- Estados ----------
alter table public.agendamentos drop constraint if exists agendamentos_status_check;
alter table public.agendamentos add constraint agendamentos_status_check
  check (status in ('pendente','confirmado','recusado','aguardando_resposta','cancelado','expirado'));

-- ---------- Novas colunas ----------
alter table public.agendamentos
  add column if not exists protocolo text,
  add column if not exists whatsapp_pais text,
  add column if not exists fuso_horario text not null default 'America/Bahia',
  add column if not exists inicio_solicitado timestamptz,
  add column if not exists inicio_proposto timestamptz,
  add column if not exists inicio_confirmado timestamptz,
  add column if not exists reserva_inicio timestamptz,
  add column if not exists reserva_fim timestamptz,
  add column if not exists duracao_minutos integer,
  add column if not exists buffer_minutos integer,
  add column if not exists expira_em timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists confirmado_em timestamptz,
  add column if not exists recusado_em timestamptz,
  add column if not exists cancelado_em timestamptz,
  add column if not exists expirado_em timestamptz,
  add column if not exists respondido_em timestamptz,
  add column if not exists admin_responsavel_id uuid references auth.users (id) on delete set null,
  add column if not exists motivo text,
  add column if not exists privacidade_versao text,
  add column if not exists privacidade_registrada_em timestamptz,
  add column if not exists privacidade_manifestacao text,
  add column if not exists privacidade_base_legal text,
  add column if not exists token_hash text,
  add column if not exists token_expira_em timestamptz,
  add column if not exists token_usado_em timestamptz,
  add column if not exists solicitacao_anterior_id uuid references public.agendamentos (id),
  add column if not exists legado boolean not null default false;

-- ---------- Backfill de registros legados ----------
-- (1) WhatsApp brasileiro legado -> E.164
alter table public.agendamentos drop constraint if exists agendamentos_whatsapp_check;
update public.agendamentos
   set whatsapp = '+55' || whatsapp,
       whatsapp_pais = coalesce(whatsapp_pais, 'BR')
 where whatsapp ~ '^[0-9]{10,11}$';

-- (2)/(3) Instante solicitado e marcação de legado
update public.agendamentos
   set inicio_solicitado = (data_solicitada + horario_solicitado) at time zone fuso_horario,
       legado = true
 where inicio_solicitado is null;

-- Protocolo para registros que ainda não têm (referência, não é segredo)
update public.agendamentos
   set protocolo = 'TL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
 where protocolo is null;

alter table public.agendamentos alter column protocolo set not null;
alter table public.agendamentos alter column protocolo
  set default 'TL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
alter table public.agendamentos alter column inicio_solicitado set not null;

-- ---------- Constraints ----------
alter table public.agendamentos drop constraint if exists agendamentos_whatsapp_e164_check;
alter table public.agendamentos add constraint agendamentos_whatsapp_e164_check
  check (whatsapp ~ '^\+[1-9][0-9]{6,14}$');

alter table public.agendamentos drop constraint if exists agendamentos_whatsapp_pais_check;
alter table public.agendamentos add constraint agendamentos_whatsapp_pais_check
  check (whatsapp_pais is null or whatsapp_pais ~ '^[A-Z]{2}$');

alter table public.agendamentos drop constraint if exists agendamentos_duracao_check;
alter table public.agendamentos add constraint agendamentos_duracao_check
  check ((duracao_minutos is null or duracao_minutos between 5 and 720)
     and (buffer_minutos is null or buffer_minutos between 0 and 240));

alter table public.agendamentos drop constraint if exists agendamentos_motivo_check;
alter table public.agendamentos add constraint agendamentos_motivo_check
  check (motivo is null or char_length(motivo) <= 500);

-- Reserva: início e fim juntos, fim > início
alter table public.agendamentos drop constraint if exists agendamentos_reserva_coerente;
alter table public.agendamentos add constraint agendamentos_reserva_coerente
  check ((reserva_inicio is null) = (reserva_fim is null)
     and (reserva_inicio is null or reserva_fim > reserva_inicio));

-- Somente estados ativos podem ocupar horário
alter table public.agendamentos drop constraint if exists agendamentos_reserva_estado;
alter table public.agendamentos add constraint agendamentos_reserva_estado
  check (reserva_inicio is null or status in ('pendente','aguardando_resposta','confirmado'));

-- Proteção definitiva contra sobreposição: intervalo semiaberto [início, fim),
-- onde fim = início + duração + buffer. Atendimentos consecutivos são permitidos.
alter table public.agendamentos drop constraint if exists agendamentos_sem_sobreposicao;
alter table public.agendamentos add constraint agendamentos_sem_sobreposicao
  exclude using gist (tstzrange(reserva_inicio, reserva_fim, '[)') with &&)
  where (reserva_inicio is not null);

create unique index if not exists agendamentos_protocolo_key on public.agendamentos (protocolo);
create unique index if not exists agendamentos_token_hash_key on public.agendamentos (token_hash) where token_hash is not null;

-- Data de referência para filtros (coalesce imutável -> coluna gerada)
alter table public.agendamentos add column if not exists inicio_referencia timestamptz
  generated always as (coalesce(reserva_inicio, inicio_confirmado, inicio_proposto, inicio_solicitado)) stored;
create index if not exists agendamentos_inicio_ref_idx on public.agendamentos (inicio_referencia);
create index if not exists agendamentos_expira_idx on public.agendamentos (expira_em)
  where status in ('pendente','aguardando_resposta');
create index if not exists agendamentos_created_idx on public.agendamentos (created_at desc);

-- Pendências de dados legados (para relatório do proprietário)
create or replace view public.agendamentos_legados_pendentes
with (security_invoker = true) as
  select id, protocolo, status, data_solicitada, horario_solicitado, tipo_atendimento, created_at
    from public.agendamentos
   where legado and reserva_inicio is null and status in ('pendente','confirmado');

-- =====================================================================
-- Histórico (trilha de auditoria, somente inserção)
-- =====================================================================
create table if not exists public.agendamento_eventos (
  id bigint generated always as identity primary key,
  agendamento_id uuid not null references public.agendamentos (id),
  tipo text not null check (tipo in (
    'solicitacao_recebida','privacidade_registrada','solicitacao_confirmada','solicitacao_recusada',
    'proposta_enviada','proposta_aceita','proposta_recusada','cancelamento',
    'solicitacao_expirada','proposta_expirada','notificacao_reenviada')),
  status_anterior text,
  status_novo text,
  ator text not null check (ator in ('aluno','admin','sistema')),
  admin_id uuid references auth.users (id) on delete set null,
  motivo text check (motivo is null or char_length(motivo) <= 500),
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists agendamento_eventos_ag_idx on public.agendamento_eventos (agendamento_id, criado_em);

-- =====================================================================
-- Outbox de notificações
-- =====================================================================
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.agendamentos (id),
  evento_id bigint references public.agendamento_eventos (id),
  tipo text not null check (tipo in (
    'solicitacao_recebida','confirmacao','recusa','proposta','proposta_aceita','proposta_recusada',
    'cancelamento','expiracao_solicitacao','expiracao_proposta',
    'admin_nova_solicitacao','admin_proposta_aceita','admin_proposta_recusada')),
  destinatario text not null check (destinatario in ('aluno','admin')),
  estado text not null default 'pendente' check (estado in (
    'pendente','processando','enviado_ao_provedor','falhou','incerto','cancelada','entrega_confirmada','devolvida')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 5,
  reenvios integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  lease_ate timestamptz,
  provedor_mensagem_id text,
  dedup_chave text not null unique,
  payload_cifrado text,        -- AES-256-GCM (chave só no servidor); apagado após envio
  ultimo_erro text check (ultimo_erro is null or char_length(ultimo_erro) <= 300),
  enviado_em timestamptz,
  entregue_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists notificacoes_fila_idx on public.notificacoes (estado, proxima_tentativa_em);
create index if not exists notificacoes_ag_idx on public.notificacoes (agendamento_id);
create index if not exists notificacoes_provedor_idx on public.notificacoes (provedor_mensagem_id) where provedor_mensagem_id is not null;

-- =====================================================================
-- Administradores autorizados (sem cadastro público)
-- =====================================================================
create table if not exists public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- =====================================================================
-- Idempotência de submissões
-- =====================================================================
create table if not exists public.idempotencia (
  chave text primary key check (char_length(chave) between 16 and 100),
  escopo text not null,
  hash_conteudo text not null,
  resposta jsonb,
  agendamento_id uuid references public.agendamentos (id),
  criado_em timestamptz not null default now()
);

-- =====================================================================
-- Rate limiting persistente (chaves já pseudonimizadas por HMAC no servidor)
-- =====================================================================
create table if not exists public.rate_limites (
  chave text not null,
  janela_inicio timestamptz not null,
  contador integer not null default 0,
  primary key (chave, janela_inicio)
);

-- =====================================================================
-- Webhooks recebidos (idempotência por id do evento)
-- =====================================================================
create table if not exists public.webhook_eventos (
  id text primary key,
  tipo text not null,
  recebido_em timestamptz not null default now()
);

-- =====================================================================
-- Triggers: updated_at, máquina de estados e imutabilidade do histórico
-- =====================================================================
create or replace function public._tg_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists agendamentos_updated_at on public.agendamentos;
create trigger agendamentos_updated_at before update on public.agendamentos
  for each row execute function public._tg_updated_at();

-- Defesa em profundidade: mesmo uma escrita direta (ex.: chave privilegiada)
-- não consegue fazer transições fora da máquina de estados.
create or replace function public._tg_transicao_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'pendente' and new.status in ('confirmado','recusado','aguardando_resposta','expirado','cancelado'))
      or (old.status = 'aguardando_resposta' and new.status in ('confirmado','cancelado','expirado'))
      or (old.status = 'confirmado' and new.status = 'cancelado')
    ) then
      raise exception 'transicao_invalida: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('recusado','cancelado','expirado') and (
       new.reserva_inicio is not null or new.inicio_confirmado is distinct from old.inicio_confirmado) then
    raise exception 'registro_terminal' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists agendamentos_transicao on public.agendamentos;
create trigger agendamentos_transicao before update on public.agendamentos
  for each row execute function public._tg_transicao_status();

create or replace function public._tg_somente_insercao() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'historico_imutavel' using errcode = 'P0001';
end $$;

drop trigger if exists agendamento_eventos_imutavel on public.agendamento_eventos;
create trigger agendamento_eventos_imutavel before update or delete on public.agendamento_eventos
  for each row execute function public._tg_somente_insercao();

drop trigger if exists notificacoes_atualizado on public.notificacoes;
create or replace function public._tg_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
create trigger notificacoes_atualizado before update on public.notificacoes
  for each row execute function public._tg_atualizado_em();

drop trigger if exists administradores_atualizado on public.administradores;
create trigger administradores_atualizado before update on public.administradores
  for each row execute function public._tg_atualizado_em();

-- >>> 20261117000200_funcoes_agendamento.sql
-- =====================================================================
-- Migração 3 — Funções atômicas de negócio
-- ---------------------------------------------------------------------
-- Toda reserva, mudança de horário e mudança de estado acontece dentro
-- de UMA função (uma transação). A disponibilidade é garantida pela
-- constraint de exclusão agendamentos_sem_sobreposicao: em requisições
-- concorrentes, a segunda espera a primeira e recebe exclusion_violation,
-- convertida aqui em {"ok":false,"erro":"conflito"}.
--
-- Permissões:
--   * funções "públicas" (solicitar, responder proposta, fila, cron) — só service_role;
--   * funções admin_* — authenticated, mas verificam public.eh_admin() (auth.uid()).
-- =====================================================================

-- ---------- Autorização ----------
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.administradores a
     where a.user_id = (select auth.uid()) and a.ativo
  );
$$;

-- ---------- Helpers internos ----------
create or replace function public._registrar_evento(
  p_ag uuid, p_tipo text, p_ant text, p_novo text, p_ator text,
  p_admin uuid default null, p_motivo text default null, p_dados jsonb default '{}'::jsonb
) returns bigint
language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.agendamento_eventos (agendamento_id, tipo, status_anterior, status_novo, ator, admin_id, motivo, dados)
  values (p_ag, p_tipo, p_ant, p_novo, p_ator, p_admin, p_motivo, coalesce(p_dados, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- Chave de deduplicação = evento de negócio + tipo + destinatário
create or replace function public._enfileirar(
  p_ag uuid, p_evento bigint, p_tipo text, p_dest text, p_payload text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.notificacoes (agendamento_id, evento_id, tipo, destinatario, dedup_chave, payload_cifrado)
  values (p_ag, p_evento, p_tipo, p_dest, 'evt:' || p_evento || ':' || p_tipo || ':' || p_dest, p_payload)
  on conflict (dedup_chave) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Cancela notificações de proposta ainda não enviadas (apaga o segredo cifrado)
create or replace function public._cancelar_propostas_pendentes(p_ag uuid) returns void
language sql set search_path = '' as $$
  update public.notificacoes
     set estado = 'cancelada', payload_cifrado = null, lease_ate = null
   where agendamento_id = p_ag and tipo = 'proposta'
     and estado in ('pendente','falhou','incerto','processando');
$$;

-- ---------- Expiração (idempotente; usada pelo cron e de forma "preguiçosa") ----------
create or replace function public.expirar_vencidos(p_limite integer default 500, p_intervalo tstzrange default null)
returns integer
language plpgsql set search_path = '' as $$
declare
  r public.agendamentos%rowtype;
  v_ev bigint;
  v_n integer := 0;
begin
  for r in
    select * from public.agendamentos a
     where a.status in ('pendente','aguardando_resposta')
       and a.expira_em is not null and a.expira_em <= now()
       and (p_intervalo is null or (a.reserva_inicio is not null
            and tstzrange(a.reserva_inicio, a.reserva_fim, '[)') && p_intervalo))
     order by a.expira_em
     limit p_limite
     for update skip locked
  loop
    update public.agendamentos
       set status = 'expirado', expirado_em = now(), reserva_inicio = null, reserva_fim = null
     where id = r.id;
    if r.status = 'pendente' then
      v_ev := public._registrar_evento(r.id, 'solicitacao_expirada', r.status, 'expirado', 'sistema',
                null, 'Prazo de análise encerrado', jsonb_build_object('expira_em', r.expira_em));
      perform public._enfileirar(r.id, v_ev, 'expiracao_solicitacao', 'aluno');
    else
      perform public._cancelar_propostas_pendentes(r.id);
      v_ev := public._registrar_evento(r.id, 'proposta_expirada', r.status, 'expirado', 'sistema',
                null, 'Proposta não respondida no prazo', jsonb_build_object('expira_em', r.expira_em));
      perform public._enfileirar(r.id, v_ev, 'expiracao_proposta', 'aluno');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- =====================================================================
-- ETAPA 1 — Solicitação pública (chamada só pelo servidor com chave privilegiada)
-- =====================================================================
create or replace function public.solicitar_agendamento(
  p_idem_chave text, p_idem_hash text,
  p_nome text, p_email text, p_whatsapp text, p_whatsapp_pais text,
  p_tipo text, p_inicio timestamptz, p_duracao integer, p_buffer integer, p_fuso text,
  p_objetivo text, p_prazo_horas integer,
  p_priv_versao text, p_priv_manifestacao text, p_priv_base_legal text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_existente public.idempotencia%rowtype;
  v_fim timestamptz;
  v_id uuid;
  v_protocolo text;
  v_ev bigint;
  v_notif uuid;
  v_resp jsonb;
  v_local timestamp;
begin
  if p_duracao is null or p_duracao < 5 then
    return jsonb_build_object('ok', false, 'erro', 'servico_indisponivel');
  end if;
  if p_inicio <= now() then
    return jsonb_build_object('ok', false, 'erro', 'horario_passado');
  end if;

  -- Idempotência: mesma chave + mesmo conteúdo => mesma resposta; conteúdo diferente => rejeita.
  insert into public.idempotencia (chave, escopo, hash_conteudo)
  values (p_idem_chave, 'solicitacao', p_idem_hash)
  on conflict (chave) do nothing;
  if not found then
    select * into v_existente from public.idempotencia where chave = p_idem_chave;
    if v_existente.hash_conteudo <> p_idem_hash or v_existente.escopo <> 'solicitacao' then
      return jsonb_build_object('ok', false, 'erro', 'idempotencia_conflito');
    end if;
    if v_existente.resposta is not null then
      return v_existente.resposta || jsonb_build_object('repetido', true);
    end if;
    return jsonb_build_object('ok', false, 'erro', 'em_processamento');
  end if;

  v_fim := p_inicio + make_interval(mins => p_duracao + coalesce(p_buffer, 0));
  v_local := p_inicio at time zone p_fuso;

  -- Registros legados ativos sem duração conhecida bloqueiam o mesmo dia.
  if exists (
    select 1 from public.agendamentos a
     where a.legado and a.reserva_inicio is null and a.status in ('pendente','confirmado')
       and a.data_solicitada = v_local::date
  ) then
    delete from public.idempotencia where chave = p_idem_chave;
    return jsonb_build_object('ok', false, 'erro', 'conflito');
  end if;

  -- Libera reservas vencidas que ocupem o intervalo, antes de tentar reservar.
  perform public.expirar_vencidos(50, tstzrange(p_inicio, v_fim, '[)'));

  begin
    insert into public.agendamentos (
      nome, email, whatsapp, whatsapp_pais, tipo_atendimento,
      data_solicitada, horario_solicitado, objetivo, status, fuso_horario,
      inicio_solicitado, reserva_inicio, reserva_fim, duracao_minutos, buffer_minutos,
      expira_em, privacidade_versao, privacidade_registrada_em, privacidade_manifestacao, privacidade_base_legal
    ) values (
      p_nome, p_email, p_whatsapp, p_whatsapp_pais, p_tipo,
      v_local::date, v_local::time, nullif(p_objetivo, ''), 'pendente', p_fuso,
      p_inicio, p_inicio, v_fim, p_duracao, coalesce(p_buffer, 0),
      now() + make_interval(hours => p_prazo_horas), p_priv_versao, now(), p_priv_manifestacao, p_priv_base_legal
    ) returning id, protocolo into v_id, v_protocolo;
  exception when exclusion_violation then
    delete from public.idempotencia where chave = p_idem_chave;
    return jsonb_build_object('ok', false, 'erro', 'conflito');
  end;

  v_ev := public._registrar_evento(v_id, 'solicitacao_recebida', null, 'pendente', 'aluno', null, null,
            jsonb_build_object('inicio', p_inicio, 'duracao_minutos', p_duracao, 'buffer_minutos', coalesce(p_buffer, 0)));
  perform public._registrar_evento(v_id, 'privacidade_registrada', null, null, 'aluno', null, null,
            jsonb_build_object('versao', p_priv_versao, 'manifestacao', p_priv_manifestacao, 'base_legal', p_priv_base_legal));
  v_notif := public._enfileirar(v_id, v_ev, 'solicitacao_recebida', 'aluno');
  perform public._enfileirar(v_id, v_ev, 'admin_nova_solicitacao', 'admin');

  v_resp := jsonb_build_object('ok', true, 'id', v_id, 'protocolo', v_protocolo, 'notificacao_id', v_notif);
  update public.idempotencia set resposta = v_resp, agendamento_id = v_id where chave = p_idem_chave;
  return v_resp;
end $$;

-- =====================================================================
-- ETAPAS 3/4/5 — Ações do profissional (verificam eh_admin() no próprio banco)
-- =====================================================================
create or replace function public._exigir_admin() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if not public.eh_admin() then
    raise exception 'nao_autorizado' using errcode = '42501';
  end if;
  return (select auth.uid());
end $$;

create or replace function public.admin_confirmar(p_id uuid, p_duracao integer default null, p_buffer integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin();
  r public.agendamentos%rowtype;
  v_ini timestamptz; v_fim timestamptz; v_ev bigint;
begin
  select * into r from public.agendamentos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if r.status <> 'pendente' then return jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', r.status); end if;
  if r.expira_em is not null and r.expira_em <= now() then
    perform public.expirar_vencidos(1, tstzrange(r.reserva_inicio, r.reserva_fim, '[)'));
    return jsonb_build_object('ok', false, 'erro', 'expirado');
  end if;

  v_ini := coalesce(r.reserva_inicio, r.inicio_solicitado);
  if v_ini <= now() then return jsonb_build_object('ok', false, 'erro', 'horario_passado'); end if;

  begin
    if r.reserva_inicio is null then
      -- Registro legado: só confirma com duração configurada no momento da ação.
      if p_duracao is null then return jsonb_build_object('ok', false, 'erro', 'duracao_nao_configurada'); end if;
      v_fim := v_ini + make_interval(mins => p_duracao + coalesce(p_buffer, 0));
      update public.agendamentos
         set reserva_inicio = v_ini, reserva_fim = v_fim, duracao_minutos = p_duracao, buffer_minutos = coalesce(p_buffer, 0)
       where id = p_id;
    end if;
    update public.agendamentos
       set status = 'confirmado', inicio_confirmado = v_ini, confirmado_em = now(),
           expira_em = null, admin_responsavel_id = v_admin
     where id = p_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'erro', 'conflito');
  end;

  v_ev := public._registrar_evento(p_id, 'solicitacao_confirmada', 'pendente', 'confirmado', 'admin', v_admin, null,
            jsonb_build_object('inicio', v_ini));
  perform public._enfileirar(p_id, v_ev, 'confirmacao', 'aluno');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_recusar(p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin();
  r public.agendamentos%rowtype; v_ev bigint;
begin
  select * into r from public.agendamentos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if r.status <> 'pendente' then return jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', r.status); end if;
  update public.agendamentos
     set status = 'recusado', recusado_em = now(), reserva_inicio = null, reserva_fim = null,
         expira_em = null, motivo = nullif(p_motivo, ''), admin_responsavel_id = v_admin
   where id = p_id;
  v_ev := public._registrar_evento(p_id, 'solicitacao_recusada', 'pendente', 'recusado', 'admin', v_admin, nullif(p_motivo, ''));
  perform public._enfileirar(p_id, v_ev, 'recusa', 'aluno');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_cancelar(p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin();
  r public.agendamentos%rowtype; v_ev bigint;
begin
  select * into r from public.agendamentos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if r.status not in ('pendente','confirmado') then
    return jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', r.status);
  end if;
  update public.agendamentos
     set status = 'cancelado', cancelado_em = now(), reserva_inicio = null, reserva_fim = null,
         expira_em = null, motivo = nullif(p_motivo, ''), admin_responsavel_id = v_admin
   where id = p_id;
  v_ev := public._registrar_evento(p_id, 'cancelamento', r.status, 'cancelado', 'admin', v_admin, nullif(p_motivo, ''),
            jsonb_build_object('inicio_cancelado', r.reserva_inicio));
  perform public._enfileirar(p_id, v_ev, 'cancelamento', 'aluno');
  return jsonb_build_object('ok', true);
end $$;

-- Proposta de novo horário. O token é gerado no servidor (256 bits);
-- aqui chegam somente o hash SHA-256 e o token cifrado (AES-256-GCM) para a fila.
create or replace function public.admin_propor(
  p_id uuid, p_inicio timestamptz, p_duracao integer, p_buffer integer,
  p_token_hash text, p_token_expira timestamptz, p_payload_cifrado text, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin();
  r public.agendamentos%rowtype; v_fim timestamptz; v_ev bigint;
begin
  if p_duracao is null or p_duracao < 5 then return jsonb_build_object('ok', false, 'erro', 'duracao_nao_configurada'); end if;
  if p_inicio <= now() then return jsonb_build_object('ok', false, 'erro', 'horario_passado'); end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_token_expira <= now() or p_payload_cifrado is null then
    return jsonb_build_object('ok', false, 'erro', 'parametros_invalidos');
  end if;

  select * into r from public.agendamentos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if r.status not in ('pendente','aguardando_resposta') then
    return jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', r.status);
  end if;
  if r.expira_em is not null and r.expira_em <= now() then
    perform public.expirar_vencidos(1, tstzrange(r.reserva_inicio, r.reserva_fim, '[)'));
    return jsonb_build_object('ok', false, 'erro', 'expirado');
  end if;

  v_fim := p_inicio + make_interval(mins => p_duracao + coalesce(p_buffer, 0));
  perform public.expirar_vencidos(50, tstzrange(p_inicio, v_fim, '[)'));

  -- Substitui a reserva anterior pela da proposta numa única atualização:
  -- nunca existem duas reservas para o mesmo registro e, em caso de conflito,
  -- nada é alterado.
  begin
    update public.agendamentos
       set status = 'aguardando_resposta', inicio_proposto = p_inicio,
           reserva_inicio = p_inicio, reserva_fim = v_fim,
           duracao_minutos = p_duracao, buffer_minutos = coalesce(p_buffer, 0),
           token_hash = p_token_hash, token_expira_em = p_token_expira, token_usado_em = null,
           expira_em = p_token_expira, admin_responsavel_id = v_admin
     where id = p_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'erro', 'conflito');
  end;

  perform public._cancelar_propostas_pendentes(p_id);  -- invalida envio de proposta anterior
  v_ev := public._registrar_evento(p_id, 'proposta_enviada', r.status, 'aguardando_resposta', 'admin', v_admin,
            nullif(p_motivo, ''),
            jsonb_build_object('inicio_solicitado', r.inicio_solicitado, 'reserva_anterior', r.reserva_inicio,
                               'inicio_proposto', p_inicio, 'token_expira_em', p_token_expira));
  perform public._enfileirar(p_id, v_ev, 'proposta', 'aluno', p_payload_cifrado);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reprocessar_notificacao(p_notif uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin();
  n public.notificacoes%rowtype; a public.agendamentos%rowtype;
begin
  select * into n from public.notificacoes where id = p_notif for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if n.estado not in ('falhou','incerto') then
    return jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'estado', n.estado);
  end if;
  if n.tipo = 'proposta' then
    select * into a from public.agendamentos where id = n.agendamento_id;
    if n.payload_cifrado is null or a.status <> 'aguardando_resposta' or a.token_expira_em <= now() then
      return jsonb_build_object('ok', false, 'erro', 'proposta_inativa');
    end if;
  end if;
  update public.notificacoes
     set estado = 'pendente', tentativas = 0, reenvios = reenvios + 1,
         proxima_tentativa_em = now(), lease_ate = null, ultimo_erro = null
   where id = p_notif;
  perform public._registrar_evento(n.agendamento_id, 'notificacao_reenviada', null, null, 'admin', v_admin, null,
            jsonb_build_object('notificacao_id', n.id, 'tipo', n.tipo));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_contagens()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._exigir_admin();
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v
    from (select status, count(*) n from public.agendamentos group by status) s;
  return v || jsonb_build_object('notificacoes_falhas',
    (select count(*) from public.notificacoes where estado in ('falhou','incerto','devolvida')));
end $$;

-- =====================================================================
-- Resposta do aluno à proposta (token de uso único)
-- =====================================================================
create or replace function public.consultar_proposta(p_token_hash text)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare r public.agendamentos%rowtype;
begin
  select * into r from public.agendamentos where token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'erro', 'token_invalido'); end if;
  if r.token_usado_em is not null then return jsonb_build_object('ok', false, 'erro', 'token_usado', 'status', r.status); end if;
  if r.status <> 'aguardando_resposta' then return jsonb_build_object('ok', false, 'erro', 'proposta_inativa', 'status', r.status); end if;
  if r.token_expira_em <= now() then return jsonb_build_object('ok', false, 'erro', 'token_expirado'); end if;
  return jsonb_build_object('ok', true,
    'primeiro_nome', split_part(r.nome, ' ', 1), 'tipo_atendimento', r.tipo_atendimento,
    'inicio_solicitado', r.inicio_solicitado, 'inicio_proposto', r.inicio_proposto,
    'duracao_minutos', r.duracao_minutos, 'fuso_horario', r.fuso_horario,
    'expira_em', r.token_expira_em, 'protocolo', r.protocolo);
end $$;

create or replace function public.responder_proposta(p_token_hash text, p_acao text)
returns jsonb
language plpgsql set search_path = '' as $$
declare r public.agendamentos%rowtype; v_ev bigint;
begin
  if p_acao not in ('aceitar','recusar') then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
  -- FOR UPDATE serializa respostas simultâneas com o mesmo token.
  select * into r from public.agendamentos where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'token_invalido'); end if;
  if r.token_usado_em is not null then return jsonb_build_object('ok', false, 'erro', 'token_usado', 'status', r.status); end if;
  if r.status <> 'aguardando_resposta' then return jsonb_build_object('ok', false, 'erro', 'proposta_inativa', 'status', r.status); end if;
  if r.token_expira_em <= now() then
    perform public.expirar_vencidos(1, tstzrange(r.reserva_inicio, r.reserva_fim, '[)'));
    return jsonb_build_object('ok', false, 'erro', 'token_expirado');
  end if;
  if r.reserva_inicio is null or r.reserva_inicio <= now() then
    return jsonb_build_object('ok', false, 'erro', 'proposta_inativa');
  end if;

  if p_acao = 'aceitar' then
    update public.agendamentos
       set status = 'confirmado', inicio_confirmado = r.reserva_inicio, confirmado_em = now(),
           respondido_em = now(), token_usado_em = now(), expira_em = null
     where id = r.id;
    v_ev := public._registrar_evento(r.id, 'proposta_aceita', 'aguardando_resposta', 'confirmado', 'aluno', null, null,
              jsonb_build_object('inicio', r.reserva_inicio));
    perform public._enfileirar(r.id, v_ev, 'proposta_aceita', 'aluno');
    perform public._enfileirar(r.id, v_ev, 'admin_proposta_aceita', 'admin');
    return jsonb_build_object('ok', true, 'status', 'confirmado', 'inicio', r.reserva_inicio, 'fuso_horario', r.fuso_horario);
  else
    update public.agendamentos
       set status = 'cancelado', cancelado_em = now(), respondido_em = now(), token_usado_em = now(),
           reserva_inicio = null, reserva_fim = null, expira_em = null,
           motivo = 'Proposta de novo horário recusada pelo aluno'
     where id = r.id;
    v_ev := public._registrar_evento(r.id, 'proposta_recusada', 'aguardando_resposta', 'cancelado', 'aluno', null,
              'Proposta de novo horário recusada pelo aluno', jsonb_build_object('inicio_proposto', r.inicio_proposto));
    perform public._enfileirar(r.id, v_ev, 'proposta_recusada', 'aluno');
    perform public._enfileirar(r.id, v_ev, 'admin_proposta_recusada', 'admin');
    return jsonb_build_object('ok', true, 'status', 'cancelado');
  end if;
end $$;

-- =====================================================================
-- Outbox: reivindicação com lease (SKIP LOCKED) e conclusão
-- =====================================================================
create or replace function public.reivindicar_notificacoes(
  p_limite integer default 20, p_lease_segundos integer default 120, p_ids uuid[] default null
) returns setof public.notificacoes
language plpgsql set search_path = '' as $$
begin
  -- Leases vencidos há mais de 23h: a chave de idempotência do provedor (24h)
  -- já não protege contra duplicidade -> reconciliação manual.
  update public.notificacoes
     set estado = 'incerto', lease_ate = null,
         ultimo_erro = 'Envio interrompido sem confirmação; verifique no provedor antes de reenviar.'
   where estado = 'processando' and lease_ate < now() and criado_em < now() - interval '23 hours';

  return query
  update public.notificacoes n
     set estado = 'processando', lease_ate = now() + make_interval(secs => p_lease_segundos),
         tentativas = n.tentativas + 1
   where n.id in (
     select x.id from public.notificacoes x
      where (p_ids is null or x.id = any (p_ids))
        and ((x.estado = 'pendente' and x.proxima_tentativa_em <= now())
          or (x.estado = 'processando' and x.lease_ate < now()))
      order by x.proxima_tentativa_em
      limit p_limite
      for update skip locked)
  returning n.*;
end $$;

create or replace function public.concluir_notificacao(
  p_id uuid, p_sucesso boolean, p_provedor_id text default null, p_erro text default null,
  p_permanente boolean default false
) returns text
language plpgsql set search_path = '' as $$
declare n public.notificacoes%rowtype; v_estado text;
begin
  select * into n from public.notificacoes where id = p_id for update;
  if not found or n.estado <> 'processando' then return 'ignorado'; end if;
  if p_sucesso then
    update public.notificacoes
       set estado = 'enviado_ao_provedor', provedor_mensagem_id = p_provedor_id, enviado_em = now(),
           payload_cifrado = null, lease_ate = null, ultimo_erro = null
     where id = p_id;
    return 'enviado_ao_provedor';
  end if;
  v_estado := case when p_permanente or n.tentativas >= n.max_tentativas then 'falhou' else 'pendente' end;
  update public.notificacoes
     set estado = v_estado, lease_ate = null, ultimo_erro = left(p_erro, 300),
         proxima_tentativa_em = now() + make_interval(mins => least(60, power(2, n.tentativas)::int))
   where id = p_id;
  return v_estado;
end $$;

-- Dados para compor o e-mail (somente servidor)
create or replace function public.dados_notificacao(p_id uuid)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'notificacao', to_jsonb(n) - 'payload_cifrado',
    'payload_cifrado', n.payload_cifrado,
    'agendamento', jsonb_build_object(
      'id', a.id, 'protocolo', a.protocolo, 'nome', a.nome, 'email', a.email, 'whatsapp', a.whatsapp,
      'tipo_atendimento', a.tipo_atendimento, 'status', a.status, 'fuso_horario', a.fuso_horario,
      'inicio_solicitado', a.inicio_solicitado, 'inicio_proposto', a.inicio_proposto,
      'inicio_confirmado', a.inicio_confirmado, 'reserva_inicio', a.reserva_inicio,
      'duracao_minutos', a.duracao_minutos, 'expira_em', a.expira_em, 'motivo', a.motivo,
      'objetivo', a.objetivo))
  from public.notificacoes n join public.agendamentos a on a.id = n.agendamento_id
  where n.id = p_id;
$$;

-- =====================================================================
-- Rate limiting (janela fixa, atômico) e limpeza
-- =====================================================================
create or replace function public.consumir_limite(p_chave text, p_janela_segundos integer, p_max integer)
returns boolean
language plpgsql set search_path = '' as $$
declare v_janela timestamptz; v_n integer;
begin
  v_janela := to_timestamp(floor(extract(epoch from now()) / p_janela_segundos) * p_janela_segundos);
  insert into public.rate_limites (chave, janela_inicio, contador) values (p_chave, v_janela, 1)
  on conflict (chave, janela_inicio) do update set contador = public.rate_limites.contador + 1
  returning contador into v_n;
  return v_n <= p_max;
end $$;

create or replace function public.limpar_temporarios() returns jsonb
language plpgsql set search_path = '' as $$
declare a int; b int; c int;
begin
  delete from public.rate_limites where janela_inicio < now() - interval '2 days';
  get diagnostics a = row_count;
  delete from public.idempotencia where criado_em < now() - interval '7 days';
  get diagnostics b = row_count;
  delete from public.webhook_eventos where recebido_em < now() - interval '30 days';
  get diagnostics c = row_count;
  return jsonb_build_object('rate_limites', a, 'idempotencia', b, 'webhook_eventos', c);
end $$;

-- Webhook do provedor (idempotente por id do evento)
create or replace function public.registrar_webhook_email(p_evento_id text, p_tipo text, p_mensagem_id text)
returns boolean
language plpgsql set search_path = '' as $$
begin
  insert into public.webhook_eventos (id, tipo) values (p_evento_id, p_tipo) on conflict (id) do nothing;
  if not found then return false; end if;
  if p_tipo = 'email.delivered' then
    update public.notificacoes set estado = 'entrega_confirmada', entregue_em = now()
     where provedor_mensagem_id = p_mensagem_id and estado = 'enviado_ao_provedor';
  elsif p_tipo in ('email.bounced','email.complained') then
    update public.notificacoes set estado = 'devolvida', ultimo_erro = 'Provedor informou: ' || p_tipo
     where provedor_mensagem_id = p_mensagem_id and estado in ('enviado_ao_provedor','entrega_confirmada');
  end if;
  return true;
end $$;

-- >>> 20261117000300_rls_permissoes_cron.sql
-- =====================================================================
-- Migração 4 — RLS, permissões e rotina de expiração no banco
-- ---------------------------------------------------------------------
-- * anon: nenhum acesso a tabelas ou funções.
-- * authenticated: SOMENTE leitura, e apenas se public.eh_admin() (usuário
--   autenticado NÃO é administrador automaticamente). Nenhuma escrita direta:
--   alterações passam pelas funções admin_* (máquina de estados + auditoria).
-- * service_role: usado apenas no servidor. Ignora RLS; por isso cada endpoint
--   do servidor valida tudo antes de chamar as funções.
-- =====================================================================

alter table public.agendamentos enable row level security;
alter table public.agendamento_eventos enable row level security;
alter table public.notificacoes enable row level security;
alter table public.administradores enable row level security;
alter table public.idempotencia enable row level security;
alter table public.rate_limites enable row level security;
alter table public.webhook_eventos enable row level security;

revoke all on public.agendamentos, public.agendamento_eventos, public.notificacoes, public.administradores,
              public.idempotencia, public.rate_limites, public.webhook_eventos
  from anon, authenticated;
revoke all on public.agendamentos_legados_pendentes from anon, authenticated;

-- Histórico é trilha de auditoria: nem a chave privilegiada edita/apaga.
revoke update, delete, truncate on public.agendamento_eventos from service_role;

-- Leitura para administradores, sem colunas secretas (hash de token / payload cifrado)
grant select (id, protocolo, nome, email, whatsapp, whatsapp_pais, tipo_atendimento, data_solicitada,
              horario_solicitado, objetivo, status, created_at, updated_at, fuso_horario, inicio_solicitado,
              inicio_proposto, inicio_confirmado, reserva_inicio, reserva_fim, duracao_minutos, buffer_minutos,
              expira_em, confirmado_em, recusado_em, cancelado_em, expirado_em, respondido_em,
              admin_responsavel_id, motivo, privacidade_versao, privacidade_registrada_em,
              privacidade_manifestacao, privacidade_base_legal, token_expira_em, token_usado_em,
              solicitacao_anterior_id, legado, inicio_referencia)
  on public.agendamentos to authenticated;
grant select on public.agendamento_eventos to authenticated;
grant select (id, agendamento_id, evento_id, tipo, destinatario, estado, tentativas, max_tentativas, reenvios,
              proxima_tentativa_em, provedor_mensagem_id, ultimo_erro, enviado_em, entregue_em, criado_em, atualizado_em)
  on public.notificacoes to authenticated;
grant select on public.administradores to authenticated;
grant select on public.agendamentos_legados_pendentes to authenticated;

drop policy if exists admin_le_agendamentos on public.agendamentos;
create policy admin_le_agendamentos on public.agendamentos for select to authenticated using ((select public.eh_admin()));
drop policy if exists admin_le_eventos on public.agendamento_eventos;
create policy admin_le_eventos on public.agendamento_eventos for select to authenticated using ((select public.eh_admin()));
drop policy if exists admin_le_notificacoes on public.notificacoes;
create policy admin_le_notificacoes on public.notificacoes for select to authenticated using ((select public.eh_admin()));
drop policy if exists admin_le_proprio_registro on public.administradores;
create policy admin_le_proprio_registro on public.administradores for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Funções ----------
-- Por padrão o Postgres concede EXECUTE a PUBLIC; removemos de todas.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'eh_admin','_registrar_evento','_enfileirar','_cancelar_propostas_pendentes','expirar_vencidos',
       'solicitar_agendamento','_exigir_admin','admin_confirmar','admin_recusar','admin_cancelar','admin_propor',
       'admin_reprocessar_notificacao','admin_contagens','consultar_proposta','responder_proposta',
       'reivindicar_notificacoes','concluir_notificacao','dados_notificacao','consumir_limite',
       'limpar_temporarios','registrar_webhook_email','_tg_updated_at','_tg_transicao_status',
       '_tg_somente_insercao','_tg_atualizado_em')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.eh_admin() to authenticated;
grant execute on function public.admin_confirmar(uuid, integer, integer) to authenticated;
grant execute on function public.admin_recusar(uuid, text) to authenticated;
grant execute on function public.admin_cancelar(uuid, text) to authenticated;
grant execute on function public.admin_propor(uuid, timestamptz, integer, integer, text, timestamptz, text, text) to authenticated;
grant execute on function public.admin_reprocessar_notificacao(uuid) to authenticated;
grant execute on function public.admin_contagens() to authenticated;

grant execute on function public.solicitar_agendamento(text, text, text, text, text, text, text, timestamptz, integer, integer, text, text, integer, text, text, text) to service_role;
grant execute on function public.consultar_proposta(text) to service_role;
grant execute on function public.responder_proposta(text, text) to service_role;
grant execute on function public.expirar_vencidos(integer, tstzrange) to service_role;
grant execute on function public.reivindicar_notificacoes(integer, integer, uuid[]) to service_role;
grant execute on function public.concluir_notificacao(uuid, boolean, text, text, boolean) to service_role;
grant execute on function public.dados_notificacao(uuid) to service_role;
grant execute on function public.consumir_limite(text, integer, integer) to service_role;
grant execute on function public.limpar_temporarios() to service_role;
grant execute on function public.registrar_webhook_email(text, text, text) to service_role;

-- Evita que funções criadas no futuro fiquem executáveis por anon/authenticated sem querer
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- Expiração automática dentro do banco (independe da Vercel) ----------
-- pg_cron está disponível nos projetos Supabase. A cada minuto expira solicitações
-- e propostas vencidas, libera reservas, registra histórico e enfileira e-mails.
-- O ENVIO dos e-mails é feito pela rota /api/cron (Vercel Cron) — ver README.
create extension if not exists pg_cron;
select cron.schedule('agenda-expirar-vencidos', '* * * * *', $$select public.expirar_vencidos(500)$$);
select cron.schedule('agenda-limpar-temporarios', '17 4 * * *', $$select public.limpar_temporarios()$$);

-- >>> 20261118000000_solicitacao_simples.sql
-- =====================================================================
-- Migração 5 — Fluxo simplificado (decisão do proprietário, 18/11/2026)
-- ---------------------------------------------------------------------
-- O site passa a ser apenas uma landing page com formulário: o pedido é
-- GRAVADO no banco e o aluno o envia ao profissional pelo WhatsApp.
-- Não há painel, login, e-mails nem bloqueio de horário.
--
-- Esta migração só ACRESCENTA a função registrar_solicitacao. Nada é
-- apagado: tabelas e funções anteriores continuam existindo, sem uso.
-- =====================================================================

create or replace function public.registrar_solicitacao(
  p_idem_chave text, p_idem_hash text,
  p_nome text, p_email text, p_whatsapp text, p_whatsapp_pais text,
  p_tipo text, p_inicio timestamptz, p_fuso text, p_objetivo text,
  p_priv_versao text, p_priv_manifestacao text, p_priv_base_legal text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_existente public.idempotencia%rowtype;
  v_id uuid;
  v_protocolo text;
  v_resp jsonb;
  v_local timestamp;
begin
  if p_inicio <= now() then
    return jsonb_build_object('ok', false, 'erro', 'horario_passado');
  end if;

  -- Idempotência: mesma chave + mesmo conteúdo => mesmo protocolo; conteúdo diferente => rejeita.
  insert into public.idempotencia (chave, escopo, hash_conteudo)
  values (p_idem_chave, 'solicitacao_simples', p_idem_hash)
  on conflict (chave) do nothing;
  if not found then
    select * into v_existente from public.idempotencia where chave = p_idem_chave;
    if v_existente.hash_conteudo <> p_idem_hash or v_existente.escopo <> 'solicitacao_simples' then
      return jsonb_build_object('ok', false, 'erro', 'idempotencia_conflito');
    end if;
    if v_existente.resposta is not null then
      return v_existente.resposta || jsonb_build_object('repetido', true);
    end if;
    return jsonb_build_object('ok', false, 'erro', 'em_processamento');
  end if;

  v_local := p_inicio at time zone p_fuso;

  insert into public.agendamentos (
    nome, email, whatsapp, whatsapp_pais, tipo_atendimento,
    data_solicitada, horario_solicitado, objetivo, status, fuso_horario, inicio_solicitado,
    privacidade_versao, privacidade_registrada_em, privacidade_manifestacao, privacidade_base_legal
  ) values (
    p_nome, p_email, p_whatsapp, p_whatsapp_pais, p_tipo,
    v_local::date, v_local::time, nullif(p_objetivo, ''), 'pendente', p_fuso, p_inicio,
    p_priv_versao, now(), p_priv_manifestacao, p_priv_base_legal
  ) returning id, protocolo into v_id, v_protocolo;

  perform public._registrar_evento(v_id, 'solicitacao_recebida', null, 'pendente', 'aluno', null, null,
            jsonb_build_object('inicio', p_inicio));
  perform public._registrar_evento(v_id, 'privacidade_registrada', null, null, 'aluno', null, null,
            jsonb_build_object('versao', p_priv_versao, 'manifestacao', p_priv_manifestacao, 'base_legal', p_priv_base_legal));

  v_resp := jsonb_build_object('ok', true, 'id', v_id, 'protocolo', v_protocolo);
  update public.idempotencia set resposta = v_resp, agendamento_id = v_id where chave = p_idem_chave;
  return v_resp;
end $$;

revoke all on function public.registrar_solicitacao(text, text, text, text, text, text, text, timestamptz, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_solicitacao(text, text, text, text, text, text, text, timestamptz, text, text, text, text, text)
  to service_role;
