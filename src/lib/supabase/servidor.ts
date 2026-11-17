import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig, emProducao } from "@/lib/env";

/** Cliente com a sessão do usuário (cookies HttpOnly), sujeito a RLS. */
export async function clienteSessao() {
  const { url, publishable } = supabaseConfig();
  if (!url || !publishable) return null;
  const store = await cookies();
  return createServerClient(url, publishable, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: emProducao(), path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) store.set(name, value, options);
        } catch {
          // Chamado a partir de Server Component: o middleware renova a sessão.
        }
      },
    },
  });
}
