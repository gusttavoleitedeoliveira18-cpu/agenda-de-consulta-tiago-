// Executor dos testes end-to-end LOCAIS.
// Pré-requisito: `npx supabase start` (Docker). Nada aqui toca produção:
// usa o Supabase local, um Resend FALSO e um verificador Turnstile FALSO.
//
//   npm run test:e2e            (compila e executa)
//   SKIP_BUILD=1 npm run test:e2e
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { iniciarFalsos } from "./falsos.mjs";

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
if (!/127\.0\.0\.1|localhost/.test(status.API_URL)) throw new Error("Os testes E2E só rodam contra o Supabase local.");

const PORTA_FALSOS = 4010;
const segredos = {
  CRON_SECRET: randomBytes(24).toString("hex"),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString("base64")}`,
};
const base = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  PROFESSIONAL_TIME_ZONE: "America/Bahia",
  RESEND_API_KEY: "re_teste_local",
  EMAIL_FROM: "Agenda Teste <agenda@example.test>",
  ADMIN_NOTIFICATION_EMAIL: "profissional@example.test",
  APP_TEST_MODE: "1",
  TEST_RESEND_API_URL: `http://127.0.0.1:${PORTA_FALSOS}`,
  TEST_SERVICE_DURATIONS: JSON.stringify({ consultoria_online: 60, acompanhamento_presencial: 60, aula_futebol: 90 }),
  TRUSTED_IP_HEADER: "x-test-ip",
  ...segredos,
};
delete base.VERCEL;

function rodar(cmd, args, env, nome) {
  const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${nome}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${nome}] ${d}`));
  return p;
}
async function aguardar(url) {
  for (let i = 0; i < 120; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`Servidor não respondeu: ${url}`);
}

const falsos = await iniciarFalsos(PORTA_FALSOS);
if (!process.env.SKIP_BUILD) execFileSync("npx", ["next", "build"], { env: { ...base, PUBLIC_SITE_URL: "http://localhost:3000" }, stdio: "inherit" });

const servidores = [
  // A: modo de teste local, Turnstile dispensado explicitamente (sem chave).
  rodar("npx", ["next", "start", "-p", "3000"], { ...base, PUBLIC_SITE_URL: "http://localhost:3000" }, "A"),
  // B: Turnstile exigido, verificado contra o verificador falso local.
  rodar("npx", ["next", "start", "-p", "3001"], { ...base, PUBLIC_SITE_URL: "http://localhost:3001", TURNSTILE_SECRET_KEY: "segredo-turnstile-teste", TEST_TURNSTILE_VERIFY_URL: `http://127.0.0.1:${PORTA_FALSOS}/siteverify` }, "B"),
  // C: "produção" sem modo de teste e sem Turnstile -> deve falhar de forma segura (503).
  rodar("npx", ["next", "start", "-p", "3002"], { ...base, APP_TEST_MODE: "", PUBLIC_SITE_URL: "https://localhost:3002" }, "C"),
];
let codigo = 1;
try {
  await Promise.all([3000, 3001, 3002].map((p) => aguardar(`http://localhost:${p}/privacidade`)));
  const vt = spawn("npx", ["vitest", "run", "tests/e2e", "--testTimeout=120000", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...base, E2E_DB_URL: status.DB_URL, E2E_MAILPIT: status.MAILPIT_URL, E2E_FALSOS: `http://127.0.0.1:${PORTA_FALSOS}`, E2E_API_URL: status.API_URL },
  });
  codigo = await new Promise((ok) => vt.on("exit", ok));
} finally {
  for (const s of servidores) { try { process.kill(-s.pid, "SIGTERM"); } catch { /* já encerrado */ } }
  falsos.close();
}
process.exit(codigo ?? 1);
