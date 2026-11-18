-- ============================================================
-- Leaderboards: reliable score saving + an overall player ranking
-- Run in: Supabase Dashboard → SQL Editor, AFTER schema.sql. Safe to re-run.
--
--   * submit_score(): saves a finished round for the signed-in player. It runs on the server,
--     so it works even if the insert policy on game_scores is missing, and it adds basic sanity
--     checks (valid game id, score range, at most one score every 3 seconds).
--   * leaderboard_overall: one row per player. In every game a player's best result earns
--     points by place (1st = 10 … 10th = 1); the total is their overall score.
--     "Lower is better" games (keep in sync with isLowerBetter() in src/lib/scores.ts): minefield, slide.
-- ============================================================

create or replace function public.submit_score(p_game text, p_score integer, p_seconds integer default 0)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_game is null or p_game !~ '^[a-z0-9-]{1,40}$' then raise exception 'bad_game'; end if;
  if p_score is null or p_score < 0 or p_score > 1000000 then raise exception 'bad_score'; end if;
  if exists (select 1 from game_scores where user_id = v_user and created_at > now() - interval '3 seconds') then
    return false;
  end if;
  insert into game_scores (user_id, game_id, score, seconds)
  values (v_user, p_game, p_score, greatest(coalesce(p_seconds, 0), 0));
  -- make sure the player has a name on the board
  insert into profiles (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
  from auth.users u where u.id = v_user
  on conflict (id) do nothing;
  return true;
end;
$$;

revoke all on function public.submit_score(text, integer, integer) from public, anon;
grant execute on function public.submit_score(text, integer, integer) to authenticated;

create or replace view public.leaderboard_overall
with (security_invoker = false) as
with best as (
  select
    game_id,
    user_id,
    case when game_id in ('minefield', 'slide') then min(score) else max(score) end as best
  from game_scores
  group by game_id, user_id
),
ranked as (
  select
    user_id,
    game_id,
    rank() over (
      partition by game_id
      order by
        case when game_id in ('minefield', 'slide') then best end asc nulls last,
        case when game_id not in ('minefield', 'slide') then best end desc nulls last
    ) as place
  from best
),
plays as (
  select user_id, count(*) as rounds, count(distinct game_id) as games
  from game_scores
  group by user_id
)
select
  r.user_id,
  coalesce(p.display_name, 'Player') as display_name,
  sum(greatest(0, 11 - r.place))::integer as points,
  (count(*) filter (where r.place = 1))::integer as firsts,
  max(pl.rounds)::integer as rounds,
  max(pl.games)::integer as games,
  p.avatar
from ranked r
join plays pl on pl.user_id = r.user_id
left join profiles p on p.id = r.user_id
group by r.user_id, p.display_name, p.avatar;

grant select on public.leaderboard_overall to anon, authenticated;

notify pgrst, 'reload schema';
