import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/env";

// Cliente com chave PRIVILEGIADA (secret/service_role): ignora RLS.
// Usado apenas em rotas do servidor com operações específicas e dados já validados:
// solicitação pública, resposta a proposta por token, fila de e-mails, cron e webhook.
// Ações administrativas NÃO usam este cliente: usam a sessão do administrador (RLS + eh_admin()).
let cache: SupabaseClient | null = null;

export function clienteServico(): SupabaseClient | null {
  const { url, secret } = supabaseConfig();
  if (!url || !secret) {
    console.error("supabase: configuração ausente", JSON.stringify({ SUPABASE_URL: !!url, SUPABASE_SECRET_KEY: !!secret }));
    return null;
  }
  if (!/^https?:\/\//.test(url)) {
    console.error("supabase: SUPABASE_URL não parece uma URL (verifique se os valores não foram trocados)");
    return null;
  }
  cache ??= createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "agenda-servidor" } },
  });
  return cache;
}
