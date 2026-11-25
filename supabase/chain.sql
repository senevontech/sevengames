-- ============================================================
-- Chain Reaction: daily boards, endless runs, leaderboards, streak and XP.
-- Run in: Supabase Dashboard → SQL Editor, AFTER shop.sql (game_xp) and schema.sql (profiles).
-- Safe to re-run.
--
--   * Three variants: orbs, grid, dominoes. Two modes:
--       daily   — the same board for everyone each day (India time). Your FIRST finished run
--                 of the day is your official one; later runs are practice and aren't saved.
--       endless — rounds with rising targets; every finished run is saved, the best counts.
--   * chain_submit() saves a run (and its taps, so it can be replayed later) and gives XP:
--       daily: 30 XP the first time each day per variant; endless: 10 XP per round cleared (max 150).
--   * chain_board() returns a leaderboard (today's daily, or all-time endless bests) with your
--     own place, and your daily streak (days in a row with at least one official daily run).
--   * Scores come from the player's device (like every other game here); the server checks
--     ranges and keeps one official daily run.
-- ============================================================

-- XP for chain (keep this game list in sync with shop.sql and matches.sql)
alter table public.game_xp drop constraint if exists game_xp_game_check;
alter table public.game_xp add constraint game_xp_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune', 'lastcard'));

create table if not exists public.chain_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  variant text not null check (variant in ('orbs', 'grid', 'dominoes')),
  mode text not null check (mode in ('daily', 'endless')),
  day date not null,
  score integer not null check (score between 0 and 10000000),
  pieces integer not null default 0 check (pieces between 0 and 100000),
  rounds integer not null default 0 check (rounds between 0 and 10000),
  depth integer not null default 0 check (depth between 0 and 10000),
  input jsonb,
  created_at timestamptz not null default now()
);
-- one official daily run per variant per day
create unique index if not exists chain_runs_daily_once on public.chain_runs (user_id, variant, day) where mode = 'daily';
create index if not exists chain_runs_board on public.chain_runs (variant, mode, day, score desc);
create index if not exists chain_runs_user on public.chain_runs (user_id, created_at desc);
alter table public.chain_runs enable row level security;
-- No policies: read through chain_board(), write through chain_submit().

create or replace function public._chain_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- days in a row (ending today, or yesterday if today isn't played yet) with an official daily run
create or replace function public._chain_streak(p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  d date := _chain_today();
  n integer := 0;
begin
  if not exists (select 1 from chain_runs where user_id = p_user and mode = 'daily' and day = d) then
    d := d - 1;
  end if;
  while exists (select 1 from chain_runs where user_id = p_user and mode = 'daily' and day = d) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end;
$$;

create or replace function public._chain_xp(p_user uuid, p_amount integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  insert into game_xp (user_id, game) values (p_user, 'chain') on conflict do nothing;
  update game_xp set xp = xp + least(p_amount, 200), last_award = now() where user_id = p_user and game = 'chain';
end;
$$;

-- Save a finished run. Returns { official, xp, best, streak }.
create or replace function public.chain_submit(
  p_variant text, p_mode text, p_day date, p_score integer, p_pieces integer, p_rounds integer, p_depth integer, p_input jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := _chain_today();
  v_official boolean := false;
  v_xp integer := 0;
  v_best integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_variant not in ('orbs', 'grid', 'dominoes') or p_mode not in ('daily', 'endless') then raise exception 'bad_run'; end if;
  if p_score is null or p_score < 0 or p_score > 10000000 then raise exception 'bad_score'; end if;
  if p_input is not null and length(p_input::text) > 4000 then p_input := null; end if;
  -- at most one saved run every 3 seconds
  if exists (select 1 from chain_runs where user_id = v_user and created_at > now() - interval '3 seconds') then
    raise exception 'too_fast';
  end if;

  if p_mode = 'daily' then
    -- only today's board (a run started just before midnight still counts for yesterday)
    if p_day is null or p_day not between v_today - 1 and v_today then raise exception 'bad_day'; end if;
    if not exists (select 1 from chain_runs where user_id = v_user and variant = p_variant and mode = 'daily' and day = p_day) then
      insert into chain_runs (user_id, variant, mode, day, score, pieces, rounds, depth, input)
      values (v_user, p_variant, 'daily', p_day, p_score, greatest(0, coalesce(p_pieces, 0)), 0, greatest(0, coalesce(p_depth, 0)), p_input);
      v_official := true;
      v_xp := 30;
    end if;
    select score into v_best from chain_runs where user_id = v_user and variant = p_variant and mode = 'daily' and day = p_day;
  else
    insert into chain_runs (user_id, variant, mode, day, score, pieces, rounds, depth, input)
    values (v_user, p_variant, 'endless', v_today, p_score, greatest(0, coalesce(p_pieces, 0)), greatest(0, coalesce(p_rounds, 0)), greatest(0, coalesce(p_depth, 0)), p_input);
    v_official := true;
    v_xp := least(150, 10 * greatest(0, coalesce(p_rounds, 0)));
    select max(score) into v_best from chain_runs where user_id = v_user and variant = p_variant and mode = 'endless';
  end if;
  perform _chain_xp(v_user, v_xp);
  -- a name on the boards
  insert into profiles (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
  from auth.users u where u.id = v_user
  on conflict (id) do nothing;
  return jsonb_build_object('official', v_official, 'xp', v_xp, 'best', coalesce(v_best, 0), 'streak', _chain_streak(v_user));
end;
$$;

-- A leaderboard: today's daily board for a variant, or the all-time endless bests.
-- Returns { top: [{rank, user_id, name, avatar, score}], me: {rank, score} | null, played: bool, streak }.
create or replace function public.chain_board(p_variant text, p_mode text, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_day date := coalesce(p_day, _chain_today());
  v_top jsonb;
  v_me jsonb;
begin
  if p_variant not in ('orbs', 'grid', 'dominoes') or p_mode not in ('daily', 'endless') then raise exception 'bad_run'; end if;
  with best as (
    select user_id, max(score) as score
    from chain_runs
    where variant = p_variant and mode = p_mode and (p_mode = 'endless' or day = v_day)
    group by user_id
  ),
  ranked as (
    select user_id, score, rank() over (order by score desc) as rank from best
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'user_id', r.user_id, 'name', coalesce(p.display_name, 'Player'), 'avatar', p.avatar, 'score', r.score) order by r.rank, r.user_id), '[]'::jsonb)
       from (select * from ranked order by rank limit 20) r left join profiles p on p.id = r.user_id),
    (select jsonb_build_object('rank', rank, 'score', score, 'of', (select count(*) from ranked)) from ranked where user_id = v_user)
  into v_top, v_me;
  return jsonb_build_object(
    'top', v_top,
    'me', v_me,
    'played', v_user is not null and exists (select 1 from chain_runs where user_id = v_user and variant = p_variant and mode = 'daily' and day = v_day),
    'streak', case when v_user is null then 0 else _chain_streak(v_user) end
  );
end;
$$;

revoke all on function public._chain_today() from public, anon, authenticated;
revoke all on function public._chain_streak(uuid) from public, anon, authenticated;
revoke all on function public._chain_xp(uuid, integer) from public, anon, authenticated;
revoke all on function public.chain_submit(text, text, date, integer, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.chain_submit(text, text, date, integer, integer, integer, integer, jsonb) to authenticated;
revoke all on function public.chain_board(text, text, date) from public;
grant execute on function public.chain_board(text, text, date) to anon, authenticated;

notify pgrst, 'reload schema';
