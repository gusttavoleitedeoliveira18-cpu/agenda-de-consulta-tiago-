import { NextResponse } from "next/server";
import { clienteSessao } from "@/lib/supabase/servidor";
import { origemPermitida } from "@/lib/seguranca/requisicao";

// Encerramento de sessão somente por POST com verificação de origem.
export async function POST(req: Request) {
  if (!origemPermitida(req)) return NextResponse.json({ erro: "origem" }, { status: 403 });
  const supabase = await clienteSessao();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/admin/login?saiu=1", req.url), 303);
}
