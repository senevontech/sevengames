-- Most played games, for the home page carousel (most played in the centre, then the rest in
-- order). Counts game starts from the live site and the release app (public.events, see
-- analytics.sql) over the last 30 days; everyone can read the totals, nobody can read the rows.
-- Run after admin.sql / analytics.sql. Safe to re-run.

create index if not exists events_game_start_idx on public.events (created_at desc, game_id) where type = 'game_start';

create or replace function public.popular_games(p_days int default 30)
returns table (game_id text, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.game_id, count(*)::bigint as plays
  from public.events e
  where e.type = 'game_start'
    and e.game_id is not null
    and e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
  group by e.game_id
  order by plays desc, e.game_id
  limit 200;
$$;

revoke all on function public.popular_games(int) from public;
grant execute on function public.popular_games(int) to anon, authenticated;
