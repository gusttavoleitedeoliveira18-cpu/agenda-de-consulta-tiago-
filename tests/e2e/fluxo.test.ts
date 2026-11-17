// Testes end-to-end contra servidores Next reais (next start) + Supabase local.
// Executar via `npm run test:e2e` (tests/e2e/run.mjs prepara o ambiente).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";

const A = "http://localhost:3000", B = "http://localhost:3001";
const FUSO = "America/Sao_Paulo";
const db = new Client({ connectionString: process.env.E2E_DB_URL });
let browser: Browser;
let ipSeq = 0;
let dia = 0;

function slot(hora = "10:00") {
  dia++;
  return { data_solicitada: DateTime.now().setZone(FUSO).plus({ days: 2 + dia }).toISODate()!, horario_solicitado: hora };
}
function corpo(extra: Record<string, unknown> = {}) {
  return {
    nome: "Maria Teste Souza", email: `aluno+${randomUUID().slice(0, 8)}@example.test`, whatsapp: "+5571988887777", whatsapp_pais: "BR",
    tipo_atendimento: "consultoria_online", ...slot(), objetivo: "Condicionamento", privacidade: "ciente",
    idempotency_key: randomUUID(), ...extra,
  };
}
async function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/api/agendamento`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-test-ip": `10.0.0.${++ipSeq}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const linha = async (protocolo: string) => (await db.query("select * from agendamentos where protocolo=$1", [protocolo])).rows[0];
async function foto(p: Page, nome: string) {
  if (process.env.E2E_CAPTURAS) await p.screenshot({ path: `docs/visual/depois/${nome}.png`, fullPage: true });
}

beforeAll(async () => {
  await db.connect();
  await db.query("truncate notificacoes, agendamento_eventos, idempotencia, rate_limites, webhook_eventos, agendamentos cascade");
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); await db.end(); });

describe("API de solicitação", () => {
  it("bloqueia origem ausente/estranha (CSRF) e honeypot", async () => {
    const r1 = await fetch(`${A}/api/agendamento`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo()) });
    expect(r1.status).toBe(403);
    expect((await post(A, corpo(), { origin: "https://atacante.example" })).status).toBe(403);
    const hp = await post(A, corpo({ website: "http://spam" }));
    expect(hp.status).toBe(400);
    expect(hp.j.ok).toBeUndefined();
  });

  it("valida campos obrigatórios, e-mail, telefone, data/horário passados, serviço e privacidade", async () => {
    const vazio = await post(A, { idempotency_key: randomUUID() });
    expect(vazio.status).toBe(422);
    expect(Object.keys(vazio.j.errors).sort()).toEqual(["data_solicitada", "email", "horario_solicitado", "nome", "privacidade", "tipo_atendimento", "whatsapp"].sort());
    expect((await post(A, corpo({ email: "x@y" }))).j.errors.email).toBeTruthy();
    expect((await post(A, corpo({ whatsapp: "+557198888" }))).j.errors.whatsapp).toMatch(/inválido/);
    expect((await post(A, corpo({ whatsapp: "+5500999999999" }))).j.errors.whatsapp).toMatch(/inválido/);
    expect((await post(A, corpo({ whatsapp: "71988887777" }))).j.errors.whatsapp).toBeTruthy();
    const ontem = DateTime.now().setZone(FUSO).minus({ days: 1 }).toISODate();
    expect((await post(A, corpo({ data_solicitada: ontem }))).j.errors.data_solicitada).toBeTruthy();
    const hoje = DateTime.now().setZone(FUSO);
    if (hoje.hour > 0) expect((await post(A, corpo({ data_solicitada: hoje.toISODate(), horario_solicitado: "00:00" }))).j.errors.horario_solicitado).toMatch(/futuro/);
    expect((await post(A, corpo({ tipo_atendimento: "nao_sei" }))).j.errors.tipo_atendimento).toMatch(/Escolha um tipo/);
    expect((await post(A, corpo({ privacidade: "" }))).j.errors.privacidade).toBeTruthy();
    expect((await db.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(0);
  });

  it("registra no banco em E.164 e no horário de Brasília", async () => {
    const b = corpo();
    const r = await post(A, b);
    expect(r.status).toBe(201);
    expect(r.j.protocolo).toMatch(/^TL-[0-9A-F]{10}$/);
    const a = await linha(r.j.protocolo);
    expect(a).toMatchObject({ whatsapp: "+5571988887777", whatsapp_pais: "BR", status: "pendente", fuso_horario: FUSO, email: b.email });
    expect(DateTime.fromJSDate(a.inicio_solicitado).setZone(FUSO).toFormat("yyyy-MM-dd HH:mm")).toBe(`${b.data_solicitada} 10:00`);
  });

  it("aceita números internacionais (Portugal, Japão, EUA)", async () => {
    for (const [tel, pais] of [["+351 912 345 678", "PT"], ["+81 90-1234-5678", "JP"], ["+1 (415) 555-2671", "US"]]) {
      const r = await post(A, corpo({ whatsapp: tel, whatsapp_pais: pais }));
      expect(r.status, tel).toBe(201);
      expect((await linha(r.j.protocolo)).whatsapp).toBe(tel.replace(/[^\d+]/g, ""));
    }
  });

  it("dois alunos podem pedir o mesmo horário (o profissional decide)", async () => {
    const s = slot("14:00");
    expect((await post(A, corpo(s))).status).toBe(201);
    expect((await post(A, corpo(s))).status).toBe(201);
  });

  it("idempotência: repetição devolve o mesmo protocolo; outro conteúdo é rejeitado", async () => {
    const b = corpo();
    const r1 = await post(A, b);
    const r2 = await post(A, b);
    expect([r1.status, r2.status]).toEqual([201, 200]);
    expect(r2.j.protocolo).toBe(r1.j.protocolo);
    expect((await post(A, { ...b, objetivo: "outro" })).status).toBe(409);
    expect((await db.query("select count(*)::int n from agendamentos where email=$1", [b.email])).rows[0].n).toBe(1);
  });

  it("rate limit persistente por IP", async () => {
    const st: number[] = [];
    for (let i = 0; i < 9; i++) st.push((await post(A, { idempotency_key: randomUUID() }, { "x-test-ip": "203.0.113.77" })).status);
    expect(st.slice(0, 8).every((s) => s === 422)).toBe(true);
    expect(st[8]).toBe(429);
  });

  it("Turnstile, quando configurado, é exigido e verificado no servidor", async () => {
    expect((await post(B, corpo())).status).toBe(400);
    expect((await post(B, corpo({ turnstile: "token-falso" }))).status).toBe(400);
    expect((await post(B, corpo({ turnstile: "token-valido" }))).status).toBe(201);
  });

  it("não existem mais painel, login nem rotas de e-mail/proposta", async () => {
    for (const r of ["/admin", "/admin/login", "/proposta"]) expect((await fetch(A + r, { redirect: "manual" })).status, r).toBe(404);
    for (const r of ["/api/cron", "/api/proposta", "/api/webhooks/resend"]) expect((await fetch(A + r, { method: "POST" })).status, r).toBe(404);
  });

  it("dados não são acessíveis com a chave pública e a chave secreta não vai ao navegador", async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.E2E_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const sel = await anon.from("agendamentos").select("id,nome,email");
    expect(sel.error).toBeTruthy();
    expect((await anon.rpc("registrar_solicitacao", {})).error).toBeTruthy();
    const html = await (await fetch(`${A}/`)).text();
    const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    const tudo = html + (await Promise.all(scripts.map(async (s) => (await fetch(A + s)).text()))).join("");
    expect(tudo).not.toContain(process.env.SUPABASE_SECRET_KEY!);
  });
});

describe("Formulário no navegador", () => {
  it("celular: número estrangeiro, mantém dados após erro, 1 envio no duplo clique, botão do WhatsApp com mensagem pronta", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${A}/#agendamento`);
    await foto(p, "home-mobile-form");
    await p.fill("#nome", "Joana Estrangeira");
    await p.fill("#email", "invalido");
    await p.click("button:has-text('Solicitar avaliação')");
    await p.waitForSelector("text=Informe um e-mail válido.");
    expect(await p.inputValue("#nome")).toBe("Joana Estrangeira");
    await p.fill("#email", `joana+${randomUUID().slice(0, 6)}@example.test`);
    await p.selectOption("select[aria-label='País do WhatsApp']", "PT");
    await p.fill("#whatsapp", "912345678");
    expect(await p.inputValue("#whatsapp")).toBe("+351 912 345 678");
    await p.selectOption("#tipo_atendimento", "acompanhamento_presencial");
    expect(await p.locator("#tipo_atendimento option[value=nao_sei]").count()).toBe(0);
    const s = slot("07:30");
    await p.fill("#data_solicitada", s.data_solicitada);
    await p.fill("#horario_solicitado", s.horario_solicitado);
    await p.fill("#objetivo", "Ganhar resistência");
    await p.check("#privacidade");
    const reqs: string[] = [];
    p.on("request", (r) => { if (r.url().endsWith("/api/agendamento")) reqs.push(r.method()); });
    await p.locator("button:has-text('Solicitar avaliação')").dblclick();
    await p.waitForSelector("text=Solicitação registrada!");
    expect(reqs).toHaveLength(1);
    await foto(p, "sucesso-whatsapp-mobile");
    const prot = (await p.locator("text=Protocolo:").innerText()).match(/TL-[0-9A-F]{10}/)![0];
    expect((await linha(prot)).whatsapp).toBe("+351912345678");

    const href = await p.getAttribute("a:has-text('Enviar pelo WhatsApp')", "href");
    const u = new URL(href!);
    expect(`${u.origin}${u.pathname}`).toBe("https://wa.me/5571981880556");
    const texto = u.searchParams.get("text")!;
    const [ano, mes, d] = s.data_solicitada.split("-");
    for (const trecho of ["Olá, Tiago!", "Nome: Joana Estrangeira", "Atendimento: Acompanhamento presencial",
      `Data desejada: ${d}/${mes}/${ano} às 07:30, horário de Brasília (UTC−03:00)`, "Objetivo: Ganhar resistência", `Protocolo: ${prot}`]) {
      expect(texto).toContain(trecho);
    }
    expect(await p.getAttribute("a:has-text('Enviar pelo WhatsApp')", "target")).toBe("_blank");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });
});
