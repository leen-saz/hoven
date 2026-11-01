-- 012: Hoven store data (Salla). Per-order cache + one row per day, same definitions as the old
-- hoven-dashboard salla_api.py (reconciled against Salla's own monthly summary). Service role only.
create table if not exists public.salla_orders (
  id text primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.companies (id),
  day date not null,
  status text not null default '',
  total numeric not null default 0,
  draft boolean not null default false,
  pending_payment boolean not null default false,
  amounts jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists salla_orders_day_idx on public.salla_orders (day);

create table if not exists public.salla_orders_daily (
  day date primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.companies (id),
  orders int not null default 0,
  net_sales_sar numeric not null default 0,
  gross_sales_sar numeric not null default 0,
  discounts_sar numeric not null default 0,
  shipping_sar numeric not null default 0,
  refunds_sar numeric not null default 0,
  vat_sar numeric not null default 0,
  orders_with_detail int not null default 0,
  canceled_orders int not null default 0,
  canceled_sar numeric not null default 0,
  pending_review_orders int not null default 0,
  pending_review_sar numeric not null default 0,
  source text not null default '',
  fetched_at timestamptz not null default now()
);
alter table public.salla_orders enable row level security;
alter table public.salla_orders_daily enable row level security;
revoke all on public.salla_orders, public.salla_orders_daily from anon, authenticated;
