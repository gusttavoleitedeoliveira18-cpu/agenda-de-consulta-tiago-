import { NextResponse } from "next/server";
import { isValidPhoneNumber } from "libphonenumber-js/max";
import { agenda } from "@/config/agenda";
import { site } from "@/config/site";
import { validate } from "@/lib/validate";
import { validarTelefone } from "@/lib/telefone";
import { localParaInstante, hojeNoFuso } from "@/lib/tempo";
import { clienteServico } from "@/lib/supabase/servico";
import { fusoProfissional } from "@/lib/env";
import { ipConfiavel, lerJson, origemPermitida, SEM_CACHE } from "@/lib/seguranca/requisicao";
import { verificarTurnstile, turnstileAtivo } from "@/lib/seguranca/turnstile";
import { consumir, REGRAS, limiteDesligadoEmTeste } from "@/lib/seguranca/limite";
import { hashConteudo } from "@/lib/seguranca/cripto";

// Registra a solicitação no banco. O aluno a envia ao profissional pelo WhatsApp
// (mensagem pronta montada no navegador após a confirmação do registro).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: SEM_CACHE });
const INDISPONIVEL = "O envio está temporariamente indisponível. Tente novamente mais tarde ou chame o profissional diretamente pelo WhatsApp.";

export async function POST(req: Request) {
  if (!origemPermitida(req)) return json({ error: "Origem não permitida." }, 403);
  const body = await lerJson(req);
  if (!body) return json({ error: "Requisição inválida." }, 400);

  // Honeypot: campo invisível para pessoas. Não simulamos sucesso.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json({ error: "Não foi possível processar o envio. Recarregue a página e tente novamente." }, 400);
  }

  const db = clienteServico();
  if (!db) return json({ error: INDISPONIVEL }, 503);

  const ip = ipConfiavel(req);
  if (!limiteDesligadoEmTeste()) {
    const lim = await consumir(db, REGRAS.solicitacaoPorIp, ip);
    if (lim === "excedido") return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429);
    if (lim !== "ok") return json({ error: INDISPONIVEL }, 503);
  }

  if (turnstileAtivo()) {
    const t = await verificarTurnstile(body.turnstile, ip);
    if (t === "invalido") return json({ error: "Não foi possível confirmar que você não é um robô. Refaça a verificação e envie novamente.", turnstile: true }, 400);
    if (t !== "ok") return json({ error: INDISPONIVEL }, 503);
  }

  const fuso = fusoProfissional();
  const { v, e, ok } = validate(body, {
    hoje: hojeNoFuso(fuso),
    servicosDisponiveis: site.tipos.map((t) => t.v),
    telefoneValido: (x) => isValidPhoneNumber(x),
  });
  if (!ok || !v) return json({ errors: e }, 422);

  const tel = validarTelefone(v.whatsapp, v.whatsapp_pais || undefined);
  if (!tel.ok) return json({ errors: { whatsapp: "Número de WhatsApp inválido ou incompleto." } }, 422);

  const conv = localParaInstante(v.data_solicitada, v.horario_solicitado, fuso);
  if (!conv.ok) {
    const msg = conv.erro === "formato" ? "Data inválida." : "Este horário não existe ou é ambíguo no fuso do profissional. Escolha outro.";
    return json({ errors: { [conv.erro === "formato" ? "data_solicitada" : "horario_solicitado"]: msg } }, 422);
  }
  if (conv.instante.getTime() <= Date.now()) {
    return json({ errors: { horario_solicitado: "Escolha um horário futuro." } }, 422);
  }

  const chave = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  if (!/^[0-9a-f-]{32,36}$/i.test(chave)) return json({ error: "Requisição inválida. Recarregue a página." }, 400);

  if (!limiteDesligadoEmTeste()) {
    const lim = await consumir(db, REGRAS.solicitacaoPorEmail, v.email);
    if (lim === "excedido") return json({ error: "Limite de solicitações para este e-mail atingido. Tente novamente amanhã." }, 429);
    if (lim !== "ok") return json({ error: INDISPONIVEL }, 503);
  }

  const dados = {
    nome: v.nome.replace(/\s+/g, " "), email: v.email, whatsapp: tel.e164, pais: tel.pais ?? null,
    tipo: v.tipo_atendimento, inicio: conv.instante.toISOString(), objetivo: v.objetivo ?? "",
  };
  const { data, error } = await db.rpc("registrar_solicitacao", {
    p_idem_chave: chave, p_idem_hash: hashConteudo(dados),
    p_nome: dados.nome, p_email: dados.email, p_whatsapp: dados.whatsapp, p_whatsapp_pais: dados.pais,
    p_tipo: dados.tipo, p_inicio: dados.inicio, p_fuso: fuso, p_objetivo: dados.objetivo,
    p_priv_versao: agenda.privacidade.versao, p_priv_manifestacao: agenda.privacidade.manifestacao,
    p_priv_base_legal: agenda.privacidade.baseLegal,
  });
  if (error || !data) {
    console.error("agendamento: falha ao registrar", error?.code ?? "sem-codigo");
    return json({ error: "Não foi possível registrar sua solicitação. Tente novamente." }, 500);
  }
  const r = data as { ok: boolean; erro?: string; protocolo?: string; repetido?: boolean };
  if (!r.ok) {
    switch (r.erro) {
      case "horario_passado":
        return json({ errors: { horario_solicitado: "Escolha um horário futuro." } }, 422);
      case "idempotencia_conflito":
        return json({ error: "Esta solicitação já foi enviada com outros dados. Recarregue a página para enviar uma nova." }, 409);
      default:
        return json({ error: "Sua solicitação ainda está sendo processada. Aguarde alguns segundos." }, 409);
    }
  }
  return json({ ok: true, protocolo: r.protocolo }, r.repetido ? 200 : 201);
}
