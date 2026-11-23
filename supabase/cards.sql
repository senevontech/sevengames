-- ============================================================
-- Card games: free chips + Blackjack (server-dealt)
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- CHIPS are a free play currency, separate from tokens on purpose:
--   * never sold, never turned into tokens, items or anything else (keeps card games clear of
--     real-money gambling rules);
--   * 10,000 to start, 2,000 free once a day (India time), and 1,000 once an hour for anyone
--     who has run out (under 100 chips);
--   * every change is written to chip_ledger.
--
-- BLACKJACK is dealt on the server so nobody can see or change the cards: the deck and the
-- dealer's hidden card never leave the database until the round is over.
--   Rules: one 52-card deck shuffled each round; dealer peeks for blackjack with an ace or ten
--   showing; dealer stands on all 17s; blackjack pays 3:2; double on any first two cards;
--   one split (any two cards of the same rank; split aces get one card each); no insurance.
--   Cards are numbers 0–51: rank = c % 13 (0 = A, 1–9 = 2–10, 10 = J, 11 = Q, 12 = K),
--   suit = c / 13 (0 ♠, 1 ♥, 2 ♦, 3 ♣).
-- ============================================================

-- 1) Chips ---------------------------------------------------------------
create table if not exists public.chip_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  last_daily date,
  last_refill timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.chip_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta bigint not null,
  reason text not null check (reason in ('start', 'daily', 'refill', 'blackjack')),
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists chip_ledger_user_idx on public.chip_ledger (user_id, created_at desc);

alter table public.chip_wallets enable row level security;
alter table public.chip_ledger enable row level security;
drop policy if exists "Own chip wallet" on public.chip_wallets;
create policy "Own chip wallet" on public.chip_wallets for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own chip ledger" on public.chip_ledger;
create policy "Own chip ledger" on public.chip_ledger for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: chips only change through the functions below.

create or replace function public._chips_const(p_key text)
returns bigint language sql immutable as $$
  select case p_key
    when 'start' then 10000
    when 'daily' then 2000
    when 'refill' then 1000
    when 'broke' then 100      -- under this, the hourly refill is available
    when 'min_bet' then 10
    when 'max_bet' then 50000
  end
$$;

-- the player's wallet, created with the starting chips on first use
create or replace function public._chips_wallet(p_user uuid)
returns chip_wallets language plpgsql security definer set search_path = public as $$
declare
  w chip_wallets%rowtype;
begin
  select * into w from chip_wallets where user_id = p_user for update;
  if not found then
    insert into chip_wallets (user_id, balance) values (p_user, _chips_const('start')) returning * into w;
    insert into chip_ledger (user_id, delta, reason) values (p_user, _chips_const('start'), 'start');
  end if;
  return w;
end;
$$;

-- add (or with a negative delta, take) chips; refuses to go below 0
create or replace function public._chips_credit(p_user uuid, p_delta bigint, p_reason text, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v bigint;
begin
  perform _chips_wallet(p_user);
  update chip_wallets set balance = balance + p_delta where user_id = p_user and balance + p_delta >= 0
  returning balance into v;
  if v is null then raise exception 'insufficient_chips'; end if;
  insert into chip_ledger (user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref);
  return v;
end;
$$;

create or replace function public._chips_state(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w chip_wallets%rowtype := _chips_wallet(p_user);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return jsonb_build_object(
    'balance', w.balance,
    'daily_ready', w.last_daily is distinct from v_today,
    'daily_amount', _chips_const('daily'),
    'refill_ready', w.balance < _chips_const('broke') and (w.last_refill is null or w.last_refill < now() - interval '1 hour'),
    'refill_at', case when w.last_refill is null then null else w.last_refill + interval '1 hour' end,
    'refill_amount', _chips_const('refill'),
    'min_bet', _chips_const('min_bet'),
    'max_bet', _chips_const('max_bet')
  );
end;
$$;

create or replace function public.chips_state()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return _chips_state(auth.uid());
end;
$$;

create or replace function public.chips_daily()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  w chip_wallets%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  w := _chips_wallet(v_user);
  if w.last_daily = v_today then raise exception 'already_claimed'; end if;
  update chip_wallets set last_daily = v_today where user_id = v_user;
  perform _chips_credit(v_user, _chips_const('daily'), 'daily', v_today::text);
  return _chips_state(v_user);
end;
$$;

create or replace function public.chips_refill()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  w chip_wallets%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  w := _chips_wallet(v_user);
  if w.balance >= _chips_const('broke') then raise exception 'not_broke'; end if;
  if w.last_refill is not null and w.last_refill > now() - interval '1 hour' then raise exception 'refill_wait'; end if;
  -- an unfinished blackjack round still holds chips: finish it first
  if exists (select 1 from bj_rounds where user_id = v_user and status = 'playing') then raise exception 'round_open'; end if;
  update chip_wallets set last_refill = now() where user_id = v_user;
  perform _chips_credit(v_user, _chips_const('refill'), 'refill', null);
  return _chips_state(v_user);
end;
$$;

-- 2) Blackjack ------------------------------------------------------------
create table if not exists public.bj_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck smallint[] not null,            -- cards still to come (secret)
  dealer smallint[] not null,          -- dealer's cards; [2] is the hole card until the end
  hands jsonb not null,                -- [{ cards: [..], bet, done, doubled, split }]
  active integer not null default 0,
  status text not null default 'playing' check (status in ('playing', 'done')),
  outcome jsonb,                       -- per hand: { result, payout } once done
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bj_rounds_one_open on public.bj_rounds (user_id) where status = 'playing';
create index if not exists bj_rounds_user_idx on public.bj_rounds (user_id, created_at desc);
alter table public.bj_rounds enable row level security;
-- No policies at all: the browser never reads this table (it would show the deck).

-- blackjack value of a card: A = 1 (made 11 by _bj_total when it fits), J/Q/K = 10
create or replace function public._bj_card(c integer)
returns integer language sql immutable as $$
  select case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end
$$;

-- best total of a hand (aces as 11 when that doesn't bust)
create or replace function public._bj_total(p_cards jsonb)
returns integer language sql immutable as $$
  with v as (select coalesce(sum(_bj_card(x::int)), 0) s, bool_or(x::int % 13 = 0) ace from jsonb_array_elements_text(p_cards) x)
  select case when coalesce(ace, false) and s + 10 <= 21 then s + 10 else s end from v
$$;

create or replace function public._bj_total_arr(p_cards smallint[])
returns integer language sql immutable as $$
  select _bj_total(to_jsonb(p_cards))
$$;

-- what the player may see (the dealer's hole card stays hidden while playing)
create or replace function public._bj_view(r bj_rounds)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'active', r.active,
    'hands', (
      select jsonb_agg(h || jsonb_build_object('total', _bj_total(h -> 'cards')) order by i)
      from jsonb_array_elements(r.hands) with ordinality t(h, i)
    ),
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], -1) end,
    'dealer_total', case when r.status = 'done' then _bj_total_arr(r.dealer) else _bj_total(jsonb_build_array(r.dealer[1])) end,
    'outcome', r.outcome,
    'chips', _chips_state(r.user_id)
  )
$$;

-- dealer draws to 17, then every hand is paid
create or replace function public._bj_finish(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r bj_rounds%rowtype;
  d integer;
  h jsonb;
  i integer;
  pt integer;
  pay bigint;
  res text;
  outs jsonb := '[]'::jsonb;
  any_live boolean := false;
begin
  select * into r from bj_rounds where id = p_id for update;
  -- the dealer only draws if some hand is still standing (not bust)
  for i in 0 .. jsonb_array_length(r.hands) - 1 loop
    if _bj_total(r.hands -> i -> 'cards') <= 21 then any_live := true; end if;
  end loop;
  if any_live then
    while _bj_total_arr(r.dealer) < 17 loop
      r.dealer := r.dealer || r.deck[1];
      r.deck := r.deck[2:];
    end loop;
  end if;
  d := _bj_total_arr(r.dealer);

  for i in 0 .. jsonb_array_length(r.hands) - 1 loop
    h := r.hands -> i;
    pt := _bj_total(h -> 'cards');
    if pt > 21 then res := 'bust'; pay := 0;
    elsif d > 21 then res := 'dealer_bust'; pay := (h ->> 'bet')::bigint * 2;
    elsif pt > d then res := 'win'; pay := (h ->> 'bet')::bigint * 2;
    elsif pt = d then res := 'push'; pay := (h ->> 'bet')::bigint;
    else res := 'lose'; pay := 0;
    end if;
    if pay > 0 then perform _chips_credit(r.user_id, pay, 'blackjack', p_id::text); end if;
    outs := outs || jsonb_build_object('result', res, 'payout', pay, 'bet', (h ->> 'bet')::bigint);
  end loop;

  update bj_rounds set dealer = r.dealer, deck = r.deck, status = 'done', outcome = outs, updated_at = now() where id = p_id;
end;
$$;

-- the player's unfinished round (after a reload), or null
create or replace function public.bj_current()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r bj_rounds%rowtype;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into r from bj_rounds where user_id = auth.uid() and status = 'playing';
  if not found then return jsonb_build_object('round', null, 'chips', _chips_state(auth.uid())); end if;
  return jsonb_build_object('round', _bj_view(r), 'chips', _chips_state(auth.uid()));
end;
$$;

create or replace function public.bj_deal(p_bet bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_deck smallint[];
  v_id uuid := gen_random_uuid();
  r bj_rounds%rowtype;
  pt integer;
  dt integer;
  pay bigint;
  res text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_bet < _chips_const('min_bet') or p_bet > _chips_const('max_bet') then raise exception 'bad_bet'; end if;
  if exists (select 1 from bj_rounds where user_id = v_user and status = 'playing') then raise exception 'round_open'; end if;
  perform _chips_credit(v_user, -p_bet, 'blackjack', v_id::text); -- raises insufficient_chips

  select array_agg(c::smallint order by random()) into v_deck from generate_series(0, 51) c;
  insert into bj_rounds (id, user_id, deck, dealer, hands)
  values (
    v_id, v_user, v_deck[5:], array[v_deck[2], v_deck[4]],
    jsonb_build_array(jsonb_build_object('cards', jsonb_build_array(v_deck[1], v_deck[3]), 'bet', p_bet, 'done', false, 'doubled', false, 'split', false))
  )
  returning * into r;

  -- naturals: a blackjack on either side ends the round straight away
  pt := _bj_total(r.hands -> 0 -> 'cards');
  dt := _bj_total_arr(r.dealer);
  if pt = 21 or dt = 21 then
    if pt = 21 and dt = 21 then res := 'push'; pay := p_bet;
    elsif pt = 21 then res := 'blackjack'; pay := p_bet + (p_bet * 3) / 2;
    else res := 'dealer_blackjack'; pay := 0;
    end if;
    if pay > 0 then perform _chips_credit(v_user, pay, 'blackjack', v_id::text); end if;
    update bj_rounds set status = 'done', outcome = jsonb_build_array(jsonb_build_object('result', res, 'payout', pay, 'bet', p_bet)), updated_at = now()
    where id = v_id returning * into r;
  end if;
  return _bj_view(r);
end;
$$;

-- 'hit' | 'stand' | 'double' | 'split'
create or replace function public.bj_action(p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r bj_rounds%rowtype;
  h jsonb;
  cards jsonb;
  bet bigint;
  c1 integer;
  c2 integer;
  n integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from bj_rounds where user_id = v_user and status = 'playing' for update;
  if not found then raise exception 'no_round'; end if;
  h := r.hands -> r.active;
  cards := h -> 'cards';
  bet := (h ->> 'bet')::bigint;
  n := jsonb_array_length(cards);

  if p_action = 'hit' then
    cards := cards || to_jsonb(r.deck[1]);
    r.deck := r.deck[2:];
    h := jsonb_set(h, '{cards}', cards);
    if _bj_total(cards) >= 21 then h := jsonb_set(h, '{done}', 'true'); end if;

  elsif p_action = 'stand' then
    h := jsonb_set(h, '{done}', 'true');

  elsif p_action = 'double' then
    if n <> 2 then raise exception 'cant_double'; end if;
    perform _chips_credit(v_user, -bet, 'blackjack', r.id::text);
    cards := cards || to_jsonb(r.deck[1]);
    r.deck := r.deck[2:];
    h := h || jsonb_build_object('cards', cards, 'bet', bet * 2, 'doubled', true, 'done', true);

  elsif p_action = 'split' then
    c1 := (cards ->> 0)::int;
    c2 := (cards ->> 1)::int;
    if n <> 2 or jsonb_array_length(r.hands) > 1 or c1 % 13 <> c2 % 13 then raise exception 'cant_split'; end if;
    perform _chips_credit(v_user, -bet, 'blackjack', r.id::text);
    r.hands := jsonb_build_array(
      jsonb_build_object('cards', jsonb_build_array(c1, r.deck[1]), 'bet', bet, 'done', c1 % 13 = 0, 'doubled', false, 'split', true),
      jsonb_build_object('cards', jsonb_build_array(c2, r.deck[2]), 'bet', bet, 'done', c1 % 13 = 0, 'doubled', false, 'split', true)
    );
    r.deck := r.deck[3:];
    -- a split hand that makes 21 stands by itself (it pays as 21, not as a blackjack)
    if _bj_total(r.hands -> 0 -> 'cards') = 21 then r.hands := jsonb_set(r.hands, '{0,done}', 'true'); end if;
    if _bj_total(r.hands -> 1 -> 'cards') = 21 then r.hands := jsonb_set(r.hands, '{1,done}', 'true'); end if;
    h := r.hands -> 0;

  else
    raise exception 'bad_action';
  end if;

  r.hands := jsonb_set(r.hands, array[r.active::text], h);
  -- on to the next unfinished hand, or the dealer
  while r.active < jsonb_array_length(r.hands) and (r.hands -> r.active ->> 'done')::boolean loop
    r.active := r.active + 1;
  end loop;
  update bj_rounds set hands = r.hands, deck = r.deck, active = least(r.active, jsonb_array_length(r.hands) - 1), updated_at = now()
  where id = r.id;
  if r.active >= jsonb_array_length(r.hands) then perform _bj_finish(r.id); end if;

  select * into r from bj_rounds where id = r.id;
  return _bj_view(r);
end;
$$;

revoke all on function public._chips_wallet(uuid) from public, anon, authenticated;
revoke all on function public._chips_credit(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public._chips_state(uuid) from public, anon, authenticated;
revoke all on function public._bj_view(bj_rounds) from public, anon, authenticated;
revoke all on function public._bj_finish(uuid) from public, anon, authenticated;
grant execute on function public.chips_state() to authenticated;
grant execute on function public.chips_daily() to authenticated;
grant execute on function public.chips_refill() to authenticated;
grant execute on function public.bj_current() to authenticated;
grant execute on function public.bj_deal(bigint) to authenticated;
grant execute on function public.bj_action(text) to authenticated;

notify pgrst, 'reload schema';
