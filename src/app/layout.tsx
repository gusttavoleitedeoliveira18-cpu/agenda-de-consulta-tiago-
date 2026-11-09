import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { site } from "@/config/site";
import "./globals.css";
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display" });
const body = Figtree({ subsets: ["latin"], variable: "--f-body" });
export const metadata: Metadata = { title: `${site.nome} | Personal Trainer`, description: site.hero.texto };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={`${display.variable} ${body.variable}`}><body className="font-sans antialiased">{children}</body></html>;
}
