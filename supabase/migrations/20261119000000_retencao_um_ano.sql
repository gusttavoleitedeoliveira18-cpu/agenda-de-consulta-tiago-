-- =====================================================================
-- Migração 6 — Retenção de 1 ano (decisão do proprietário, 19/11/2026)
-- ---------------------------------------------------------------------
-- O Aviso de Privacidade informa que as solicitações ficam guardadas por
-- até 1 ano. Esta migração cria a exclusão automática correspondente.
--
-- O histórico (agendamento_eventos) continua protegido contra exclusões
-- comuns; somente a rotina de retenção, que liga um sinal de sessão
-- 'app.retencao' dentro da própria transação, pode apagar eventos.
-- =====================================================================

create or replace function public._tg_somente_insercao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.retencao', true) = 'on' then
    return old;
  end if;
  raise exception 'historico_imutavel' using errcode = 'P0001';
end $$;

create or replace function public.aplicar_retencao(p_meses integer default 12)
returns integer
language plpgsql set search_path = '' as $$
declare v_limite timestamptz := now() - make_interval(months => p_meses); v_n integer;
begin
  perform set_config('app.retencao', 'on', true);
  delete from public.agendamento_eventos e
   using public.agendamentos a
   where e.agendamento_id = a.id and a.created_at < v_limite;
  delete from public.idempotencia i
   using public.agendamentos a
   where i.agendamento_id = a.id and a.created_at < v_limite;
  delete from public.notificacoes n
   using public.agendamentos a
   where n.agendamento_id = a.id and a.created_at < v_limite;
  update public.agendamentos set solicitacao_anterior_id = null
   where solicitacao_anterior_id in (select id from public.agendamentos where created_at < v_limite);
  delete from public.agendamentos where created_at < v_limite;
  get diagnostics v_n = row_count;
  perform set_config('app.retencao', 'off', true);
  return v_n;
end $$;

revoke all on function public.aplicar_retencao(integer) from public, anon, authenticated;

-- Todo dia às 04:37 (UTC) apaga solicitações com mais de 1 ano.
create extension if not exists pg_cron;
select cron.schedule('agenda-retencao-1-ano', '37 4 * * *', $$select public.aplicar_retencao(12)$$);
