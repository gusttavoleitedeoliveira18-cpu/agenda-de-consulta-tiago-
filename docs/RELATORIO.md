# Relatório de entrega — evolução da agenda (17/11/2026)

## 1. Diagnóstico inicial (projeto original)

O ZIP enviado é idêntico ao repositório (exceto `package.json`/`tsconfig.json`, onde o repositório é mais novo). O trabalho foi feito sobre o repositório.

| | Situação encontrada |
|---|---|
| Funcionava | Site público (Next **15.5.29**, React **19.3.1** — versões reais do lockfile, não as do README antigo), build e tipagem OK, gravação simples em `agendamentos` com service_role. |
| Parcial | Validação só no formato BR (10–11 dígitos); honeypot respondia **sucesso falso**; página de privacidade com campos a preencher. |
| Não existia | Painel, autenticação, e-mails, propostas, estados além de 4, fuso, durações, conflitos, histórico, antispam, rate limit, testes. |
| Defeitos | (1) `F` definido dentro do render: **ao exibir erros, o formulário apagava tudo o que o aluno digitou** (reproduzido no original com Playwright). (2) Data mínima calculada em UTC (após 21h na Bahia bloqueava "hoje"). (3) Horário sem fuso. (4) `@types/react@18` com React 19. (5) `any` em `page.tsx`. |
| `FormData.entries()` | Causa real: o `tsconfig.json` do ZIP não tinha `"dom.iterable"` em `lib`; o repositório já tinha. O formulário agora itera `FormData` de forma tipada (`string | File`), sem `any`/`@ts-ignore`. |
| Dependências | Mantidas as versões de Next/React. `@types/react(-dom)` 18→19 (compatibilidade com o React instalado). Adicionadas: `react-phone-number-input` (+libphonenumber-js), `@supabase/ssr`, `luxon`, `zod`, `svix`, `server-only`; dev: `vitest`, `pg`, `eslint` + `eslint-config-next@15.5.29`, `playwright` (mesma versão do navegador instalado), `supabase` CLI. |
| Risco conhecido | `npm audit`: alerta *high* no `postcss` empacotado dentro do Next 15 (uso em build, não em runtime). A correção exige Next 16 (major) — **não aplicada**; recomenda-se avaliar a migração em etapa própria. |

## 2. Principais arquivos

**Criados:** `supabase/migrations/*` (4), `supabase/config.toml`, `supabase/templates/recuperacao.html`, `src/config/agenda.ts`, `src/lib/{env,tempo,telefone}.ts`, `src/lib/seguranca/*`, `src/lib/supabase/*`, `src/lib/email/*`, `src/lib/agenda/servicos.ts`, `src/lib/admin/*`, `src/middleware.ts`, `src/app/api/{proposta,cron,webhooks/resend}/route.ts`, `src/app/proposta/*`, `src/app/admin/**`, `src/components/Turnstile.tsx`, `src/components/admin/*`, `vercel.json`, `eslint.config.mjs`, `vitest.config.ts`, `tests/**`, `scripts/gerar-schema.mjs`, `docs/**`.

**Modificados:** `src/components/BookingForm.tsx`, `src/app/api/agendamento/route.ts`, `src/lib/validate.ts`, `src/app/page.tsx` (somente props do formulário, link do WhatsApp e remoção de `any`), `src/app/privacidade/page.tsx`, `src/app/globals.css` (estilos do campo de telefone), `src/config/site.ts` (comentário), `next.config.js` (cabeçalhos), `supabase/schema.sql` (gerado), `.env.example`, `README.md`, `package.json`/lock.

## 3. Decisões técnicas

- **Concorrência**: constraint `EXCLUDE USING gist (tstzrange(reserva_inicio, reserva_fim, '[)') WITH &&) WHERE reserva_inicio IS NOT NULL`. Estados terminais zeram a reserva na mesma transação. Solicitações vencidas ainda não processadas pelo cron são expiradas dentro da própria transação que precisa do intervalo.
- **Alteração de horário**: um único `UPDATE` troca a reserva; em conflito nada muda.
- **Ações do admin** usam a sessão do próprio administrador (RLS + `eh_admin()` dentro das funções `SECURITY DEFINER`); a chave secreta fica restrita a solicitação pública, resposta por token, fila, cron e webhook.
- **Token de proposta**: 256 bits, só o SHA-256 no banco; na fila, cifrado com AES-256-GCM (subchave HKDF de `TOKEN_ENCRYPTION_KEY`, AAD = id do agendamento) e apagado após o envio. Fica no fragmento `#t=` (não vai ao servidor em GET), é removido da barra de endereço, a página tem `no-referrer`/`no-store` e nenhum script de terceiros.
- **E-mail**: "aceito pelo provedor" ≠ "entregue"; `entrega_confirmada` só via webhook assinado. Timeout reenvia com a mesma `Idempotency-Key`; lease vencido há mais de 23 h vira `incerto` (reconciliação manual).
- **Rate limit** no PostgreSQL (compartilhado entre instâncias serverless), chaves por HMAC.
- **LGPD**: o formulário registra **ciência** do Aviso (versão, data/hora, manifestação, base legal "procedimentos preliminares de contrato"); não é consentimento.

## 4. Relatório de testes (resultados reais desta execução)

Ambiente: Supabase local via CLI 3.2.0 (Postgres 17, GoTrue, PostgREST, Mailpit) em Docker; servidores `next start` de produção.

### 4.1 Verificações técnicas
| Teste | Resultado |
|---|---|
| `npm ci` com o lockfile | **Aprovado** |
| `tsc --noEmit` | **Aprovado** |
| ESLint | **Aprovado** (0 avisos) |
| `next build` | **Aprovado** |
| Migrações em banco local, inclusive sobre dados no formato antigo | **Aprovado** (backfill verificado) |
| Reexecução das migrações / `schema.sql` | **Aprovado** |
| Conexão Supabase (API, Auth, RLS) | **Aprovado** (local) — produção: **Bloqueado por configuração externa** |

### 4.2 Unitários — 32/32 aprovados (`npm test`)
Fuso America/Bahia, horários inexistentes/ambíguos de horário de verão (São Paulo 2018/2019, Nova York), datas inválidas, "hoje" no fuso, faixa de funcionamento; telefones BR/PT/GB/US/AR → E.164, incompleto, impossível, sem país; `wa.me` multi-país e sem link fictício; schema de validação; AES-GCM (adulteração, AAD, chave errada), token, pseudonimização; e-mails (XSS escapado, "não confirmado", fuso, CREF, ausência de WhatsApp não configurado, todos os 12 tipos); redirecionamento seguro pós-login.

### 4.3 Banco real — 29/29 aprovados (`npm run test:db`)
Registro + eventos + outbox na mesma transação; mesmo horário, sobreposição parcial, consecutivo, buffer; horário passado; serviço sem duração; idempotência (mesmo conteúdo / conteúdo diferente); **12 conexões paralelas → 1 reserva**; **6 paralelas com a mesma chave → 1 registro**; confirmar (e repetição sem duplicar e-mail); recusa/cancelamento liberam horário; proposta troca reserva e preserva o original; proposta em horário ocupado não altera nada; nova proposta invalida token antigo; trigger bloqueia transição inválida mesmo com escrita direta; histórico imutável (inclusive para service_role); aceite/recusa por token; token inexistente/expirado/reutilizado; **8 respostas simultâneas com o mesmo token → 1 decisão**; expiração idempotente de pendente e proposta com liberação; expiração "preguiçosa"; RLS: anônimo, autenticado não-admin, admin sem escrita direta e sem colunas secretas, admin desativado; 2 workers sem reivindicar a mesma notificação; backoff → falhou → reprocessamento → payload apagado; webhook idempotente; rate limit atômico.

### 4.4 End-to-end — 23/23 aprovados (`npm run test:e2e`)
CSRF/origem e honeypot; todos os campos obrigatórios, e-mail, telefone incompleto/impossível/sem país, data e horário passados, serviço inexistente e sem duração, privacidade; BR → E.164 + e-mail inicial + aviso interno; Portugal/Japão/EUA; idempotência HTTP; conflitos 409 com duração de 90 min; **10 requisições HTTP paralelas → 1 aceita, 9 conflitos**; falha do provedor → "registrada, mas e-mail pendente" + protocolo → cron reenvia sem duplicar; rate limit 429; Turnstile ausente/inválido/válido; produção sem Turnstile → 503 sem gravar; cron sem segredo → 401; cron expira e libera; webhook sem assinatura → 401, assinado → entrega confirmada, repetido idempotente; acesso direto à API do Supabase com chave pública e com usuário não-admin bloqueado; chave secreta/segredos ausentes do HTML/JS; visitante e não-admin bloqueados no painel; login admin, filtros/busca, WhatsApp, proposta, e-mail com link, **GET/HEAD não consomem o token**, aceite no navegador, link reaberto → "já respondida"; 6 respostas paralelas → 1; token inválido/expirado; confirmar, cancelar, recusar pelo painel com histórico; falha permanente de e-mail → reenvio pelo painel; proposta em horário ocupado; logout; **recuperação de senha pelo e-mail (Mailpit) e novo login**; link de recuperação reutilizado rejeitado; formulário no celular com número de Portugal, dados mantidos após erro, **duplo clique → 1 requisição**, sem rolagem horizontal.

### 4.5 Visual
| Teste | Resultado |
|---|---|
| Site público acima do formulário, antes × depois, 1440×900 e iPhone 13 | **Aprovado — 0 pixels diferentes** (comparação automática) |
| Formulário, privacidade, proposta, login e painel | **Aprovado** por inspeção das capturas em `docs/visual/` |
| Diferenças autorizadas | campo de telefone com bandeira, nota de fuso, checkbox de ciência, mensagens; privacidade com texto revisado |

### 4.6 Não executados / bloqueados
| Teste | Classificação |
|---|---|
| Turnstile real da Cloudflare (widget e siteverify) | **Bloqueado por configuração externa** — `challenges.cloudflare.com` inacessível neste ambiente; o caminho do servidor foi testado contra verificador falso local |
| Envio real pelo Resend / domínio / entrega na caixa | **Bloqueado por configuração externa** (conta, domínio, chave); testado contra API falsa local com o mesmo protocolo |
| Webhook real do Resend | **Bloqueado por configuração externa** (assinatura Svix testada localmente) |
| Supabase de produção, migrações em produção | **Não executado** (exige autorização) |
| Vercel Cron real | **Bloqueado por configuração externa** (rota testada diretamente) |
| Safari/iPhone real, Android real, Windows | **Não executado** (testado em Chromium com emulação de iPhone 13) |
| Auditoria de segurança completa / pentest | **Não executado** — os itens acima são testes direcionados, não uma auditoria integral |

## 5. Pendências do proprietário

1. **Duração real de cada serviço** (e intervalo entre atendimentos) em `src/config/agenda.ts` — **sem isso o formulário não aceita solicitações**.
2. **WhatsApp oficial** em `src/config/site.ts` (formato `+55…`).
3. Confirmar o fuso (`America/Bahia`) e os prazos de 48 h.
4. Dias e horários de funcionamento (opcional).
5. E-mail que recebe os avisos internos (`ADMIN_NOTIFICATION_EMAIL`).
6. Domínio do site e domínio/remetente verificado no Resend.
7. Credenciais (Supabase, Resend, Turnstile, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`) cadastradas **diretamente** na Vercel/.env.local — nunca pelo chat.
8. Aviso de Privacidade: CPF/CNPJ e endereço do controlador, encarregado (ou dispensa), canal de atendimento ao titular, regiões/salvaguardas dos provedores, **prazo de retenção** — e validação jurídica do texto e das bases legais.
9. Política de retenção (nenhuma exclusão automática de solicitações foi implementada sem regra aprovada).
10. Criar o primeiro administrador (README §3) e desativar o cadastro público no Supabase.
11. Autorizar backup + aplicação das migrações no banco de produção; revisar os registros antigos listados no painel.
12. Plano da Vercel (Pro para cron a cada 5 min; ver README §5).
13. Autorização de imagem dos alunos na foto (pendência já citada na etapa 1).
