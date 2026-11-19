-- ============================================================
-- Android app: Google Play Billing + AdMob rewarded ads (server side)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql and adfree.sql. Safe to re-run.
--
--   * The app never credits anything itself. It sends a Google Play purchase token to the
--     `play-billing` Edge Function, which asks Google whether the purchase is real and belongs to
--     this player, then calls the functions below (service role only):
--       play_grant_pack   one-time token pack (each purchase token credits once)
--       play_set_plus     the 5,000-tokens-a-month subscription; its paid period follows
--                         Google's expiry date, so tokens.sql's monthly credit keeps working
--       play_set_adfree   ad-free; the pass end date follows Google's expiry date
--   * Rewarded ads: AdMob calls the `admob-ssv` Edge Function, which checks Google's signature
--     and then calls admob_reward (each AdMob transaction rewards once; daily cap as on the web).
-- ============================================================

create table if not exists public.play_purchases (
  purchase_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  kind text not null check (kind in ('pack', 'plus', 'adfree')),
  order_id text,
  state text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists play_purchases_user_idx on public.play_purchases (user_id);
alter table public.play_purchases enable row level security;
drop policy if exists "Own play purchases" on public.play_purchases;
create policy "Own play purchases" on public.play_purchases for select to authenticated using (auth.uid() = user_id);

create table if not exists public.admob_rewards (
  transaction_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  view_id uuid,
  created_at timestamptz not null default now()
);
alter table public.admob_rewards enable row level security;
-- no policies: server only

-- a one-time token pack. Returns true when this call credited it.
create or replace function public.play_grant_pack(p_user uuid, p_token text, p_product text, p_pack text, p_order text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
  v_tokens integer;
begin
  select tokens + bonus into v_tokens from token_packs where id = p_pack;
  if v_tokens is null then raise exception 'bad_pack'; end if;
  insert into play_purchases (purchase_token, user_id, product_id, kind, order_id, state)
  values (p_token, p_user, p_product, 'pack', p_order, 'purchased')
  on conflict (purchase_token) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  perform token_wallet_for(p_user);
  perform _tok_credit(p_user, v_tokens, 'purchase', p_pack);
  return true;
end;
$$;

-- wallet + signup bonus for a player (token_wallet() works on auth.uid(); this is its server twin)
create or replace function public.token_wallet_for(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into token_wallets (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  if not exists (select 1 from token_ledger where user_id = p_user and reason = 'signup') then
    begin
      perform _tok_credit(p_user, _tok_const('signup_bonus'), 'signup', 'welcome');
    exception when unique_violation then null;
    end;
  end if;
end;
$$;

-- the monthly token subscription. p_state: 'active' | 'cancelled' (paid until expiry) | 'expired'
create or replace function public.play_set_plus(p_user uuid, p_token text, p_product text, p_plan text, p_expiry timestamptz, p_state text, p_order text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub subscriptions%rowtype;
begin
  if p_plan not in ('monthly', 'yearly') then raise exception 'bad_plan'; end if;
  insert into play_purchases (purchase_token, user_id, product_id, kind, order_id, state, expires_at)
  values (p_token, p_user, p_product, 'plus', p_order, p_state, p_expiry)
  on conflict (purchase_token) do update set state = excluded.state, expires_at = excluded.expires_at, updated_at = now();

  perform token_wallet_for(p_user);
  select * into v_sub from subscriptions where provider = 'google_play' and provider_ref = p_token for update;
  if found then
    update subscriptions set
      status = case when p_state = 'expired' or p_expiry <= now() then 'expired' else p_state end,
      period_end = greatest(period_end, p_expiry),
      plan = p_plan
    where id = v_sub.id;
  elsif p_state <> 'expired' and p_expiry > now() then
    -- a new subscription: the first 5,000 tokens are due straight away
    insert into subscriptions (user_id, plan, status, provider, provider_ref, currency, amount, period_end, next_credit_at)
    values (p_user, p_plan, p_state, 'google_play', p_token, 'PLAY', 0, p_expiry, now());
  end if;
  perform _tok_process_subscription(p_user);
end;
$$;

-- ad-free through Google Play: the pass lasts as long as the Play subscription is paid
create or replace function public.play_set_adfree(p_user uuid, p_token text, p_product text, p_expiry timestamptz, p_state text, p_order text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into play_purchases (purchase_token, user_id, product_id, kind, order_id, state, expires_at)
  values (p_token, p_user, p_product, 'adfree', p_order, p_state, p_expiry)
  on conflict (purchase_token) do update set state = excluded.state, expires_at = excluded.expires_at, updated_at = now();
  if p_state = 'expired' or p_expiry <= now() then return; end if;
  -- auto_renew off: Google renews it, never the token wallet
  insert into ad_free_passes (user_id, expires_at, auto_renew)
  values (p_user, p_expiry, false)
  on conflict (user_id) do update set expires_at = greatest(ad_free_passes.expires_at, excluded.expires_at), auto_renew = false, updated_at = now();
end;
$$;

-- a verified AdMob rewarded-ad view. Returns true when tokens were credited.
create or replace function public.admob_reward(p_user uuid, p_view uuid, p_txn text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v ad_views%rowtype;
  v_rows integer;
begin
  insert into admob_rewards (transaction_id, user_id, view_id) values (p_txn, p_user, p_view)
  on conflict (transaction_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if; -- AdMob retried a callback we already handled

  select * into v from ad_views where id = p_view and user_id = p_user for update;
  if not found or v.claimed_at is not null or v.started_at < now() - interval '2 hours' then return false; end if;
  if _tok_ads_today(p_user) >= _tok_const('ad_daily_cap') then return false; end if;
  update ad_views set claimed_at = now() where id = p_view;
  perform _tok_credit(p_user, _tok_const('ad_reward'), 'ad', p_txn);
  return true;
end;
$$;

-- server only (Edge Functions use the service role)
revoke all on function public.play_grant_pack(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.token_wallet_for(uuid) from public, anon, authenticated;
revoke all on function public.play_set_plus(uuid, text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.play_set_adfree(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.admob_reward(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.play_grant_pack(uuid, text, text, text, text) to service_role;
grant execute on function public.token_wallet_for(uuid) to service_role;
grant execute on function public.play_set_plus(uuid, text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.play_set_adfree(uuid, text, text, timestamptz, text, text) to service_role;
grant execute on function public.admob_reward(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
