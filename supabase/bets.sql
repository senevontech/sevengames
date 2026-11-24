-- ============================================================
-- Chip bets and gifts.
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql, engagement.sql and matches.sql.
-- Safe to re-run.
--
-- Only EARNED chips can be bet or gifted (token_wallets.earned, see tokens.sql): chips bought
-- with money never ride on a game result or change hands. Every stake, payout and gift goes
-- through _tok_credit with reason 'bet' / 'gift', so the ledger shows all of it.
--
-- vs the Senevon CPU  (kind 'cpu')
--   bet_cpu_open(game)            takes the 1-chip stake before the game; an older open CPU bet
--                                 of yours is forfeited (an abandoned game counts as a loss)
--   bet_cpu_settle(id, result)    'win' pays 2 (stake back + 1), 'draw' refunds, 'lose' keeps it.
--                                 The result comes from the player's device, so a win only pays
--                                 if the game lasted a sensible minimum time, and CPU winnings
--                                 are capped at +20 chips a day (India time); past the cap a win
--                                 just refunds the stake.
-- Online           (kind 'room' = friends / invite code, 'random' = random matching)
--   bet_match_join(game, match, kind, stake, players)
--                                 every player stakes the same amount when the match starts:
--                                 random = 3 exactly, room = 5 or more. The winner(s) take the pot.
--   Results come from match_report() (matches.sql), which every player's device already sends.
--   _bet_try_settle pays out once every staked player has reported the SAME result. A draw, a
--   disagreement, or a player who never staked: everyone is refunded. If someone never reports,
--   the reports that did arrive decide after 5 minutes (leaving mid-match reports a loss).
--   bet_match_status(game, match) your stake's state (also settles anything overdue).
-- Gifts
--   gift_chips(to, amount, note)  earned chips to any player: 500 a day at most (India time),
--                                 and your account must be 3 days old.
--   gift_limits()                 what you can still send today.
-- ============================================================

create table if not exists public.chip_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cpu', 'room', 'random')),
  game text not null check (game in ('chess', 'ludo', 'carrom', 'arrows', 'pool')),
  match_id text not null check (length(match_id) between 6 and 80),
  players uuid[] not null default '{}',
  stake integer not null check (stake > 0),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'draw', 'refunded')),
  payout integer not null default 0,
  note text,
  opened_at timestamptz not null default now(),
  settled_at timestamptz
);
create unique index if not exists chip_bets_one_per_player on public.chip_bets (game, match_id, user_id);
create index if not exists chip_bets_user_idx on public.chip_bets (user_id, opened_at desc);
create index if not exists chip_bets_open_idx on public.chip_bets (game, match_id) where status = 'open';

create table if not exists public.chip_gifts (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  note text check (note is null or length(note) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists chip_gifts_from_idx on public.chip_gifts (from_user, created_at desc);
create index if not exists chip_gifts_to_idx on public.chip_gifts (to_user, created_at desc);

alter table public.chip_bets enable row level security;
alter table public.chip_gifts enable row level security;
drop policy if exists "Own bets" on public.chip_bets;
create policy "Own bets" on public.chip_bets for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own gifts" on public.chip_gifts;
create policy "Own gifts" on public.chip_gifts for select to authenticated using (auth.uid() in (from_user, to_user));
-- No insert / update / delete policies: changes only through the functions below.

-- ---------- rules ----------
create or replace function public._bet_const(p_name text)
returns integer language sql immutable as $$
  select case p_name
    when 'cpu_stake' then 1
    when 'cpu_daily_cap' then 20       -- net CPU winnings a day
    when 'random_stake' then 3
    when 'room_min' then 5
    when 'gift_daily_cap' then 500
    when 'gift_min_age_days' then 3
    when 'settle_after_min' then 5     -- missing reports: decide with what arrived after this
  end
$$;

-- shortest believable win against the CPU, per game (seconds)
create or replace function public._bet_cpu_min_secs(p_game text)
returns integer language sql immutable as $$
  select case p_game when 'chess' then 60 when 'ludo' then 90 when 'carrom' then 60 when 'pool' then 45 else 45 end
$$;

-- today, India time (same calendar as daily rewards)
create or replace function public._bet_today_start()
returns timestamptz language sql stable as $$
  select (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'
$$;

create or replace function public._bet_wallet(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'balance', coalesce((select balance from token_wallets where user_id = p_user), 0),
    'earned', coalesce((select earned from token_wallets where user_id = p_user), 0)
  )
$$;

-- pay `amount` back to a bet's owner and close it
create or replace function public._bet_close(p_bet uuid, p_status text, p_payout integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b chip_bets%rowtype;
begin
  select * into b from chip_bets where id = p_bet for update;
  if not found or b.status <> 'open' then return; end if;
  if p_payout > 0 then
    perform _tok_credit(b.user_id, p_payout, 'bet', b.game || ':' || b.match_id);
  end if;
  update chip_bets set status = p_status, payout = p_payout, note = p_note, settled_at = now() where id = p_bet;
end;
$$;

-- ---------- vs CPU ----------
create or replace function public.bet_cpu_open(p_game text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_stake integer := _bet_const('cpu_stake');
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('chess', 'ludo', 'carrom', 'pool') then raise exception 'bad_game'; end if;
  perform token_wallet(); -- wallet exists, signup bonus in
  -- an unfinished CPU game you walked away from counts as lost
  update chip_bets set status = 'lost', settled_at = now(), note = 'abandoned'
  where user_id = v_user and kind = 'cpu' and status = 'open';
  perform _tok_credit(v_user, -v_stake, 'bet', 'cpu:' || p_game); -- raises insufficient_earned
  insert into chip_bets (user_id, kind, game, match_id, players, stake)
  values (v_user, 'cpu', p_game, 'cpu-' || gen_random_uuid()::text, array[v_user], v_stake)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'stake', v_stake) || _bet_wallet(v_user);
end;
$$;

create or replace function public.bet_cpu_settle(p_bet uuid, p_result text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  b chip_bets%rowtype;
  v_net integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_result not in ('win', 'lose', 'draw') then raise exception 'bad_result'; end if;
  select * into b from chip_bets where id = p_bet and user_id = v_user and kind = 'cpu' for update;
  if not found then raise exception 'bad_bet'; end if;
  if b.status = 'open' then
    if p_result = 'lose' then
      perform _bet_close(b.id, 'lost', 0, null);
    elsif p_result = 'draw' then
      perform _bet_close(b.id, 'draw', b.stake, null);
    elsif now() - b.opened_at < make_interval(secs => _bet_cpu_min_secs(b.game)) then
      perform _bet_close(b.id, 'refunded', b.stake, 'too_fast');
    else
      select coalesce(sum(payout - stake), 0) into v_net from chip_bets
      where user_id = v_user and kind = 'cpu' and status <> 'open' and settled_at >= _bet_today_start();
      if v_net >= _bet_const('cpu_daily_cap') then
        perform _bet_close(b.id, 'won', b.stake, 'capped');
      else
        perform _bet_close(b.id, 'won', 2 * b.stake, null);
      end if;
    end if;
    select * into b from chip_bets where id = p_bet;
  end if;
  return jsonb_build_object('id', b.id, 'status', b.status, 'stake', b.stake, 'payout', b.payout, 'note', b.note) || _bet_wallet(v_user);
end;
$$;

-- ---------- online matches ----------
create or replace function public.bet_match_join(p_game text, p_match text, p_kind text, p_stake integer, p_players uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_first chip_bets%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('chess', 'ludo', 'carrom', 'arrows', 'pool') then raise exception 'bad_game'; end if;
  if p_match is null or length(p_match) not between 6 and 80 then raise exception 'bad_match'; end if;
  if p_kind not in ('room', 'random') then raise exception 'bad_kind'; end if;
  if p_kind = 'random' and p_stake <> _bet_const('random_stake') then raise exception 'bad_stake'; end if;
  if p_kind = 'room' and (p_stake is null or p_stake < _bet_const('room_min')) then raise exception 'bad_stake'; end if;
  p_players := coalesce(p_players, '{}');
  if not (v_user = any (p_players)) or cardinality(p_players) not between 2 and 4 then raise exception 'bad_players'; end if;

  perform pg_advisory_xact_lock(hashtext('bet:' || p_game || ':' || p_match));
  -- already in?
  select id into v_id from chip_bets where game = p_game and match_id = p_match and user_id = v_user;
  if found then return jsonb_build_object('id', v_id) || _bet_wallet(v_user); end if;
  -- everyone in a match stakes the same amount, on the same players
  select * into v_first from chip_bets where game = p_game and match_id = p_match order by opened_at limit 1;
  if found then
    if v_first.status <> 'open' then raise exception 'match_settled'; end if;
    if v_first.stake <> p_stake or v_first.kind <> p_kind then raise exception 'stake_mismatch'; end if;
    if not (v_first.players @> p_players and p_players @> v_first.players) then raise exception 'bad_players'; end if;
  end if;
  -- the match must not be over already
  if exists (select 1 from match_reports where game = p_game and match_id = p_match) then raise exception 'match_settled'; end if;

  perform token_wallet();
  perform _tok_credit(v_user, -p_stake, 'bet', p_game || ':' || p_match); -- raises insufficient_earned
  insert into chip_bets (user_id, kind, game, match_id, players, stake)
  values (v_user, p_kind, p_game, p_match, p_players, p_stake)
  returning id into v_id;
  return jsonb_build_object('id', v_id) || _bet_wallet(v_user);
end;
$$;

-- Settle a match's bets if its result is known. p_force: decide with the reports that arrived
-- even if some are missing (used once the first report is old enough).
create or replace function public._bet_try_settle(p_game text, p_match text, p_force boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_bets chip_bets[];
  v_players uuid[];
  v_stakers uuid[];
  v_nrep integer;
  v_first timestamptz;
  v_claims integer;
  v_draws integer;
  v_winners uuid[];
  v_pot integer;
  v_each integer;
  v_rest integer;
  b chip_bets;
  w uuid;
  i integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bet:' || p_game || ':' || p_match));
  select array_agg(c order by c.opened_at) into v_bets from chip_bets c
  where c.game = p_game and c.match_id = p_match and c.status = 'open' and c.kind <> 'cpu';
  if v_bets is null then return; end if;
  v_players := v_bets[1].players;
  select array_agg(x.user_id) into v_stakers from unnest(v_bets) x;

  -- What the stakers reported. A report with no winners and no draw is a forfeit / "I lost"
  -- (leaving mid-match reports that), so it claims nothing. Count the draws and the different
  -- winner claims.
  select count(*), min(r.created_at),
         count(*) filter (where r.draw),
         count(distinct array_to_string(array(select u::text from unnest(r.winners) u order by 1), ','))
           filter (where not r.draw and cardinality(r.winners) > 0)
    into v_nrep, v_first, v_draws, v_claims
  from match_reports r where r.game = p_game and r.match_id = p_match and r.user_id = any (v_stakers);

  if v_nrep = 0 then
    -- nobody finished it: give the stakes back after a long while
    if v_bets[1].opened_at < now() - interval '3 hours' then
      foreach b in array v_bets loop perform _bet_close(b.id, 'refunded', b.stake, 'no_result'); end loop;
    end if;
    return;
  end if;
  -- wait for every staker's report, unless it's overdue
  if v_nrep < cardinality(v_stakers) and not p_force
     and v_first > now() - make_interval(mins => _bet_const('settle_after_min')) then
    return;
  end if;

  -- not every player staked: the bet never started, refund everyone
  if not (v_stakers @> v_players) then
    foreach b in array v_bets loop perform _bet_close(b.id, 'refunded', b.stake, 'not_all_staked'); end loop;
    return;
  end if;
  -- a draw everyone agrees on, or nobody claims a win: stakes back
  if (v_draws > 0 and v_draws = v_nrep) or (v_draws = 0 and v_claims = 0) then
    foreach b in array v_bets loop perform _bet_close(b.id, 'draw', b.stake, null); end loop;
    return;
  end if;
  -- a draw against a win, or two different winners claimed: refund everyone
  if v_draws > 0 or v_claims > 1 then
    foreach b in array v_bets loop perform _bet_close(b.id, 'refunded', b.stake, 'disagreed'); end loop;
    return;
  end if;

  select r.winners into v_winners from match_reports r
  where r.game = p_game and r.match_id = p_match and r.user_id = any (v_stakers)
    and not r.draw and cardinality(r.winners) > 0 limit 1;
  -- a claimed winner who reported a loss or draw themselves, or a winner who never staked: refund
  if not (v_winners <@ v_stakers) or exists (
    select 1 from match_reports r where r.game = p_game and r.match_id = p_match
      and r.user_id = any (v_winners) and (r.draw or cardinality(r.winners) = 0)
  ) then
    foreach b in array v_bets loop perform _bet_close(b.id, 'refunded', b.stake, 'disagreed'); end loop;
    return;
  end if;

  select sum(x.stake) into v_pot from unnest(v_bets) x;
  v_each := v_pot / cardinality(v_winners);
  v_rest := v_pot - v_each * cardinality(v_winners);
  foreach b in array v_bets loop
    if b.user_id = any (v_winners) then
      i := i + 1;
      perform _bet_close(b.id, 'won', v_each + case when i = 1 then v_rest else 0 end, null);
    else
      perform _bet_close(b.id, 'lost', 0, null);
    end if;
  end loop;
end;
$$;

create or replace function public.bet_match_status(p_game text, p_match text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  b chip_bets%rowtype;
  v_first timestamptz;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select min(created_at) into v_first from match_reports where game = p_game and match_id = p_match;
  perform _bet_try_settle(p_game, p_match,
    v_first is not null and v_first < now() - make_interval(mins => _bet_const('settle_after_min')));
  select * into b from chip_bets where game = p_game and match_id = p_match and user_id = v_user;
  if not found then return jsonb_build_object('status', 'none') || _bet_wallet(v_user); end if;
  return jsonb_build_object('id', b.id, 'status', b.status, 'stake', b.stake, 'payout', b.payout, 'note', b.note) || _bet_wallet(v_user);
end;
$$;

-- ---------- gifts ----------
create or replace function public._gift_sent_today(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer from chip_gifts where from_user = p_user and created_at >= _bet_today_start()
$$;

create or replace function public.gift_limits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_age interval;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select now() - created_at into v_age from auth.users where id = v_user;
  return jsonb_build_object(
    'cap', _bet_const('gift_daily_cap'),
    'sent_today', _gift_sent_today(v_user),
    'old_enough', v_age >= make_interval(days => _bet_const('gift_min_age_days')),
    'min_age_days', _bet_const('gift_min_age_days')
  ) || _bet_wallet(v_user);
end;
$$;

create or replace function public.gift_chips(p_to uuid, p_amount integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_age interval;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_to is null or p_to = v_user then raise exception 'bad_recipient'; end if;
  if not exists (select 1 from auth.users where id = p_to) then raise exception 'bad_recipient'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'bad_amount'; end if;
  select now() - created_at into v_age from auth.users where id = v_user;
  if v_age < make_interval(days => _bet_const('gift_min_age_days')) then raise exception 'account_too_new'; end if;
  -- one gift at a time per sender (the daily total can't be raced past)
  perform pg_advisory_xact_lock(hashtext('gift:' || v_user::text));
  if _gift_sent_today(v_user) + p_amount > _bet_const('gift_daily_cap') then raise exception 'gift_limit'; end if;
  p_note := nullif(left(btrim(coalesce(p_note, '')), 80), '');

  perform token_wallet();
  perform _tok_credit(v_user, -p_amount, 'gift', 'to:' || p_to::text); -- raises insufficient_earned
  perform _tok_credit(p_to, p_amount, 'gift', 'from:' || v_user::text);
  insert into chip_gifts (from_user, to_user, amount, note) values (v_user, p_to, p_amount, p_note);
  return gift_limits();
end;
$$;

-- ---------- access ----------
revoke all on function public._bet_const(text) from public, anon, authenticated;
revoke all on function public._bet_cpu_min_secs(text) from public, anon, authenticated;
revoke all on function public._bet_wallet(uuid) from public, anon, authenticated;
revoke all on function public._bet_close(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public._bet_try_settle(text, text, boolean) from public, anon, authenticated;
revoke all on function public._gift_sent_today(uuid) from public, anon, authenticated;
revoke all on function public.bet_cpu_open(text) from public, anon;
revoke all on function public.bet_cpu_settle(uuid, text) from public, anon;
revoke all on function public.bet_match_join(text, text, text, integer, uuid[]) from public, anon;
revoke all on function public.bet_match_status(text, text) from public, anon;
revoke all on function public.gift_limits() from public, anon;
revoke all on function public.gift_chips(uuid, integer, text) from public, anon;
grant execute on function public.bet_cpu_open(text) to authenticated;
grant execute on function public.bet_cpu_settle(uuid, text) to authenticated;
grant execute on function public.bet_match_join(text, text, text, integer, uuid[]) to authenticated;
grant execute on function public.bet_match_status(text, text) to authenticated;
grant execute on function public.gift_limits() to authenticated;
grant execute on function public.gift_chips(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
