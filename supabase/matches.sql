-- ============================================================
-- Online match results: XP for every online game + 1 token for a confirmed win.
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql, shop.sql and carrom.sql. Safe to re-run.
--
-- Rules (online matches only; vs CPU / same-device games keep their own XP):
--   * win  → +100 XP, and +1 token once the result is CONFIRMED
--   * loss → −40 XP, never below the start of your current level (you never lose a level)
--   * draw → +30 XP each, no token
--   * Every player's device reports with match_report(). XP applies straight away for your own
--     report (at most one XP change per game every 20 s, so made-up matches can't farm it).
--   * The token is paid only when another player in the same match reports the same winners
--     (the loser confirms), so nobody can award themselves tokens. Leaving mid-match reports a
--     loss, which confirms the other player's win.
--   * Token limits: 10 win tokens a day in total, and 3 a day from the same opponent.
--   * XP goes to: chess / ludo / arrows / pool → game_xp (shop.sql), carrom → carrom_profiles.
-- ============================================================

-- the token ledger gets a 'match' reason (keep this list in sync with tokens.sql and friends)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match', 'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift'));

-- Arrows and Pool get their own XP
alter table public.game_xp drop constraint if exists game_xp_game_check;
alter table public.game_xp add constraint game_xp_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain'));

create table if not exists public.match_reports (
  game text not null check (game in ('chess', 'ludo', 'carrom', 'arrows', 'pool')),
  match_id text not null check (length(match_id) between 6 and 80),
  user_id uuid not null references auth.users(id) on delete cascade,
  players uuid[] not null,
  winners uuid[] not null default '{}',
  draw boolean not null default false,
  xp_delta integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (game, match_id, user_id)
);
-- (tables made before Pool existed: widen the game list)
alter table public.match_reports drop constraint if exists match_reports_game_check;
alter table public.match_reports add constraint match_reports_game_check check (game in ('chess', 'ludo', 'carrom', 'arrows', 'pool'));
create index if not exists match_reports_user_idx on public.match_reports (user_id, game, created_at desc);

-- win tokens paid (one per match), for the daily limits
create table if not exists public.match_tokens (
  game text not null,
  match_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_by uuid not null,
  paid_at timestamptz not null default now(),
  primary key (game, match_id, user_id)
);
create index if not exists match_tokens_user_idx on public.match_tokens (user_id, paid_at desc);

alter table public.match_reports enable row level security;
alter table public.match_tokens enable row level security;
drop policy if exists "Own match reports" on public.match_reports;
create policy "Own match reports" on public.match_reports for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own match tokens" on public.match_tokens;
create policy "Own match tokens" on public.match_tokens for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: changes only through match_report().

-- XP change for one game, never dropping below the start of the current level. Returns the change made.
create or replace function public._match_xp(p_user uuid, p_game text, p_delta integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_xp integer;
  v_floor integer;
  v_lvl integer;
  v_new integer;
begin
  if p_game = 'carrom' then
    insert into carrom_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
    select xp into v_xp from carrom_profiles where user_id = p_user for update;
  else
    insert into game_xp (user_id, game) values (p_user, p_game) on conflict do nothing;
    select xp into v_xp from game_xp where user_id = p_user and game = p_game for update;
  end if;
  v_xp := coalesce(v_xp, 0);
  -- level from XP (total XP for level L is 50·L·(L−1)), and where that level starts
  v_lvl := least(30, greatest(1, floor((1 + sqrt(1 + 4 * v_xp / 50.0)) / 2)::integer));
  v_floor := 50 * v_lvl * (v_lvl - 1);
  v_new := case when p_delta < 0 then greatest(v_floor, v_xp + p_delta) else v_xp + p_delta end;
  if p_game = 'carrom' then
    update carrom_profiles set xp = v_new where user_id = p_user;
  else
    update game_xp set xp = v_new, last_award = now() where user_id = p_user and game = p_game;
  end if;
  return v_new - v_xp;
end;
$$;

-- Pay the win token for a match if its winners are confirmed by a non-winner, within the limits.
create or replace function public._match_pay(p_game text, p_match text)
returns void language plpgsql security definer set search_path = public as $$
declare
  w uuid;
  v_conf uuid;
  v_winners uuid[];
begin
  -- the winners as a non-winner reported them (that report is the confirmation)
  select r.user_id, r.winners into v_conf, v_winners from match_reports r
  where r.game = p_game and r.match_id = p_match and not r.draw
    and cardinality(r.winners) > 0 and not (r.user_id = any (r.winners))
  order by r.created_at limit 1;
  if v_conf is null then return; end if;
  foreach w in array v_winners loop
    -- the winner must have reported the same winners themselves
    continue when not exists (
      select 1 from match_reports r where r.game = p_game and r.match_id = p_match and r.user_id = w
        and not r.draw and r.winners @> v_winners and v_winners @> r.winners
    );
    continue when exists (select 1 from match_tokens where game = p_game and match_id = p_match and user_id = w);
    -- limits: 10 a day in total, 3 a day from the same opponent
    continue when (select count(*) from match_tokens where user_id = w and paid_at > now() - interval '1 day') >= 10;
    continue when (select count(*) from match_tokens where user_id = w and confirmed_by = v_conf and paid_at > now() - interval '1 day') >= 3;
    insert into match_tokens (game, match_id, user_id, confirmed_by) values (p_game, p_match, w, v_conf);
    perform token_wallet_for(w);
    perform _tok_credit(w, 1, 'match', p_game || ':' || p_match);
  end loop;
end;
$$;

-- Report this player's result for one online match.
--   p_players: every signed-in player's id in the match (including you)
--   p_winners: the winning player(s) (two in 2v2 carrom); empty when a CPU won
--   p_draw:    the match was a draw
-- Returns { xp_delta, token, xp, level }. Reporting the same match again changes nothing.
create or replace function public.match_report(p_game text, p_match text, p_players uuid[], p_winners uuid[], p_draw boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_prev match_reports%rowtype;
  v_won boolean;
  v_delta integer := 0;
  v_recent boolean;
  v_xp integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('chess', 'ludo', 'carrom', 'arrows', 'pool') then raise exception 'bad_game'; end if;
  if p_match is null or length(p_match) not between 6 and 80 then raise exception 'bad_match'; end if;
  p_players := coalesce(p_players, '{}');
  p_winners := coalesce(p_winners, '{}');
  if not (v_user = any (p_players)) or cardinality(p_players) > 4 then raise exception 'bad_players'; end if;
  if not (p_winners <@ p_players) or cardinality(p_winners) > 2 then raise exception 'bad_winners'; end if;
  if p_draw then p_winners := '{}'; end if;
  v_won := v_user = any (p_winners);

  select * into v_prev from match_reports where game = p_game and match_id = p_match and user_id = v_user;
  if not found then
    -- one XP change per game every 20 seconds (stops made-up matches from farming XP)
    v_recent := exists (select 1 from match_reports where user_id = v_user and game = p_game and created_at > now() - interval '20 seconds');
    if not v_recent then
      v_delta := _match_xp(v_user, p_game, case when p_draw then 30 when v_won then 100 else -40 end);
    end if;
    insert into match_reports (game, match_id, user_id, players, winners, draw, xp_delta)
    values (p_game, p_match, v_user, p_players, p_winners, p_draw, v_delta);
  else
    v_delta := v_prev.xp_delta;
  end if;

  perform _match_pay(p_game, p_match);
  -- chip match entries (entries.sql): the prize is paid once every player's report agrees
  if to_regprocedure('public._entry_try_settle(text,text,boolean)') is not null then
    perform _entry_try_settle(p_game, p_match, false);
  end if;

  if p_game = 'carrom' then
    select xp into v_xp from carrom_profiles where user_id = v_user;
  else
    select xp into v_xp from game_xp where user_id = v_user and game = p_game;
  end if;
  return jsonb_build_object(
    'xp_delta', v_delta,
    'token', exists (select 1 from match_tokens where game = p_game and match_id = p_match and user_id = v_user),
    'xp', coalesce(v_xp, 0)
  );
end;
$$;

-- Has my win token for this match been paid yet? (The loser may confirm a moment after I report.)
create or replace function public.match_token_paid(p_game text, p_match text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from match_tokens where game = p_game and match_id = p_match and user_id = auth.uid())
$$;

revoke all on function public._match_xp(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._match_pay(text, text) from public, anon, authenticated;
revoke all on function public.match_report(text, text, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.match_report(text, text, uuid[], uuid[], boolean) to authenticated;
revoke all on function public.match_token_paid(text, text) from public, anon;
grant execute on function public.match_token_paid(text, text) to authenticated;

notify pgrst, 'reload schema';
