# Relatório de entrega — landing page com formulário (18/11/2026)

## 1. Mudança de escopo

A primeira versão (17/11) implementava painel com login, e-mails, propostas de horário e bloqueio de agenda. Por decisão do proprietário em 18/11, o site passou a ser **apenas uma landing page com formulário**: o pedido é gravado no banco e o aluno o envia ao Tiago pelo WhatsApp (mensagem pronta). Foram removidos painel, login, e-mails (Resend), página de proposta, cron, webhook e o bloqueio de horários. Envio automático de WhatsApp pelo servidor não foi implementado: exige a API paga do WhatsApp Business (verificação da Meta).

Decisões registradas: WhatsApp +55 71 98188-0556; horário de Brasília (`America/Sao_Paulo`); opção "Ainda não sei" retirada; banco Supabase em São Paulo.

## 2. Diagnóstico do projeto original (mantido)

- Versões reais: Next **15.5.29**, React **19.3.1** (lockfile). `@types/react` atualizado de 18 para 19 para combinar com o React instalado.
- **Defeito corrigido**: o formulário original apagava tudo o que o aluno tinha digitado quando aparecia um erro (componente `F` definido dentro do render). Reproduzido no original com Playwright.
- `FormData.entries()`: o `tsconfig.json` do ZIP não tinha `"dom.iterable"`; o repositório já tinha. A iteração agora é tipada, sem `any`/`@ts-ignore`.
- Data mínima do formulário era calculada em UTC; agora usa o fuso do profissional.
- Risco conhecido: `npm audit` aponta alerta *high* no `postcss` embutido no Next 15 (uso em build). Correção exige Next 16 (major) — não aplicada.

## 3. O que o site faz

- Formulário com WhatsApp internacional (bandeiras, validação com metadados do libphonenumber, armazenamento E.164), data/horário interpretados no horário de Brasília (rejeita horários inexistentes/ambíguos de horário de verão), ciência do Aviso de Privacidade (versão, data/hora e base legal gravadas).
- Gravação atômica e idempotente (`registrar_solicitacao`), com protocolo `TL-XXXXXXXXXX` e histórico.
- Tela de sucesso só depois da confirmação do banco, com botão para o WhatsApp do Tiago e a mensagem pronta (nome, atendimento, data/horário, objetivo, protocolo).
- Proteções: origem (CSRF), honeypot, rate limit persistente por IP e por e-mail (chaves pseudonimizadas por HMAC), limites de tamanho, cabeçalhos de segurança (CSP, HSTS, X-Frame-Options), Turnstile opcional. Banco com RLS: a chave pública não lê nem grava nada.

## 4. Testes (resultados reais)

| Verificação | Resultado |
|---|---|
| `npm ci`, `tsc`, ESLint, `next build` | **Aprovados** |
| Unitários (`npm test`) | **17/17 aprovados** |
| Banco local real (`npm run test:db`) | **7/7 aprovados** — gravação, horário local, sem bloqueio de horário, horário passado, idempotência (inclusive 6 envios simultâneos → 1 registro), anônimo/autenticado sem acesso, rate limit atômico |
| End-to-end (`npm run test:e2e`) | **11/11 aprovados** — CSRF, honeypot, todas as validações, E.164 BR/PT/JP/US, mesmo horário por dois alunos, idempotência, rate limit 429, Turnstile (verificador falso local), rotas antigas inexistentes (404), banco inacessível pela chave pública, chave secreta fora do JS; no celular: número de Portugal, dados mantidos após erro, duplo clique → 1 envio, link `wa.me/5571981880556` com a mensagem correta, sem rolagem horizontal |
| Visual (antes × depois, 1440×900 e iPhone 13) | **Aprovado**: acima do formulário, a única diferença de pixels é a frase "responde por e-mail" → "responde pelo WhatsApp". Capturas em `docs/visual/` |
| Supabase de produção (projeto São Paulo) | Migrações 1–4 aplicadas e conferidas pelo proprietário (7 tabelas, funções, pg_cron, RLS). **Migração 5 pendente** de execução no SQL Editor |
| Turnstile real da Cloudflare | **Bloqueado por configuração externa** (Cloudflare inacessível neste ambiente; chaves não configuradas) |
| Vercel | Projeto criado e conectado ao GitHub em 18/11 (variáveis `SUPABASE_URL` e `SUPABASE_SECRET_KEY` cadastradas); teste pela pré-visualização do pull request **em andamento** |
| Safari/iPhone, Android, Windows reais | **Não executado** (Chromium com emulação de iPhone 13) |

## 5. Pendências do proprietário

1. ~~Executar a migração 5 no SQL Editor do Supabase~~ — feito.
2. Testar a pré-visualização da Vercel e, se aprovada, fazer o merge do pull request para publicar.
3. (Recomendado) Cloudflare Turnstile e `PUBLIC_SITE_URL`.
4. Aviso de Privacidade: CPF/CNPJ e endereço do controlador, encarregado (ou dispensa), canal para os titulares, prazo de retenção e validação jurídica.
5. Autorização de imagem dos alunos que aparecem na foto.
