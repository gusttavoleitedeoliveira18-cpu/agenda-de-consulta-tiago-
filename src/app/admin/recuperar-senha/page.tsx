import type { Metadata } from "next";
import FormAcesso, { campo } from "@/components/admin/FormAcesso";
import { recuperarSenha } from "../acesso";

export const metadata: Metadata = { title: "Recuperar senha | Painel", robots: { index: false, follow: false } };

export default function Recuperar() {
  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <a href="/admin/login" className="text-lima underline">← Voltar</a>
      <h1 className="mt-6 font-display text-3xl font-bold">Recuperar senha</h1>
      <p className="mb-8 mt-2 text-neblina">Enviaremos um link para o e-mail da conta autorizada.</p>
      <FormAcesso acao={recuperarSenha} botao="Enviar link">
        <div><label htmlFor="email" className="mb-1.5 block text-sm font-medium">E-mail</label><input id="email" name="email" type="email" autoComplete="username" required className={campo} /></div>
      </FormAcesso>
    </main>);
}
