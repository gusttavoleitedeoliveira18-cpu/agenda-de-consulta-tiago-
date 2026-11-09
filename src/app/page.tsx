import Image from "next/image";
import { Check, Laptop, Dumbbell, Trophy, MapPin, Users } from "lucide-react";
import { site } from "@/config/site";
import BookingForm from "@/components/BookingForm";
const btn = "inline-flex min-h-[56px] items-center justify-center rounded-xl bg-lima px-7 text-lg font-semibold text-grafite transition active:scale-[.98]";
const wrap = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const icons = [Laptop, Dumbbell, Trophy];
export default function Home() {
  const wa = site.whatsapp && `https://wa.me/${site.whatsapp}`;
  return (<>
    <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-grafite/85 backdrop-blur">
      <div className={`${wrap} flex h-16 items-center justify-between`}>
        <a href="#inicio" className="font-display text-lg font-bold">{site.nome.split(" ")[0]}<span className="text-lima"> Lima</span></a>
        <a href="#agendamento" className="rounded-lg bg-lima px-4 py-2.5 text-sm font-semibold text-grafite">Agendar avaliação</a>
      </div></header>
    <main>
      <section id="inicio" className="relative isolate overflow-hidden pt-16">
        <div className={`${wrap} grid items-center gap-8 py-10 md:grid-cols-2 md:py-20`}>
          <div className="hero-in order-2 md:order-1">
            <p className="mb-4 text-neblina">{site.nome} · {site.cref}</p>
            <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">{site.hero.titulo}</h1>
            <p className="mt-5 max-w-lg text-lg text-neblina">{site.hero.texto}</p>
            <a href="#agendamento" className={`${btn} mt-8 w-full sm:w-auto`}>Agendar avaliação</a>
          </div>
          <div className="relative order-1 aspect-[4/5] overflow-hidden rounded-3xl md:order-2">
            <Image src={site.foto} alt="Tiago conduzindo um treino em grupo na praia" fill priority sizes="(min-width:768px) 50vw, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-grafite/70 via-transparent to-transparent" />
          </div>
        </div></section>

      <section id="sobre" className="bg-floresta py-16"><div className={`${wrap} grid gap-8 md:grid-cols-[1.3fr_1fr]`}>
        <div><h2 className="font-display text-3xl font-bold sm:text-4xl">Quem vai acompanhar você</h2>
          <p className="mt-5 max-w-xl text-lg text-neblina">{site.sobre}</p></div>
        <dl className="grid content-start gap-4">
          {[["Profissional", site.nome], ["Experiência", "Mais de 4 anos"], ["Registro", site.cref]].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-white/10 bg-grafite p-4"><dt className="text-sm text-neblina">{k}</dt><dd className="font-display text-xl font-semibold">{v}</dd></div>))}
        </dl></div></section>

      <section id="servicos" className={`${wrap} py-16`}>
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Como você pode treinar</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {site.servicos.map((s, i) => { const I = icons[i]; return (
            <article key={s.t} className="rounded-2xl border border-white/10 bg-floresta p-6">
              <I className="text-lima" size={32} aria-hidden /><h3 className="mt-4 font-display text-xl font-semibold">{s.t}</h3><p className="mt-2 text-neblina">{s.d}</p></article>); })}
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {[[Users, "Formatos", site.formatos], [MapPin, "Locais", site.locais]].map(([I, t, l]: any) => (
            <div key={t}><h3 className="flex items-center gap-2 font-semibold"><I size={20} className="text-lima" aria-hidden />{t}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">{l.map((x: string) => <li key={x} className="rounded-full border border-white/20 px-4 py-2 text-sm">{x}</li>)}</ul></div>))}
        </div></section>

      <section id="metodo" className="bg-floresta py-16"><div className={wrap}>
        <h2 className="max-w-2xl font-display text-3xl font-bold sm:text-4xl">Muito além de um treino. Um acompanhamento completo.</h2>
        <p className="mt-4 max-w-2xl text-lg text-neblina">Cada aluno possui necessidades e objetivos diferentes. Por isso, o trabalho envolve planejamento, acompanhamento e ajustes constantes, priorizando a segurança e a evolução individual.</p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {site.diferenciais.map((d) => <li key={d} className="flex items-start gap-3 rounded-xl bg-grafite p-4"><Check className="mt-0.5 shrink-0 text-lima" size={20} aria-hidden />{d}</li>)}
        </ul></div></section>

      <section className="py-20"><div className={wrap}>
        <blockquote className="border-l-4 border-lima pl-6 font-display text-3xl font-semibold leading-tight sm:text-5xl">
          A evolução acontece com consistência, segurança e respeito à individualidade de cada aluno.</blockquote></div></section>

      <section className="bg-floresta py-14"><div className={wrap}>
        <h2 className="font-display text-2xl font-bold sm:text-3xl">Também atendo</h2>
        <ul className="mt-5 flex flex-wrap gap-3">{site.publico.map((p) => <li key={p} className="rounded-full bg-grafite px-5 py-3 text-lg">{p}</li>)}</ul></div></section>

      <section id="como-funciona" className={`${wrap} py-16`}>
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Como funciona</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">{site.etapas.map((e, i) => (
          <li key={e} className="rounded-2xl border border-white/10 p-6"><span className="font-display text-4xl font-bold text-lima">{i + 1}</span><p className="mt-3 text-lg">{e}</p></li>))}</ol></section>

      <section id="agendamento" className="bg-grafite py-16"><div className="mx-auto max-w-xl px-5">
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Solicite sua avaliação</h2>
        <p className="mb-8 mt-3 text-neblina">Envie sua preferência de data e horário. O profissional confirma a disponibilidade e responde por e-mail.</p>
        <BookingForm /></div></section>
    </main>
    <footer className="border-t border-white/10 bg-floresta py-12"><div className={`${wrap} grid gap-6 md:grid-cols-2`}>
      <div><p className="font-display text-xl font-bold">{site.nome}</p><p className="text-neblina">{site.cref}</p></div>
      <div className="flex flex-wrap gap-4 md:justify-end">
        {site.instagram && <a className="underline" href={site.instagram}>Instagram</a>}
        {wa && <a className="underline" href={wa}>WhatsApp</a>}
        <a className="underline" href="/privacidade">Aviso de Privacidade</a>
        <a href="#agendamento" className="font-semibold text-lima">Solicitar avaliação</a></div></div></footer>
  </>);
}
