import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { clienteServico } from "@/lib/supabase/servico";
import { emailConfig } from "@/lib/env";

// Webhook do Resend (assinado via Svix). Eventos sem assinatura válida são rejeitados.
// Idempotência por svix-id. Somente o necessário é registrado (tipo + id da mensagem).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const segredo = emailConfig().webhookSecret;
  if (!segredo) return NextResponse.json({ erro: "nao_configurado" }, { status: 503 });
  const corpo = await req.text();
  if (corpo.length > 65_536) return NextResponse.json({ erro: "grande" }, { status: 413 });
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };
  let verificado: unknown;
  try {
    // svix@2: verify() lança erro se a assinatura/timestamp forem inválidos; o corpo é lido depois.
    new Webhook(segredo).verify(corpo, headers);
    verificado = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ erro: "assinatura_invalida" }, { status: 401 });
  }
  const evento = (verificado && typeof verificado === "object" ? verificado : {}) as { type?: unknown; data?: { email_id?: unknown } };
  const db = clienteServico();
  if (!db) return NextResponse.json({ erro: "indisponivel" }, { status: 503 });
  const { error } = await db.rpc("registrar_webhook_email", {
    p_evento_id: headers["svix-id"], p_tipo: String(evento.type ?? "desconhecido").slice(0, 60),
    p_mensagem_id: String(evento.data?.email_id ?? ""),
  });
  if (error) return NextResponse.json({ erro: "indisponivel" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
