# Site — Tiago de Souza Lima (Personal Trainer)

Landing page com formulário de solicitação de avaliação.
Next.js 15.5 · React 19 · TypeScript · Tailwind 3 · Supabase (Postgres) · Vercel.

## Como funciona

1. O aluno conhece o profissional na página e preenche o formulário (sem cadastro, sem login).
2. O servidor valida tudo e **grava a solicitação no Supabase** (protocolo, horário em horário de Brasília, WhatsApp em formato internacional E.164, registro de ciência do Aviso de Privacidade).
3. A tela de sucesso mostra o botão **"Enviar pelo WhatsApp"**, que abre o WhatsApp do aluno com a mensagem pronta para o Tiago (+55 71 98188-0556). O Tiago combina tudo diretamente com o aluno.
4. Todas as solicitações ficam salvas no Supabase (**Table Editor → agendamentos**), mesmo se o aluno não enviar a mensagem.

Proteções: verificação de origem, honeypot, limite de tentativas por IP e por e-mail (no próprio banco), idempotência (duplo clique não duplica), validação completa no servidor e Cloudflare Turnstile opcional. O banco não aceita leitura nem escrita pela chave pública: só o servidor grava.

## Rodar localmente

Pré-requisitos: Node 20+ e Docker.

```bash
npm ci
npx supabase start          # Supabase local (aplica as migrações)
npx supabase status         # mostra a URL e a chave secreta LOCAIS
cp .env.example .env.local  # preencha SUPABASE_URL e SUPABASE_SECRET_KEY
npm run dev                 # http://localhost:3000
```

## Testes

| Comando | O que faz |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript estrito / ESLint |
| `npm test` | Unitários: fuso e horário de verão, telefone/E.164/wa.me, validação, pseudonimização |
| `npm run test:db` | Banco local real: gravação, idempotência concorrente, bloqueio de acesso direto, rate limit |
| `npm run test:e2e` | Servidores `next start` reais + navegador (Playwright) contra o Supabase local |

## Banco de dados (Supabase)

As migrações em `supabase/migrations/` são a fonte de verdade; `supabase/schema.sql` é gerado delas (`npm run db:schema`) e pode ser executado inteiro no SQL Editor. São incrementais e podem ser reexecutadas sem apagar dados.

> As migrações 2–4 criaram também estruturas de uma versão anterior (painel, e-mails, propostas). Elas ficam no banco sem uso e não interferem. A migração 5 (`20261118000000_solicitacao_simples.sql`) adiciona a função usada pelo formulário atual.

**Projeto já criado (São Paulo):** para atualizar, rode no SQL Editor o conteúdo de `supabase/migrations/20261118000000_solicitacao_simples.sql` (ou o `schema.sql` inteiro de novo).

Ver as solicitações: **Table Editor → agendamentos** (colunas `protocolo`, `nome`, `email`, `whatsapp`, `tipo_atendimento`, `data_solicitada`, `horario_solicitado`, `objetivo`, `created_at`).

## Publicação na Vercel

1. Importe o repositório na Vercel (Add New → Project).
2. Environment Variables (Production e Preview):

| Variável | Obrigatória | Onde obter |
|---|---|---|
| `SUPABASE_URL` | sim | Supabase → Project Settings → API (Project URL) |
| `SUPABASE_SECRET_KEY` | sim | Supabase → Project Settings → API Keys → Secret key (**secreta**) |
| `PROFESSIONAL_TIME_ZONE` | não (padrão `America/Sao_Paulo`) | — |
| `PUBLIC_SITE_URL` | recomendada | o endereço final do site (https) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | opcional | Cloudflare → Turnstile → Add site |

3. As funções rodam em São Paulo (`vercel.json` → `gru1`), perto do banco.
4. Cada envio para um branch gera um link de pré-visualização (`…-git-<branch>-….vercel.app`) para testar antes do merge. Variáveis novas só valem para deploys feitos depois de cadastradas.

## Configurações (sem segredos)

- `src/config/site.ts` — textos, serviços e WhatsApp oficial.
- `src/config/agenda.ts` — versão e base legal do Aviso de Privacidade.
