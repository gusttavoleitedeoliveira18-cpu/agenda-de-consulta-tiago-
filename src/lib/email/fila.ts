import "server-only";
import { clienteServico } from "@/lib/supabase/servico";
import { chaveCriptografia, emailConfig, siteUrl } from "@/lib/env";
import { decifrar, subchave } from "@/lib/seguranca/cripto";
import { nomeServico } from "@/lib/agenda/servicos";
import { montarEmail, type DadosAgendamento, type TipoNotificacao } from "./templates";

// Worker da Outbox. Reivindica notificações com lease (SKIP LOCKED), envia pelo
// Resend com Idempotency-Key estável por notificação/reenvio e registra o resultado.
// Não promete "exatamente uma vez": a deduplicação é por evento de negócio no banco
// e por chave de idempotência no provedor (válida por 24 h).

type Notificacao = { id: string; agendamento_id: string; tipo: TipoNotificacao; destinatario: "aluno" | "admin"; reenvios: number; tentativas: number };
type Envio = { ok: true; id: string } | { ok: false; erro: string; permanente: boolean };

export const FINALIDADE_TOKEN = "notificacao-token-v1";

async function enviarResend(n: Notificacao, para: string, assunto: string, html: string, texto: string): Promise<Envio> {
  const { apiKey, from, apiUrl, admin } = emailConfig();
  if (!apiKey || !from) return { ok: false, erro: "Serviço de e-mail não configurado (RESEND_API_KEY/EMAIL_FROM).", permanente: false };
  try {
    const r = await fetch(`${apiUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `notif-${n.id}-${n.reenvios}`,
      },
      body: JSON.stringify({
        from, to: [para], subject: assunto, html, text: texto,
        ...(n.destinatario === "aluno" && admin ? { reply_to: admin } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: j.id ?? "" };
    }
    // 4xx (exceto 408/409/429) = erro de requisição/configuração: não adianta repetir automaticamente.
    const permanente = r.status >= 400 && r.status < 500 && ![408, 409, 429].includes(r.status);
    return { ok: false, erro: `Provedor respondeu HTTP ${r.status}.`, permanente };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    // Timeout é incerto: a nova tentativa usa a MESMA Idempotency-Key, evitando duplicidade.
    return { ok: false, erro: timeout ? "Tempo esgotado ao contatar o provedor." : "Falha de rede ao contatar o provedor.", permanente: false };
  }
}

async function processarUma(n: Notificacao): Promise<string> {
  const db = clienteServico()!;
  const concluir = async (sucesso: boolean, provedorId: string | null, erro: string | null, permanente = false) => {
    const { data } = await db.rpc("concluir_notificacao", {
      p_id: n.id, p_sucesso: sucesso, p_provedor_id: provedorId, p_erro: erro, p_permanente: permanente,
    });
    return String(data ?? "erro");
  };

  const { data, error } = await db.rpc("dados_notificacao", { p_id: n.id });
  if (error || !data) return concluir(false, null, "Dados da notificação indisponíveis.");
  const { agendamento, payload_cifrado } = data as { agendamento: DadosAgendamento; payload_cifrado: string | null };

  const url = siteUrl();
  if (!url) return concluir(false, null, "PUBLIC_SITE_URL não configurada.");
  const para = n.destinatario === "admin" ? emailConfig().admin : agendamento.email;
  if (!para) return concluir(false, null, "ADMIN_NOTIFICATION_EMAIL não configurado.");

  let linkProposta: string | undefined;
  if (n.tipo === "proposta") {
    const chave = chaveCriptografia();
    if (!chave) return concluir(false, null, "TOKEN_ENCRYPTION_KEY não configurada.");
    if (!payload_cifrado) return concluir(false, null, "Token da proposta indisponível; crie uma nova proposta.", true);
    try {
      const token = decifrar(payload_cifrado, subchave(chave, FINALIDADE_TOKEN), agendamento.id);
      linkProposta = `${url}/proposta#t=${token}`; // fragmento: não é enviado ao servidor em GET
    } catch {
      return concluir(false, null, "Não foi possível decifrar o token (chave alterada?).", true);
    }
  }

  const email = montarEmail(n.tipo, { a: agendamento, nomeServico: nomeServico(agendamento.tipo_atendimento), siteUrl: url, linkProposta });
  const r = await enviarResend(n, para, email.assunto, email.html, email.texto);
  return r.ok ? concluir(true, r.id, null) : concluir(false, null, r.erro, r.permanente);
}

export type ResumoFila = { processadas: number; enviadas: number; reagendadas: number; falhas: number };

export async function processarFila(opts: { ids?: string[]; limite?: number } = {}): Promise<ResumoFila> {
  const resumo: ResumoFila = { processadas: 0, enviadas: 0, reagendadas: 0, falhas: 0 };
  const db = clienteServico();
  if (!db) return resumo;
  const { data, error } = await db.rpc("reivindicar_notificacoes", {
    p_limite: opts.limite ?? 25, p_lease_segundos: 90, p_ids: opts.ids ?? null,
  });
  if (error || !Array.isArray(data)) {
    console.error("fila: falha ao reivindicar notificações");
    return resumo;
  }
  for (const n of data as Notificacao[]) {
    const estado = await processarUma(n).catch(() => "erro");
    resumo.processadas++;
    if (estado === "enviado_ao_provedor") resumo.enviadas++;
    else if (estado === "pendente") resumo.reagendadas++;
    else resumo.falhas++;
  }
  return resumo;
}

/** Tenta enviar imediatamente uma notificação recém-criada; o cron continua como recuperação. */
export async function enviarAgora(id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  const r = await processarFila({ ids: [id], limite: 1 });
  return r.enviadas === 1;
}
