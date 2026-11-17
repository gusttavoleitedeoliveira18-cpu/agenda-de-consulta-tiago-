import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Renova a sessão do Supabase nas rotas /admin (padrão oficial @supabase/ssr). */
export async function atualizarSessao(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { res, autenticado: false };
  const seguro = process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && process.env.APP_TEST_MODE !== "1");
  const supabase = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: seguro, path: "/" },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of lista) res.cookies.set(name, value, options);
      },
    },
  });
  // getUser() valida o token no servidor de Auth (não confia só no cookie).
  const { data } = await supabase.auth.getUser();
  return { res, autenticado: !!data.user };
}
