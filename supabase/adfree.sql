-- ============================================================
-- Ad-free pass: 85 tokens per 30 days, auto-renewing (can be cancelled)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql. Safe to re-run.
--
--   * ad_free_state()  → is this player ad-free, why, until when, does it renew.
--                        Also takes the renewal payment when a pass has run out.
--   * ad_free_buy()    → start a pass (85 tokens), or switch renewal back on.
--   * ad_free_cancel() → stop renewing; the paid days still count.
--   * Free for: active token subscribers, Pro members, unlimited (redeem-code) accounts.
--   * Renewal is taken when the player next opens the site after expiry. If they can't
--     afford it, the pass lapses and renewal switches OFF (so it never surprises them later).
-- ============================================================

-- token ledger: allow 'adfree' (keep this list in sync with tokens.sql, carrom.sql and shop.sql)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop'));

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
  if found and v_pass.auto_renew and v_pass.expires_at <= now() and v_perk is null then
    select balance into v_balance from token_wallets where user_id = p_user;
    if coalesce(v_balance, 0) >= _adfree_price() then
      perform _tok_credit(p_user, -_adfree_price(), 'adfree', 'renew');
      update ad_free_passes
        set expires_at = case when v_pass.expires_at + interval '30 days' > now()
                              then v_pass.expires_at + interval '30 days'
                              else now() + interval '30 days' end,
            updated_at = now()
        where user_id = p_user
        returning * into v_pass;
    else
      update ad_free_passes set auto_renew = false, updated_at = now() where user_id = p_user returning * into v_pass;
    end if;
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
  -- a pass still running: just switch renewal back on
  if exists (select 1 from ad_free_passes where user_id = v_user and expires_at > now()) then
    update ad_free_passes set auto_renew = true, updated_at = now() where user_id = v_user;
    return _adfree_state(v_user);
  end if;
  perform token_wallet(); -- wallet exists, signup bonus in
  perform _tok_credit(v_user, -_adfree_price(), 'adfree', 'start'); -- raises insufficient_tokens
  insert into ad_free_passes (user_id, expires_at, auto_renew)
  values (v_user, now() + interval '30 days', true)
  on conflict (user_id) do update set expires_at = now() + interval '30 days', auto_renew = true, updated_at = now();
  return _adfree_state(v_user);
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
