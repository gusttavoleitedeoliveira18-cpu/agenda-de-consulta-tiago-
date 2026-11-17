import type { Metadata } from "next";
import RespostaProposta from "./RespostaProposta";

export const metadata: Metadata = {
  title: "Proposta de horário",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Página estática sem scripts de terceiros. O token fica no fragmento (#t=...),
// que o navegador nunca envia ao servidor em GET; a visita não altera nada.
export default function Proposta() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <a href="/" className="text-lima underline">← Voltar ao site</a>
      <h1 className="mt-6 font-display text-3xl font-bold sm:text-4xl">Proposta de novo horário</h1>
      <RespostaProposta />
    </main>
  );
}
