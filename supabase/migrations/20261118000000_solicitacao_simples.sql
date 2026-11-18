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
