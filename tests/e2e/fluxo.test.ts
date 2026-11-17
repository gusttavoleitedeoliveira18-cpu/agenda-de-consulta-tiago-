// Testes end-to-end contra servidores Next reais (next start) + Supabase local.
// Executar via `npm run test:e2e` (tests/e2e/run.mjs prepara o ambiente).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { DateTime } from "luxon";
import { Webhook } from "svix";
import { randomUUID } from "node:crypto";

const A = "http://localhost:3000", B = "http://localhost:3001", C = "http://localhost:3002";
const FALSOS = process.env.E2E_FALSOS!;
const db = new Client({ connectionString: process.env.E2E_DB_URL });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let browser: Browser;
let ipSeq = 0;
let slotSeq = 0;
const ADMIN = { email: "tiago.admin@example.test", senha: "SenhaForte123" };
const COMUM = { email: "usuario.comum@example.test", senha: "SenhaForte123" };

function slot(horaFixa?: string) {
  slotSeq++;
  const d = DateTime.now().setZone("America/Bahia").plus({ days: 2 + slotSeq }).toISODate()!;
  return { data_solicitada: d, horario_solicitado: horaFixa ?? "10:00" };
}
function corpo(extra: Record<string, unknown> = {}) {
  return {
    nome: "Maria Teste Souza", email: `aluno+${randomUUID().slice(0, 8)}@example.test`, whatsapp: "+5571988887777", whatsapp_pais: "BR",
    tipo_atendimento: "consultoria_online", ...slot(), objetivo: "Condicionamento", privacidade: "ciente",
    idempotency_key: randomUUID(), ...extra,
  };
}
async function post(base: string, caminho: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + caminho, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-test-ip": `10.0.0.${++ipSeq}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const emails = async () => (await (await fetch(`${FALSOS}/_emails`)).json()) as Array<{ to: string[]; subject: string; html: string; chave: string; text: string }>;
const modoEmail = (modo: string) => fetch(`${FALSOS}/_modo`, { method: "POST", body: JSON.stringify({ modo }) });
const cron = (segredo = process.env.CRON_SECRET!) => fetch(`${A}/api/cron`, { headers: { authorization: `Bearer ${segredo}` } });
const linha = async (protocolo: string) => (await db.query("select * from agendamentos where protocolo=$1", [protocolo])).rows[0];
async function esperar<T>(fn: () => Promise<T | undefined | null | false>, ms = 8000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fim) throw new Error("tempo esgotado aguardando condição");
    await new Promise((r) => setTimeout(r, 200));
  }
}
/** Capturas de evidência visual (somente com E2E_CAPTURAS=1). */
async function foto(p: Page, nome: string) {
  if (process.env.E2E_CAPTURAS) await p.screenshot({ path: `docs/visual/depois/${nome}.png`, fullPage: true });
}
async function criarUsuario(u: { email: string; senha: string }, admin: boolean) {
  const { data, error } = await sb.auth.admin.createUser({ email: u.email, password: u.senha, email_confirm: true });
  if (error) throw error;
  if (admin) await db.query("insert into administradores (user_id) values ($1)", [data.user!.id]);
}
async function login(p: Page, u: { email: string; senha: string }) {
  await p.goto(`${A}/admin/login`);
  await p.fill("#email", u.email);
  await p.fill("#senha", u.senha);
  await p.click("button:has-text('Entrar')");
}

beforeAll(async () => {
  await db.connect();
  await db.query("truncate notificacoes, agendamento_eventos, idempotencia, rate_limites, webhook_eventos, agendamentos cascade");
  await db.query("delete from auth.users where email like '%@example.test'");
  await fetch(`${FALSOS}/_emails`, { method: "DELETE" });
  await modoEmail("ok");
  await criarUsuario(ADMIN, true);
  await criarUsuario(COMUM, false);
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); await db.end(); });

describe("API pública de solicitação", () => {
  it("bloqueia origem ausente/estranha (CSRF) e honeypot", async () => {
    const r1 = await fetch(`${A}/api/agendamento`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo()) });
    expect(r1.status).toBe(403);
    expect((await post(A, "/api/agendamento", corpo(), { origin: "https://atacante.example" })).status).toBe(403);
    const hp = await post(A, "/api/agendamento", corpo({ website: "http://spam" }));
    expect(hp.status).toBe(400);
    expect(hp.j.ok).toBeUndefined();
  });

  it("valida campos obrigatórios, e-mail, telefone impossível/incompleto, data passada, serviço inexistente e sem duração", async () => {
    const vazio = await post(A, "/api/agendamento", { idempotency_key: randomUUID() });
    expect(vazio.status).toBe(422);
    expect(Object.keys(vazio.j.errors).sort()).toEqual(["data_solicitada", "email", "horario_solicitado", "nome", "privacidade", "tipo_atendimento", "whatsapp"].sort());
    expect((await post(A, "/api/agendamento", corpo({ email: "x@y" }))).j.errors.email).toBeTruthy();
    expect((await post(A, "/api/agendamento", corpo({ whatsapp: "+557198888" }))).j.errors.whatsapp).toMatch(/inválido/); // incompleto
    expect((await post(A, "/api/agendamento", corpo({ whatsapp: "+5500999999999" }))).j.errors.whatsapp).toMatch(/inválido/); // DDD inexistente
    expect((await post(A, "/api/agendamento", corpo({ whatsapp: "71988887777" }))).j.errors.whatsapp).toBeTruthy(); // sem país
    const ontem = DateTime.now().setZone("America/Bahia").minus({ days: 1 }).toISODate();
    expect((await post(A, "/api/agendamento", corpo({ data_solicitada: ontem }))).j.errors.data_solicitada).toBeTruthy();
    const hoje = DateTime.now().setZone("America/Bahia");
    if (hoje.hour > 0) {
      const passou = await post(A, "/api/agendamento", corpo({ data_solicitada: hoje.toISODate(), horario_solicitado: "00:00" }));
      expect(passou.j.errors.horario_solicitado).toMatch(/futuro/);
    }
    expect((await post(A, "/api/agendamento", corpo({ tipo_atendimento: "pilates" }))).j.errors.tipo_atendimento).toBeTruthy();
    expect((await post(A, "/api/agendamento", corpo({ tipo_atendimento: "nao_sei" }))).j.errors.tipo_atendimento).toMatch(/ainda não está disponível/);
    expect((await post(A, "/api/agendamento", corpo({ privacidade: "" }))).j.errors.privacidade).toBeTruthy();
    expect((await db.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(0);
  });

  it("registra telefone brasileiro em E.164, envia e-mail inicial e notificação interna", async () => {
    const b = corpo();
    const r = await post(A, "/api/agendamento", b);
    expect(r.status).toBe(201);
    expect(r.j).toMatchObject({ ok: true, email: "enviado" });
    const a = await linha(r.j.protocolo);
    expect(a).toMatchObject({ whatsapp: "+5571988887777", whatsapp_pais: "BR", status: "pendente", fuso_horario: "America/Bahia", privacidade_versao: "2026-11-17" });
    expect(DateTime.fromJSDate(a.inicio_solicitado).setZone("America/Bahia").toFormat("yyyy-MM-dd HH:mm")).toBe(`${b.data_solicitada} 10:00`);
    const lista = await esperar(async () => { const e = await emails(); return e.length >= 2 && e; });
    const aluno = lista.find((e) => e.to[0] === b.email)!;
    expect(aluno.subject).toMatch(/Recebemos/);
    expect(aluno.html).toMatch(/ainda não está confirmado/);
    expect(aluno.html).toContain(r.j.protocolo);
    expect(aluno.chave).toMatch(/^notif-/);
    expect(lista.some((e) => e.to[0] === "profissional@example.test" && /Nova solicitação/.test(e.subject))).toBe(true);
  });

  it("aceita números internacionais (Portugal, Japão, EUA) e normaliza para E.164", async () => {
    for (const [tel, pais] of [["+351 912 345 678", "PT"], ["+81 90-1234-5678", "JP"], ["+1 (415) 555-2671", "US"]]) {
      const r = await post(A, "/api/agendamento", corpo({ whatsapp: tel, whatsapp_pais: pais }));
      expect(r.status, tel).toBe(201);
      const a = await linha(r.j.protocolo);
      expect(a.whatsapp).toBe(tel.replace(/[^\d+]/g, ""));
      expect(a.whatsapp_pais).toBe(pais);
    }
  });

  it("idempotência via HTTP: repetição devolve o mesmo protocolo; reutilização com outro conteúdo é rejeitada", async () => {
    const b = corpo();
    const r1 = await post(A, "/api/agendamento", b);
    const r2 = await post(A, "/api/agendamento", b);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.j.protocolo).toBe(r1.j.protocolo);
    const r3 = await post(A, "/api/agendamento", { ...b, objetivo: "outro" });
    expect(r3.status).toBe(409);
    expect((await db.query("select count(*)::int n from agendamentos where email=$1", [b.email])).rows[0].n).toBe(1);
  });

  it("conflito: mesmo horário e sobreposição parcial retornam 409; consecutivo é aceito", async () => {
    const s = slot("14:00");
    expect((await post(A, "/api/agendamento", corpo(s))).status).toBe(201);
    const c1 = await post(A, "/api/agendamento", corpo(s));
    expect(c1.status).toBe(409);
    expect(c1.j.errors.horario_solicitado).toMatch(/deixou de estar disponível/);
    expect((await post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: "14:30" }))).status).toBe(409);
    expect((await post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: "15:00" }))).status).toBe(201);
    // aula_futebol dura 90 min (configuração de teste): 16:00–17:30 bloqueia 17:00
    expect((await post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: "16:00", tipo_atendimento: "aula_futebol" }))).status).toBe(201);
    expect((await post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: "17:00" }))).status).toBe(409);
    expect((await post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: "17:30" }))).status).toBe(201);
  });

  it("concorrência real via HTTP: 10 requisições paralelas sobrepostas -> 1 aceita, 9 conflitos", async () => {
    const s = slot("08:00");
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      post(A, "/api/agendamento", corpo({ ...s, horario_solicitado: ["08:00", "08:15", "08:30", "08:45"][i % 4] }))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it("e-mail indisponível: registra, avisa o aluno com protocolo, cron reenvia sem duplicar", async () => {
    await modoEmail("falha500");
    const b = corpo();
    const r = await post(A, "/api/agendamento", b);
    expect(r.status).toBe(201);
    expect(r.j.email).toBe("pendente");
    const a = await linha(r.j.protocolo);
    const n = (await db.query("select estado, ultimo_erro from notificacoes where agendamento_id=$1 and tipo='solicitacao_recebida'", [a.id])).rows[0];
    expect(n.estado).toBe("pendente");
    expect(n.ultimo_erro).toMatch(/HTTP 500/);
    await modoEmail("ok");
    await db.query("update notificacoes set proxima_tentativa_em=now() where agendamento_id=$1", [a.id]);
    expect((await cron()).status).toBe(200);
    const para = async () => (await emails()).filter((e) => e.to[0] === b.email);
    expect(await para()).toHaveLength(1);
    expect((await cron()).status).toBe(200);
    expect(await para()).toHaveLength(1); // execução repetida não duplica
    expect((await db.query("select estado from notificacoes where agendamento_id=$1 and tipo='solicitacao_recebida'", [a.id])).rows[0].estado).toBe("enviado_ao_provedor");
  });

  it("rate limit persistente por IP", async () => {
    const ip = { "x-test-ip": "203.0.113.77" };
    const st: number[] = [];
    for (let i = 0; i < 9; i++) st.push((await post(A, "/api/agendamento", { idempotency_key: randomUUID() }, ip)).status);
    expect(st.slice(0, 8).every((s) => s === 422)).toBe(true);
    expect(st[8]).toBe(429);
  });
});

describe("Turnstile e falha segura em produção", () => {
  it("servidor B exige Turnstile: ausente/inválido bloqueia, válido passa", async () => {
    expect((await post(B, "/api/agendamento", corpo())).status).toBe(400);
    expect((await post(B, "/api/agendamento", corpo({ turnstile: "token-falso" }))).status).toBe(400);
    expect((await post(B, "/api/agendamento", corpo({ turnstile: "token-valido" }))).status).toBe(201);
  });
  it("servidor C (produção sem Turnstile) recusa com 503 e não grava", async () => {
    const b = corpo();
    expect((await post(C, "/api/agendamento", b)).status).toBe(503);
    expect((await db.query("select count(*)::int n from agendamentos where email=$1", [b.email])).rows[0].n).toBe(0);
  });
});

describe("Cron e webhook", () => {
  it("cron rejeita chamada sem segredo válido", async () => {
    expect((await fetch(`${A}/api/cron`)).status).toBe(401);
    expect((await cron("errado")).status).toBe(401);
  });
  it("cron expira pendentes vencidas e libera o horário", async () => {
    const b = corpo(slot("11:00"));
    const r = await post(A, "/api/agendamento", b);
    const a = await linha(r.j.protocolo);
    await db.query("update agendamentos set expira_em=now()-interval '1 second' where id=$1", [a.id]);
    const j = await (await cron()).json();
    expect(j.expirados).toBeGreaterThanOrEqual(1);
    expect((await linha(r.j.protocolo)).status).toBe("expirado");
    expect((await emails()).some((e) => e.to[0] === b.email && /expirou/.test(e.subject))).toBe(true);
    expect((await post(A, "/api/agendamento", corpo({ data_solicitada: b.data_solicitada, horario_solicitado: "11:00" }))).status).toBe(201);
  });
  it("webhook: rejeita assinatura inválida; aceita assinada; é idempotente", async () => {
    const r = await post(A, "/api/agendamento", corpo());
    const a = await linha(r.j.protocolo);
    const msg = (await db.query("select provedor_mensagem_id from notificacoes where agendamento_id=$1 and tipo='solicitacao_recebida'", [a.id])).rows[0].provedor_mensagem_id;
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: msg } });
    const sem = await fetch(`${A}/api/webhooks/resend`, { method: "POST", body: payload, headers: { "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,abc" } });
    expect(sem.status).toBe(401);
    const id = `msg_${randomUUID()}`;
    const ts = new Date();
    const assinatura = new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, ts, payload);
    const h = { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": assinatura, "content-type": "application/json" };
    expect((await fetch(`${A}/api/webhooks/resend`, { method: "POST", body: payload, headers: h })).status).toBe(200);
    expect((await fetch(`${A}/api/webhooks/resend`, { method: "POST", body: payload, headers: h })).status).toBe(200);
    expect((await db.query("select estado from notificacoes where provedor_mensagem_id=$1", [msg])).rows[0].estado).toBe("entrega_confirmada");
    expect((await db.query("select count(*)::int n from webhook_eventos where id=$1", [id])).rows[0].n).toBe(1);
  });
});

describe("Acesso direto à API do Supabase sem passar pela aplicação", () => {
  it("chave pública (anônima) não lê agendamentos nem executa funções", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const sel = await anon.from("agendamentos").select("id,nome,email");
    expect(sel.data ?? []).toEqual([]);
    expect(sel.error).toBeTruthy();
    const ins = await anon.from("agendamentos").insert({ nome: "X Y", email: "a@b.c", whatsapp: "+5571988887777", tipo_atendimento: "nao_sei", data_solicitada: "2030-01-01", horario_solicitado: "10:00", inicio_solicitado: "2030-01-01T13:00:00Z" });
    expect(ins.error).toBeTruthy();
    expect((await anon.rpc("consultar_proposta", { p_token_hash: "x" })).error).toBeTruthy();
    expect((await anon.rpc("admin_confirmar", { p_id: randomUUID() })).error).toBeTruthy();
  });
  it("usuário autenticado que não é admin não vê dados nem executa ações", async () => {
    const u = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    await u.auth.signInWithPassword({ email: COMUM.email, password: COMUM.senha });
    expect((await u.from("agendamentos").select("id")).data).toEqual([]);
    const { data } = await db.query("select id from agendamentos limit 1").then((r) => ({ data: r.rows[0] }));
    const acao = await u.rpc("admin_cancelar", { p_id: data.id, p_motivo: "x" });
    expect(acao.error?.message).toMatch(/nao_autorizado/);
  });
  it("chave privilegiada não aparece no HTML/JS enviado ao navegador", async () => {
    const html = await (await fetch(`${A}/`)).text();
    const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    const conteudo = html + (await Promise.all(scripts.map(async (s) => (await fetch(A + s)).text()))).join("");
    expect(conteudo).not.toContain(process.env.SUPABASE_SECRET_KEY!);
    expect(conteudo).not.toContain(process.env.TOKEN_ENCRYPTION_KEY!);
    expect(conteudo).not.toContain(process.env.CRON_SECRET!);
  });
});

describe("Painel administrativo e proposta de horário (navegador)", () => {
  it("bloqueia visitante sem sessão e usuário que não é administrador", async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${A}/admin/agendamentos`);
    expect(new URL(p.url()).pathname).toBe("/admin/login");
    const sa = await fetch(`${A}/admin`, { redirect: "manual" });
    expect(sa.status).toBe(307);
    await foto(p, "admin-login-desktop");
    await login(p, COMUM);
    await expect(p.locator("[role=alert]")).toBeTruthy();
    await p.waitForSelector("text=não tem permissão");
    await p.goto(`${A}/admin`);
    expect(new URL(p.url()).pathname).toBe("/admin/login");
    await ctx.close();
  });

  it("admin faz login, vê dados reais, propõe horário; aluno aceita pela página segura; token não é reutilizável", async () => {
    const b = corpo(slot("09:00"));
    const r = await post(A, "/api/agendamento", b);
    const a = await linha(r.j.protocolo);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, ADMIN);
    await p.waitForURL(`${A}/admin`);
    await p.waitForSelector("text=Visão geral");
    await foto(p, "admin-painel-desktop");
    await p.goto(`${A}/admin/agendamentos?q=Maria&status=pendente`);
    await p.waitForSelector(`text=${a.protocolo}`);
    await foto(p, "admin-lista-desktop");
    await p.goto(`${A}/admin/agendamentos/${a.id}`);
    expect(await p.getAttribute("a:has-text('Conversar no WhatsApp')", "href")).toMatch(/^https:\/\/wa\.me\/5571988887777\?text=/);
    await p.click("summary:has-text('Propor outro horário')");
    await p.fill("#hora", "12:00");
    p.once("dialog", (d) => d.accept());
    await p.click("button:has-text('Enviar proposta')");
    await p.waitForSelector("text=Proposta registrada");
    await foto(p, "admin-detalhe-desktop");
    const prop = await linha(r.j.protocolo);
    expect(prop.status).toBe("aguardando_resposta");
    expect(DateTime.fromJSDate(prop.inicio_solicitado).setZone("America/Bahia").toFormat("HH:mm")).toBe("09:00");
    expect(DateTime.fromJSDate(prop.reserva_inicio).setZone("America/Bahia").toFormat("HH:mm")).toBe("12:00");
    expect(prop.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const mail = await esperar(async () => (await emails()).find((e) => e.to[0] === b.email && /Proposta/.test(e.subject)));
    const link = /href="([^"]+\/proposta#t=[^"]+)"/.exec(mail.html)![1];
    expect(link).toMatch(/^http:\/\/localhost:3000\/proposta#t=[A-Za-z0-9_-]{43}$/);
    const n = (await db.query("select payload_cifrado from notificacoes where agendamento_id=$1 and tipo='proposta'", [a.id])).rows[0];
    expect(n.payload_cifrado).toBeNull(); // segredo apagado após envio

    // "Scanner" de e-mail: GET/HEAD na página não consome o token
    const g = await fetch(link.split("#")[0]);
    expect(g.headers.get("referrer-policy")).toBe("no-referrer");
    expect(g.headers.get("cache-control")).toMatch(/no-store/);
    await fetch(link.split("#")[0], { method: "HEAD" });
    const aluno = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await aluno.goto(link);
    await aluno.waitForSelector("text=Horário proposto");
    await foto(aluno, "proposta-mobile");
    expect(aluno.url()).not.toContain("#t="); // token removido da barra de endereço
    expect((await linha(r.j.protocolo)).token_usado_em).toBeNull();
    await aluno.click("button:has-text('Aceitar horário')");
    await aluno.waitForSelector("text=Horário confirmado!");
    expect((await linha(r.j.protocolo)).status).toBe("confirmado");
    const aluno2 = await (await browser.newContext()).newPage();
    await aluno2.goto(link);
    await aluno2.waitForSelector("text=já foi respondida");

    await p.reload();
    await p.waitForSelector("text=Aluno aceitou a proposta");
    await esperar(async () => (await emails()).find((e) => e.to[0] === "profissional@example.test" && /Proposta aceita/.test(e.subject)));
    await ctx.close();
  });

  it("respostas simultâneas com o mesmo token geram uma única decisão; token inválido/expirado", async () => {
    const r = await post(A, "/api/agendamento", corpo(slot("13:00")));
    const a = await linha(r.j.protocolo);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, ADMIN);
    await p.waitForURL(`${A}/admin`);
    await p.goto(`${A}/admin/agendamentos/${a.id}`);
    await p.click("summary:has-text('Propor outro horário')");
    await p.fill("#hora", "18:00");
    p.once("dialog", (d) => d.accept());
    await p.click("button:has-text('Enviar proposta')");
    await p.waitForSelector("text=Proposta registrada");
    const mail = await esperar(async () => (await emails()).find((e) => e.to[0] === a.email && /Proposta/.test(e.subject)));
    const token = /#t=([A-Za-z0-9_-]{43})/.exec(mail.html)![1];
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => post(A, "/api/proposta", { token, acao: i % 2 ? "aceitar" : "recusar" })));
    expect(rs.filter((x) => x.status === 200)).toHaveLength(1);
    expect(rs.filter((x) => x.j.erro === "token_usado")).toHaveLength(5);
    expect((await post(A, "/api/proposta", { token: "A".repeat(43), acao: "consultar" })).status).toBe(404);
    expect((await post(A, "/api/proposta", { token: "curto", acao: "aceitar" })).status).toBe(404);
    // expirado
    const r2 = await post(A, "/api/agendamento", corpo(slot("13:00")));
    const a2 = await linha(r2.j.protocolo);
    await p.goto(`${A}/admin/agendamentos/${a2.id}`);
    await p.click("summary:has-text('Propor outro horário')");
    await p.fill("#hora", "19:00");
    p.once("dialog", (d) => d.accept());
    await p.click("button:has-text('Enviar proposta')");
    await p.waitForSelector("text=Proposta registrada");
    const mail2 = await esperar(async () => (await emails()).find((e) => e.to[0] === a2.email && /Proposta/.test(e.subject)));
    const token2 = /#t=([A-Za-z0-9_-]{43})/.exec(mail2.html)![1];
    await db.query("update agendamentos set token_expira_em=now()-interval '1 s', expira_em=now()-interval '1 s' where id=$1", [a2.id]);
    const exp = await post(A, "/api/proposta", { token: token2, acao: "aceitar" });
    expect(exp.status).toBe(409);
    expect(exp.j.erro).toBe("token_expirado");
    expect((await linha(r2.j.protocolo)).status).toBe("expirado");
    await ctx.close();
  });

  it("confirma, recusa e cancela pelo painel com histórico; reprocessa notificação com falha; logout", async () => {
    const [r1, r2, r3] = [await post(A, "/api/agendamento", corpo(slot())), await post(A, "/api/agendamento", corpo(slot())), await post(A, "/api/agendamento", corpo(slot()))];
    const [a1, a2, a3] = [await linha(r1.j.protocolo), await linha(r2.j.protocolo), await linha(r3.j.protocolo)];
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.accept());
    await login(p, ADMIN);
    await p.waitForURL(`${A}/admin`);

    await p.goto(`${A}/admin/agendamentos/${a1.id}`);
    await p.click("button:has-text('Confirmar horário solicitado')");
    await p.waitForSelector("text=Horário confirmado. O aluno");
    expect((await linha(r1.j.protocolo)).status).toBe("confirmado");
    await modoEmail("falha422"); // erro permanente do provedor
    await p.goto(`${A}/admin/agendamentos/${a1.id}`);
    await p.click("summary:has-text('Cancelar atendimento')");
    await p.fill("#motivo-c", "Imprevisto do profissional");
    await p.click("button:has-text('Cancelar atendimento')");
    await p.waitForSelector("text=Atendimento cancelado. O horário");
    const falha = await esperar(async () => (await db.query("select id, estado from notificacoes where agendamento_id=$1 and tipo='cancelamento'", [a1.id])).rows.find((x) => x.estado === "falhou"));
    await modoEmail("ok");
    await p.goto(`${A}/admin/agendamentos/${a1.id}`);
    await p.waitForSelector("text=Falhou");
    await p.click("button:has-text('Reenviar')");
    await p.waitForSelector("text=Notificação colocada novamente na fila");
    await esperar(async () => (await db.query("select estado from notificacoes where id=$1", [falha.id])).rows[0].estado === "enviado_ao_provedor");
    await p.reload();
    for (const t of ["Solicitação confirmada", "Cancelamento", "Reenvio de notificação solicitado", "Imprevisto do profissional"]) await p.waitForSelector(`text=${t}`);

    await p.goto(`${A}/admin/agendamentos/${a2.id}`);
    await p.click("summary:has-text('Recusar solicitação')");
    await p.fill("#motivo-r", "Agenda cheia");
    await p.click("button:has-text('Recusar')");
    await p.waitForSelector("text=Solicitação recusada. O horário");
    expect((await linha(r2.j.protocolo)).reserva_inicio).toBeNull();

    // proposta para horário ocupado (o de a3) não altera nada
    const ocupado = DateTime.fromJSDate(a3.inicio_solicitado).setZone("America/Bahia");
    const r4 = await post(A, "/api/agendamento", corpo(slot()));
    const a4 = await linha(r4.j.protocolo);
    await p.goto(`${A}/admin/agendamentos/${a4.id}`);
    await p.click("summary:has-text('Propor outro horário')");
    await p.fill("#data", ocupado.toISODate()!);
    await p.fill("#hora", ocupado.toFormat("HH:mm"));
    await p.click("button:has-text('Enviar proposta')");
    await p.waitForSelector("text=conflita com outro agendamento");
    expect((await linha(r4.j.protocolo)).status).toBe("pendente");

    await p.goto(`${A}/admin/agendamentos?status=recusado`);
    await p.waitForSelector(`text=${a2.protocolo}`);
    await p.click("button:has-text('Sair')");
    await p.waitForURL(/\/admin\/login\?saiu=1/);
    await p.goto(`${A}/admin`);
    expect(new URL(p.url()).pathname).toBe("/admin/login");
    await ctx.close();
  });

  it("recuperação de senha pelo e-mail (Mailpit local) e novo login", async () => {
    const mp = process.env.E2E_MAILPIT!;
    await fetch(`${mp}/api/v1/messages`, { method: "DELETE" });
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${A}/admin/recuperar-senha`);
    await p.fill("#email", ADMIN.email);
    await p.click("button:has-text('Enviar link')");
    await p.waitForSelector("text=Se este e-mail pertencer");
    const msg = await esperar(async () => {
      const l = await (await fetch(`${mp}/api/v1/messages`)).json();
      return l.messages?.find((m: { To: Array<{ Address: string }> }) => m.To[0].Address === ADMIN.email);
    }, 15000);
    const html = (await (await fetch(`${mp}/api/v1/message/${msg.ID}`)).json()).HTML as string;
    const link = /href="([^"]+)"/.exec(html)![1].replace(/&amp;/g, "&");
    await p.goto(link);
    await p.waitForURL(`${A}/admin/redefinir-senha`);
    await p.fill("#senha", "NovaSenha456X");
    await p.fill("#confirmacao", "NovaSenha456X");
    await p.click("button:has-text('Salvar nova senha')");
    await p.waitForURL(`${A}/admin?senha=alterada`);
    const p2 = await (await browser.newContext()).newPage();
    await login(p2, { email: ADMIN.email, senha: "NovaSenha456X" });
    await p2.waitForURL(`${A}/admin`);
    // link já usado não serve de novo
    const p3 = await (await browser.newContext()).newPage();
    await p3.goto(link);
    expect(p3.url()).toContain("erro=link_invalido");
    ADMIN.senha = "NovaSenha456X";
    await ctx.close();
  });
});

describe("Formulário público no navegador", () => {
  it("preenche com número estrangeiro, mantém dados após erro, evita envio duplicado e mostra sucesso com protocolo", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${A}/#agendamento`);
    await p.fill("#nome", "Joana Estrangeira");
    await p.fill("#email", "invalido");
    await p.click("button:has-text('Solicitar avaliação')");
    await p.waitForSelector("text=Informe um e-mail válido.");
    expect(await p.inputValue("#nome")).toBe("Joana Estrangeira"); // não apaga o que foi digitado
    const email = `joana+${randomUUID().slice(0, 6)}@example.test`;
    await p.fill("#email", email);
    await p.selectOption("select[aria-label='País do WhatsApp']", "PT");
    await p.fill("#whatsapp", "912345678");
    expect(await p.inputValue("#whatsapp")).toMatch(/^\+351 912 345 678$/);
    await p.selectOption("#tipo_atendimento", "acompanhamento_presencial");
    expect(await p.locator("#tipo_atendimento option[value=nao_sei]").isDisabled()).toBe(true);
    const s = slot("07:00");
    await p.fill("#data_solicitada", s.data_solicitada);
    await p.fill("#horario_solicitado", s.horario_solicitado);
    await p.check("#privacidade");
    const reqs: string[] = [];
    p.on("request", (r) => { if (r.url().endsWith("/api/agendamento")) reqs.push(r.method()); });
    await p.locator("button:has-text('Solicitar avaliação')").dblclick();
    await p.waitForSelector("text=Solicitação enviada com sucesso!");
    expect(reqs).toHaveLength(1);
    const prot = (await p.locator("text=Protocolo:").innerText()).match(/TL-[0-9A-F]{10}/)![0];
    expect((await linha(prot)).whatsapp).toBe("+351912345678");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });
});
