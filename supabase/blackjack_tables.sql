-- ============================================================
-- Blackjack online tables: up to 5 players against one dealer, with free chips.
-- Run in: Supabase Dashboard → SQL Editor, AFTER cards.sql. Safe to re-run.
--
-- Everything happens on the server: the shoe (6 decks, reshuffled when under 80 cards),
-- every card, the dealer's hidden card, the clocks and the payouts. The browser only asks
-- for the table's state (bjt_state) and sends bets and moves; it never sees the shoe.
--
-- A round:
--   betting — seated players place bets. The first bet starts a 12 s window; the cards come
--             as soon as everyone has bet or the window ends (players without a bet sit out).
--   playing — seats act in order (hit / stand / double / split), 20 s each; out of time = stand.
--             Same rules as solo Blackjack (cards.sql): dealer peeks for blackjack, stands on
--             all 17s, blackjack pays 3:2, one split, split aces get one card each.
--   done    — results show for 6 s, then the next round's betting starts.
-- Nobody needs to be "the host": every bjt_state call moves the table on when a clock runs
-- out, so the table keeps going while anyone is there. Players not seen for 45 s are dropped
-- (between rounds; a hand in play is stood for them). Three missed turns in a row and you're
-- taken off the table. Empty tables are deleted.
-- ============================================================

create table if not exists public.bjt_tables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4}$'),
  private boolean not null default false,
  phase text not null default 'betting' check (phase in ('betting', 'playing', 'done')),
  round integer not null default 1,
  shoe smallint[] not null default '{}',   -- secret
  dealer smallint[] not null default '{}', -- [2] is the hole card while playing
  turn integer,
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bjt_seats (
  table_id uuid not null references public.bjt_tables(id) on delete cascade,
  seat integer not null check (seat between 0 and 4),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Player',
  avatar jsonb,
  bet bigint not null default 0,
  hands jsonb not null default '[]',     -- [{ cards, bet, done, doubled, split, natural }]
  active integer not null default 0,
  outcome jsonb,                         -- per hand { result, payout, bet } after the round
  timeouts integer not null default 0,
  leaving boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key (table_id, seat)
);

-- one table at a time (a seat whose player left mid-hand stays until the round is paid)
create unique index if not exists bjt_seats_one_table on public.bjt_seats (user_id) where not leaving;

alter table public.bjt_tables enable row level security;
alter table public.bjt_seats enable row level security;
-- No policies: the browser never reads these tables directly (the shoe is in there).

create or replace function public._bjt_const(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'seats' then 5
    when 'bet_s' then 12
    when 'turn_s' then 20
    when 'done_s' then 6
    when 'stale_s' then 45
    when 'max_timeouts' then 3
  end
$$;

create or replace function public._bjt_new_code()
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
    exit when not exists (select 1 from bjt_tables where code = v);
  end loop;
  return v;
end;
$$;

-- what everyone at the table may see (+ the caller's own seat and chips)
create or replace function public._bjt_view(p_id uuid, p_user uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'code', t.code,
    'private', t.private,
    'phase', t.phase,
    'round', t.round,
    'turn', t.turn,
    'ms_left', case when t.deadline is null then null else greatest(0, floor(extract(epoch from (t.deadline - now())) * 1000))::bigint end,
    'dealer', case
      when t.phase = 'playing' and cardinality(t.dealer) >= 2 then jsonb_build_array(t.dealer[1], -1)
      else to_jsonb(t.dealer) end,
    'dealer_total', case
      when cardinality(t.dealer) = 0 then 0
      when t.phase = 'playing' then _bj_total(jsonb_build_array(t.dealer[1]))
      else _bj_total_arr(t.dealer) end,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', s.seat, 'user_id', s.user_id, 'name', s.name, 'avatar', s.avatar, 'bet', s.bet,
        'active', s.active, 'outcome', s.outcome, 'leaving', s.leaving,
        'hands', coalesce((
          select jsonb_agg(h || jsonb_build_object('total', _bj_total(h -> 'cards')) order by i)
          from jsonb_array_elements(s.hands) with ordinality x(h, i)
        ), '[]'::jsonb)
      ) order by s.seat)
      from bjt_seats s where s.table_id = t.id
    ), '[]'::jsonb),
    'me', (select s.seat from bjt_seats s where s.table_id = t.id and s.user_id = p_user and not s.leaving),
    'chips', _chips_state(p_user)
  )
  from bjt_tables t where t.id = p_id
$$;

-- dealer plays, every hand is paid, results show for a moment
create or replace function public._bjt_finish(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t bjt_tables%rowtype;
  s bjt_seats%rowtype;
  h jsonb;
  i integer;
  pt integer;
  d integer;
  pay bigint;
  b bigint;
  res text;
  outs jsonb;
  live boolean := false;
  dealer_bj boolean;
begin
  select * into t from bjt_tables where id = p_id for update;
  dealer_bj := cardinality(t.dealer) = 2 and _bj_total_arr(t.dealer) = 21;
  -- the dealer draws only if some hand is still standing (not bust, not a blackjack)
  for s in select * from bjt_seats where table_id = p_id loop
    for i in 0 .. jsonb_array_length(s.hands) - 1 loop
      if _bj_total(s.hands -> i -> 'cards') <= 21 and not coalesce((s.hands -> i ->> 'natural')::boolean, false) then live := true; end if;
    end loop;
  end loop;
  if live and not dealer_bj then
    while _bj_total_arr(t.dealer) < 17 loop
      if cardinality(t.shoe) = 0 then
        select array_agg((c % 52)::smallint order by random()) into t.shoe from generate_series(0, 311) c;
      end if;
      t.dealer := t.dealer || t.shoe[1];
      t.shoe := t.shoe[2:];
    end loop;
  end if;
  d := _bj_total_arr(t.dealer);

  for s in select * from bjt_seats where table_id = p_id and jsonb_array_length(hands) > 0 loop
    outs := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(s.hands) - 1 loop
      h := s.hands -> i;
      b := (h ->> 'bet')::bigint;
      pt := _bj_total(h -> 'cards');
      if coalesce((h ->> 'natural')::boolean, false) then
        if dealer_bj then res := 'push'; pay := b; else res := 'blackjack'; pay := b + (b * 3) / 2; end if;
      elsif dealer_bj then res := 'dealer_blackjack'; pay := 0;
      elsif pt > 21 then res := 'bust'; pay := 0;
      elsif d > 21 then res := 'dealer_bust'; pay := b * 2;
      elsif pt > d then res := 'win'; pay := b * 2;
      elsif pt = d then res := 'push'; pay := b;
      else res := 'lose'; pay := 0;
      end if;
      if pay > 0 then perform _chips_credit(s.user_id, pay, 'blackjack', 'bjt:' || t.code || ':' || t.round); end if;
      outs := outs || jsonb_build_object('result', res, 'payout', pay, 'bet', b);
    end loop;
    update bjt_seats set outcome = outs, hands = (select jsonb_agg(x || '{"done": true}'::jsonb) from jsonb_array_elements(s.hands) x)
    where table_id = p_id and seat = s.seat;
  end loop;

  update bjt_tables set dealer = t.dealer, shoe = t.shoe, phase = 'done', turn = null,
    deadline = now() + make_interval(secs => _bjt_const('done_s')), updated_at = now()
  where id = p_id;
end;
$$;

-- the next seat with a hand to play, or the dealer
create or replace function public._bjt_next_turn(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s bjt_seats%rowtype;
  i integer;
begin
  for s in select * from bjt_seats where table_id = p_id and jsonb_array_length(hands) > 0 order by seat loop
    for i in 0 .. jsonb_array_length(s.hands) - 1 loop
      if not (s.hands -> i ->> 'done')::boolean then
        update bjt_seats set active = i where table_id = p_id and seat = s.seat;
        update bjt_tables set turn = s.seat, deadline = now() + make_interval(secs => _bjt_const('turn_s')), updated_at = now() where id = p_id;
        return;
      end if;
    end loop;
  end loop;
  perform _bjt_finish(p_id);
end;
$$;

-- deal the round to everyone who has bet
create or replace function public._bjt_deal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t bjt_tables%rowtype;
  s bjt_seats%rowtype;
  tot integer;
begin
  select * into t from bjt_tables where id = p_id for update;
  if cardinality(t.shoe) < 80 then
    select array_agg((c % 52)::smallint order by random()) into t.shoe from generate_series(0, 311) c;
  end if;
  update bjt_seats set hands = '[]', outcome = null, active = 0 where table_id = p_id;
  -- one card each, the dealer's up card, a second card each, the dealer's hole card
  for s in select * from bjt_seats where table_id = p_id and bet > 0 order by seat loop
    update bjt_seats set hands = jsonb_build_array(jsonb_build_object(
      'cards', jsonb_build_array(t.shoe[1]), 'bet', bet, 'done', false, 'doubled', false, 'split', false, 'natural', false))
    where table_id = p_id and seat = s.seat;
    t.shoe := t.shoe[2:];
  end loop;
  t.dealer := array[t.shoe[1]];
  t.shoe := t.shoe[2:];
  for s in select * from bjt_seats where table_id = p_id and bet > 0 order by seat loop
    update bjt_seats set hands = jsonb_set(hands, '{0,cards}', (hands -> 0 -> 'cards') || to_jsonb(t.shoe[1]))
    where table_id = p_id and seat = s.seat;
    t.shoe := t.shoe[2:];
  end loop;
  t.dealer := t.dealer || t.shoe[1];
  t.shoe := t.shoe[2:];
  -- naturals stand by themselves
  for s in select * from bjt_seats where table_id = p_id and bet > 0 loop
    tot := _bj_total(s.hands -> 0 -> 'cards');
    if tot = 21 then
      update bjt_seats set hands = jsonb_set(jsonb_set(hands, '{0,done}', 'true'), '{0,natural}', 'true') where table_id = p_id and seat = s.seat;
    end if;
  end loop;
  update bjt_tables set shoe = t.shoe, dealer = t.dealer, phase = 'playing', turn = null, deadline = null, updated_at = now() where id = p_id;
  -- dealer blackjack (the peek): the round ends now
  if _bj_total_arr(t.dealer) = 21 then
    perform _bjt_finish(p_id);
  else
    perform _bjt_next_turn(p_id);
  end if;
end;
$$;

-- one move for the seat whose turn it is
create or replace function public._bjt_apply(p_id uuid, p_seat integer, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t bjt_tables%rowtype;
  s bjt_seats%rowtype;
  h jsonb;
  cards jsonb;
  b bigint;
  c1 integer;
  c2 integer;
  n integer;
begin
  select * into t from bjt_tables where id = p_id for update;
  select * into s from bjt_seats where table_id = p_id and seat = p_seat for update;
  if t.phase <> 'playing' or t.turn is distinct from p_seat then raise exception 'not_your_turn'; end if;
  if cardinality(t.shoe) < 4 then
    select array_agg((c % 52)::smallint order by random()) into t.shoe from generate_series(0, 311) c;
  end if;
  h := s.hands -> s.active;
  cards := h -> 'cards';
  b := (h ->> 'bet')::bigint;
  n := jsonb_array_length(cards);

  if p_action = 'hit' then
    cards := cards || to_jsonb(t.shoe[1]);
    t.shoe := t.shoe[2:];
    h := jsonb_set(h, '{cards}', cards);
    if _bj_total(cards) >= 21 then h := jsonb_set(h, '{done}', 'true'); end if;
  elsif p_action = 'stand' then
    h := jsonb_set(h, '{done}', 'true');
  elsif p_action = 'double' then
    if n <> 2 then raise exception 'cant_double'; end if;
    perform _chips_credit(s.user_id, -b, 'blackjack', 'bjt:' || t.code || ':' || t.round);
    cards := cards || to_jsonb(t.shoe[1]);
    t.shoe := t.shoe[2:];
    h := h || jsonb_build_object('cards', cards, 'bet', b * 2, 'doubled', true, 'done', true);
  elsif p_action = 'split' then
    c1 := (cards ->> 0)::int;
    c2 := (cards ->> 1)::int;
    if n <> 2 or jsonb_array_length(s.hands) > 1 or c1 % 13 <> c2 % 13 then raise exception 'cant_split'; end if;
    perform _chips_credit(s.user_id, -b, 'blackjack', 'bjt:' || t.code || ':' || t.round);
    s.hands := jsonb_build_array(
      jsonb_build_object('cards', jsonb_build_array(c1, t.shoe[1]), 'bet', b, 'done', c1 % 13 = 0, 'doubled', false, 'split', true, 'natural', false),
      jsonb_build_object('cards', jsonb_build_array(c2, t.shoe[2]), 'bet', b, 'done', c1 % 13 = 0, 'doubled', false, 'split', true, 'natural', false)
    );
    t.shoe := t.shoe[3:];
    if _bj_total(s.hands -> 0 -> 'cards') = 21 then s.hands := jsonb_set(s.hands, '{0,done}', 'true'); end if;
    if _bj_total(s.hands -> 1 -> 'cards') = 21 then s.hands := jsonb_set(s.hands, '{1,done}', 'true'); end if;
    h := s.hands -> 0;
  else
    raise exception 'bad_action';
  end if;

  s.hands := jsonb_set(s.hands, array[s.active::text], h);
  update bjt_seats set hands = s.hands where table_id = p_id and seat = p_seat;
  update bjt_tables set shoe = t.shoe, updated_at = now() where id = p_id;
  perform _bjt_next_turn(p_id);
end;
$$;

-- move the table on: clocks that ran out, players who went away
create or replace function public._bjt_advance(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t bjt_tables%rowtype;
  s bjt_seats%rowtype;
begin
  select * into t from bjt_tables where id = p_id for update;
  if not found then return; end if;

  -- gone quiet: dropped between rounds (a bet not yet dealt is handed back)
  if t.phase <> 'playing' then
    for s in select * from bjt_seats where table_id = p_id
      and (leaving or seen_at < now() - make_interval(secs => _bjt_const('stale_s'))) loop
      if t.phase = 'betting' and s.bet > 0 then
        perform _chips_credit(s.user_id, s.bet, 'blackjack', 'bjt:' || t.code || ':' || t.round || ':back');
      end if;
      delete from bjt_seats where table_id = p_id and seat = s.seat;
    end loop;
  end if;
  if not exists (select 1 from bjt_seats where table_id = p_id) then
    delete from bjt_tables where id = p_id;
    return;
  end if;

  if t.phase = 'betting' then
    if exists (select 1 from bjt_seats where table_id = p_id and bet > 0)
      and (not exists (select 1 from bjt_seats where table_id = p_id and bet = 0) or t.deadline < now()) then
      perform _bjt_deal(p_id);
    end if;
  elsif t.phase = 'playing' then
    if t.deadline < now() and t.turn is not null then
      update bjt_seats set timeouts = timeouts + 1 where table_id = p_id and seat = t.turn;
      perform _bjt_apply(p_id, t.turn, 'stand');
    end if;
  elsif t.phase = 'done' then
    if t.deadline < now() then
      delete from bjt_seats where table_id = p_id and (leaving or timeouts >= _bjt_const('max_timeouts'));
      update bjt_seats set bet = 0, hands = '[]', outcome = null, active = 0 where table_id = p_id;
      update bjt_tables set phase = 'betting', dealer = '{}', turn = null, deadline = null, round = round + 1, updated_at = now() where id = p_id;
      if not exists (select 1 from bjt_seats where table_id = p_id) then delete from bjt_tables where id = p_id; end if;
    end if;
  end if;
end;
$$;

-- leave whatever table the player is at (a hand in play is stood, and still paid)
create or replace function public._bjt_leave_all(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s bjt_seats%rowtype;
  t bjt_tables%rowtype;
begin
  for s in select * from bjt_seats where user_id = p_user and not leaving loop
    select * into t from bjt_tables where id = s.table_id for update;
    if t.phase = 'playing' and jsonb_array_length(s.hands) > 0 then
      update bjt_seats set leaving = true,
        hands = (select jsonb_agg(x || '{"done": true}'::jsonb) from jsonb_array_elements(s.hands) x)
      where table_id = s.table_id and seat = s.seat;
      if t.turn = s.seat then perform _bjt_next_turn(s.table_id); end if;
    else
      if t.phase = 'betting' and s.bet > 0 then
        perform _chips_credit(p_user, s.bet, 'blackjack', 'bjt:' || t.code || ':' || t.round || ':back');
      end if;
      delete from bjt_seats where table_id = s.table_id and seat = s.seat;
      if not exists (select 1 from bjt_seats where table_id = s.table_id) then delete from bjt_tables where id = s.table_id; end if;
    end if;
  end loop;
end;
$$;

-- sit at a table (the lowest free seat)
create or replace function public._bjt_sit(p_id uuid, p_user uuid, p_name text, p_avatar jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_seat integer;
begin
  perform 1 from bjt_tables where id = p_id for update;
  select min(x) into v_seat from generate_series(0, _bjt_const('seats') - 1) x
  where not exists (select 1 from bjt_seats where table_id = p_id and seat = x);
  if v_seat is null then raise exception 'table_full'; end if;
  perform _chips_wallet(p_user);
  insert into bjt_seats (table_id, seat, user_id, name, avatar)
  values (
    p_id, v_seat, p_user,
    left(coalesce(nullif(trim(p_name), ''), 'Player'), 24),
    case when p_avatar is null or length(p_avatar::text) > 400 then null else p_avatar end
  );
end;
$$;

/* ---------------- what the browser calls ---------------- */

-- a seat at any public table with room (or a new one)
create or replace function public.bjt_quick(p_name text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  -- already sitting at a table: go back to it
  select table_id into v_id from bjt_seats where user_id = v_user and not leaving;
  if v_id is not null then
    perform _bjt_advance(v_id);
    return _bjt_view(v_id, v_user);
  end if;
  perform _bjt_leave_all(v_user);
  select t.id into v_id from bjt_tables t
  where not t.private
    and exists (select 1 from bjt_seats s where s.table_id = t.id and s.seen_at > now() - interval '30 seconds')
    and (select count(*) from bjt_seats s where s.table_id = t.id) < _bjt_const('seats')
  order by (select count(*) from bjt_seats s where s.table_id = t.id) desc, t.created_at
  limit 1;
  if v_id is null then
    insert into bjt_tables (code) values (_bjt_new_code()) returning id into v_id;
  end if;
  perform _bjt_sit(v_id, v_user, p_name, p_avatar);
  return _bjt_view(v_id, v_user);
end;
$$;

-- a new table; private ones are only joined with the code
create or replace function public.bjt_create(p_name text, p_avatar jsonb default null, p_private boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform _bjt_leave_all(v_user);
  -- tidy up: tables nobody has sat at for a while
  delete from bjt_tables t where t.updated_at < now() - interval '1 hour'
    and not exists (select 1 from bjt_seats s where s.table_id = t.id and s.seen_at > now() - interval '5 minutes');
  insert into bjt_tables (code, private) values (_bjt_new_code(), coalesce(p_private, true)) returning id into v_id;
  perform _bjt_sit(v_id, v_user, p_name, p_avatar);
  return _bjt_view(v_id, v_user);
end;
$$;

create or replace function public.bjt_join(p_code text, p_name text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bjt_tables where code = upper(trim(p_code));
  if v_id is null then raise exception 'no_table'; end if;
  if not exists (select 1 from bjt_seats where table_id = v_id and user_id = v_user and not leaving) then
    perform _bjt_leave_all(v_user);
    perform _bjt_sit(v_id, v_user, p_name, p_avatar);
  end if;
  return _bjt_view(v_id, v_user);
end;
$$;

-- the table as it is now (also keeps you seated, and moves the table on)
create or replace function public.bjt_state(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bjt_tables where code = upper(trim(p_code));
  if v_id is null then raise exception 'no_table'; end if;
  update bjt_seats set seen_at = now() where table_id = v_id and user_id = v_user;
  perform _bjt_advance(v_id);
  if not exists (select 1 from bjt_tables where id = v_id) then raise exception 'no_table'; end if;
  return _bjt_view(v_id, v_user);
end;
$$;

-- set your bet for the coming round (0 takes it back)
create or replace function public.bjt_bet(p_code text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  t bjt_tables%rowtype;
  s bjt_seats%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into t from bjt_tables where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no_table'; end if;
  select * into s from bjt_seats where table_id = t.id and user_id = v_user and not leaving for update;
  if not found then raise exception 'not_seated'; end if;
  if t.phase <> 'betting' then raise exception 'betting_closed'; end if;
  if p_amount <> 0 and (p_amount < _chips_const('min_bet') or p_amount > _chips_const('max_bet')) then raise exception 'bad_bet'; end if;
  if s.bet > 0 then perform _chips_credit(v_user, s.bet, 'blackjack', 'bjt:' || t.code || ':' || t.round || ':back'); end if;
  if p_amount > 0 then perform _chips_credit(v_user, -p_amount, 'blackjack', 'bjt:' || t.code || ':' || t.round); end if;
  update bjt_seats set bet = p_amount, seen_at = now(), timeouts = 0 where table_id = t.id and seat = s.seat;
  if p_amount > 0 and t.deadline is null then
    update bjt_tables set deadline = now() + make_interval(secs => _bjt_const('bet_s')), updated_at = now() where id = t.id;
  end if;
  perform _bjt_advance(t.id);
  return _bjt_view(t.id, v_user);
end;
$$;

-- 'hit' | 'stand' | 'double' | 'split'
create or replace function public.bjt_action(p_code text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_seat integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bjt_tables where code = upper(trim(p_code));
  if v_id is null then raise exception 'no_table'; end if;
  select seat into v_seat from bjt_seats where table_id = v_id and user_id = v_user and not leaving;
  if v_seat is null then raise exception 'not_seated'; end if;
  perform _bjt_advance(v_id); -- a clock may have run out first
  update bjt_seats set timeouts = 0, seen_at = now() where table_id = v_id and seat = v_seat;
  perform _bjt_apply(v_id, v_seat, p_action);
  return _bjt_view(v_id, v_user);
end;
$$;

create or replace function public.bjt_leave()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  perform _bjt_leave_all(auth.uid());
  return _chips_state(auth.uid());
end;
$$;

revoke all on function public._bjt_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public._bjt_finish(uuid) from public, anon, authenticated;
revoke all on function public._bjt_next_turn(uuid) from public, anon, authenticated;
revoke all on function public._bjt_deal(uuid) from public, anon, authenticated;
revoke all on function public._bjt_apply(uuid, integer, text) from public, anon, authenticated;
revoke all on function public._bjt_advance(uuid) from public, anon, authenticated;
revoke all on function public._bjt_leave_all(uuid) from public, anon, authenticated;
revoke all on function public._bjt_sit(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.bjt_quick(text, jsonb) from public, anon;
revoke all on function public.bjt_create(text, jsonb, boolean) from public, anon;
revoke all on function public.bjt_join(text, text, jsonb) from public, anon;
revoke all on function public.bjt_state(text) from public, anon;
revoke all on function public.bjt_bet(text, bigint) from public, anon;
revoke all on function public.bjt_action(text, text) from public, anon;
revoke all on function public.bjt_leave() from public, anon;
grant execute on function public.bjt_quick(text, jsonb) to authenticated;
grant execute on function public.bjt_create(text, jsonb, boolean) to authenticated;
grant execute on function public.bjt_join(text, text, jsonb) to authenticated;
grant execute on function public.bjt_state(text) to authenticated;
grant execute on function public.bjt_bet(text, bigint) to authenticated;
grant execute on function public.bjt_action(text, text) to authenticated;
grant execute on function public.bjt_leave() to authenticated;

notify pgrst, 'reload schema';
