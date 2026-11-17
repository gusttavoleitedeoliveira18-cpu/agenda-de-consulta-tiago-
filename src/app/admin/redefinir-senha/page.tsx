import type { Metadata } from "next";
import FormAcesso, { campo } from "@/components/admin/FormAcesso";
import { exigirAdminPagina } from "@/lib/admin/auth";
import { redefinirSenha } from "../acesso";

export const metadata: Metadata = { title: "Nova senha | Painel", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Redefinir() {
  await exigirAdminPagina();
  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-bold">Definir nova senha</h1>
      <p className="mb-8 mt-2 text-neblina">Mínimo de 10 caracteres, com letras maiúsculas, minúsculas e números.</p>
      <FormAcesso acao={redefinirSenha} botao="Salvar nova senha">
        <div><label htmlFor="senha" className="mb-1.5 block text-sm font-medium">Nova senha</label><input id="senha" name="senha" type="password" autoComplete="new-password" minLength={10} required className={campo} /></div>
        <div><label htmlFor="confirmacao" className="mb-1.5 block text-sm font-medium">Repita a nova senha</label><input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" minLength={10} required className={campo} /></div>
      </FormAcesso>
    </main>);
}
