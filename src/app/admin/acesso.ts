"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clienteSessao } from "@/lib/supabase/servidor";
import { clienteServico } from "@/lib/supabase/servico";
import { siteUrl } from "@/lib/env";
import { destinoSeguro, verificarAdmin } from "@/lib/admin/auth";
import { ipDeHeaders } from "@/lib/seguranca/requisicao";
import { consumir, REGRAS, limiteDesligadoEmTeste, type Regra } from "@/lib/seguranca/limite";

export type EstadoForm = { erro?: string; msg?: string };

async function dentroDoLimite(regra: Regra): Promise<boolean> {
  if (limiteDesligadoEmTeste()) return true;
  const db = clienteServico();
  if (!db) return false;
  return (await consumir(db, regra, ipDeHeaders(await headers()))) === "ok";
}

const credenciais = z.object({ email: z.email().max(160), senha: z.string().min(1).max(200) });

export async function entrar(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const p = credenciais.safeParse({ email: fd.get("email"), senha: fd.get("senha") });
  if (!p.success) return { erro: "Informe e-mail e senha." };
  if (!(await dentroDoLimite(REGRAS.loginPorIp))) return { erro: "Muitas tentativas. Aguarde alguns minutos." };
  const supabase = await clienteSessao();
  if (!supabase) return { erro: "Autenticação não configurada." };
  const { error } = await supabase.auth.signInWithPassword({ email: p.data.email, password: p.data.senha });
  if (error) return { erro: "E-mail ou senha inválidos." };
  const r = await verificarAdmin();
  if (!r.ok) {
    await supabase.auth.signOut();
    return { erro: "Esta conta não tem permissão para acessar o painel." };
  }
  redirect(destinoSeguro(fd.get("next")));
}

export async function recuperarSenha(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const email = z.email().max(160).safeParse(fd.get("email"));
  if (!email.success) return { erro: "Informe um e-mail válido." };
  const resposta = { msg: "Se este e-mail pertencer a uma conta autorizada, você receberá um link para redefinir a senha." };
  if (!(await dentroDoLimite(REGRAS.recuperacaoPorIp))) return { erro: "Muitas tentativas. Aguarde e tente novamente." };
  const supabase = await clienteSessao();
  const url = siteUrl();
  if (!supabase || !url) return { erro: "Recuperação de senha não configurada (PUBLIC_SITE_URL/Supabase)." };
  // Mesma resposta exista ou não a conta (evita enumeração de e-mails).
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${url}/admin/auth/confirm?next=/admin/redefinir-senha` });
  return resposta;
}

export async function redefinirSenha(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const senha = String(fd.get("senha") ?? "");
  if (senha.length < 10 || senha.length > 200 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha)) {
    return { erro: "Use ao menos 10 caracteres, com letras maiúsculas, minúsculas e números." };
  }
  if (senha !== fd.get("confirmacao")) return { erro: "As senhas não conferem." };
  const r = await verificarAdmin();
  if (!r.ok) return { erro: "Sessão inválida ou expirada. Solicite um novo link." };
  const { error } = await r.supabase.auth.updateUser({ password: senha });
  if (error) return { erro: "Não foi possível alterar a senha. Escolha uma senha diferente e mais forte." };
  redirect("/admin?senha=alterada");
}
