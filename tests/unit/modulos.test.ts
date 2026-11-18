import { describe, expect, it } from "vitest";
import { localParaInstante, hojeNoFuso, rotuloFuso } from "@/lib/tempo";
import { validarTelefone, linkWhatsApp, formatarTelefone } from "@/lib/telefone";
import { validate } from "@/lib/validate";
import { subchave, pseudonimo } from "@/lib/seguranca/cripto";
import { site } from "@/config/site";
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
  it("formata com rótulo de fuso", () => {
    expect(rotuloFuso("America/Bahia")).toBe("America/Bahia (UTC−03:00)");
    expect(rotuloFuso("America/Sao_Paulo")).toBe("horário de Brasília (UTC−03:00)");
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

describe("criptografia e configuração", () => {
  it("pseudonimiza identificadores de rate limit com subchave derivada", () => {
    const chave = subchave(randomBytes(32), "rate-limit-v1");
    const p = pseudonimo("203.0.113.1", chave);
    expect(p).not.toContain("203");
    expect(pseudonimo("203.0.113.1", chave)).toBe(p);
    expect(pseudonimo("203.0.113.2", chave)).not.toBe(p);
  });
  it("WhatsApp oficial configurado é válido (o botão do site funciona)", () => {
    expect(linkWhatsApp(site.whatsapp)).toBe("https://wa.me/5571981880556");
    expect(site.tipos.map((t) => t.v)).toEqual(["consultoria_online", "acompanhamento_presencial", "aula_futebol"]);
  });
});
