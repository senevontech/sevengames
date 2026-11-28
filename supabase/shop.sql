-- ============================================================
-- Senevon shop: cosmetics + boosters bought with tokens (server-authoritative)
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql. Safe to re-run.
--
--   * Cosmetics (kept forever, one equipped per slot):
--       arrow_skin    Arrows: arrow colours / line style
--       arrow_fx      Arrows: effect when an arrow leaves the board
--       frame         ring around the player's avatar (seen by everyone, e.g. leaderboards)
--       chess_board   Chess: board colours        chess_pieces  Chess: piece set
--       ludo_board    Ludo: board theme           ludo_dice     Ludo: dice + token style
--     Some cosmetics need a level in their game first (min_level, from game_xp below).
--   * Game XP (chess, ludo): earned per finished game through award_game_xp(), capped and
--     rate-limited on the server. Level = same curve as Carrom (100, 300, 600 … XP).
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
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club', 'leaderboard'));

-- 1) Catalog ---------------------------------------------------------
create table if not exists public.shop_items (
  item_id text primary key,
  kind text not null,
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

-- Chess + Ludo cosmetics (added later): which game's level unlocks them
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  -- dd_*: DroidDoom (embedded game) unlocks, see droiddoom.sql
  check (kind in ('arrow_skin', 'arrow_fx', 'arrow_board', 'arrow_head', 'frame', 'booster', 'chess_board', 'chess_pieces', 'ludo_board', 'ludo_dice',
                  'dd_levels', 'dd_skin', 'dd_weapon', 'chat_pack', 'ludo_token', 'pool_table', 'pool_cue', 'tune_pack', 'sf_ship', 'sf_sky'));

-- Ludo token colours: 9 free, 4 in the shop (keep ids in sync with LUDO_TOKENS in src/lib/shopCatalog.ts)
insert into public.shop_items (item_id, kind, price, sort) values
  ('ltok:red', 'ludo_token', 0, 0), ('ltok:orange', 'ludo_token', 0, 1), ('ltok:yellow', 'ludo_token', 0, 2),
  ('ltok:lime', 'ludo_token', 0, 3), ('ltok:green', 'ludo_token', 0, 4), ('ltok:teal', 'ludo_token', 0, 5),
  ('ltok:blue', 'ludo_token', 0, 6), ('ltok:purple', 'ludo_token', 0, 7), ('ltok:pink', 'ludo_token', 0, 8),
  ('ltok:gold', 'ludo_token', 1200, 9), ('ltok:neon', 'ludo_token', 1500, 10),
  ('ltok:rainbow', 'ludo_token', 2500, 11), ('ltok:galaxy', 'ludo_token', 3000, 12)
on conflict (item_id) do nothing;
alter table public.shop_items add column if not exists game text;
-- which game's level unlocks an item: chess / ludo (game XP) or arrows (puzzle level reached)
alter table public.shop_items drop constraint if exists shop_items_game_check;
alter table public.shop_items add constraint shop_items_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune', 'lastcard', 'snakeladder'));
alter table public.shop_items add column if not exists min_level integer not null default 1 check (min_level between 1 and 30);
-- Senevon Plus exclusives: members own them for free, nobody else can buy them
alter table public.shop_items add column if not exists plus_only boolean not null default false;

insert into public.shop_items (item_id, kind, price, sort, game, min_level) values
  ('cboard:classic', 'chess_board', 0, 0, 'chess', 1),
  ('cboard:walnut', 'chess_board', 800, 1, 'chess', 1),
  ('cboard:ocean', 'chess_board', 1000, 2, 'chess', 3),
  ('cboard:marble', 'chess_board', 1500, 3, 'chess', 6),
  ('cboard:midnight', 'chess_board', 2200, 4, 'chess', 10),
  ('cpieces:classic', 'chess_pieces', 0, 0, 'chess', 1),
  ('cpieces:flat', 'chess_pieces', 800, 1, 'chess', 1),
  ('cpieces:neon', 'chess_pieces', 1500, 2, 'chess', 5),
  ('cpieces:gold', 'chess_pieces', 2500, 3, 'chess', 12),
  ('lboard:classic', 'ludo_board', 0, 0, 'ludo', 1),
  ('lboard:candy', 'ludo_board', 800, 1, 'ludo', 1),
  ('lboard:night', 'ludo_board', 1200, 2, 'ludo', 4),
  ('lboard:royal', 'ludo_board', 2000, 3, 'ludo', 8),
  ('ldice:classic', 'ludo_dice', 0, 0, 'ludo', 1),
  ('ldice:gem', 'ludo_dice', 900, 1, 'ludo', 2),
  ('ldice:neon', 'ludo_dice', 1400, 2, 'ludo', 5),
  ('ldice:gold', 'ludo_dice', 2200, 3, 'ludo', 10)
on conflict (item_id) do nothing;

-- Pool: tables (looks) and cues (stats: aim / power / spin). Keep ids in sync with POOL_TABLES / POOL_CUES
-- in src/lib/shopCatalog.ts. The pool level comes from pool XP.
insert into public.shop_items (item_id, kind, price, sort, game, min_level) values
  ('ptable:club', 'pool_table', 0, 0, 'pool', 1),
  ('ptable:tournament', 'pool_table', 800, 1, 'pool', 1),
  ('ptable:oak', 'pool_table', 1200, 2, 'pool', 3),
  ('ptable:slate', 'pool_table', 1600, 3, 'pool', 5),
  ('ptable:royal', 'pool_table', 2200, 4, 'pool', 8),
  ('ptable:midnight', 'pool_table', 3000, 5, 'pool', 12),
  ('pcue:house', 'pool_cue', 0, 0, 'pool', 1),
  ('pcue:maple', 'pool_cue', 600, 1, 'pool', 1),
  ('pcue:ebony', 'pool_cue', 1200, 2, 'pool', 3),
  ('pcue:carbon', 'pool_cue', 1800, 3, 'pool', 5),
  ('pcue:royal', 'pool_cue', 2600, 4, 'pool', 8),
  ('pcue:legend', 'pool_cue', 4000, 5, 'pool', 12)
on conflict (item_id) do nothing;

-- Spacefall: ship lines and skies (looks only, every ship flies the same; no level lock). Keep ids
-- in sync with SF_SHIPS / SF_SKIES in src/lib/shopCatalog.ts.
insert into public.shop_items (item_id, kind, price, sort) values
  ('sfship:aegis', 'sf_ship', 0, 0),
  ('sfship:viper', 'sf_ship', 600, 1),
  ('sfship:phantom', 'sf_ship', 1200, 2),
  ('sfship:lancer', 'sf_ship', 1800, 3),
  ('sfship:reaper', 'sf_ship', 2500, 4),
  ('sfship:titan', 'sf_ship', 3500, 5),
  ('sfsky:journey', 'sf_sky', 0, 0),
  ('sfsky:legion', 'sf_sky', 500, 1),
  ('sfsky:crab', 'sf_sky', 900, 2),
  ('sfsky:mystic', 'sf_sky', 1300, 3),
  ('sfsky:cliffs', 'sf_sky', 1800, 4)
on conflict (item_id) do nothing;

-- Draw a Tune unlocks (nothing to equip: owning one unlocks it for making songs; anyone can always
-- listen to songs that use them). Keep ids in sync with TUNE_ITEMS in src/lib/shopCatalog.ts.
insert into public.shop_items (item_id, kind, price, sort, game, min_level) values
  ('tinst:guitar', 'tune_pack', 900, 0, 'tune', 1),
  ('tinst:flute', 'tune_pack', 900, 1, 'tune', 1),
  ('tinst:synth', 'tune_pack', 1000, 2, 'tune', 1),
  ('tinst:sitar', 'tune_pack', 1200, 3, 'tune', 1),
  ('tinst:tabla', 'tune_pack', 1200, 4, 'tune', 1),
  ('tbeat:trap', 'tune_pack', 600, 5, 'tune', 1),
  ('tbeat:house', 'tune_pack', 600, 6, 'tune', 1),
  ('tbeat:dembow', 'tune_pack', 600, 7, 'tune', 1),
  ('tscale:world', 'tune_pack', 800, 8, 'tune', 1),
  ('tfx:echo', 'tune_pack', 700, 9, 'tune', 1)
on conflict (item_id) do nothing;
-- saving / sharing a song is free: the old "Save as audio" item is retired
delete from public.shop_items where item_id = 'tfx:export' and not exists (select 1 from public.shop_owned where item_id = 'tfx:export');
update public.shop_items set active = false where item_id = 'tfx:export';

-- Arrows: more styles + effects, board themes and arrowhead shapes (Arrows level = puzzle level reached)
insert into public.shop_items (item_id, kind, price, sort, game, min_level) values
  ('skin:ink', 'arrow_skin', 600, 5, 'arrows', 1),
  ('skin:ice', 'arrow_skin', 1000, 6, 'arrows', 5),
  ('skin:chalk', 'arrow_skin', 1200, 7, 'arrows', 5),
  ('skin:lava', 'arrow_skin', 1600, 8, 'arrows', 10),
  ('skin:rainbow', 'arrow_skin', 2600, 9, 'arrows', 20),
  ('fx:bubbles', 'arrow_fx', 700, 4, 'arrows', 1),
  ('fx:petals', 'arrow_fx', 1000, 5, 'arrows', 5),
  ('fx:confetti', 'arrow_fx', 1300, 6, 'arrows', 5),
  ('fx:lightning', 'arrow_fx', 1800, 7, 'arrows', 10),
  ('fx:fireworks', 'arrow_fx', 2600, 8, 'arrows', 20),
  ('board:classic', 'arrow_board', 0, 0, 'arrows', 1),
  ('board:paper', 'arrow_board', 600, 1, 'arrows', 1),
  ('board:blueprint', 'arrow_board', 1000, 2, 'arrows', 5),
  ('board:wood', 'arrow_board', 1400, 3, 'arrows', 10),
  ('board:sunset', 'arrow_board', 1800, 4, 'arrows', 10),
  ('board:space', 'arrow_board', 2600, 5, 'arrows', 20),
  ('head:classic', 'arrow_head', 0, 0, 'arrows', 1),
  ('head:chevron', 'arrow_head', 600, 1, 'arrows', 1),
  ('head:dot', 'arrow_head', 800, 2, 'arrows', 1),
  ('head:bold', 'arrow_head', 1000, 3, 'arrows', 5),
  ('head:diamond', 'arrow_head', 1600, 4, 'arrows', 10),
  ('head:star', 'arrow_head', 2200, 5, 'arrows', 20)
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
alter table public.player_cosmetics add column if not exists chess_board text;
alter table public.player_cosmetics add column if not exists chess_pieces text;
alter table public.player_cosmetics add column if not exists ludo_board text;
alter table public.player_cosmetics add column if not exists ludo_dice text;
alter table public.player_cosmetics add column if not exists arrow_board text;
alter table public.player_cosmetics add column if not exists arrow_head text;
alter table public.player_cosmetics add column if not exists ludo_token text;
alter table public.player_cosmetics add column if not exists pool_table text;
alter table public.player_cosmetics add column if not exists pool_cue text;
alter table public.player_cosmetics add column if not exists sf_ship text;
alter table public.player_cosmetics add column if not exists sf_sky text;

-- XP per game (chess, ludo, arrows, pool). Carrom keeps its own (carrom.sql).
create table if not exists public.game_xp (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune', 'lastcard', 'snakeladder')),
  xp integer not null default 0 check (xp >= 0),
  last_award timestamptz,
  primary key (user_id, game)
);
-- (tables made earlier: keep the game list current — same list as matches.sql)
alter table public.game_xp drop constraint if exists game_xp_game_check;
alter table public.game_xp add constraint game_xp_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune', 'lastcard', 'snakeladder'));
alter table public.game_xp enable row level security;
drop policy if exists "Own game xp" on public.game_xp;
create policy "Own game xp" on public.game_xp for select to authenticated using (auth.uid() = user_id);

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
-- Level from XP: total XP for level L is 50·L·(L−1) (100, 300, 600 …), max 30. Same as Carrom.
create or replace function public._game_level(p_xp integer)
returns integer language sql immutable as $$
  select least(30, greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 50.0)) / 2)::integer))
$$;

create or replace function public._game_xp(p_user uuid, p_game text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select xp from game_xp where user_id = p_user and game = p_game), 0)
$$;
-- A player's level in a game, for level-locked items. Arrows: the puzzle level reached
-- (game_progress, progress.sql); chess / ludo: from game XP.
create or replace function public._shop_level(p_user uuid, p_game text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v integer;
begin
  if p_game = 'arrows' then
    begin
      select level into v from game_progress where user_id = p_user and game_id = 'arrows';
    exception when undefined_table then
      v := null; -- progress.sql not run yet
    end;
    return greatest(1, coalesce(v, 1));
  end if;
  return _game_level(_game_xp(p_user, p_game));
end;
$$;

-- Senevon Plus member right now (a running subscription, or a Pro member)
create or replace function public._is_plus(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v boolean;
begin
  select exists (
    select 1 from subscriptions where user_id = p_user and status in ('active', 'cancelled') and period_end > now()
  ) into v;
  if v then return true; end if;
  if to_regclass('public.pro_members') is not null then
    execute 'select exists (select 1 from public.pro_members where user_id = $1)' into v using p_user;
  end if;
  return coalesce(v, false);
end;
$$;

create or replace function public._shop_free(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from token_unlimited where user_id = p_user)
$$;

create or replace function public._shop_owns(p_user uuid, p_item text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_items where item_id = p_item and price = 0 and kind <> 'booster' and not plus_only)
    or exists (select 1 from shop_owned where user_id = p_user and item_id = p_item)
    or (exists (select 1 from shop_items where item_id = p_item and plus_only) and _is_plus(p_user))
$$;

create or replace function public._shop_state(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'owned', coalesce((select jsonb_agg(item_id) from (
      select item_id from shop_owned where user_id = p_user
      union select item_id from shop_items where plus_only and _is_plus(p_user)) o), '[]'::jsonb),
    'plus', _is_plus(p_user),
    'inventory', jsonb_build_object(
      'arrows_hint', coalesce((select count from shop_inventory where user_id = p_user and item = 'arrows_hint'), 0),
      'arrows_undo', coalesce((select count from shop_inventory where user_id = p_user and item = 'arrows_undo'), 0)
    ),
    'equipped', coalesce((
      select jsonb_build_object(
        'frame', frame, 'arrow_skin', arrow_skin, 'arrow_fx', arrow_fx,
        'chess_board', chess_board, 'chess_pieces', chess_pieces, 'ludo_board', ludo_board, 'ludo_dice', ludo_dice,
        'arrow_board', arrow_board, 'arrow_head', arrow_head, 'ludo_token', ludo_token,
        'pool_table', pool_table, 'pool_cue', pool_cue, 'sf_ship', sf_ship, 'sf_sky', sf_sky
      ) from player_cosmetics where user_id = p_user
    ), '{}'::jsonb),
    'xp', jsonb_build_object('chess', _game_xp(p_user, 'chess'), 'ludo', _game_xp(p_user, 'ludo'), 'arrows', _game_xp(p_user, 'arrows'), 'pool', _game_xp(p_user, 'pool'), 'chain', _game_xp(p_user, 'chain'), 'tune', _game_xp(p_user, 'tune'), 'lastcard', _game_xp(p_user, 'lastcard'), 'snakeladder', _game_xp(p_user, 'snakeladder')),
    'levels', jsonb_build_object('arrows', _shop_level(p_user, 'arrows')),
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
  if r.plus_only then raise exception 'plus_only'; end if;
  -- no level gate: chips buy any item (min_level is now only a hint shown in the shop)
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

-- Equip an owned cosmetic in its slot (the item's kind, e.g. 'frame', 'chess_board'); null = take it off.
create or replace function public.shop_equip(p_slot text, p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_slot not in ('frame', 'arrow_skin', 'arrow_fx', 'arrow_board', 'arrow_head', 'chess_board', 'chess_pieces', 'ludo_board', 'ludo_dice', 'ludo_token', 'pool_table', 'pool_cue', 'sf_ship', 'sf_sky') then
    raise exception 'bad_slot';
  end if;
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
    arrow_board = case when p_slot = 'arrow_board' then p_item else arrow_board end,
    arrow_head = case when p_slot = 'arrow_head' then p_item else arrow_head end,
    chess_board = case when p_slot = 'chess_board' then p_item else chess_board end,
    chess_pieces = case when p_slot = 'chess_pieces' then p_item else chess_pieces end,
    ludo_board = case when p_slot = 'ludo_board' then p_item else ludo_board end,
    ludo_dice = case when p_slot = 'ludo_dice' then p_item else ludo_dice end,
    ludo_token = case when p_slot = 'ludo_token' then p_item else ludo_token end,
    pool_table = case when p_slot = 'pool_table' then p_item else pool_table end,
    pool_cue = case when p_slot = 'pool_cue' then p_item else pool_cue end,
    sf_ship = case when p_slot = 'sf_ship' then p_item else sf_ship end,
    sf_sky = case when p_slot = 'sf_sky' then p_item else sf_sky end,
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

-- XP for one finished game. The client reports it, so the server caps it (a win is ~150) and
-- accepts at most one award every 20 seconds per game.
create or replace function public.award_game_xp(p_game text, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_last timestamptz;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('chess', 'ludo', 'pool', 'lastcard', 'snakeladder') then raise exception 'bad_game'; end if;
  insert into game_xp (user_id, game) values (v_user, p_game) on conflict do nothing;
  select last_award into v_last from game_xp where user_id = v_user and game = p_game for update;
  if v_last is null or v_last < now() - interval '20 seconds' then
    update game_xp set xp = xp + greatest(0, least(coalesce(p_amount, 0), 200)), last_award = now()
    where user_id = v_user and game = p_game;
  end if;
  return _shop_state(v_user);
end;
$$;

revoke all on function public._game_level(integer) from public, anon, authenticated;
revoke all on function public._game_xp(uuid, text) from public, anon, authenticated;
revoke all on function public.award_game_xp(text, integer) from public, anon;
grant execute on function public.award_game_xp(text, integer) to authenticated;
revoke all on function public._shop_free(uuid) from public, anon, authenticated;
revoke all on function public._is_plus(uuid) from public, anon, authenticated;
revoke all on function public._shop_level(uuid, text) from public, anon, authenticated;
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
