import { NextResponse } from "next/server";
import { clienteServico } from "@/lib/supabase/servico";
import { cronSecret } from "@/lib/env";
import { comparacaoSegura } from "@/lib/seguranca/cripto";
import { processarFila } from "@/lib/email/fila";

// Rotina agendada (Vercel Cron envia GET com "Authorization: Bearer <CRON_SECRET>").
// Idempotente: pode rodar várias vezes sem efeitos duplicados.
//  1. expira solicitações/propostas vencidas (também roda a cada minuto via pg_cron no banco);
//  2. processa notificações pendentes e tentativas vencidas;
//  3. limpa dados temporários (rate limit, idempotência, webhooks antigos).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = cronSecret();
  const auth = req.headers.get("authorization") ?? "";
  if (!segredo || !comparacaoSegura(auth, `Bearer ${segredo}`)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }
  const db = clienteServico();
  if (!db) return NextResponse.json({ erro: "supabase_nao_configurado" }, { status: 503 });

  const exp = await db.rpc("expirar_vencidos", { p_limite: 500, p_intervalo: null });
  let fila = { processadas: 0, enviadas: 0, reagendadas: 0, falhas: 0 };
  for (let i = 0; i < 4; i++) {
    const r = await processarFila({ limite: 25 });
    fila = { processadas: fila.processadas + r.processadas, enviadas: fila.enviadas + r.enviadas, reagendadas: fila.reagendadas + r.reagendadas, falhas: fila.falhas + r.falhas };
    if (r.processadas < 25) break;
  }
  const limpeza = await db.rpc("limpar_temporarios");
  const resultado = { expirados: exp.error ? null : exp.data, fila, limpeza: limpeza.error ? null : limpeza.data };
  console.info("cron:", JSON.stringify(resultado));
  return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
}
