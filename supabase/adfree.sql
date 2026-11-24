-- ============================================================
-- Ad-free: NOT for chips any more. Ad-free comes only with real-money plans: Senevon Plus
-- (subscription), the Google Play ad-free subscription (play.sql writes the pass), Pro and
-- unlimited accounts. Passes bought with chips earlier run until they expire and never renew.
--
-- (History: this used to be an 85-token pass per 30 days, auto-renewing.)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql. Safe to re-run.
--
--   * ad_free_state()  → is this player ad-free, why, until when. Switches off any old
--                        chip renewal; chips are never taken.
--   * ad_free_buy()    → kept for old app versions: returns the state if the player already
--                        has a perk, otherwise refuses with 'adfree_not_for_chips'.
--   * ad_free_cancel() → stop renewing; the remaining days still count.
--   * Free for: active Plus subscribers, Pro members, unlimited (redeem-code) accounts.
-- ============================================================

-- token ledger: allow 'adfree' (keep this list in sync with tokens.sql, carrom.sql and shop.sql)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club'));

create table if not exists public.ad_free_passes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  auto_renew boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ad_free_passes enable row level security;
drop policy if exists "Own ad-free pass" on public.ad_free_passes;
create policy "Own ad-free pass" on public.ad_free_passes for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: changes only through the functions below.

create or replace function public._adfree_price()
returns integer language sql immutable as $$ select 85 $$;

-- Why a player is ad-free without a pass ('unlimited' | 'subscriber' | 'pro'), or null.
create or replace function public._adfree_perk(p_user uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pro boolean := false;
begin
  if exists (select 1 from token_unlimited where user_id = p_user) then return 'unlimited'; end if;
  if exists (
    select 1 from subscriptions
    where user_id = p_user and status in ('active', 'cancelled') and period_end > now()
  ) then
    return 'subscriber';
  end if;
  -- pro.sql is optional
  if to_regclass('public.pro_members') is not null then
    execute 'select exists (select 1 from public.pro_members where user_id = $1)' into v_pro using p_user;
    if v_pro then return 'pro'; end if;
  end if;
  return null;
end;
$$;

-- Take a due renewal (once), then report the state.
create or replace function public._adfree_state(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_perk text := _adfree_perk(p_user);
  v_pass ad_free_passes%rowtype;
  v_balance integer;
begin
  select * into v_pass from ad_free_passes where user_id = p_user for update;
  -- chips never renew a pass: switch any old chip renewal off
  if found and v_pass.auto_renew then
    update ad_free_passes set auto_renew = false, updated_at = now() where user_id = p_user returning * into v_pass;
  end if;

  return jsonb_build_object(
    'active', v_perk is not null or (v_pass.user_id is not null and v_pass.expires_at > now()),
    'reason', coalesce(v_perk, case when v_pass.user_id is not null and v_pass.expires_at > now() then 'pass' end),
    'expires_at', v_pass.expires_at,
    'auto_renew', coalesce(v_pass.auto_renew, false),
    'price', _adfree_price()
  );
end;
$$;

create or replace function public.ad_free_state()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  return _adfree_state(v_user);
end;
$$;

create or replace function public.ad_free_buy()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  -- already ad-free through a subscription / Pro / unlimited: nothing to pay
  if _adfree_perk(v_user) is not null then return _adfree_state(v_user); end if;
  -- ad-free can't be bought with chips: only with Senevon Plus or the Play subscription
  raise exception 'adfree_not_for_chips';
end;
$$;

create or replace function public.ad_free_cancel()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  update ad_free_passes set auto_renew = false, updated_at = now() where user_id = v_user;
  return _adfree_state(v_user);
end;
$$;

revoke all on function public._adfree_perk(uuid) from public, anon, authenticated;
revoke all on function public._adfree_state(uuid) from public, anon, authenticated;
revoke all on function public.ad_free_state() from public, anon;
revoke all on function public.ad_free_buy() from public, anon;
revoke all on function public.ad_free_cancel() from public, anon;
grant execute on function public.ad_free_state() to authenticated;
grant execute on function public.ad_free_buy() to authenticated;
grant execute on function public.ad_free_cancel() to authenticated;
