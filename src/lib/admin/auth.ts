import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { clienteSessao } from "@/lib/supabase/servidor";

// Autenticação ≠ autorização: um usuário autenticado só é administrador se estiver
// ativo em public.administradores. Esta verificação roda em TODA página e ação
// administrativa (o middleware só melhora a navegação) e o banco verifica de novo
// (RLS + eh_admin() nas funções admin_*).

export type ContextoAdmin = { ok: true; supabase: SupabaseClient; user: User } | { ok: false; motivo: "sem_config" | "sem_sessao" | "nao_admin" };

export async function verificarAdmin(): Promise<ContextoAdmin> {
  const supabase = await clienteSessao();
  if (!supabase) return { ok: false, motivo: "sem_config" };
  const { data, error } = await supabase.auth.getUser(); // valida o JWT no servidor de Auth
  if (error || !data.user) return { ok: false, motivo: "sem_sessao" };
  const { data: admin } = await supabase.rpc("eh_admin");
  if (admin !== true) return { ok: false, motivo: "nao_admin" };
  return { ok: true, supabase, user: data.user };
}

/** Para Server Components: redireciona quem não pode acessar. */
export async function exigirAdminPagina(): Promise<{ supabase: SupabaseClient; user: User }> {
  const r = await verificarAdmin();
  if (!r.ok) redirect(r.motivo === "nao_admin" ? "/admin/login?erro=nao_autorizado" : "/admin/login");
  return { supabase: r.supabase, user: r.user };
}

export { destinoSeguro } from "./redirecionamento";
