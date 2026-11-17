import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { conectar, limpar, comoServico, comoUsuario, criarUsuario, emHoras, novaChave, type Resultado } from "./helpers";

const SQL = "select public.registrar_solicitacao($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r";
const params = (o: { chave?: string; hash?: string; inicio: string; nome?: string }) => [
  o.chave ?? novaChave(), o.hash ?? "h1", o.nome ?? "Aluno Teste", "aluno@example.test", "+5571999990000", "BR",
  "consultoria_online", o.inicio, "America/Sao_Paulo", "Hipertrofia", "2026-11-18", "ciencia_aviso_privacidade", "procedimentos_preliminares_contrato",
];

let c: Client;
let usuario: string;
beforeAll(async () => { c = await conectar(); usuario = await criarUsuario(c, false); });
afterAll(async () => { await c.end(); });
beforeEach(async () => { await limpar(c); });

const registrar = async (o: Parameters<typeof params>[0]) => (await comoServico<{ r: Resultado }>(c, SQL, params(o))).r;

describe("registrar_solicitacao", () => {
  it("grava a solicitação com protocolo, horário local e registro de privacidade", async () => {
    const inicio = "2030-03-10T13:00:00.000Z"; // 10:00 em Brasília
    const r = await registrar({ inicio });
    expect(r.ok).toBe(true);
    expect(r.protocolo).toMatch(/^TL-[0-9A-F]{10}$/);
    const a = (await c.query("select * from agendamentos where id=$1", [r.id])).rows[0];
    expect(a).toMatchObject({ status: "pendente", fuso_horario: "America/Sao_Paulo", reserva_inicio: null, expira_em: null, privacidade_versao: "2026-11-18" });
    expect(a.horario_solicitado).toBe("10:00:00");
    const ev = (await c.query("select tipo from agendamento_eventos where agendamento_id=$1 order by id", [r.id])).rows.map((x) => x.tipo);
    expect(ev).toEqual(["solicitacao_recebida", "privacidade_registrada"]);
    expect((await c.query("select count(*)::int n from notificacoes")).rows[0].n).toBe(0); // sem e-mails
  });

  it("não bloqueia horários: o profissional decide pelo WhatsApp", async () => {
    const inicio = emHoras(30);
    expect((await registrar({ inicio })).ok).toBe(true);
    expect((await registrar({ inicio })).ok).toBe(true);
  });

  it("rejeita horário passado", async () => {
    expect((await registrar({ inicio: emHoras(-1) })).erro).toBe("horario_passado");
  });

  it("idempotência: repetição devolve o mesmo protocolo; outro conteúdo é rejeitado", async () => {
    const chave = novaChave();
    const inicio = emHoras(50);
    const a = await registrar({ chave, hash: "x", inicio });
    const b = await registrar({ chave, hash: "x", inicio });
    expect(b.repetido).toBe(true);
    expect(b.protocolo).toBe(a.protocolo);
    expect((await registrar({ chave, hash: "y", inicio })).erro).toBe("idempotencia_conflito");
    expect((await c.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(1);
  });

  it("6 envios simultâneos com a mesma chave geram um único registro", async () => {
    const chave = novaChave();
    const inicio = emHoras(60);
    const clientes = await Promise.all(Array.from({ length: 6 }, () => conectar()));
    try {
      await Promise.all(clientes.map((cl) => comoServico(cl, SQL, params({ chave, hash: "z", inicio }))));
      expect((await c.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(1);
    } finally {
      await Promise.all(clientes.map((cl) => cl.end()));
    }
  });
});

describe("acesso direto ao banco", () => {
  it("visitante anônimo e usuário autenticado não leem nem gravam solicitações", async () => {
    await registrar({ inicio: emHoras(30) });
    await expect(comoUsuario(c, null, "select * from agendamentos")).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(c, null, SQL, params({ inicio: emHoras(31) }))).rejects.toThrow(/permission denied/);
    expect(await comoUsuario(c, usuario, "select id from agendamentos")).toEqual([]);
    await expect(comoUsuario(c, usuario, SQL, params({ inicio: emHoras(32) }))).rejects.toThrow(/permission denied/);
  });

  it("rate limit compartilhado e atômico", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, async () => {
      const cl = await conectar();
      try { return (await comoServico<{ v: boolean }>(cl, "select public.consumir_limite('ip:abc', 3600, 5) v")).v; } finally { await cl.end(); }
    }));
    expect(rs.filter(Boolean)).toHaveLength(5);
  });
});
