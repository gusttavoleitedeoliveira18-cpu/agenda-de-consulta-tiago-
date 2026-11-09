# Site público — Personal Trainer (etapa 1)
Next.js 14 · TypeScript · Tailwind · Lucide · Supabase.

## Rodar
1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha.
3. `npm run dev` → http://localhost:3000

## Supabase (obrigatório para gravar solicitações)
1. Crie um projeto em supabase.com.
2. Execute `supabase/schema.sql` no SQL Editor (tabela `agendamentos`, RLS ligada, sem acesso público).
3. Em Project Settings → API copie a URL e a **service_role key** para `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (local e na Vercel). A chave nunca vai ao navegador.
Sem essas variáveis, o formulário valida mas exibe erro de indisponibilidade — não simula sucesso.

## Pendências de conteúdo
- `src/config/site.ts`: `instagram` e `whatsapp`.
- `src/app/privacidade/page.tsx`: controlador, prazos e canal de contato (campos em destaque).
- Foto: usada `/public/images/tiago-treino.png`; recomenda-se otimizar/recortar e obter autorização dos alunos que aparecem.

## Reutilizar para outro personal
Edite `src/config/site.ts`, a foto em `public/images` e as cores em `tailwind.config.ts`.

## Etapa 2 (painel)
Tabela pronta; adicione Supabase Auth e policies de SELECT/UPDATE só para o personal.
