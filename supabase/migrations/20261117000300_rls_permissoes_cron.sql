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
