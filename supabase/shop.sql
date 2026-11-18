-- ============================================================
-- Senevon shop: cosmetics + boosters bought with tokens (server-authoritative)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql. Safe to re-run.
--
--   * Cosmetics (kept forever, one equipped per slot):
--       arrow_skin  Arrows: arrow colours / line style
--       arrow_fx    Arrows: effect when an arrow leaves the board
--       frame       ring around the player's avatar (seen by everyone, e.g. leaderboards)
--   * Boosters (packs into an inventory, used one at a time):
--       arrows_hint, arrows_undo
--   * Prices live in shop_items and can be changed from the admin panel (Tokens tab).
--     Items with price 0 are free for everyone (the defaults). Unlimited (redeem-code)
--     accounts pay nothing.
--   * The browser only reads; every change goes through the functions below.
--   * Keep item ids in sync with src/lib/shopCatalog.ts.
-- ============================================================

-- token ledger: allow 'shop' (keep this list in sync with tokens.sql, adfree.sql and carrom.sql)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop'));

-- 1) Catalog ---------------------------------------------------------
create table if not exists public.shop_items (
  item_id text primary key,
  kind text not null check (kind in ('arrow_skin', 'arrow_fx', 'frame', 'booster')),
  price integer not null default 0 check (price >= 0 and price <= 1000000),
  -- boosters: which inventory counter a purchase fills, and by how much
  grants text check (grants in ('arrows_hint', 'arrows_undo')),
  qty integer not null default 1 check (qty between 1 and 1000),
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Default prices. On re-run only new items are added: prices changed in the admin panel stay.
insert into public.shop_items (item_id, kind, price, grants, qty, sort) values
  ('skin:classic', 'arrow_skin', 0, null, 1, 0),
  ('skin:pastel', 'arrow_skin', 800, null, 1, 1),
  ('skin:neon', 'arrow_skin', 1500, null, 1, 2),
  ('skin:midnight', 'arrow_skin', 1500, null, 1, 3),
  ('skin:gold', 'arrow_skin', 2500, null, 1, 4),
  ('fx:wave', 'arrow_fx', 0, null, 1, 0),
  ('fx:pulse', 'arrow_fx', 1000, null, 1, 1),
  ('fx:ink', 'arrow_fx', 1200, null, 1, 2),
  ('fx:starburst', 'arrow_fx', 1800, null, 1, 3),
  ('frame:ember', 'frame', 800, null, 1, 0),
  ('frame:neon', 'frame', 1200, null, 1, 1),
  ('frame:gold', 'frame', 2000, null, 1, 2),
  ('frame:galaxy', 'frame', 3000, null, 1, 3),
  ('pack:hint5', 'booster', 300, 'arrows_hint', 5, 0),
  ('pack:hint20', 'booster', 1000, 'arrows_hint', 20, 1),
  ('pack:undo5', 'booster', 400, 'arrows_undo', 5, 2),
  ('pack:undo20', 'booster', 1300, 'arrows_undo', 20, 3)
on conflict (item_id) do nothing;

alter table public.shop_items enable row level security;
drop policy if exists "Public shop catalog" on public.shop_items;
create policy "Public shop catalog" on public.shop_items for select to anon, authenticated using (true);

-- 2) Player state ----------------------------------------------------
create table if not exists public.shop_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.shop_items(item_id) on delete cascade,
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.shop_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null check (item in ('arrows_hint', 'arrows_undo')),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, item)
);

-- Equipped cosmetics. Public: other players see your avatar frame on the leaderboards.
create table if not exists public.player_cosmetics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  frame text,
  arrow_skin text,
  arrow_fx text,
  updated_at timestamptz not null default now()
);

alter table public.shop_owned enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.player_cosmetics enable row level security;

drop policy if exists "Own shop items" on public.shop_owned;
create policy "Own shop items" on public.shop_owned for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own shop inventory" on public.shop_inventory;
create policy "Own shop inventory" on public.shop_inventory for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Public cosmetics" on public.player_cosmetics;
create policy "Public cosmetics" on public.player_cosmetics for select to anon, authenticated using (true);
-- No insert / update / delete policies: changes only through the functions below.

-- 3) Helpers (not callable from the browser) ---------------------------
create or replace function public._shop_free(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from token_unlimited where user_id = p_user)
$$;

create or replace function public._shop_owns(p_user uuid, p_item text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_items where item_id = p_item and price = 0 and kind <> 'booster')
    or exists (select 1 from shop_owned where user_id = p_user and item_id = p_item)
$$;

create or replace function public._shop_state(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'owned', coalesce((select jsonb_agg(item_id) from shop_owned where user_id = p_user), '[]'::jsonb),
    'inventory', jsonb_build_object(
      'arrows_hint', coalesce((select count from shop_inventory where user_id = p_user and item = 'arrows_hint'), 0),
      'arrows_undo', coalesce((select count from shop_inventory where user_id = p_user and item = 'arrows_undo'), 0)
    ),
    'equipped', jsonb_build_object(
      'frame', (select frame from player_cosmetics where user_id = p_user),
      'arrow_skin', (select arrow_skin from player_cosmetics where user_id = p_user),
      'arrow_fx', (select arrow_fx from player_cosmetics where user_id = p_user)
    ),
    'free', _shop_free(p_user),
    'tokens', coalesce((select balance from token_wallets where user_id = p_user), 0)
  )
$$;

-- 4) Player-callable functions ----------------------------------------
create or replace function public.shop_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  return _shop_state(v_user);
end;
$$;

-- Buy one item. Cosmetics: owned forever (buying again does nothing). Boosters: adds the pack's
-- quantity to the inventory every time.
create or replace function public.shop_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r shop_items%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from shop_items where item_id = p_item and active;
  if not found then raise exception 'bad_item'; end if;
  if r.kind <> 'booster' and _shop_owns(v_user, p_item) then return _shop_state(v_user); end if;
  if r.price > 0 and not _shop_free(v_user) then
    perform token_wallet(); -- wallet exists, signup bonus in
    perform _tok_credit(v_user, -r.price, 'shop', p_item); -- raises insufficient_tokens
  end if;
  if r.kind = 'booster' then
    insert into shop_inventory (user_id, item, count) values (v_user, r.grants, r.qty)
    on conflict (user_id, item) do update set count = shop_inventory.count + excluded.count;
  else
    insert into shop_owned (user_id, item_id) values (v_user, p_item) on conflict do nothing;
  end if;
  return _shop_state(v_user);
end;
$$;

-- Equip an owned cosmetic in its slot ('frame' | 'arrow_skin' | 'arrow_fx'); null = take it off.
create or replace function public.shop_equip(p_slot text, p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_slot not in ('frame', 'arrow_skin', 'arrow_fx') then raise exception 'bad_slot'; end if;
  if p_item is not null then
    select kind into v_kind from shop_items where item_id = p_item;
    if v_kind is distinct from p_slot then raise exception 'bad_item'; end if;
    if not _shop_owns(v_user, p_item) then raise exception 'not_owned'; end if;
  end if;
  insert into player_cosmetics (user_id) values (v_user) on conflict (user_id) do nothing;
  update player_cosmetics set
    frame = case when p_slot = 'frame' then p_item else frame end,
    arrow_skin = case when p_slot = 'arrow_skin' then p_item else arrow_skin end,
    arrow_fx = case when p_slot = 'arrow_fx' then p_item else arrow_fx end,
    updated_at = now()
  where user_id = v_user;
  return _shop_state(v_user);
end;
$$;

-- Use one booster from the inventory ('arrows_hint' | 'arrows_undo').
create or replace function public.shop_use(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  update shop_inventory set count = count - 1 where user_id = v_user and item = p_item and count > 0;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'none_left'; end if;
  return _shop_state(v_user);
end;
$$;

revoke all on function public._shop_free(uuid) from public, anon, authenticated;
revoke all on function public._shop_owns(uuid, text) from public, anon, authenticated;
revoke all on function public._shop_state(uuid) from public, anon, authenticated;
revoke all on function public.shop_state() from public, anon;
revoke all on function public.shop_buy(text) from public, anon;
revoke all on function public.shop_equip(text, text) from public, anon;
revoke all on function public.shop_use(text) from public, anon;
grant execute on function public.shop_state() to authenticated;
grant execute on function public.shop_buy(text) to authenticated;
grant execute on function public.shop_equip(text, text) to authenticated;
grant execute on function public.shop_use(text) to authenticated;

notify pgrst, 'reload schema';
