-- ============================================================
-- Carrom shop + striker upgrades (server-authoritative)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql (pro.sql is optional). Safe to re-run.
--
--   * XP / level, owned items, equipped items and striker upgrades live here, not in
--     user metadata (which players can edit). The browser only calls the RPCs below.
--   * Items (strikers, coin sets, boards) are bought with tokens. Top items need a
--     minimum player level first. Pro members own every item; unlimited (redeem-code)
--     accounts pay nothing.
--   * Each striker has three stats (power, weight, aim), level 1-10 = its base level
--     plus bought upgrade steps. Upgrades to level 7+ need a minimum player level.
--   * XP is granted per finished match through carrom_award_xp(), capped and rate-limited.
-- ============================================================

-- token ledger: allow 'carrom' spends (keep this list in sync with tokens.sql, adfree.sql and shop.sql)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament'));

-- 1) Catalog ---------------------------------------------------------
create table if not exists public.carrom_catalog (
  kind text not null check (kind in ('striker', 'coins', 'board')),
  item_id text not null,
  price integer not null default 0 check (price >= 0),
  min_level integer not null default 1,
  legacy_level integer,                 -- level it used to unlock at (owners keep it); null = was Pro-only
  base_power integer not null default 1,
  base_weight integer not null default 1,
  base_aim integer not null default 1,
  primary key (kind, item_id)
);

insert into public.carrom_catalog (kind, item_id, price, min_level, legacy_level, base_power, base_weight, base_aim) values
  ('striker', 'classic', 0, 1, 1, 1, 1, 1),
  ('striker', 'maple', 250, 1, 3, 2, 2, 3),
  ('striker', 'ocean', 400, 1, 5, 2, 1, 4),
  ('striker', 'carbon', 600, 3, 8, 2, 4, 2),
  ('striker', 'neon', 900, 5, 12, 4, 2, 2),
  ('striker', 'gold', 1400, 8, 16, 3, 3, 3),
  ('striker', 'galaxy', 2500, 12, null, 4, 3, 4),
  ('striker', 'lava', 3000, 15, null, 5, 4, 2),
  ('coins', 'classic', 0, 1, 1, 1, 1, 1),
  ('coins', 'marble', 200, 1, 4, 1, 1, 1),
  ('coins', 'pearl', 350, 1, 7, 1, 1, 1),
  ('coins', 'jade', 550, 3, 10, 1, 1, 1),
  ('coins', 'neon', 800, 5, 14, 1, 1, 1),
  ('coins', 'royal', 1800, 10, null, 1, 1, 1),
  ('coins', 'crystal', 2200, 12, null, 1, 1, 1),
  ('board', 'classic', 0, 1, 1, 1, 1, 1),
  ('board', 'tournament', 500, 1, null, 1, 1, 1),
  ('board', 'midnight', 1200, 6, null, 1, 1, 1)
on conflict (kind, item_id) do update set
  price = excluded.price, min_level = excluded.min_level, legacy_level = excluded.legacy_level,
  base_power = excluded.base_power, base_weight = excluded.base_weight, base_aim = excluded.base_aim;

alter table public.carrom_catalog enable row level security;
drop policy if exists "Public carrom catalog" on public.carrom_catalog;
create policy "Public carrom catalog" on public.carrom_catalog for select to anon, authenticated using (true);

-- 2) Player state ----------------------------------------------------
create table if not exists public.carrom_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  striker text not null default 'classic',
  coins text not null default 'classic',
  board text not null default 'classic',
  last_xp_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.carrom_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  item_id text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

create table if not exists public.carrom_striker_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  striker text not null,
  power integer not null default 0 check (power >= 0),   -- bought upgrade steps
  weight integer not null default 0 check (weight >= 0),
  aim integer not null default 0 check (aim >= 0),
  primary key (user_id, striker)
);

alter table public.carrom_profiles enable row level security;
alter table public.carrom_owned enable row level security;
alter table public.carrom_striker_stats enable row level security;
drop policy if exists "Own carrom profile" on public.carrom_profiles;
create policy "Own carrom profile" on public.carrom_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own carrom items" on public.carrom_owned;
create policy "Own carrom items" on public.carrom_owned for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own striker stats" on public.carrom_striker_stats;
create policy "Own striker stats" on public.carrom_striker_stats for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: changes only through the functions below.

-- 3) Rules (keep in sync with src/games/carrom/stats.ts) ---------------
create or replace function public._carrom_level(p_xp integer)
returns integer language sql immutable as $$
  -- total XP for level L is 50 * L * (L - 1)
  select greatest(1, least(30, floor((1 + sqrt(1 + 0.08 * greatest(p_xp, 0))) / 2)::integer))
$$;

create or replace function public._carrom_upgrade_cost(p_target integer)
returns integer language sql immutable as $$
  select case p_target
    when 2 then 80 when 3 then 120 when 4 then 180 when 5 then 260 when 6 then 360
    when 7 then 500 when 8 then 700 when 9 then 950 when 10 then 1300
  end
$$;

-- player level needed to raise a stat to p_target ("high power" tiers)
create or replace function public._carrom_upgrade_gate(p_target integer)
returns integer language sql immutable as $$
  select case when p_target >= 10 then 14 when p_target = 9 then 10 when p_target = 8 then 7 when p_target = 7 then 4 else 1 end
$$;

-- Pro membership lives in pro.sql, which may not have been run: no table = nobody is Pro.
-- (plpgsql + dynamic SQL, so creating this function doesn't need the table to exist.)
create or replace function public._carrom_pro(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v boolean := false;
begin
  if to_regclass('public.pro_members') is null then return false; end if;
  execute 'select exists (select 1 from public.pro_members where user_id = $1)' into v using p_user;
  return v;
end;
$$;

create or replace function public._carrom_free(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from token_unlimited where user_id = p_user)
$$;

create or replace function public._carrom_owns(p_user uuid, p_kind text, p_item text)
returns boolean language sql stable security definer set search_path = public as $$
  select _carrom_pro(p_user)
    or exists (select 1 from carrom_catalog where kind = p_kind and item_id = p_item and price = 0)
    or exists (select 1 from carrom_owned where user_id = p_user and kind = p_kind and item_id = p_item)
$$;

create or replace function public._carrom_state(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'xp', p.xp,
    'level', _carrom_level(p.xp),
    'striker', p.striker,
    'coins', p.coins,
    'board', p.board,
    'pro', _carrom_pro(p_user),
    'free', _carrom_free(p_user),
    'owned', coalesce((select jsonb_agg(kind || ':' || item_id) from carrom_owned where user_id = p_user), '[]'::jsonb),
    'upgrades', coalesce((
      select jsonb_object_agg(striker, jsonb_build_object('power', power, 'weight', weight, 'aim', aim))
      from carrom_striker_stats where user_id = p_user
    ), '{}'::jsonb),
    'tokens', coalesce((select balance from token_wallets where user_id = p_user), 0)
  )
  from carrom_profiles p where p.user_id = p_user
$$;

-- 4) Player-callable functions ----------------------------------------

-- Load (and on first call create) the player's carrom state. Players who earned items by
-- level before the shop existed keep them; their old XP carries over (capped).
create or replace function public.carrom_state()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_raw text;
  v_xp integer := 0;
  v_rows integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from carrom_profiles where user_id = v_user) then
    select raw_user_meta_data -> 'carrom' ->> 'xp' into v_raw from auth.users where id = v_user;
    if v_raw ~ '^\d{1,9}$' then v_xp := least(v_raw::integer, 4500); end if;  -- 4,500 XP = level 10
    insert into carrom_profiles (user_id, xp) values (v_user, v_xp) on conflict (user_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      insert into carrom_owned (user_id, kind, item_id)
      select v_user, kind, item_id from carrom_catalog
      where legacy_level is not null and legacy_level <= _carrom_level(v_xp) and price > 0
      on conflict do nothing;
    end if;
  end if;
  return _carrom_state(v_user);
end;
$$;

create or replace function public.carrom_buy(p_kind text, p_item text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_price integer;
  v_min integer;
  v_xp integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform carrom_state();
  select price, min_level into v_price, v_min from carrom_catalog where kind = p_kind and item_id = p_item;
  if v_price is null then raise exception 'bad_item'; end if;
  if _carrom_owns(v_user, p_kind, p_item) then return _carrom_state(v_user); end if;
  select xp into v_xp from carrom_profiles where user_id = v_user;
  if _carrom_level(v_xp) < v_min then raise exception 'level_required'; end if;
  if not _carrom_free(v_user) and v_price > 0 then
    perform token_wallet(); -- wallet exists, signup bonus in
    perform _tok_credit(v_user, -v_price, 'carrom', p_kind || ':' || p_item); -- raises insufficient_tokens
  end if;
  insert into carrom_owned (user_id, kind, item_id) values (v_user, p_kind, p_item) on conflict do nothing;
  return _carrom_state(v_user);
end;
$$;

create or replace function public.carrom_upgrade(p_striker text, p_stat text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_base integer;
  v_steps integer;
  v_target integer;
  v_cost integer;
  v_xp integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_stat not in ('power', 'weight', 'aim') then raise exception 'bad_stat'; end if;
  perform carrom_state();
  if not _carrom_owns(v_user, 'striker', p_striker) then raise exception 'not_owned'; end if;
  select case p_stat when 'power' then base_power when 'weight' then base_weight else base_aim end
    into v_base from carrom_catalog where kind = 'striker' and item_id = p_striker;
  if v_base is null then raise exception 'bad_item'; end if;

  insert into carrom_striker_stats (user_id, striker) values (v_user, p_striker) on conflict do nothing;
  select case p_stat when 'power' then power when 'weight' then weight else aim end
    into v_steps from carrom_striker_stats where user_id = v_user and striker = p_striker for update;

  v_target := v_base + v_steps + 1;
  if v_target > 10 then raise exception 'max_level'; end if;
  select xp into v_xp from carrom_profiles where user_id = v_user;
  if _carrom_level(v_xp) < _carrom_upgrade_gate(v_target) then raise exception 'level_required'; end if;

  v_cost := _carrom_upgrade_cost(v_target);
  if not _carrom_free(v_user) then
    perform token_wallet();
    perform _tok_credit(v_user, -v_cost, 'carrom', 'upgrade:' || p_striker || ':' || p_stat || ':' || v_target);
  end if;

  update carrom_striker_stats set
    power = power + (p_stat = 'power')::integer,
    weight = weight + (p_stat = 'weight')::integer,
    aim = aim + (p_stat = 'aim')::integer
  where user_id = v_user and striker = p_striker;
  return _carrom_state(v_user);
end;
$$;

create or replace function public.carrom_select(p_kind text, p_item text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform carrom_state();
  if not _carrom_owns(v_user, p_kind, p_item) then raise exception 'not_owned'; end if;
  update carrom_profiles set
    striker = case when p_kind = 'striker' then p_item else striker end,
    coins = case when p_kind = 'coins' then p_item else coins end,
    board = case when p_kind = 'board' then p_item else board end
  where user_id = v_user;
  return _carrom_state(v_user);
end;
$$;

-- XP for one finished match. The client reports it, so the server caps it (a perfect win is
-- about 300) and accepts at most one award every 30 seconds.
create or replace function public.carrom_award_xp(p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform carrom_state();
  update carrom_profiles
    set xp = xp + least(greatest(coalesce(p_amount, 0), 0), 450), last_xp_at = now()
    where user_id = v_user and (last_xp_at is null or last_xp_at < now() - interval '30 seconds');
  return _carrom_state(v_user);
end;
$$;

revoke all on function public._carrom_state(uuid) from public, anon, authenticated;
revoke all on function public._carrom_owns(uuid, text, text) from public, anon, authenticated;
revoke all on function public._carrom_pro(uuid) from public, anon, authenticated;
revoke all on function public._carrom_free(uuid) from public, anon, authenticated;
revoke all on function public.carrom_state() from public, anon;
revoke all on function public.carrom_buy(text, text) from public, anon;
revoke all on function public.carrom_upgrade(text, text) from public, anon;
revoke all on function public.carrom_select(text, text) from public, anon;
revoke all on function public.carrom_award_xp(integer) from public, anon;
grant execute on function public.carrom_state() to authenticated;
grant execute on function public.carrom_buy(text, text) to authenticated;
grant execute on function public.carrom_upgrade(text, text) to authenticated;
grant execute on function public.carrom_select(text, text) to authenticated;
grant execute on function public.carrom_award_xp(integer) to authenticated;
