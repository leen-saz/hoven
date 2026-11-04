-- 024_usage: usage metering and monthly quotas per company (docs/prd-davinci.md, phase B).
-- usage_daily is one row per company/day/module/unit, bumped by usage_add(). No quota row = unlimited.
create table if not exists public.usage_daily (
  company_id uuid not null references public.companies (id),
  day date not null,
  module text not null,
  unit text not null,
  qty bigint not null default 0,
  primary key (company_id, day, module, unit)
);
create index if not exists usage_daily_day_idx on public.usage_daily (company_id, day);

create table if not exists public.usage_quotas (
  company_id uuid not null references public.companies (id),
  unit text not null,
  monthly_limit bigint not null check (monthly_limit >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, unit)
);

create or replace function public.usage_add(p_company uuid, p_day date, p_module text, p_unit text, p_qty bigint)
returns void language sql security invoker as $$
  insert into public.usage_daily (company_id, day, module, unit, qty) values (p_company, p_day, p_module, p_unit, p_qty)
  on conflict (company_id, day, module, unit) do update set qty = public.usage_daily.qty + excluded.qty;
$$;

alter table public.usage_daily enable row level security;
alter table public.usage_quotas enable row level security;
revoke all on public.usage_daily, public.usage_quotas from anon, authenticated;
revoke execute on function public.usage_add(uuid, date, text, text, bigint) from public, anon, authenticated;
