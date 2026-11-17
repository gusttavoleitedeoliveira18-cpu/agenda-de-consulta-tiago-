import type { Metadata } from "next";
import { site } from "@/config/site";
import FormAcesso, { campo } from "@/components/admin/FormAcesso";
import { entrar } from "../acesso";

export const metadata: Metadata = { title: "Entrar | Painel", robots: { index: false, follow: false } };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/admin";
  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <p className="font-display text-lg font-bold">{site.nome.split(" ")[0]}<span className="text-lima"> Lima</span></p>
      <h1 className="mt-6 font-display text-3xl font-bold">Painel do profissional</h1>
      <p className="mb-8 mt-2 text-neblina">Acesso restrito a contas autorizadas.</p>
      {sp.erro === "nao_autorizado" && <p role="alert" className="mb-5 rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">Esta conta não tem permissão para acessar o painel.</p>}
      {sp.erro === "link_invalido" && <p role="alert" className="mb-5 rounded-lg bg-[#3a1d18] p-3 text-sm text-[#ffb4a5]">O link expirou ou já foi usado. Solicite um novo.</p>}
      {sp.saiu === "1" && <p role="status" className="mb-5 rounded-lg border border-lima/40 p-3 text-sm">Sessão encerrada.</p>}
      <FormAcesso acao={entrar} botao="Entrar">
        <input type="hidden" name="next" value={next} />
        <div><label htmlFor="email" className="mb-1.5 block text-sm font-medium">E-mail</label><input id="email" name="email" type="email" autoComplete="username" required className={campo} /></div>
        <div><label htmlFor="senha" className="mb-1.5 block text-sm font-medium">Senha</label><input id="senha" name="senha" type="password" autoComplete="current-password" required className={campo} /></div>
      </FormAcesso>
      <p className="mt-6 text-sm"><a href="/admin/recuperar-senha" className="text-lima underline">Esqueci minha senha</a></p>
    </main>);
}
