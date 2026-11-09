import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validate } from "@/lib/validate";
export const runtime = "nodejs";
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Requisição inválida." }, { status: 400 }); }
  if (body.website) return NextResponse.json({ ok: true }); // honeypot anti-spam
  const { v, e, ok } = validate(body);
  if (!ok) return NextResponse.json({ errors: e }, { status: 422 });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "O envio ainda não está disponível. Fale com o profissional por outro canal." }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from("agendamentos").insert({ ...v, objetivo: v.objetivo || null, status: "pendente" });
  if (error) { console.error("supabase:", error.message); return NextResponse.json({ error: "Não foi possível registrar sua solicitação. Tente novamente." }, { status: 500 }); }
  return NextResponse.json({ ok: true }, { status: 201 });
}
