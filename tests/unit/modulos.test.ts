import { describe, expect, it } from "vitest";
import { localParaInstante, hojeNoFuso, dentroDoFuncionamento, rotuloFuso, formatarDataHora } from "@/lib/tempo";
import { validarTelefone, linkWhatsApp, formatarTelefone } from "@/lib/telefone";
import { validate } from "@/lib/validate";
import { cifrar, decifrar, gerarToken, hashToken, subchave, tokenComFormatoValido, pseudonimo } from "@/lib/seguranca/cripto";
import { montarEmail, esc, type DadosAgendamento } from "@/lib/email/templates";
import { destinoSeguro } from "@/lib/admin/redirecionamento";
import { randomBytes } from "node:crypto";

describe("fuso horário", () => {
  it("converte horário local da Bahia (UTC−3) para UTC sem depender do fuso do servidor", () => {
    const r = localParaInstante("2026-12-01", "09:30", "America/Bahia");
    expect(r.ok && r.instante.toISOString()).toBe("2026-12-01T12:30:00.000Z");
  });
  it("rejeita horário inexistente (salto de horário de verão) e ambíguo (recuo)", () => {
    // São Paulo: 04/11/2018 00:00 -> 01:00 (00:30 não existiu); 16/02/2019 23:00-23:59 ocorreu duas vezes.
    expect(localParaInstante("2018-11-04", "00:30", "America/Sao_Paulo")).toEqual({ ok: false, erro: "inexistente" });
    expect(localParaInstante("2019-02-16", "23:30", "America/Sao_Paulo")).toEqual({ ok: false, erro: "ambiguo" });
    expect(localParaInstante("2026-03-08", "02:30", "America/New_York")).toEqual({ ok: false, erro: "inexistente" });
  });
  it("rejeita datas e horas inválidas", () => {
    expect(localParaInstante("2026-02-31", "10:00", "America/Bahia").ok).toBe(false);
    expect(localParaInstante("2026-01-01", "24:00", "America/Bahia").ok).toBe(false);
    expect(localParaInstante("01/01/2026", "10:00", "America/Bahia").ok).toBe(false);
  });
  it("calcula 'hoje' no fuso do profissional (23:30 na Bahia já é amanhã em UTC)", () => {
    expect(hojeNoFuso("America/Bahia", new Date("2026-11-18T02:30:00Z"))).toBe("2026-11-17");
  });
  it("valida faixa de funcionamento considerando a duração inteira", () => {
    const h = { 1: [["08:00", "12:00"]] as Array<[string, string]> };
    const seg = (hora: string) => (localParaInstante("2026-11-16", hora, "America/Bahia") as { instante: Date }).instante;
    expect(dentroDoFuncionamento(seg("08:00"), 60, "America/Bahia", h)).toBe(true);
    expect(dentroDoFuncionamento(seg("11:30"), 60, "America/Bahia", h)).toBe(false);
    expect(dentroDoFuncionamento(seg("13:00"), 60, "America/Bahia", h)).toBe(false);
    expect(dentroDoFuncionamento(seg("13:00"), 60, "America/Bahia", null)).toBe(true);
  });
  it("formata com rótulo de fuso", () => {
    expect(rotuloFuso("America/Bahia")).toBe("America/Bahia (UTC−03:00)");
    expect(rotuloFuso("America/Sao_Paulo")).toBe("horário de Brasília (UTC−03:00)");
    expect(formatarDataHora("2026-12-01T12:30:00Z", "America/Bahia")).toBe("terça-feira, 01/12/2026 às 09:30");
  });
});

describe("telefone internacional", () => {
  it.each([
    ["+55 71 98888-7777", "+5571988887777", "BR"],
    ["+351 912 345 678", "+351912345678", "PT"],
    ["+44 7400 123456", "+447400123456", "GB"],
    ["+1 415 555 2671", "+14155552671", "US"],
    ["+54 9 11 2345-6789", "+5491123456789", "AR"],
  ])("%s -> %s", (entrada, e164, pais) => {
    const r = validarTelefone(entrada);
    expect(r.ok && r.e164).toBe(e164);
    expect(r.ok && r.pais).toBe(pais);
  });
  it("rejeita incompleto, impossível e sem código do país", () => {
    expect(validarTelefone("+5571988")).toEqual({ ok: false, erro: "invalido" });
    expect(validarTelefone("+5500988887777")).toEqual({ ok: false, erro: "invalido" });
    expect(validarTelefone("+999123456789")).toEqual({ ok: false, erro: "invalido" });
    expect(validarTelefone("71988887777")).toEqual({ ok: false, erro: "pais" });
    expect(validarTelefone("")).toEqual({ ok: false, erro: "vazio" });
  });
  it("gera wa.me sem '+' e formatação, preservando o código do país", () => {
    expect(linkWhatsApp("+5571988887777")).toBe("https://wa.me/5571988887777");
    expect(linkWhatsApp("+351912345678")).toBe("https://wa.me/351912345678");
    expect(linkWhatsApp("+447400123456", "Olá & tchau")).toBe("https://wa.me/447400123456?text=Ol%C3%A1%20%26%20tchau");
    expect(linkWhatsApp("5571988887777")).toBe("https://wa.me/5571988887777"); // formato do site.ts
    expect(linkWhatsApp("")).toBeNull();
    expect(linkWhatsApp("123")).toBeNull(); // nunca gera link fictício
    expect(formatarTelefone("+5571988887777")).toBe("+55 71 98888 7777");
  });
});

describe("validação compartilhada", () => {
  const ok = {
    nome: "Ana Lima", email: "ANA@Example.com ", whatsapp: "+5571988887777", whatsapp_pais: "BR", tipo_atendimento: "consultoria_online",
    data_solicitada: "2030-01-10", horario_solicitado: "10:00", objetivo: "", privacidade: "ciente",
  };
  const opts = { hoje: "2026-11-17", servicosDisponiveis: ["consultoria_online"], telefoneValido: (t: string) => validarTelefone(t).ok };
  it("aceita dados válidos e normaliza e-mail", () => {
    const r = validate(ok, opts);
    expect(r.ok).toBe(true);
    expect(r.v?.email).toBe("ana@example.com");
  });
  it("aponta cada erro no campo correspondente", () => {
    const r = validate({ ...ok, nome: "Ana", email: "x", whatsapp: "+55719", tipo_atendimento: "aula_futebol", data_solicitada: "2026-11-16", horario_solicitado: "25:00", privacidade: "", objetivo: "a".repeat(601) }, opts);
    expect(Object.keys(r.e).sort()).toEqual(["data_solicitada", "email", "horario_solicitado", "nome", "objetivo", "privacidade", "tipo_atendimento", "whatsapp"]);
    expect(r.e.tipo_atendimento).toMatch(/ainda não está disponível/);
  });
  it("ignora tipos não-string (ex.: File/objetos)", () => {
    expect(validate({ ...ok, nome: { a: 1 } as unknown as string }, opts).e.nome).toBeTruthy();
  });
});

describe("criptografia", () => {
  const chave = randomBytes(32);
  it("token de 256 bits URL-safe e hash SHA-256", () => {
    const t = gerarToken();
    expect(tokenComFormatoValido(t)).toBe(true);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenComFormatoValido("abc")).toBe(false);
  });
  it("AES-256-GCM: ida e volta; adulteração, AAD diferente ou chave errada falham", () => {
    const k = subchave(chave, "notificacao-token-v1");
    const c = cifrar("segredo", k, "id-1");
    expect(c.startsWith("v1.")).toBe(true);
    expect(decifrar(c, k, "id-1")).toBe("segredo");
    expect(() => decifrar(c, k, "id-2")).toThrow();
    expect(() => decifrar(c, subchave(chave, "outra"), "id-1")).toThrow();
    const b = Buffer.from(c.slice(3), "base64url"); b[b.length - 1] ^= 1;
    expect(() => decifrar("v1." + b.toString("base64url"), k, "id-1")).toThrow();
  });
  it("pseudonimiza identificadores de rate limit", () => {
    const p = pseudonimo("203.0.113.1", chave);
    expect(p).not.toContain("203");
    expect(pseudonimo("203.0.113.1", chave)).toBe(p);
  });
});

describe("e-mails", () => {
  const a: DadosAgendamento = {
    id: "00000000-0000-0000-0000-000000000001", protocolo: "TL-ABC", nome: "<script>alert(1)</script> Souza", email: "a@b.c",
    whatsapp: "+5571988887777", tipo_atendimento: "consultoria_online", status: "pendente", fuso_horario: "America/Bahia",
    inicio_solicitado: "2026-12-01T12:30:00Z", inicio_proposto: "2026-12-02T13:00:00Z", inicio_confirmado: null, reserva_inicio: null,
    duracao_minutos: 60, expira_em: "2026-11-30T12:00:00Z", motivo: null, objetivo: null,
  };
  const ctx = { a, nomeServico: "Consultoria online", siteUrl: "https://exemplo.test" };
  it("escapa conteúdo do usuário (XSS)", () => {
    const e = montarEmail("admin_nova_solicitacao", ctx);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(esc(`"'&`)).toBe("&quot;&#39;&amp;");
  });
  it("recebimento deixa claro que NÃO está confirmado e informa fuso", () => {
    const e = montarEmail("solicitacao_recebida", ctx);
    expect(e.html).toContain("ainda não está confirmado");
    expect(e.html).toContain("America/Bahia (UTC−03:00)");
    expect(e.html).toContain("Tiago de Souza Lima");
    expect(e.html).toContain("CREF 018432-G/BA");
    expect(e.texto).toContain("NÃO");
  });
  it("inclui botão para o WhatsApp oficial do profissional", () => {
    expect(montarEmail("confirmacao", ctx).html).toContain("https://wa.me/5571981880556");
  });
  it("proposta mostra horário original, proposto, prazo e botão de resposta", () => {
    const e = montarEmail("proposta", { ...ctx, linkProposta: "https://exemplo.test/proposta#t=abc" });
    expect(e.html).toContain("Você solicitou");
    expect(e.html).toContain("Horário proposto");
    expect(e.html).toContain("https://exemplo.test/proposta#t=abc");
    expect(e.html).toContain("terça-feira, 01/12/2026 às 09:30");
  });
  it("todos os tipos geram assunto, HTML e texto", () => {
    for (const t of ["solicitacao_recebida", "confirmacao", "recusa", "proposta", "proposta_aceita", "proposta_recusada", "cancelamento",
      "expiracao_solicitacao", "expiracao_proposta", "admin_nova_solicitacao", "admin_proposta_aceita", "admin_proposta_recusada"] as const) {
      const e = montarEmail(t, ctx);
      expect(e.assunto.length).toBeGreaterThan(5);
      expect(e.html).toContain("<!doctype html>");
      expect(e.texto.length).toBeGreaterThan(10);
    }
  });
});

describe("redirecionamento seguro após login", () => {
  it.each([["/admin/agendamentos", "/admin/agendamentos"], ["/admin", "/admin"], ["https://mal.example", "/admin"], ["//mal.example", "/admin"],
    ["/admin/../x", "/admin"], ["/adminx", "/admin"], [null, "/admin"], ["/admin/agendamentos?status=pendente", "/admin/agendamentos?status=pendente"]])("%s", (e, s) => {
    expect(destinoSeguro(e)).toBe(s);
  });
});
