# Site e agenda — Tiago de Souza Lima (Personal Trainer)

Next.js 15.5 (App Router) · React 19 · TypeScript · Tailwind 3 · Supabase (Postgres 17, Auth, RLS) · Resend · Cloudflare Turnstile.

O site público é o mesmo da etapa 1 (identidade visual preservada). Sobre ele foram implementados:

- **Formulário de solicitação** com WhatsApp internacional (bandeiras, E.164), fuso explícito do profissional, ciência do Aviso de Privacidade, idempotência, Turnstile, honeypot e rate limit persistente.
- **Reserva sem conflitos no PostgreSQL**: cada solicitação ativa ocupa `[início, início + duração + intervalo)`; uma *exclusion constraint* GiST impede sobreposição mesmo com requisições simultâneas.
- **Máquina de estados** (`pendente`, `aguardando_resposta`, `confirmado`, `recusado`, `cancelado`, `expirado`) aplicada no banco, com histórico imutável.
- **Painel do profissional** (`/admin`): login, recuperação de senha, dashboard, filtros, busca, paginação, confirmar/recusar/propor/cancelar, WhatsApp, histórico e reenvio de e-mails com falha.
- **Proposta de novo horário** com link seguro de uso único (`/proposta#t=…`), aceito ou recusado sem criar conta.
- **E-mails transacionais** via fila (Outbox) com tentativas, backoff, deduplicação e `Idempotency-Key`.
- **Expiração automática** (pg_cron a cada minuto) e rotina `/api/cron` (Vercel Cron) para envio de e-mails.

Relatório completo (diagnóstico, testes e pendências): [`docs/RELATORIO.md`](docs/RELATORIO.md).

---

## 1. Rodar localmente

Pré-requisitos: Node 20+ (testado com 22), Docker (para o Supabase local).

```bash
npm ci
npx supabase start          # sobe Postgres/Auth/API/Mailpit locais e aplica as migrações
npx supabase status         # mostra URL e chaves LOCAIS
cp .env.example .env.local  # preencha com os valores locais
npm run dev                 # http://localhost:3000
```

O modo de teste (`APP_TEST_MODE=1`, usado pelos testes automatizados) nunca é ativado na Vercel (a variável `VERCEL` o desliga).

## 2. Testes

| Comando | O que faz |
|---|---|
| `npm run typecheck` | TypeScript estrito |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) |
| `npm test` | Testes unitários (fuso/DST, telefone, validação, criptografia, e-mails, redirecionamento) |
| `npm run test:db` | Banco real local: estados, conflitos, concorrência com conexões paralelas, RLS, outbox, rate limit |
| `npm run test:e2e` | Compila e sobe 3 servidores `next start` reais + navegador (Playwright) contra o Supabase local, com Resend e Turnstile **falsos locais** |

Os testes apagam dados — só rodam contra `127.0.0.1`/`localhost`.

## 3. Banco de dados (Supabase)

As migrações em `supabase/migrations/` são a fonte de verdade. São **incrementais, preservam os registros existentes e podem ser reexecutadas**. `supabase/schema.sql` é gerado a partir delas (`npm run db:schema`).

| Migração | Conteúdo |
|---|---|
| `…000000_baseline.sql` | Schema original da etapa 1 (não altera bancos que já o têm) |
| `…000100_estrutura_agendamentos.sql` | Novas colunas, backfill documentado dos registros antigos, constraints, exclusão GiST, histórico, outbox, administradores, idempotência, rate limit, webhooks, triggers |
| `…000200_funcoes_agendamento.sql` | Funções atômicas: solicitar, confirmar, recusar, propor, cancelar, responder proposta, expirar, fila |
| `…000300_rls_permissoes_cron.sql` | RLS, grants mínimos, pg_cron de expiração e limpeza |

**Antes de aplicar em produção (somente com autorização do proprietário):**

1. Backup: Dashboard → Database → Backups (ou `npx supabase db dump --linked -f backup.sql` e `--data-only -f dados.sql`).
2. Teste em um projeto de desenvolvimento/branch.
3. Aplique: `npx supabase link --project-ref <ref>` e `npx supabase db push` (ou execute `supabase/schema.sql` no SQL Editor).
4. Recuperação: restaure o backup pelo painel ou `psql` com os arquivos do passo 1.

Registros antigos (anteriores a esta versão) são marcados `legado`: o WhatsApp brasileiro recebe `+55` (E.164) e o horário é interpretado em America/Bahia. Como não havia duração, **não recebem reserva**; os pendentes/confirmados aparecem no painel em "Registros antigos para revisar" e bloqueiam novas solicitações no mesmo dia até serem resolvidos.

### Primeiro administrador

O cadastro público está desligado. Para criar o administrador:

1. Supabase → Authentication → Sign In / Providers → Email: **desative "Allow new users to sign up"**.
2. Authentication → Users → **Add user** → e-mail e senha forte (marque *Auto Confirm User*).
3. SQL Editor:
   ```sql
   insert into public.administradores (user_id, observacao)
   select id, 'Proprietário' from auth.users where email = 'EMAIL_DO_PROFISSIONAL';
   ```
4. Para revogar: `update public.administradores set ativo = false where user_id = '…';`

Um usuário autenticado que não está ativo em `administradores` não acessa o painel nem os dados (verificado no servidor e no banco).

### Supabase Auth — URLs e e-mail de recuperação

- Authentication → URL Configuration: **Site URL** = `PUBLIC_SITE_URL`; **Redirect URLs**: `https://SEU_DOMINIO/admin/auth/confirm`.
- Authentication → Email Templates → **Reset Password**: use o conteúdo de `supabase/templates/recuperacao.html` (fluxo `token_hash`, recomendado para SSR).
- Configure SMTP próprio no Supabase para os e-mails de autenticação (o SMTP padrão tem limites baixos).

## 4. Configurações do proprietário (sem segredos)

- `src/config/site.ts` — textos, serviços e WhatsApp oficial (+55 71 98188-0556, E.164).
- `src/config/agenda.ts` — bloco de agenda por solicitação (60 min), intervalo extra (0), dias/horários de funcionamento (opcional, ainda não definido), prazos de expiração (48 h), versão do Aviso de Privacidade.
- `PROFESSIONAL_TIME_ZONE` — fuso: horário de Brasília (`America/Sao_Paulo`).

## 5. Publicação na Vercel

Variáveis (Project → Settings → Environment Variables), conforme `.env.example`:

| Variável | Production | Preview | Observação |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✓ | ✓ (projeto de dev) | públicas |
| `SUPABASE_SECRET_KEY` | ✓ | ✓ (projeto de dev) | **secreta** |
| `PUBLIC_SITE_URL` | ✓ | URL do preview | https |
| `PROFESSIONAL_TIME_ZONE` | ✓ | ✓ | |
| `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL` | ✓ | opcional | domínio verificado |
| `RESEND_WEBHOOK_SECRET` | opcional | — | confirmação de entrega |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | ✓ obrigatório | ✓ | sem elas o envio retorna 503 |
| `CRON_SECRET` | ✓ | — | |
| `TOKEN_ENCRYPTION_KEY` | ✓ obrigatório | ✓ | `openssl rand -base64 32` |

Serviços externos:

- **Resend**: verifique o domínio (SPF/DKIM) em Domains; `EMAIL_FROM` deve usar esse domínio. Webhook opcional: `https://SEU_DOMINIO/api/webhooks/resend` com eventos `email.delivered`, `email.bounced`, `email.complained`.
- **Cloudflare Turnstile**: crie um widget com o domínio do site; copie site key e secret key.
- **Cron**: `vercel.json` agenda `/api/cron` a cada 5 minutos (envio/reenvio de e-mails e limpeza). Esse intervalo exige plano **Pro**. No plano **Hobby** (crons diários), troque para `"0 12 * * *"`; a expiração continua a cada minuto no banco (pg_cron), mas e-mails que falharem no envio imediato só serão reenviados na execução diária — ou agende `/api/cron` por `pg_net` no Supabase.
- **Rate limit**: implementado no próprio PostgreSQL (tabela `rate_limites`, contador atômico, chaves pseudonimizadas por HMAC, retenção de 2 dias) — não há serviço externo adicional.

## 6. Rotas

| Rota | Tipo | Descrição |
|---|---|---|
| `/` | página | site + formulário |
| `/privacidade` | página | Aviso de Privacidade |
| `/proposta` | página | resposta à proposta (token no fragmento `#t=`) |
| `POST /api/agendamento` | API | nova solicitação |
| `POST /api/proposta` | API | `consultar` / `aceitar` / `recusar` |
| `GET /api/cron` | API | rotina agendada (Bearer `CRON_SECRET`) |
| `POST /api/webhooks/resend` | API | eventos de entrega (assinatura Svix) |
| `/admin/login`, `/admin/recuperar-senha`, `/admin/redefinir-senha`, `/admin/auth/confirm`, `POST /admin/sair` | auth | acesso do profissional |
| `/admin`, `/admin/agendamentos`, `/admin/agendamentos/[id]` | painel | gestão |
