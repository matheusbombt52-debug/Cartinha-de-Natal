create table if not exists public.cartinha_cobrancas (
  id uuid primary key,
  cartinha_id uuid not null unique references public.cartinhas(id) on delete cascade,
  metodo text not null check (metodo in ('pix', 'credit_card')),
  cakto_id text unique,
  criada_em timestamptz not null default now(),
  resposta jsonb
);

alter table public.cartinha_cobrancas enable row level security;
revoke all on public.cartinha_cobrancas from public, anon, authenticated;
grant select, insert, update on public.cartinha_cobrancas to service_role;
