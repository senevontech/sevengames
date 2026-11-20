-- ============================================================
-- Razorpay (website payments). Run after tokens.sql (and play.sql).
--
-- The website's checkout goes through the `razorpay` Edge Function, which talks to Razorpay
-- with the secret key and calls the functions below with the service role. Nothing here is
-- callable from the browser.
--   token packs   one-off orders  → rp_grant_pack   (each Razorpay payment credits once)
--   Senevon Plus  subscriptions   → rp_set_plus     (renewals / cancellations from webhooks)
-- Site setting payments_mode = 'live' switches the website from the test checkout to Razorpay.
-- ============================================================

-- every order / subscription the site started, so the server can check what was paid for
create table if not exists public.razorpay_orders (
  id text primary key,                  -- Razorpay order id (order_…) or subscription id (sub_…)
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('pack', 'plus')),
  item text not null,                   -- pack id, or plan ('monthly' | 'yearly')
  currency text not null,
  amount numeric(10, 2) not null,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists razorpay_orders_user_idx on public.razorpay_orders (user_id, created_at desc);

-- payments already credited (a payment id is credited at most once)
create table if not exists public.razorpay_payments (
  payment_id text primary key,
  order_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);

-- Razorpay plans, created by the Edge Function on first use per plan + currency + price
create table if not exists public.razorpay_plans (
  plan text not null check (plan in ('monthly', 'yearly')),
  currency text not null,
  amount numeric(10, 2) not null,
  plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (plan, currency, amount)
);

alter table public.razorpay_orders enable row level security;
alter table public.razorpay_payments enable row level security;
alter table public.razorpay_plans enable row level security;
-- players may see their own orders; the rest is server only
drop policy if exists "Own razorpay orders" on public.razorpay_orders;
create policy "Own razorpay orders" on public.razorpay_orders for select to authenticated using (auth.uid() = user_id);

-- A paid token pack. Returns true when this call credited it (false: already credited).
create or replace function public.rp_grant_pack(p_payment text, p_order text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  o razorpay_orders%rowtype;
  v_tokens integer;
  v_rows integer;
begin
  select * into o from razorpay_orders where id = p_order and kind = 'pack' for update;
  if not found then raise exception 'unknown_order'; end if;
  insert into razorpay_payments (payment_id, order_id, user_id, kind) values (p_payment, p_order, o.user_id, 'pack')
  on conflict (payment_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  -- one order pays for one pack, whatever happens with retries
  if o.status = 'paid' then return false; end if;
  select tokens + bonus into v_tokens from token_packs where id = o.item;
  if v_tokens is null then raise exception 'bad_pack'; end if;
  update razorpay_orders set status = 'paid', updated_at = now() where id = p_order;
  perform token_wallet_for(o.user_id);
  perform _tok_credit(o.user_id, v_tokens, 'purchase', o.item);
  return true;
end;
$$;

-- Senevon Plus through Razorpay. p_state: 'active' | 'cancelled' (paid until period end) | 'expired'.
-- p_period_end: end of the period paid so far (Razorpay's current_end).
create or replace function public.rp_set_plus(p_sub text, p_state text, p_period_end timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  o razorpay_orders%rowtype;
  v_sub subscriptions%rowtype;
begin
  select * into o from razorpay_orders where id = p_sub and kind = 'plus' for update;
  if not found then raise exception 'unknown_subscription'; end if;
  update razorpay_orders set status = p_state, updated_at = now() where id = p_sub;

  perform token_wallet_for(o.user_id);
  select * into v_sub from subscriptions where provider = 'razorpay' and provider_ref = p_sub for update;
  if found then
    update subscriptions set
      status = case when p_state = 'expired' or p_period_end <= now() then 'expired' else p_state end,
      period_end = greatest(period_end, p_period_end)
    where id = v_sub.id;
  elsif p_state <> 'expired' and p_period_end > now() then
    -- a new subscription: the first tokens are due straight away
    insert into subscriptions (user_id, plan, status, provider, provider_ref, currency, amount, period_end, next_credit_at)
    values (o.user_id, o.item, p_state, 'razorpay', p_sub, o.currency, o.amount, p_period_end, now());
  end if;
  perform _tok_process_subscription(o.user_id);
end;
$$;

revoke all on function public.rp_grant_pack(text, text) from public, anon, authenticated;
revoke all on function public.rp_set_plus(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rp_grant_pack(text, text) to service_role;
grant execute on function public.rp_set_plus(text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
