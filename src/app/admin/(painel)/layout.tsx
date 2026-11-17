import type { Metadata } from "next";
import { site } from "@/config/site";
import { exigirAdminPagina } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Painel | Agendamentos", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user } = await exigirAdminPagina();
  return (<>
    <header className="border-b border-white/10 bg-grafite/85">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <a href="/admin" className="font-display text-lg font-bold">{site.nome.split(" ")[0]}<span className="text-lima"> Lima</span> <span className="text-sm font-normal text-neblina">· Painel</span></a>
        <nav aria-label="Painel" className="flex flex-wrap items-center gap-2 text-sm">
          <a href="/admin" className="rounded-lg px-3 py-2 hover:bg-floresta">Início</a>
          <a href="/admin/agendamentos" className="rounded-lg px-3 py-2 hover:bg-floresta">Agendamentos</a>
          <form action="/admin/sair" method="post"><button className="rounded-lg border border-white/20 px-3 py-2" title={user.email ?? ""}>Sair</button></form>
        </nav>
      </div>
    </header>
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">{children}</main>
  </>);
}
