import { NextResponse, type NextRequest } from "next/server";
import { clienteSessao } from "@/lib/supabase/servidor";
import { destinoSeguro } from "@/lib/admin/auth";

// Retorno dos links de e-mail do Supabase Auth (recuperação de senha).
// Aceita o fluxo token_hash (recomendado para SSR) e o fluxo PKCE (code).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const destino = destinoSeguro(sp.get("next"));
  const supabase = await clienteSessao();
  const falha = NextResponse.redirect(new URL("/admin/login?erro=link_invalido", req.url));
  if (!supabase) return falha;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type");
  const code = sp.get("code");
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(destino, req.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destino, req.url));
  }
  return falha;
}
