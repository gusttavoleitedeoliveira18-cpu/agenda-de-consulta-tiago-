// Helpers para testes contra o banco LOCAL do Supabase (supabase start).
// Nunca aponte TEST_DATABASE_URL para produção: os testes apagam dados.
import { Client } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!/127\.0\.0\.1|localhost/.test(DB_URL)) {
  throw new Error("TEST_DATABASE_URL precisa apontar para um banco local de testes.");
}

export async function conectar(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

export async function limpar(c: Client) {
  await c.query(
    "truncate public.notificacoes, public.agendamento_eventos, public.idempotencia, public.rate_limites, public.webhook_eventos, public.agendamentos cascade",
  );
}

/** Executa como service_role (o papel usado pelo servidor). */
export async function comoServico<T>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  await c.query("begin");
  try {
    await c.query("set local role service_role");
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows[0] as T;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

/** Executa como usuário autenticado (JWT simulado com sub = userId). */
export async function comoUsuario<T>(c: Client, userId: string | null, sql: string, params: unknown[] = []) {
  await c.query("begin");
  try {
    if (userId) {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    } else {
      await c.query("set local role anon");
    }
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows as T[];
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

export async function criarUsuario(c: Client, admin: boolean): Promise<string> {
  const id = randomUUID();
  await c.query(
    "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())",
    [id, `teste-${id.slice(0, 8)}@example.test`],
  );
  if (admin) await c.query("insert into public.administradores (user_id) values ($1)", [id]);
  return id;
}

export type Resultado = { ok: boolean; erro?: string; id?: string; protocolo?: string; repetido?: boolean; [k: string]: unknown };

export function emHoras(h: number, minutos = 0): string {
  const d = new Date(Date.now() + h * 3600_000);
  d.setUTCMinutes(minutos, 0, 0);
  return d.toISOString();
}

export function novaChave() {
  return randomBytes(16).toString("hex");
}

export function token() {
  const t = randomBytes(32).toString("base64url");
  return { token: t, hash: createHash("sha256").update(t).digest("hex") };
}

export const SQL_SOLICITAR =
  "select public.solicitar_agendamento($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as r";

export function paramsSolicitar(o: { chave?: string; hash?: string; inicio: string; duracao?: number | null; buffer?: number; nome?: string; prazoHoras?: number }) {
  return [
    o.chave ?? novaChave(), o.hash ?? "h1", o.nome ?? "Aluno Teste", "aluno@example.test", "+5571999990000", "BR",
    "consultoria_online", o.inicio, o.duracao === undefined ? 60 : o.duracao, o.buffer ?? 0, "America/Bahia", "",
    o.prazoHoras ?? 48, "2026-11-17", "ciencia_aviso_privacidade", "procedimentos_preliminares_contrato",
  ];
}

export async function solicitar(c: Client, o: Parameters<typeof paramsSolicitar>[0]): Promise<Resultado> {
  const r = await comoServico<{ r: Resultado }>(c, SQL_SOLICITAR, paramsSolicitar(o));
  return r.r;
}
