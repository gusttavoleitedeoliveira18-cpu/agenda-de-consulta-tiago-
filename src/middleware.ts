import { NextResponse, type NextRequest } from "next/server";
import { atualizarSessao } from "@/lib/supabase/middleware";

const PUBLICAS = ["/admin/login", "/admin/recuperar-senha", "/admin/auth/confirm"];

// Camada de conveniência: renova a sessão e redireciona visitantes sem sessão.
// A barreira de segurança real está em cada página/ação (verificarAdmin) e no banco (RLS).
export async function middleware(req: NextRequest) {
  const { res, autenticado } = await atualizarSessao(req);
  const caminho = req.nextUrl.pathname;
  if (!autenticado && !PUBLICAS.some((p) => caminho === p || caminho.startsWith(`${p}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = caminho === "/admin" ? "" : `?next=${encodeURIComponent(caminho)}`;
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
