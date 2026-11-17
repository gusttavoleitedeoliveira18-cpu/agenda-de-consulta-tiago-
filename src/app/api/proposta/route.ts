import { NextResponse, after } from "next/server";
import { clienteServico } from "@/lib/supabase/servico";
import { hashToken, tokenComFormatoValido } from "@/lib/seguranca/cripto";
import { ipConfiavel, lerJson, origemPermitida, SEM_CACHE } from "@/lib/seguranca/requisicao";
import { consumir, REGRAS, limiteDesligadoEmTeste } from "@/lib/seguranca/limite";
import { nomeServico } from "@/lib/agenda/servicos";
import { processarFila } from "@/lib/email/fila";

// Resposta à proposta de novo horário. Somente POST: GET/HEAD nunca alteram estado,
// e scanners de e-mail não têm acesso ao token (ele fica no fragmento #t= da URL).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: SEM_CACHE });

export async function POST(req: Request) {
  if (!origemPermitida(req)) return json({ erro: "origem" }, 403);
  const body = await lerJson(req, 2048);
  if (!body) return json({ erro: "requisicao_invalida" }, 400);
  const db = clienteServico();
  if (!db) return json({ erro: "indisponivel" }, 503);

  if (!limiteDesligadoEmTeste()) {
    const lim = await consumir(db, REGRAS.propostaPorIp, ipConfiavel(req));
    if (lim === "excedido") return json({ erro: "limite" }, 429);
    if (lim !== "ok") return json({ erro: "indisponivel" }, 503);
  }

  const { token, acao } = body;
  // Mesma resposta para token malformado e inexistente: evita enumeração.
  if (!tokenComFormatoValido(token)) return json({ erro: "token_invalido" }, 404);
  const hash = hashToken(token);

  if (acao === "consultar") {
    const { data, error } = await db.rpc("consultar_proposta", { p_token_hash: hash });
    if (error || !data) return json({ erro: "indisponivel" }, 503);
    const d = data as Record<string, unknown> & { ok: boolean; erro?: string };
    if (!d.ok) return json({ erro: d.erro }, d.erro === "token_invalido" ? 404 : 410);
    return json({ ...d, servico: nomeServico(String(d.tipo_atendimento)) }, 200);
  }

  if (acao !== "aceitar" && acao !== "recusar") return json({ erro: "acao_invalida" }, 400);
  const { data, error } = await db.rpc("responder_proposta", { p_token_hash: hash, p_acao: acao });
  if (error || !data) return json({ erro: "indisponivel" }, 503);
  const d = data as { ok: boolean; erro?: string; status?: string };
  if (!d.ok) return json({ erro: d.erro, status: d.status }, d.erro === "token_invalido" ? 404 : 409);
  after(() => processarFila({ limite: 5 }).then(() => undefined).catch(() => undefined));
  return json(d, 200);
}
