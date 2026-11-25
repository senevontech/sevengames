-- ============================================================
-- Last Card online: 2–4 players in a room, server-dealt. No chips.
-- Run in: Supabase Dashboard → SQL Editor, AFTER shop.sql (game_xp). Safe to re-run.
--
-- The server holds the deck and every hand; the browser only asks for the room's state
-- (lc_state: your own hand + how many cards the others hold) and sends moves. The rules are the
-- same as src/games/lastcard/engine.ts (card ids 0–107 numbered the same way):
--   match the colour or the number/symbol; Skip, Reverse, +2, Wild, Wild +4;
--   house rules chosen by the room's host: stack +2/+4 (on by default), 7-swap / 0-pass,
--   draw until you can play. Say "Last card!" when you play your second-last card, or draw 2.
-- A turn lasts 25 s; out of time = draw (and pass). Three missed turns in a row, or 60 s without
-- checking in, and you're out of the game (your cards go back under the deck). The game ends when
-- someone plays their last card, or when only one player is left.
-- XP: 40 for a win, 10 for finishing a game (game_xp 'lastcard').
-- ============================================================

-- XP for lastcard (keep this game list in sync with shop.sql, matches.sql, chain.sql and tune.sql)
alter table public.game_xp drop constraint if exists game_xp_game_check;
alter table public.game_xp add constraint game_xp_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune', 'lastcard'));

create table if not exists public.lc_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4}$'),
  private boolean not null default false,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'over')),
  host uuid references auth.users(id) on delete set null,
  rules jsonb not null default '{"stack": true, "sevenZero": false, "drawUntil": false}',
  deck smallint[] not null default '{}',     -- secret
  discard smallint[] not null default '{}',  -- the top card is the last one
  color integer not null default 0,
  turn integer,
  dir integer not null default 1 check (dir in (-1, 1)),
  pending integer not null default 0,
  pend_kind integer not null default 0,
  drawn smallint,                            -- the card the player to move just drew
  winner integer,
  last jsonb,
  seq integer not null default 0,
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lc_seats (
  room_id uuid not null references public.lc_rooms(id) on delete cascade,
  seat integer not null check (seat between 0 and 19), -- 0–3 (10+ only for a moment while seats close up)
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Player',
  avatar jsonb,
  hand smallint[] not null default '{}',     -- secret (only its owner sees it)
  called boolean not null default false,
  out boolean not null default false,
  timeouts integer not null default 0,
  seen_at timestamptz not null default now(),
  primary key (room_id, seat)
);
-- one room at a time
create unique index if not exists lc_seats_one_room on public.lc_seats (user_id);

alter table public.lc_rooms enable row level security;
alter table public.lc_seats enable row level security;
-- No policies: the browser never reads these tables directly (the deck and hands are in there).

/* ---------------- cards ---------------- */
create or replace function public._lc_c(p integer) returns integer language sql immutable as $$
  select case when p >= 100 then 4 else p / 25 end
$$;
create or replace function public._lc_v(p integer) returns integer language sql immutable as $$
  select case
    when p >= 104 then 14
    when p >= 100 then 13
    when p % 25 = 0 then 0
    when p % 25 <= 18 then (p % 25 + 1) / 2
    when p % 25 <= 20 then 10
    when p % 25 <= 22 then 11
    else 12 end
$$;
create or replace function public._lc_points(p_hand smallint[]) returns integer language sql immutable as $$
  select coalesce(sum(case when _lc_v(x) <= 9 then _lc_v(x) when _lc_v(x) <= 12 then 20 else 50 end), 0)::integer from unnest(p_hand) x
$$;
create or replace function public._lc_shuffle(p smallint[]) returns smallint[] language sql volatile as $$
  select coalesce(array_agg(x order by random()), '{}') from unnest(p) x
$$;
create or replace function public._lc_sort(p smallint[]) returns smallint[] language sql immutable as $$
  select coalesce(array_agg(x order by _lc_c(x), _lc_v(x), x), '{}') from unnest(p) x
$$;

create or replace function public._lc_new_code()
returns text language plpgsql as $$
declare
  v text;
  abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  loop
    v := '';
    for i in 1 .. 4 loop
      v := v || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    exit when not exists (select 1 from lc_rooms where code = v);
  end loop;
  return v;
end;
$$;

/* ---------------- what each player may see ---------------- */
create or replace function public._lc_view(p_id uuid, p_user uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'code', r.code,
    'private', r.private,
    'status', r.status,
    'host', r.host = p_user,
    'rules', r.rules,
    'top', r.discard[cardinality(r.discard)],
    'under', to_jsonb(r.discard[greatest(1, cardinality(r.discard) - 2):greatest(0, cardinality(r.discard) - 1)]),
    'color', r.color,
    'turn', r.turn,
    'dir', r.dir,
    'pending', r.pending,
    'pend_kind', r.pend_kind,
    'drawn', case when me.seat = r.turn then r.drawn end,
    'deck', cardinality(r.deck),
    'winner', r.winner,
    'points', case when r.status = 'over' then (select coalesce(sum(_lc_points(s.hand)), 0) from lc_seats s where s.room_id = r.id and s.seat is distinct from r.winner) end,
    'last', r.last,
    'seq', r.seq,
    'ms_left', case when r.deadline is null then null else greatest(0, floor(extract(epoch from (r.deadline - now())) * 1000))::bigint end,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('seat', s.seat, 'user_id', s.user_id, 'name', s.name, 'avatar', s.avatar,
        'count', cardinality(s.hand), 'called', s.called, 'out', s.out) order by s.seat)
      from lc_seats s where s.room_id = r.id), '[]'::jsonb),
    'me', me.seat,
    'hand', coalesce(to_jsonb(_lc_sort(me.hand)), '[]'::jsonb)
  )
  from lc_rooms r
  left join lc_seats me on me.room_id = r.id and me.user_id = p_user
  where r.id = p_id
$$;

/* ---------------- moving the game on ---------------- */
-- the next seat still in the game, `p_steps` places on in direction `p_dir`
create or replace function public._lc_next(p_room uuid, p_from integer, p_dir integer, p_steps integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
  s integer := p_from;
  k integer := 0;
  guard integer;
begin
  select max(seat) + 1 into n from lc_seats where room_id = p_room;
  if n is null then return 0; end if;
  while k < p_steps loop
    guard := 0;
    loop
      s := ((s + p_dir) % n + n) % n;
      guard := guard + 1;
      exit when guard > n or exists (select 1 from lc_seats where room_id = p_room and seat = s and not out);
    end loop;
    k := k + 1;
  end loop;
  return s;
end;
$$;

-- `p_seat` takes cards from the deck (the played cards are shuffled back in when it runs out)
create or replace function public._lc_take(p_room uuid, p_seat integer, p_count integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r lc_rooms%rowtype;
  got smallint;
  n integer := 0;
begin
  for i in 1 .. greatest(0, p_count) loop
    select * into r from lc_rooms where id = p_room;
    if cardinality(r.deck) = 0 then
      exit when cardinality(r.discard) <= 1;
      update lc_rooms set deck = _lc_shuffle(r.discard[1:cardinality(r.discard) - 1]), discard = array[r.discard[cardinality(r.discard)]]
      where id = p_room;
      select * into r from lc_rooms where id = p_room;
    end if;
    got := r.deck[cardinality(r.deck)];
    update lc_rooms set deck = r.deck[1:cardinality(r.deck) - 1] where id = p_room;
    update lc_seats set hand = array_append(hand, got), called = false where room_id = p_room and seat = p_seat;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public._lc_can(r lc_rooms, p_card integer)
returns boolean language plpgsql stable as $$
declare
  c integer := _lc_c(p_card);
  v integer := _lc_v(p_card);
  top integer := r.discard[cardinality(r.discard)];
begin
  if r.drawn is not null and p_card <> r.drawn then return false; end if;
  if r.pending > 0 then
    if not coalesce((r.rules ->> 'stack')::boolean, true) then return false; end if;
    return (v = 12 and r.pend_kind = 2) or v = 14;
  end if;
  if c = 4 or c = r.color then return true; end if;
  return _lc_c(top) <> 4 and _lc_v(top) = v;
end;
$$;

create or replace function public._lc_xp(p_user uuid, p_amount integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into game_xp (user_id, game) values (p_user, 'lastcard') on conflict do nothing;
  update game_xp set xp = xp + p_amount, last_award = now() where user_id = p_user and game = 'lastcard';
end;
$$;

create or replace function public._lc_finish(p_room uuid, p_winner integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  s lc_seats%rowtype;
begin
  update lc_rooms set status = 'over', winner = p_winner, deadline = null, pending = 0, pend_kind = 0, drawn = null, seq = seq + 1, updated_at = now()
  where id = p_room;
  for s in select * from lc_seats where room_id = p_room loop
    perform _lc_xp(s.user_id, case when s.seat = p_winner then 40 when s.out then 0 else 10 end);
  end loop;
end;
$$;

-- one player is left: they win
create or replace function public._lc_check_end(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n integer;
  w integer;
begin
  if (select status from lc_rooms where id = p_room) <> 'playing' then return; end if;
  select count(*), min(seat) into n, w from lc_seats where room_id = p_room and not out;
  if n <= 1 then perform _lc_finish(p_room, w); end if;
end;
$$;

-- set the clock for whoever moves now
create or replace function public._lc_turn_to(p_room uuid, p_seat integer)
returns void language sql security definer set search_path = public as $$
  update lc_rooms set turn = p_seat, drawn = null, deadline = now() + interval '25 seconds', seq = seq + 1, updated_at = now() where id = p_room
$$;

-- draw (the turn player): take the stack, or one card (or until one fits)
create or replace function public._lc_do_draw(p_room uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  r lc_rooms%rowtype;
  got integer := 0;
  card smallint;
  h smallint[];
  v_until boolean;
begin
  select * into r from lc_rooms where id = p_room;
  if r.pending > 0 then
    perform _lc_take(p_room, p_seat, r.pending);
    update lc_rooms set pending = 0, pend_kind = 0, last = jsonb_build_object('seat', p_seat, 'kind', 'penalty', 'count', r.pending) where id = p_room;
    perform _lc_turn_to(p_room, _lc_next(p_room, p_seat, r.dir, 1));
    return;
  end if;
  v_until := coalesce((r.rules ->> 'drawUntil')::boolean, false);
  loop
    exit when _lc_take(p_room, p_seat, 1) = 0;
    got := got + 1;
    select hand into h from lc_seats where room_id = p_room and seat = p_seat;
    card := h[cardinality(h)];
    select * into r from lc_rooms where id = p_room;
    r.drawn := null;
    exit when not v_until or _lc_can(r, card) or got >= 30;
  end loop;
  update lc_rooms set last = jsonb_build_object('seat', p_seat, 'kind', 'draw', 'count', got), seq = seq + 1 where id = p_room;
  select * into r from lc_rooms where id = p_room;
  r.drawn := null;
  if card is not null and _lc_can(r, card) then
    update lc_rooms set drawn = card, deadline = now() + interval '25 seconds' where id = p_room;
  else
    perform _lc_turn_to(p_room, _lc_next(p_room, p_seat, r.dir, 1));
  end if;
end;
$$;

-- a player leaves the game (or times out): their cards go under the deck
create or replace function public._lc_out(p_room uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  r lc_rooms%rowtype;
  h smallint[];
begin
  select * into r from lc_rooms where id = p_room;
  select hand into h from lc_seats where room_id = p_room and seat = p_seat;
  update lc_seats set out = true, hand = '{}', called = false where room_id = p_room and seat = p_seat;
  update lc_rooms set deck = coalesce(h, '{}') || deck, last = jsonb_build_object('seat', p_seat, 'kind', 'out') where id = p_room;
  perform _lc_check_end(p_room);
  if (select status from lc_rooms where id = p_room) = 'playing' and r.turn = p_seat then
    perform _lc_turn_to(p_room, _lc_next(p_room, p_seat, r.dir, 1));
  end if;
end;
$$;

-- every state call moves the room on: drop players who went away, play out an expired turn
create or replace function public._lc_advance(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r lc_rooms%rowtype;
  s lc_seats%rowtype;
  t integer;
begin
  select * into r from lc_rooms where id = p_room for update;
  if not found then return; end if;
  if r.status = 'lobby' then
    delete from lc_seats where room_id = p_room and seen_at < now() - interval '40 seconds';
  elsif r.status = 'playing' then
    for s in select * from lc_seats where room_id = p_room and not out and seen_at < now() - interval '60 seconds' loop
      perform _lc_out(p_room, s.seat);
    end loop;
    select * into r from lc_rooms where id = p_room;
    if r.status = 'playing' and r.deadline is not null and r.deadline < now() then
      update lc_seats set timeouts = timeouts + 1 where room_id = p_room and seat = r.turn returning timeouts into t;
      if r.drawn is not null then
        update lc_rooms set last = jsonb_build_object('seat', r.turn, 'kind', 'pass') where id = p_room;
        perform _lc_turn_to(p_room, _lc_next(p_room, r.turn, r.dir, 1));
      else
        perform _lc_do_draw(p_room, r.turn);
        -- drew a card that fits: keep it, out of time
        if (select drawn from lc_rooms where id = p_room) is not null then
          perform _lc_turn_to(p_room, _lc_next(p_room, r.turn, r.dir, 1));
        end if;
      end if;
      if t >= 3 then perform _lc_out(p_room, r.turn); end if;
    end if;
  end if;
  -- nobody left: the room goes
  if not exists (select 1 from lc_seats where room_id = p_room and not out) then
    delete from lc_rooms where id = p_room;
  end if;
end;
$$;

/* ---------------- seats and rooms ---------------- */
create or replace function public._lc_leave_all(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s lc_seats%rowtype;
  st text;
begin
  for s in select * from lc_seats where user_id = p_user loop
    select status into st from lc_rooms where id = s.room_id for update;
    if st = 'playing' and not s.out then
      perform _lc_out(s.room_id, s.seat);
    end if;
    delete from lc_seats where room_id = s.room_id and seat = s.seat;
    -- a new host if the host left
    update lc_rooms set host = (select user_id from lc_seats where room_id = s.room_id and not out order by seat limit 1), seq = seq + 1
    where id = s.room_id and host = p_user;
    if not exists (select 1 from lc_seats where room_id = s.room_id and not out) then
      delete from lc_rooms where id = s.room_id;
    else
      perform _lc_check_end(s.room_id);
    end if;
  end loop;
end;
$$;

create or replace function public._lc_sit(p_room uuid, p_user uuid, p_name text, p_avatar jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  free integer;
begin
  if exists (select 1 from lc_seats where room_id = p_room and user_id = p_user) then return; end if;
  if (select status from lc_rooms where id = p_room) = 'playing' then raise exception 'room_playing'; end if;
  select min(x) into free from generate_series(0, 3) x where not exists (select 1 from lc_seats where room_id = p_room and seat = x);
  if free is null then raise exception 'room_full'; end if;
  perform _lc_leave_all(p_user);
  insert into lc_seats (room_id, seat, user_id, name, avatar) values (p_room, free, p_user, left(coalesce(nullif(btrim(p_name), ''), 'Player'), 24), p_avatar);
  update lc_rooms set seq = seq + 1, updated_at = now() where id = p_room;
end;
$$;

create or replace function public._lc_rules(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'stack', coalesce((p ->> 'stack')::boolean, true),
    'sevenZero', coalesce((p ->> 'sevenZero')::boolean, false),
    'drawUntil', coalesce((p ->> 'drawUntil')::boolean, false))
$$;

create or replace function public.lc_create(p_name text, p_avatar jsonb default null, p_private boolean default true, p_rules jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform _lc_leave_all(v_user);
  insert into lc_rooms (code, private, host, rules) values (_lc_new_code(), coalesce(p_private, true), v_user, _lc_rules(coalesce(p_rules, '{}')))
  returning id into v_id;
  perform _lc_sit(v_id, v_user, p_name, p_avatar);
  return _lc_view(v_id, v_user);
end;
$$;

create or replace function public.lc_join(p_code text, p_name text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from lc_rooms where code = upper(btrim(p_code));
  if v_id is null then raise exception 'no_room'; end if;
  perform _lc_advance(v_id);
  perform _lc_sit(v_id, v_user, p_name, p_avatar);
  return _lc_view(v_id, v_user);
end;
$$;

-- quick match: an open public room waiting for players, or a new one
create or replace function public.lc_quick(p_name text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select r.id into v_id from lc_rooms r
  where not r.private and r.status = 'lobby'
    and (select count(*) from lc_seats s where s.room_id = r.id) between 1 and 3
    and not exists (select 1 from lc_seats s where s.room_id = r.id and s.user_id = v_user)
  order by r.created_at limit 1;
  if v_id is null then
    return lc_create(p_name, p_avatar, false, null);
  end if;
  perform _lc_sit(v_id, v_user, p_name, p_avatar);
  return _lc_view(v_id, v_user);
end;
$$;

create or replace function public.lc_set_rules(p_code text, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r lc_rooms%rowtype;
begin
  select * into r from lc_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no_room'; end if;
  if r.host is distinct from v_user then raise exception 'not_host'; end if;
  if r.status = 'playing' then raise exception 'room_playing'; end if;
  update lc_rooms set rules = _lc_rules(p_rules), seq = seq + 1 where id = r.id;
  return _lc_view(r.id, v_user);
end;
$$;

-- the host deals (2–4 players); also "play again" after a game
create or replace function public.lc_start(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r lc_rooms%rowtype;
  n integer;
  v_deck smallint[];
  v_top smallint;
  v_first integer;
begin
  select * into r from lc_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no_room'; end if;
  if r.host is distinct from v_user then raise exception 'not_host'; end if;
  if r.status = 'playing' then return _lc_view(r.id, v_user); end if;
  -- players who left after the last game go; seats close up to 0..n-1
  delete from lc_seats where room_id = r.id and out;
  select count(*) into n from lc_seats where room_id = r.id;
  if n < 2 then raise exception 'need_players'; end if;
  update lc_seats s set seat = x.k - 1 + 10 from (select seat, row_number() over (order by seat) k from lc_seats where room_id = r.id) x
  where s.room_id = r.id and s.seat = x.seat;
  update lc_seats set seat = seat - 10 where room_id = r.id;
  select coalesce(array_agg(i::smallint order by random()), '{}') into v_deck from generate_series(0, 107) i;
  -- seven each
  update lc_seats s set hand = v_deck[(s.seat * 7 + 1):(s.seat * 7 + 7)], called = false, out = false, timeouts = 0 where s.room_id = r.id;
  v_deck := v_deck[(n * 7 + 1):108];
  -- the first card face up is a plain number
  loop
    v_top := v_deck[cardinality(v_deck)];
    v_deck := v_deck[1:cardinality(v_deck) - 1];
    exit when _lc_v(v_top) <= 9;
    v_deck := _lc_shuffle(array_prepend(v_top, v_deck));
  end loop;
  v_first := floor(random() * n)::integer;
  update lc_rooms set status = 'playing', deck = v_deck, discard = array[v_top], color = _lc_c(v_top), dir = 1, pending = 0, pend_kind = 0,
    drawn = null, winner = null, turn = v_first, last = jsonb_build_object('seat', -1, 'kind', 'start', 'card', v_top),
    deadline = now() + interval '25 seconds', seq = seq + 1, updated_at = now()
  where id = r.id;
  return _lc_view(r.id, v_user);
end;
$$;

create or replace function public.lc_state(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from lc_rooms where code = upper(btrim(p_code));
  if v_id is null then raise exception 'no_room'; end if;
  update lc_seats set seen_at = now() where room_id = v_id and user_id = v_user;
  perform _lc_advance(v_id);
  if not exists (select 1 from lc_rooms where id = v_id) then raise exception 'no_room'; end if;
  return _lc_view(v_id, v_user);
end;
$$;

-- play a card. A wild needs p_color (0–3); a 7 with 7-swap needs p_target (a seat).
-- p_last: you said "Last card!" with this play.
create or replace function public.lc_play(p_code text, p_card integer, p_color integer default null, p_target integer default null, p_last boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r lc_rooms%rowtype;
  me lc_seats%rowtype;
  c integer := _lc_c(p_card);
  v integer := _lc_v(p_card);
  left_n integer;
  skip integer := 0;
  t integer;
  h smallint[];
  n integer;
  stacking boolean;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from lc_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no_room'; end if;
  select * into me from lc_seats where room_id = r.id and user_id = v_user;
  if not found or me.out then raise exception 'not_seated'; end if;
  update lc_seats set seen_at = now(), timeouts = 0 where room_id = r.id and seat = me.seat;
  if r.status <> 'playing' then raise exception 'not_playing'; end if;
  if r.turn <> me.seat then raise exception 'not_your_turn'; end if;
  if p_card is null or not (p_card::smallint = any (me.hand)) or not _lc_can(r, p_card) then raise exception 'bad_move'; end if;
  if c = 4 and (p_color is null or p_color not between 0 and 3) then raise exception 'pick_color'; end if;

  if coalesce(p_last, false) and cardinality(me.hand) <= 2 then me.called := true; end if;
  update lc_seats set hand = array_remove(hand, p_card::smallint), called = me.called where room_id = r.id and seat = me.seat;
  left_n := cardinality(me.hand) - 1;
  update lc_rooms set discard = array_append(discard, p_card::smallint), color = case when c = 4 then p_color else c end, drawn = null,
    last = jsonb_build_object('seat', me.seat, 'kind', 'play', 'card', p_card), seq = seq + 1, updated_at = now()
  where id = r.id;

  if left_n = 0 then
    perform _lc_finish(r.id, me.seat);
    return _lc_view(r.id, v_user);
  end if;
  -- forgot to say "Last card!"
  if left_n = 1 and not me.called then
    perform _lc_take(r.id, me.seat, 2);
    update lc_rooms set last = last || jsonb_build_object('count', 2) where id = r.id;
  end if;

  select * into r from lc_rooms where id = r.id;
  stacking := coalesce((r.rules ->> 'stack')::boolean, true);
  if v = 10 then
    skip := 1;
  elsif v = 11 then
    update lc_rooms set dir = -dir where id = r.id;
    r.dir := -r.dir;
    select count(*) into n from lc_seats where room_id = r.id and not out;
    if n = 2 then skip := 1; end if;
  elsif v = 12 or v = 14 then
    if stacking then
      update lc_rooms set pending = pending + (case when v = 12 then 2 else 4 end), pend_kind = case when v = 12 then 2 else 4 end where id = r.id;
    else
      perform _lc_take(r.id, _lc_next(r.id, me.seat, r.dir, 1), case when v = 12 then 2 else 4 end);
      skip := 1;
    end if;
  elsif v = 7 and coalesce((r.rules ->> 'sevenZero')::boolean, false) then
    -- swap with the chosen player (or whoever holds fewest)
    t := p_target;
    if t is null or t = me.seat or not exists (select 1 from lc_seats where room_id = r.id and seat = t and not out) then
      select seat into t from lc_seats where room_id = r.id and seat <> me.seat and not out order by cardinality(hand), seat limit 1;
    end if;
    select hand into h from lc_seats where room_id = r.id and seat = me.seat;
    update lc_seats set hand = (select hand from lc_seats where room_id = r.id and seat = t), called = false where room_id = r.id and seat = me.seat;
    update lc_seats set hand = h, called = false where room_id = r.id and seat = t;
    update lc_rooms set last = last || jsonb_build_object('target', t) where id = r.id;
  elsif v = 0 and coalesce((r.rules ->> 'sevenZero')::boolean, false) then
    -- every hand moves on one seat in the direction of play
    update lc_seats s set hand = x.hand, called = false
    from (select seat, hand from lc_seats where room_id = r.id and not out) x
    where s.room_id = r.id and s.seat = _lc_next(r.id, x.seat, r.dir, 1);
  end if;
  perform _lc_turn_to(r.id, _lc_next(r.id, me.seat, r.dir, 1 + skip));
  return _lc_view(r.id, v_user);
end;
$$;

create or replace function public.lc_draw(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r lc_rooms%rowtype;
  me lc_seats%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from lc_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no_room'; end if;
  select * into me from lc_seats where room_id = r.id and user_id = v_user;
  if not found or me.out then raise exception 'not_seated'; end if;
  update lc_seats set seen_at = now(), timeouts = 0 where room_id = r.id and seat = me.seat;
  if r.status <> 'playing' or r.turn <> me.seat or r.drawn is not null then raise exception 'bad_move'; end if;
  perform _lc_do_draw(r.id, me.seat);
  return _lc_view(r.id, v_user);
end;
$$;

create or replace function public.lc_pass(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r lc_rooms%rowtype;
  me lc_seats%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from lc_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no_room'; end if;
  select * into me from lc_seats where room_id = r.id and user_id = v_user;
  if not found or me.out then raise exception 'not_seated'; end if;
  if r.status <> 'playing' or r.turn <> me.seat or r.drawn is null then raise exception 'bad_move'; end if;
  update lc_rooms set last = jsonb_build_object('seat', me.seat, 'kind', 'pass') where id = r.id;
  perform _lc_turn_to(r.id, _lc_next(r.id, me.seat, r.dir, 1));
  return _lc_view(r.id, v_user);
end;
$$;

-- say "Last card!" (with two cards or fewer)
create or replace function public.lc_call(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from lc_rooms where code = upper(btrim(p_code));
  if v_id is null then raise exception 'no_room'; end if;
  update lc_seats set called = true where room_id = v_id and user_id = v_user and cardinality(hand) <= 2 and not out;
  update lc_rooms set seq = seq + 1 where id = v_id;
  return _lc_view(v_id, v_user);
end;
$$;

create or replace function public.lc_leave()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  perform _lc_leave_all(auth.uid());
end;
$$;

revoke all on function public._lc_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public._lc_next(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._lc_take(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public._lc_xp(uuid, integer) from public, anon, authenticated;
revoke all on function public._lc_finish(uuid, integer) from public, anon, authenticated;
revoke all on function public._lc_check_end(uuid) from public, anon, authenticated;
revoke all on function public._lc_turn_to(uuid, integer) from public, anon, authenticated;
revoke all on function public._lc_do_draw(uuid, integer) from public, anon, authenticated;
revoke all on function public._lc_out(uuid, integer) from public, anon, authenticated;
revoke all on function public._lc_advance(uuid) from public, anon, authenticated;
revoke all on function public._lc_leave_all(uuid) from public, anon, authenticated;
revoke all on function public._lc_sit(uuid, uuid, text, jsonb) from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'lc_create(text, jsonb, boolean, jsonb)', 'lc_join(text, text, jsonb)', 'lc_quick(text, jsonb)', 'lc_set_rules(text, jsonb)',
    'lc_start(text)', 'lc_state(text)', 'lc_play(text, integer, integer, integer, boolean)', 'lc_draw(text)', 'lc_pass(text)',
    'lc_call(text)', 'lc_leave()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
