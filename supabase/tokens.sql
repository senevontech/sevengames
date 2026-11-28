-- ============================================================
-- Senevon Tokens: wallet, per-play pricing, subscriptions, ad rewards
-- Run in: Supabase Dashboard → SQL Editor (after schema.sql and admin.sql)
--
-- Security model
--   * Players can READ their own wallet, ledger, subscription and ad views,
--     and anyone can read game prices and plan prices.
--   * Nobody writes these tables from the browser. Every balance change goes through
--     the SECURITY DEFINER functions below, which check the rules on the server:
--       token_wallet()          creates the wallet, grants the 100 signup bonus once,
--                               and credits any subscription tokens that are due
--       spend_for_play(game)    charges the game's price for one play
--       start_ad_view(...)      opens an ad view (daily cap checked)
--       claim_ad_reward(view)   pays 50 tokens if the ad stayed open long enough
--       mock_subscribe(...)     TEST checkout, only while payments_mode = "mock"
--       cancel_subscription()
--       redeem_code(code)       developer / admin code → unlimited tokens (code is stored
--                               hashed, set from the admin panel, 5 wrong tries per hour)
--   * Admin changes (prices, grants, payments mode) go through the `admin` Edge Function
--     with the service-role key.
--
-- IMPORTANT before launch: switch site_settings.payments_mode to "live" (admin panel →
-- Tokens). In "mock" mode anyone signed in can "subscribe" for free.
-- ============================================================

-- 0) Settings ---------------------------------------------------
insert into public.site_settings (key, value) values
  ('payments_mode', '"mock"'::jsonb)
on conflict (key) do nothing;

-- 1) Wallets + ledger --------------------------------------------
create table if not exists public.token_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club')),
  ref text,
  created_at timestamptz not null default now()
);

create index if not exists token_ledger_user_time on public.token_ledger (user_id, created_at desc);

-- Earned vs bought chips. `balance` is every chip; `earned` is the part that did NOT come from a
-- purchase or a subscription. Only earned chips can pay match entries (entries.sql) or be gifted, so chips bought
-- with money never ride on a game result or change hands. Ordinary spending (shop, premium
-- plays, ad-free) uses earned chips first. Always 0 <= earned <= balance.
alter table public.token_wallets add column if not exists earned integer not null default 0;
alter table public.token_wallets drop constraint if exists token_wallets_earned_check;
alter table public.token_wallets add constraint token_wallets_earned_check check (earned >= 0 and earned <= balance);
-- the signup bonus can only ever be granted once per account
create unique index if not exists token_ledger_one_signup on public.token_ledger (user_id) where reason = 'signup';
-- databases created before guest carry-over existed: widen the reason check
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club', 'leaderboard'));
-- guest tokens can only be carried over once per account
create unique index if not exists token_ledger_one_guest on public.token_ledger (user_id) where reason = 'guest';
-- each subscription credit is unique (stops double credits if two requests race)
create unique index if not exists token_ledger_sub_ref on public.token_ledger (ref) where reason = 'subscription';

-- One-time: wallets from before the split. Everything except what was bought is earned
-- (assume purchases are still unspent, the cautious reading).
do $$
begin
  if not exists (select 1 from public.site_settings where key = 'chips_earned_split') then
    update public.token_wallets w set earned = greatest(0, w.balance - coalesce((
      select sum(l.delta) from public.token_ledger l
      where l.user_id = w.user_id and l.reason in ('purchase', 'subscription') and l.delta > 0
    ), 0));
    insert into public.site_settings (key, value) values ('chips_earned_split', 'true'::jsonb);
  end if;
end $$;

-- 2) Prices --------------------------------------------------------
create table if not exists public.game_prices (
  game_id text primary key,
  cost integer not null default 0 check (cost >= 0),   -- tokens per play; 0 = free
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_prices (
  currency text not null,                               -- ISO 4217, e.g. INR
  plan text not null check (plan in ('monthly', 'yearly')),
  amount numeric(10, 2) not null check (amount > 0),
  primary key (currency, plan)
);

insert into public.plan_prices (currency, plan, amount) values
  ('INR', 'monthly', 49), ('INR', 'yearly', 399),
  ('USD', 'monthly', 0.99), ('USD', 'yearly', 7.99),
  ('EUR', 'monthly', 0.99), ('EUR', 'yearly', 7.49),
  ('GBP', 'monthly', 0.99), ('GBP', 'yearly', 6.99)
on conflict (currency, plan) do nothing;

-- 3) Subscriptions -------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  status text not null check (status in ('active', 'cancelled', 'expired')),
  provider text not null default 'mock',
  provider_ref text,
  currency text not null,
  amount numeric(10, 2) not null,
  started_at timestamptz not null default now(),
  period_end timestamptz not null,       -- end of the paid period
  next_credit_at timestamptz not null,   -- when the next 5,000 tokens are due
  created_at timestamptz not null default now()
);

-- one running (active or cancelled-but-paid) subscription per player
create unique index if not exists subscriptions_one_running
  on public.subscriptions (user_id) where status in ('active', 'cancelled');

-- 4) Ad views ------------------------------------------------------
create table if not exists public.ad_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('network', 'house')),
  ad_id uuid,
  started_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists ad_views_user_time on public.ad_views (user_id, started_at desc);

-- 4b) Redeem code → unlimited tokens ----------------------------------
create extension if not exists pgcrypto with schema extensions;

-- server-only secrets (the redeem code's bcrypt hash). No policies: unreadable from the browser.
create table if not exists public.token_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.token_unlimited (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  via text not null default 'code',
  granted_at timestamptz not null default now()
);

create table if not exists public.redeem_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists redeem_attempts_user_time on public.redeem_attempts (user_id, created_at desc);

-- 5) Row level security -------------------------------------------
alter table public.token_wallets enable row level security;
alter table public.token_ledger enable row level security;
alter table public.game_prices enable row level security;
alter table public.plan_prices enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ad_views enable row level security;
alter table public.token_secrets enable row level security;
alter table public.token_unlimited enable row level security;
alter table public.redeem_attempts enable row level security;

drop policy if exists "Own wallet" on public.token_wallets;
create policy "Own wallet" on public.token_wallets for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own ledger" on public.token_ledger;
create policy "Own ledger" on public.token_ledger for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own subscriptions" on public.subscriptions;
create policy "Own subscriptions" on public.subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own ad views" on public.ad_views;
create policy "Own ad views" on public.ad_views for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own unlimited status" on public.token_unlimited;
create policy "Own unlimited status" on public.token_unlimited for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Public game prices" on public.game_prices;
create policy "Public game prices" on public.game_prices for select to anon, authenticated using (true);
drop policy if exists "Public plan prices" on public.plan_prices;
create policy "Public plan prices" on public.plan_prices for select to anon, authenticated using (true);
-- No insert / update / delete policies on purpose.

-- 6) Constants -----------------------------------------------------
create or replace function public._tok_const(p_name text)
returns integer language sql immutable as $$
  select case p_name
    when 'signup_bonus' then 100
    when 'guest_tokens' then 25      -- starting balance of a guest's browser wallet
    when 'sub_tokens' then 5000      -- per month, both plans
    when 'ad_reward' then 50
    when 'ad_daily_cap' then 10
    when 'ad_min_seconds' then 12    -- house ads run 15 s; network ads are usually longer
  end
$$;

-- 7) Internal helpers (not callable from the browser) ----------------
create or replace function public._tok_credit(p_user uuid, p_delta integer, p_reason text, p_ref text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_balance integer;
  v_earned integer;
begin
  insert into token_wallets (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  select balance, earned into v_balance, v_earned from token_wallets where user_id = p_user for update;
  if p_delta >= 0 then
    -- bought chips stay out of `earned`; everything else (rewards, wins, gifts, refunds) is earned
    if p_reason not in ('purchase', 'subscription') then v_earned := v_earned + p_delta; end if;
  elsif p_reason in ('entry', 'gift', 'club') then
    -- fees, gifts and club wallet deposits: earned chips only
    if v_earned + p_delta < 0 then raise exception 'insufficient_earned'; end if;
    v_earned := v_earned + p_delta;
  else
    -- ordinary spending: earned chips first
    if v_balance + p_delta < 0 then raise exception 'insufficient_tokens'; end if;
    v_earned := greatest(0, v_earned + p_delta);
  end if;
  v_balance := v_balance + p_delta;
  v_earned := least(v_earned, v_balance);
  update token_wallets set balance = v_balance, earned = v_earned, updated_at = now() where user_id = p_user;
  insert into token_ledger (user_id, delta, balance_after, reason, ref)
  values (p_user, p_delta, v_balance, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Credits subscription tokens that are due (5,000 each month). In mock mode an active
-- subscription renews itself at the end of each paid period, as a real auto-renewal would.
create or replace function public._tok_process_subscription(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s subscriptions%rowtype;
  guard integer := 0;
begin
  select * into s from subscriptions
  where user_id = p_user and status in ('active', 'cancelled')
  for update;
  if not found then return; end if;

  while s.next_credit_at <= now() and guard < 48 loop
    guard := guard + 1;
    if s.next_credit_at >= s.period_end then
      if s.status = 'active' and s.provider = 'mock' then
        s.period_end := s.period_end + (case s.plan when 'monthly' then interval '1 month' else interval '1 year' end);
      else
        s.status := 'expired';
        exit;
      end if;
    end if;
    begin
      perform _tok_credit(p_user, _tok_const('sub_tokens'), 'subscription', s.id::text || ':' || to_char(s.next_credit_at, 'YYYY-MM-DD"T"HH24:MI:SS'));
    exception when unique_violation then
      null; -- already credited by a concurrent request
    end;
    s.next_credit_at := s.next_credit_at + interval '1 month';
  end loop;

  -- a cancelled subscription ends once its paid period is over
  if s.status = 'cancelled' and s.period_end <= now() then
    s.status := 'expired';
  end if;

  update subscriptions
  set status = s.status, period_end = s.period_end, next_credit_at = s.next_credit_at
  where id = s.id;
end;
$$;

create or replace function public._tok_ads_today(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from ad_views
  where user_id = p_user and claimed_at is not null and claimed_at >= date_trunc('day', now())
$$;

create or replace function public._tok_state(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'balance', coalesce((select balance from token_wallets where user_id = p_user), 0),
    'earned', coalesce((select earned from token_wallets where user_id = p_user), 0),
    'unlimited', exists (select 1 from token_unlimited where user_id = p_user),
    'subscription', (
      select to_jsonb(x) from (
        select id, plan, status, provider, currency, amount, started_at, period_end, next_credit_at
        from subscriptions where user_id = p_user and status in ('active', 'cancelled')
        order by created_at desc limit 1
      ) x
    ),
    'ads_today', _tok_ads_today(p_user),
    'ad_daily_cap', _tok_const('ad_daily_cap'),
    'ad_reward', _tok_const('ad_reward'),
    'ad_min_seconds', _tok_const('ad_min_seconds'),
    'sub_tokens', _tok_const('sub_tokens'),
    'payments_mode', coalesce((select value #>> '{}' from site_settings where key = 'payments_mode'), 'mock')
  )
$$;

-- 8) Player-callable functions ---------------------------------------

-- Wallet state. First call for an account grants the signup bonus (once, ever).
create or replace function public.token_wallet()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from token_ledger where user_id = v_user and reason = 'signup') then
    begin
      perform _tok_credit(v_user, _tok_const('signup_bonus'), 'signup', 'welcome');
    exception when unique_violation then
      null;
    end;
  end if;
  perform _tok_process_subscription(v_user);
  return _tok_state(v_user);
end;
$$;

-- Pay for one play of a game. Free games (no price row, or cost 0) cost nothing.
create or replace function public.spend_for_play(p_game text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cost integer;
  v_balance integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select cost into v_cost from game_prices where game_id = p_game;
  v_cost := coalesce(v_cost, 0);
  perform token_wallet(); -- make sure the wallet exists and due subscription tokens are in
  -- unlimited accounts (redeem code) never pay
  if v_cost = 0 or exists (select 1 from token_unlimited where user_id = v_user) then
    return jsonb_build_object('ok', true, 'cost', 0) || _tok_state(v_user);
  end if;
  select balance into v_balance from token_wallets where user_id = v_user;
  if coalesce(v_balance, 0) < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'cost', v_cost) || _tok_state(v_user);
  end if;
  perform _tok_credit(v_user, -v_cost, 'play', p_game);
  return jsonb_build_object('ok', true, 'cost', v_cost) || _tok_state(v_user);
end;
$$;

-- Open an ad view. Returns its id; the reward is claimed with claim_ad_reward().
create or replace function public.start_ad_view(p_source text, p_ad uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_source not in ('network', 'house') then raise exception 'bad_source'; end if;
  if _tok_ads_today(v_user) >= _tok_const('ad_daily_cap') then raise exception 'ad_cap_reached'; end if;
  -- One open view per player: an ad that was closed early (or opened twice) is reused and its
  -- clock restarts, instead of piling up views until new ones are refused. The minimum watch
  -- time still counts from this new start, so a reused view can't be claimed any sooner.
  select id into v_id from ad_views
    where user_id = v_user and claimed_at is null and started_at > now() - interval '30 minutes'
    order by started_at desc limit 1
    for update;
  if v_id is not null then
    update ad_views set started_at = now(), source = p_source, ad_id = p_ad where id = v_id;
    -- tidy away any older unclaimed views
    delete from ad_views where user_id = v_user and claimed_at is null and id <> v_id;
    return v_id;
  end if;
  insert into ad_views (user_id, source, ad_id) values (v_user, p_source, p_ad) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_ad_reward(p_view uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v ad_views%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into v from ad_views where id = p_view and user_id = v_user for update;
  if not found then raise exception 'unknown_ad_view'; end if;
  if v.claimed_at is not null then raise exception 'already_claimed'; end if;
  if now() - v.started_at < make_interval(secs => _tok_const('ad_min_seconds')) then
    raise exception 'ad_not_finished';
  end if;
  if v.started_at < now() - interval '30 minutes' then raise exception 'ad_view_expired'; end if;
  if _tok_ads_today(v_user) >= _tok_const('ad_daily_cap') then raise exception 'ad_cap_reached'; end if;
  update ad_views set claimed_at = now() where id = p_view;
  perform _tok_credit(v_user, _tok_const('ad_reward'), 'ad', p_view::text);
  return _tok_state(v_user);
end;
$$;

-- TEST checkout. Refuses unless payments_mode is "mock". A real provider will create
-- subscriptions from its webhook (service role) instead.
create or replace function public.mock_subscribe(p_plan text, p_currency text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_mode text;
  v_amount numeric(10, 2);
  v_currency text := upper(coalesce(p_currency, 'USD'));
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select value #>> '{}' into v_mode from site_settings where key = 'payments_mode';
  if coalesce(v_mode, 'mock') <> 'mock' then raise exception 'mock_payments_disabled'; end if;
  if p_plan not in ('monthly', 'yearly') then raise exception 'bad_plan'; end if;

  perform token_wallet();
  if exists (select 1 from subscriptions where user_id = v_user and status in ('active', 'cancelled')) then
    raise exception 'already_subscribed';
  end if;

  select amount into v_amount from plan_prices where currency = v_currency and plan = p_plan;
  if v_amount is null then
    v_currency := 'USD';
    select amount into v_amount from plan_prices where currency = 'USD' and plan = p_plan;
  end if;

  insert into subscriptions (user_id, plan, status, provider, currency, amount, period_end, next_credit_at)
  values (
    v_user, p_plan, 'active', 'mock', v_currency, coalesce(v_amount, 0),
    now() + (case p_plan when 'monthly' then interval '1 month' else interval '1 year' end),
    now()
  );
  perform _tok_process_subscription(v_user); -- first 5,000 tokens straight away
  return _tok_state(v_user);
end;
$$;

-- Stop renewing. Tokens already paid for keep arriving until the paid period ends
-- (a yearly plan keeps its monthly drops for the rest of the year).
create or replace function public.cancel_subscription()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  update subscriptions set status = 'cancelled' where user_id = v_user and status = 'active';
  perform _tok_process_subscription(v_user);
  return _tok_state(v_user);
end;
$$;

-- Redeem the developer / admin code. A correct code makes the account unlimited.
-- Wrong codes are recorded (not raised, so the record survives) and limited to 5 per hour.
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_code text := btrim(coalesce(p_code, ''));
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from token_unlimited where user_id = v_user) then
    return jsonb_build_object('ok', true) || _tok_state(v_user);
  end if;
  if (select count(*) from redeem_attempts
      where user_id = v_user and not ok and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  select value into v_hash from token_secrets where key = 'redeem_code_hash';
  if v_hash is null or v_code = '' or extensions.crypt(v_code, v_hash) <> v_hash then
    insert into redeem_attempts (user_id, ok) values (v_user, false);
    return jsonb_build_object('ok', false, 'reason', case when v_hash is null then 'no_code_set' else 'bad_code' end);
  end if;
  insert into redeem_attempts (user_id, ok) values (v_user, true);
  insert into token_unlimited (user_id, email, via)
  values (v_user, (select email from auth.users where id = v_user), 'code')
  on conflict (user_id) do nothing;
  perform token_wallet();
  return jsonb_build_object('ok', true) || _tok_state(v_user);
end;
$$;

-- Set / change the redeem code (service role only — admin panel). Stored as a bcrypt hash.
create or replace function public.admin_set_redeem_code(p_code text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if length(btrim(coalesce(p_code, ''))) < 6 then raise exception 'code_too_short'; end if;
  insert into token_secrets (key, value, updated_at)
  values ('redeem_code_hash', extensions.crypt(btrim(p_code), extensions.gen_salt('bf', 10)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Admin grant (service role only — used by the admin Edge Function).
create or replace function public.admin_grant_tokens(p_user uuid, p_amount integer, p_note text)
returns integer
language plpgsql security definer set search_path = public
as $$
begin
  return _tok_credit(p_user, p_amount, 'admin', left(coalesce(p_note, ''), 200));
end;
$$;

-- 9) Permissions ----------------------------------------------------
revoke all on function public._tok_credit(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public._tok_process_subscription(uuid) from public, anon, authenticated;
revoke all on function public._tok_ads_today(uuid) from public, anon, authenticated;
revoke all on function public._tok_state(uuid) from public, anon, authenticated;
revoke all on function public.admin_grant_tokens(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_grant_tokens(uuid, integer, text) to service_role;
revoke all on function public.admin_set_redeem_code(text) from public, anon, authenticated;
grant execute on function public.admin_set_redeem_code(text) to service_role;
revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

revoke all on function public.token_wallet() from public, anon;
revoke all on function public.spend_for_play(text) from public, anon;
revoke all on function public.start_ad_view(text, uuid) from public, anon;
revoke all on function public.claim_ad_reward(uuid) from public, anon;
revoke all on function public.mock_subscribe(text, text) from public, anon;
revoke all on function public.cancel_subscription() from public, anon;
grant execute on function public.token_wallet() to authenticated;
grant execute on function public.spend_for_play(text) to authenticated;
grant execute on function public.start_ad_view(text, uuid) to authenticated;
grant execute on function public.claim_ad_reward(uuid) to authenticated;
grant execute on function public.mock_subscribe(text, text) to authenticated;
grant execute on function public.cancel_subscription() to authenticated;

-- 9) Guest carry-over -------------------------------------------------
-- Guests play premium games from a 25-chip wallet kept in their browser. On sign-in the
-- unspent amount moves to the account. The browser reports the amount, so it is capped at
-- the guest starting balance and credited at most once per account.
create or replace function public.claim_guest_tokens(p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_amount integer := least(greatest(coalesce(p_amount, 0), 0), _tok_const('guest_tokens'));
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform token_wallet(); -- signup bonus first
  if v_amount > 0 and not exists (select 1 from token_ledger where user_id = v_user and reason = 'guest') then
    begin
      perform _tok_credit(v_user, v_amount, 'guest', 'carry-over');
    exception when unique_violation then
      null;
    end;
  end if;
  return _tok_state(v_user);
end;
$$;

revoke all on function public.claim_guest_tokens(integer) from public, anon;
grant execute on function public.claim_guest_tokens(integer) to authenticated;

-- 10) Token packs (one-off purchases) ---------------------------------
create table if not exists public.token_packs (
  id text primary key,                 -- e.g. 'starter'
  tokens integer not null check (tokens > 0),
  bonus integer not null default 0 check (bonus >= 0),   -- extra tokens on top
  sort integer not null default 0,
  active boolean not null default true
);

create table if not exists public.pack_prices (
  pack text not null references public.token_packs(id) on delete cascade,
  currency text not null,              -- ISO 4217
  amount numeric(10, 2) not null check (amount > 0),
  primary key (pack, currency)
);

insert into public.token_packs (id, tokens, bonus, sort) values
  ('starter', 500, 0, 1),
  ('player', 1200, 200, 2),
  ('pro', 3000, 750, 3),
  ('legend', 7500, 2500, 4)
on conflict (id) do nothing;

insert into public.pack_prices (pack, currency, amount) values
  ('starter', 'INR', 29), ('player', 'INR', 59), ('pro', 'INR', 129), ('legend', 'INR', 299),
  ('starter', 'USD', 0.49), ('player', 'USD', 0.99), ('pro', 'USD', 1.99), ('legend', 'USD', 4.99),
  ('starter', 'EUR', 0.49), ('player', 'EUR', 0.99), ('pro', 'EUR', 1.99), ('legend', 'EUR', 4.49),
  ('starter', 'GBP', 0.45), ('player', 'GBP', 0.89), ('pro', 'GBP', 1.79), ('legend', 'GBP', 3.99)
on conflict (pack, currency) do nothing;

alter table public.token_packs enable row level security;
alter table public.pack_prices enable row level security;
drop policy if exists "Public token packs" on public.token_packs;
create policy "Public token packs" on public.token_packs for select to anon, authenticated using (active);
drop policy if exists "Public pack prices" on public.pack_prices;
create policy "Public pack prices" on public.pack_prices for select to anon, authenticated using (true);

-- TEST purchase of a pack. Refuses unless payments_mode is "mock". A real provider will
-- credit packs from its webhook (service role) instead.
create or replace function public.mock_buy_pack(p_pack text, p_currency text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_mode text;
  v_tokens integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select value #>> '{}' into v_mode from site_settings where key = 'payments_mode';
  if coalesce(v_mode, 'mock') <> 'mock' then raise exception 'mock_payments_disabled'; end if;
  select tokens + bonus into v_tokens from token_packs where id = p_pack and active;
  if v_tokens is null then raise exception 'bad_pack'; end if;
  perform token_wallet();
  perform _tok_credit(v_user, v_tokens, 'purchase', p_pack);
  return _tok_state(v_user);
end;
$$;

revoke all on function public.mock_buy_pack(text, text) from public, anon;
grant execute on function public.mock_buy_pack(text, text) to authenticated;
