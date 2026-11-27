alter table public.cartinha_cobrancas
  add column if not exists email_comprador text,
  add column if not exists email_tentativa_em timestamptz,
  add column if not exists email_enviado_em timestamptz;
