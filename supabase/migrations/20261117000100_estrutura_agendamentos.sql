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
