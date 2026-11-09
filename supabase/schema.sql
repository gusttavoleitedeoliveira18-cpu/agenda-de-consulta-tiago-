-- Execute no SQL Editor do Supabase.
create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 3 and 120),
  email text not null check (char_length(email) <= 160),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,11}$'),
  tipo_atendimento text not null check (tipo_atendimento in ('consultoria_online','acompanhamento_presencial','aula_futebol','nao_sei')),
  data_solicitada date not null,
  horario_solicitado time not null,
  objetivo text check (char_length(objetivo) <= 600),
  status text not null default 'pendente' check (status in ('pendente','confirmado','recusado','cancelado')),
  created_at timestamptz not null default now()
);
-- RLS ligada e SEM policies para anon/authenticated: visitantes não leem nem escrevem direto.
-- A API (servidor) grava com a service role. Na etapa 2 (painel), crie policies restritas ao personal autenticado.
alter table public.agendamentos enable row level security;
revoke all on public.agendamentos from anon, authenticated;
create index if not exists agendamentos_status_idx on public.agendamentos (status, created_at desc);
