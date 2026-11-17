import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  conectar, limpar, solicitar, comoServico, comoUsuario, criarUsuario, emHoras, novaChave, token,
  SQL_SOLICITAR, paramsSolicitar, type Resultado,
} from "./helpers";

let c: Client;
let admin: string;
let naoAdmin: string;

beforeAll(async () => {
  c = await conectar();
  admin = await criarUsuario(c, true);
  naoAdmin = await criarUsuario(c, false);
});
afterAll(async () => { await c.end(); });
beforeEach(async () => { await limpar(c); });

async function adminRpc(sql: string, params: unknown[] = []): Promise<Resultado> {
  const rows = await comoUsuario<{ r: Resultado }>(c, admin, sql, params);
  return rows[0].r;
}
async function status(id: string) {
  const r = await c.query("select status, reserva_inicio, reserva_fim, inicio_solicitado, inicio_proposto, token_usado_em from agendamentos where id=$1", [id]);
  return r.rows[0];
}
async function eventos(id: string) {
  const r = await c.query("select tipo, status_anterior, status_novo, ator from agendamento_eventos where agendamento_id=$1 order by id", [id]);
  return r.rows;
}
async function propor(id: string, inicio: string, horasToken = 48) {
  const t = token();
  const exp = new Date(Date.now() + horasToken * 3600_000).toISOString();
  const r = await adminRpc("select public.admin_propor($1,$2,60,0,$3,$4,'cifrado-teste',null) as r", [id, inicio, t.hash, exp]);
  return { r, ...t };
}

describe("solicitação e conflitos de horário", () => {
  it("registra pendente com reserva, eventos e notificações na mesma transação", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    expect(r.ok).toBe(true);
    expect(r.protocolo).toMatch(/^TL-[0-9A-F]{10}$/);
    const s = await status(r.id!);
    expect(s.status).toBe("pendente");
    expect(s.reserva_inicio).not.toBeNull();
    expect((await eventos(r.id!)).map((e) => e.tipo)).toEqual(["solicitacao_recebida", "privacidade_registrada"]);
    const n = await c.query("select tipo, destinatario, estado from notificacoes where agendamento_id=$1 order by tipo", [r.id]);
    expect(n.rows).toEqual([
      { tipo: "admin_nova_solicitacao", destinatario: "admin", estado: "pendente" },
      { tipo: "solicitacao_recebida", destinatario: "aluno", estado: "pendente" },
    ]);
  });

  it("rejeita mesmo horário e sobreposição parcial; aceita atendimento consecutivo", async () => {
    const base = emHoras(30);
    expect((await solicitar(c, { inicio: base })).ok).toBe(true);
    expect((await solicitar(c, { inicio: base })).erro).toBe("conflito");
    const meia = new Date(new Date(base).getTime() + 30 * 60_000).toISOString();
    expect((await solicitar(c, { inicio: meia })).erro).toBe("conflito");
    const antesSobrepoe = new Date(new Date(base).getTime() - 30 * 60_000).toISOString();
    expect((await solicitar(c, { inicio: antesSobrepoe })).erro).toBe("conflito");
    const seguinte = new Date(new Date(base).getTime() + 60 * 60_000).toISOString();
    expect((await solicitar(c, { inicio: seguinte })).ok).toBe(true);
  });

  it("aplica buffer no fim do intervalo", async () => {
    const base = emHoras(40);
    expect((await solicitar(c, { inicio: base, duracao: 60, buffer: 15 })).ok).toBe(true);
    const aos60 = new Date(new Date(base).getTime() + 60 * 60_000).toISOString();
    expect((await solicitar(c, { inicio: aos60 })).erro).toBe("conflito");
    const aos75 = new Date(new Date(base).getTime() + 75 * 60_000).toISOString();
    expect((await solicitar(c, { inicio: aos75 })).ok).toBe(true);
  });

  it("rejeita horário passado e serviço sem duração", async () => {
    expect((await solicitar(c, { inicio: emHoras(-1) })).erro).toBe("horario_passado");
    expect((await solicitar(c, { inicio: emHoras(5), duracao: null })).erro).toBe("servico_indisponivel");
  });

  it("idempotência: mesma chave+conteúdo devolve o mesmo registro; conteúdo diferente é rejeitado", async () => {
    const chave = novaChave();
    const inicio = emHoras(50);
    const a = await solicitar(c, { chave, hash: "abc", inicio });
    const b = await solicitar(c, { chave, hash: "abc", inicio });
    expect(b.ok).toBe(true);
    expect(b.repetido).toBe(true);
    expect(b.id).toBe(a.id);
    const x = await solicitar(c, { chave, hash: "outro", inicio: emHoras(60) });
    expect(x.erro).toBe("idempotencia_conflito");
    expect((await c.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(1);
  });

  it("concorrência real: 12 conexões paralelas para intervalos sobrepostos -> só 1 reserva", async () => {
    const base = new Date(emHoras(72)).getTime();
    const clientes = await Promise.all(Array.from({ length: 12 }, () => conectar()));
    try {
      const resultados = await Promise.all(clientes.map(async (cl, i) => {
        const inicio = new Date(base + (i % 4) * 15 * 60_000).toISOString(); // 0,15,30,45 min — todos sobrepõem
        const r = await comoServico<{ r: Resultado }>(cl, SQL_SOLICITAR, paramsSolicitar({ inicio }));
        return r.r;
      }));
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => r.erro === "conflito")).toHaveLength(11);
      expect((await c.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(1);
    } finally {
      await Promise.all(clientes.map((cl) => cl.end()));
    }
  });

  it("concorrência com mesma chave de idempotência gera um único registro", async () => {
    const chave = novaChave();
    const inicio = emHoras(80);
    const clientes = await Promise.all(Array.from({ length: 6 }, () => conectar()));
    try {
      const rs = await Promise.all(clientes.map(async (cl) =>
        (await comoServico<{ r: Resultado }>(cl, SQL_SOLICITAR, paramsSolicitar({ chave, hash: "x", inicio }))).r));
      expect(new Set(rs.filter((r) => r.ok).map((r) => r.id)).size).toBe(1);
      expect((await c.query("select count(*)::int n from agendamentos")).rows[0].n).toBe(1);
    } finally {
      await Promise.all(clientes.map((cl) => cl.end()));
    }
  });
});

describe("ações do profissional e máquina de estados", () => {
  it("confirma pendente e registra ator", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    expect((await adminRpc("select public.admin_confirmar($1) as r", [r.id])).ok).toBe(true);
    expect((await status(r.id!)).status).toBe("confirmado");
    const ev = await c.query("select ator, admin_id from agendamento_eventos where tipo='solicitacao_confirmada'");
    expect(ev.rows[0]).toEqual({ ator: "admin", admin_id: admin });
    // repetir a ação não duplica nada
    expect((await adminRpc("select public.admin_confirmar($1) as r", [r.id])).erro).toBe("estado_invalido");
    expect((await c.query("select count(*)::int n from notificacoes where tipo='confirmacao'")).rows[0].n).toBe(1);
  });

  it("recusa libera o horário", async () => {
    const inicio = emHoras(30);
    const r = await solicitar(c, { inicio });
    expect((await adminRpc("select public.admin_recusar($1,'Sem agenda') as r", [r.id])).ok).toBe(true);
    expect((await status(r.id!)).reserva_inicio).toBeNull();
    expect((await solicitar(c, { inicio })).ok).toBe(true);
  });

  it("cancelamento de confirmado libera o horário", async () => {
    const inicio = emHoras(30);
    const r = await solicitar(c, { inicio });
    await adminRpc("select public.admin_confirmar($1) as r", [r.id]);
    expect((await adminRpc("select public.admin_cancelar($1,'Imprevisto') as r", [r.id])).ok).toBe(true);
    expect((await status(r.id!)).status).toBe("cancelado");
    expect((await solicitar(c, { inicio })).ok).toBe(true);
  });

  it("proposta troca a reserva atomicamente, preserva o original e libera o horário anterior", async () => {
    const original = emHoras(30);
    const novo = emHoras(34);
    const r = await solicitar(c, { inicio: original });
    const p = await propor(r.id!, novo);
    expect(p.r.ok).toBe(true);
    const s = await status(r.id!);
    expect(s.status).toBe("aguardando_resposta");
    expect(new Date(s.inicio_solicitado).toISOString()).toBe(original);
    expect(new Date(s.reserva_inicio).toISOString()).toBe(novo);
    expect((await solicitar(c, { inicio: original })).ok).toBe(true); // original liberado
    expect((await solicitar(c, { inicio: novo })).erro).toBe("conflito"); // proposta reserva
    const n = await c.query("select payload_cifrado from notificacoes where tipo='proposta'");
    expect(n.rows[0].payload_cifrado).toBe("cifrado-teste");
  });

  it("proposta para horário ocupado não altera nada", async () => {
    const ocupado = emHoras(40);
    await solicitar(c, { inicio: ocupado });
    const r = await solicitar(c, { inicio: emHoras(30) });
    const antes = await status(r.id!);
    const p = await propor(r.id!, ocupado);
    expect(p.r.erro).toBe("conflito");
    expect(await status(r.id!)).toEqual(antes);
    expect((await eventos(r.id!)).some((e) => e.tipo === "proposta_enviada")).toBe(false);
  });

  it("nova proposta invalida token anterior", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    const p1 = await propor(r.id!, emHoras(34));
    const p2 = await propor(r.id!, emHoras(36));
    expect(p2.r.ok).toBe(true);
    const v1 = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'aceitar') as r", [p1.hash]);
    expect(v1.r.erro).toBe("token_invalido");
    const est = await c.query("select estado from notificacoes where tipo='proposta' order by criado_em");
    expect(est.rows.map((x) => x.estado)).toEqual(["cancelada", "pendente"]);
  });

  it("trigger bloqueia transição inválida mesmo por escrita direta", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    await adminRpc("select public.admin_recusar($1,null) as r", [r.id]);
    await expect(c.query("update agendamentos set status='confirmado' where id=$1", [r.id])).rejects.toThrow(/transicao_invalida/);
    await expect(c.query("update agendamentos set status='pendente' where id=$1", [r.id])).rejects.toThrow(/transicao_invalida/);
  });

  it("histórico é imutável", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    await expect(c.query("delete from agendamento_eventos where agendamento_id=$1", [r.id])).rejects.toThrow(/historico_imutavel/);
    await expect(c.query("begin; set local role service_role; delete from agendamento_eventos; commit;")).rejects.toThrow(/permission denied/);
    await c.query("rollback");
  });
});

describe("resposta à proposta por token", () => {
  it("aceite confirma; token não pode ser reutilizado", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    const p = await propor(r.id!, emHoras(34));
    const consulta = await comoServico<{ r: Resultado }>(c, "select public.consultar_proposta($1) as r", [p.hash]);
    expect(consulta.r.ok).toBe(true);
    expect(consulta.r.primeiro_nome).toBe("Aluno");
    expect((await status(r.id!)).token_usado_em).toBeNull(); // consultar não consome
    const a = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'aceitar') as r", [p.hash]);
    expect(a.r.status).toBe("confirmado");
    const b = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'recusar') as r", [p.hash]);
    expect(b.r.erro).toBe("token_usado");
    expect((await status(r.id!)).status).toBe("confirmado");
  });

  it("recusa cancela e libera o horário proposto", async () => {
    const novo = emHoras(34);
    const r = await solicitar(c, { inicio: emHoras(30) });
    const p = await propor(r.id!, novo);
    const a = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'recusar') as r", [p.hash]);
    expect(a.r.status).toBe("cancelado");
    expect((await solicitar(c, { inicio: novo })).ok).toBe(true);
  });

  it("token inexistente e expirado", async () => {
    const inex = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'aceitar') as r", ["0".repeat(64)]);
    expect(inex.r.erro).toBe("token_invalido");
    const r = await solicitar(c, { inicio: emHoras(30) });
    const p = await propor(r.id!, emHoras(34));
    await c.query("update agendamentos set token_expira_em=now()-interval '1 minute', expira_em=now()-interval '1 minute' where id=$1", [r.id]);
    const e = await comoServico<{ r: Resultado }>(c, "select public.responder_proposta($1,'aceitar') as r", [p.hash]);
    expect(e.r.erro).toBe("token_expirado");
    expect((await status(r.id!)).status).toBe("expirado");
  });

  it("duas respostas simultâneas com o mesmo token produzem uma única decisão", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    const p = await propor(r.id!, emHoras(34));
    const clientes = await Promise.all(Array.from({ length: 8 }, () => conectar()));
    try {
      const rs = await Promise.all(clientes.map(async (cl, i) =>
        (await comoServico<{ r: Resultado }>(cl, "select public.responder_proposta($1,$2) as r", [p.hash, i % 2 ? "aceitar" : "recusar"])).r));
      expect(rs.filter((x) => x.ok)).toHaveLength(1);
      expect(rs.filter((x) => x.erro === "token_usado")).toHaveLength(7);
      const ev = await c.query("select count(*)::int n from agendamento_eventos where agendamento_id=$1 and tipo in ('proposta_aceita','proposta_recusada')", [r.id]);
      expect(ev.rows[0].n).toBe(1);
    } finally {
      await Promise.all(clientes.map((cl) => cl.end()));
    }
  });
});

describe("expiração automática", () => {
  it("expira pendente e proposta vencidas, libera horários, é idempotente", async () => {
    const i1 = emHoras(30); const i2 = emHoras(40);
    const a = await solicitar(c, { inicio: i1 });
    const b = await solicitar(c, { inicio: emHoras(20) });
    await propor(b.id!, i2);
    await c.query("update agendamentos set expira_em = now() - interval '1 second', token_expira_em = case when token_hash is not null then now() - interval '1 second' end");
    const n1 = await comoServico<{ n: number }>(c, "select public.expirar_vencidos(500, null) as n");
    expect(n1.n).toBe(2);
    const n2 = await comoServico<{ n: number }>(c, "select public.expirar_vencidos(500, null) as n");
    expect(n2.n).toBe(0);
    expect((await status(a.id!)).status).toBe("expirado");
    expect((await status(b.id!)).status).toBe("expirado");
    const tipos = (await c.query("select tipo, estado from notificacoes where tipo like 'expiracao%' or tipo='proposta' order by tipo")).rows;
    expect(tipos).toEqual([
      { tipo: "expiracao_proposta", estado: "pendente" },
      { tipo: "expiracao_solicitacao", estado: "pendente" },
      { tipo: "proposta", estado: "cancelada" },
    ]);
    expect((await solicitar(c, { inicio: i1 })).ok).toBe(true);
    expect((await solicitar(c, { inicio: i2 })).ok).toBe(true);
  });

  it("solicitação nova libera reserva vencida mesmo antes do cron rodar", async () => {
    const inicio = emHoras(30);
    const a = await solicitar(c, { inicio });
    await c.query("update agendamentos set expira_em = now() - interval '1 second' where id=$1", [a.id]);
    expect((await solicitar(c, { inicio })).ok).toBe(true);
    expect((await status(a.id!)).status).toBe("expirado");
  });
});

describe("RLS e autorização", () => {
  it("anônimo não lê nem chama funções", async () => {
    await solicitar(c, { inicio: emHoras(30) });
    await expect(comoUsuario(c, null, "select * from agendamentos")).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(c, null, SQL_SOLICITAR, paramsSolicitar({ inicio: emHoras(31) }))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(c, null, "select public.consultar_proposta('x')")).rejects.toThrow(/permission denied/);
  });

  it("autenticado não-admin não vê registros e não executa ações", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    expect(await comoUsuario(c, naoAdmin, "select id from agendamentos")).toEqual([]);
    expect(await comoUsuario(c, naoAdmin, "select id from notificacoes")).toEqual([]);
    await expect(comoUsuario(c, naoAdmin, "select public.admin_confirmar($1)", [r.id])).rejects.toThrow(/nao_autorizado/);
    await expect(comoUsuario(c, naoAdmin, "select public.solicitar_agendamento('x','y','a','b','c','BR','d',now(),60,0,'America/Bahia','',48,'v','m','b')")).rejects.toThrow(/permission denied/);
  });

  it("admin lê, mas não escreve diretamente nem lê colunas secretas", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    expect(await comoUsuario(c, admin, "select id from agendamentos")).toHaveLength(1);
    await expect(comoUsuario(c, admin, "update agendamentos set status='confirmado' where id=$1", [r.id])).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(c, admin, "select token_hash from agendamentos")).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(c, admin, "select payload_cifrado from notificacoes")).rejects.toThrow(/permission denied/);
  });

  it("admin desativado perde acesso", async () => {
    const u = await criarUsuario(c, true);
    await c.query("update administradores set ativo=false where user_id=$1", [u]);
    await solicitar(c, { inicio: emHoras(30) });
    expect(await comoUsuario(c, u, "select id from agendamentos")).toEqual([]);
  });
});

describe("outbox e rate limit", () => {
  it("dois workers simultâneos não reivindicam a mesma notificação", async () => {
    for (let i = 0; i < 5; i++) await solicitar(c, { inicio: emHoras(30 + i * 2) });
    const [w1, w2] = await Promise.all([conectar(), conectar()]);
    try {
      const sql = "select coalesce(array_agg(id), '{}') ids from public.reivindicar_notificacoes(20, 60, null)";
      const [a, b] = await Promise.all([comoServico<{ ids: string[] }>(w1, sql), comoServico<{ ids: string[] }>(w2, sql)]);
      const todos = [...a.ids, ...b.ids];
      expect(todos).toHaveLength(10);
      expect(new Set(todos).size).toBe(10);
    } finally { await w1.end(); await w2.end(); }
  });

  it("falha temporária reagenda com backoff; sucesso apaga payload; falhas esgotadas -> falhou; admin reprocessa", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    await propor(r.id!, emHoras(34));
    const n = (await c.query("select id from notificacoes where tipo='proposta'")).rows[0].id;
    await comoServico(c, "select * from public.reivindicar_notificacoes(1, 60, array[$1::uuid])", [n]);
    expect((await comoServico<{ e: string }>(c, "select public.concluir_notificacao($1,false,null,'timeout',false) e", [n])).e).toBe("pendente");
    await c.query("update notificacoes set max_tentativas=1, proxima_tentativa_em=now() where id=$1", [n]);
    await comoServico(c, "select * from public.reivindicar_notificacoes(1, 60, array[$1::uuid])", [n]);
    expect((await comoServico<{ e: string }>(c, "select public.concluir_notificacao($1,false,null,'erro 500',false) e", [n])).e).toBe("falhou");
    expect((await adminRpc("select public.admin_reprocessar_notificacao($1) r", [n])).ok).toBe(true);
    await comoServico(c, "select * from public.reivindicar_notificacoes(1, 60, array[$1::uuid])", [n]);
    expect((await comoServico<{ e: string }>(c, "select public.concluir_notificacao($1,true,'msg_1',null,false) e", [n])).e).toBe("enviado_ao_provedor");
    const row = (await c.query("select payload_cifrado, provedor_mensagem_id, reenvios from notificacoes where id=$1", [n])).rows[0];
    expect(row).toEqual({ payload_cifrado: null, provedor_mensagem_id: "msg_1", reenvios: 1 });
    expect((await adminRpc("select public.admin_reprocessar_notificacao($1) r", [n])).erro).toBe("estado_invalido");
  });

  it("webhook é idempotente por id de evento", async () => {
    const r = await solicitar(c, { inicio: emHoras(30) });
    const n = (await c.query("select id from notificacoes where agendamento_id=$1 and destinatario='aluno'", [r.id])).rows[0].id;
    await comoServico(c, "select * from public.reivindicar_notificacoes(1, 60, array[$1::uuid])", [n]);
    await comoServico(c, "select public.concluir_notificacao($1,true,'msg_9',null,false)", [n]);
    expect((await comoServico<{ v: boolean }>(c, "select public.registrar_webhook_email('evt_1','email.delivered','msg_9') v")).v).toBe(true);
    expect((await comoServico<{ v: boolean }>(c, "select public.registrar_webhook_email('evt_1','email.delivered','msg_9') v")).v).toBe(false);
    expect((await c.query("select estado from notificacoes where id=$1", [n])).rows[0].estado).toBe("entrega_confirmada");
  });

  it("rate limit compartilhado e atômico", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, async () => {
      const cl = await conectar();
      try { return (await comoServico<{ v: boolean }>(cl, "select public.consumir_limite('ip:abc', 3600, 5) v")).v; } finally { await cl.end(); }
    }));
    expect(rs.filter(Boolean)).toHaveLength(5);
  });
});
