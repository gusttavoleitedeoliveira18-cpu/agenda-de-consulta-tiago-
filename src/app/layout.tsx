import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { site } from "@/config/site";
import "./globals.css";
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display" });
const body = Figtree({ subsets: ["latin"], variable: "--f-body" });
// URL pública: PUBLIC_SITE_URL, ou o domínio de produção informado pela própria Vercel.
const urlBase = process.env.PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const titulo = `${site.nome} | Personal Trainer`;
export const metadata: Metadata = {
  metadataBase: new URL(urlBase),
  title: titulo,
  description: site.hero.texto,
  // Cartão de prévia ao compartilhar o link (WhatsApp, Instagram, Facebook...). JPEG leve (< 300 KB).
  openGraph: {
    type: "website", locale: "pt_BR", siteName: site.nome, title: titulo, description: site.hero.titulo, url: "/",
    images: [{ url: "/images/compartilhar.jpg", width: 1200, height: 630, alt: `${site.nome} — Personal Trainer, ${site.cref}` }],
  },
  twitter: { card: "summary_large_image", title: titulo, description: site.hero.titulo, images: ["/images/compartilhar.jpg"] },
};
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={`${display.variable} ${body.variable}`}><body className="font-sans antialiased">{children}</body></html>;
}
