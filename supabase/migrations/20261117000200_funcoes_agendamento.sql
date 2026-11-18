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
