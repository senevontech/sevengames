-- ============================================================
-- Chess ratings + leaderboard (online games)
-- Run in: Supabase Dashboard → SQL Editor, AFTER schema.sql. Safe to re-run.
--
--   * Every player starts at 1200. Elo with K = 32 (K = 40 for a player's first 10 games).
--   * After an online game BOTH players report the result with chess_report(match, opponent,
--     result). The rating only changes when the two reports agree (one says win and the other
--     loss, or both say draw), so nobody can award themselves wins. Games where a player left
--     without reporting don't change ratings.
--   * Ratings are public (the leaderboard); reports are private.
-- ============================================================

create table if not exists public.chess_ratings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating integer not null default 1200,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.chess_reports (
  match_id text not null check (length(match_id) between 8 and 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  opponent uuid not null references auth.users(id) on delete cascade,
  result text not null check (result in ('win', 'loss', 'draw')),
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.chess_ratings enable row level security;
alter table public.chess_reports enable row level security;
drop policy if exists "Public chess ratings" on public.chess_ratings;
create policy "Public chess ratings" on public.chess_ratings for select to anon, authenticated using (true);
drop policy if exists "Own chess reports" on public.chess_reports;
create policy "Own chess reports" on public.chess_reports for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: changes only through chess_report().

-- Report this player's result. Returns { applied, rating, delta }.
create or replace function public.chess_report(p_match text, p_opponent uuid, p_result text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_other chess_reports%rowtype;
  ra integer;
  rb integer;
  ga integer;
  gb integer;
  sa numeric;
  ea numeric;
  ka integer;
  kb integer;
  da integer;
  db integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_opponent is null or p_opponent = v_user then raise exception 'bad_opponent'; end if;
  if p_result not in ('win', 'loss', 'draw') then raise exception 'bad_result'; end if;

  insert into chess_reports (match_id, user_id, opponent, result) values (p_match, v_user, p_opponent, p_result)
  on conflict (match_id, user_id) do nothing;

  select * into v_other from chess_reports where match_id = p_match and user_id = p_opponent and opponent = v_user for update;
  if not found or v_other.applied then
    return jsonb_build_object('applied', false, 'rating', coalesce((select rating from chess_ratings where user_id = v_user), 1200));
  end if;
  -- the two reports must agree
  if not ((p_result = 'win' and v_other.result = 'loss') or (p_result = 'loss' and v_other.result = 'win')
          or (p_result = 'draw' and v_other.result = 'draw')) then
    return jsonb_build_object('applied', false, 'rating', coalesce((select rating from chess_ratings where user_id = v_user), 1200));
  end if;

  insert into chess_ratings (user_id) values (v_user), (p_opponent) on conflict (user_id) do nothing;
  select rating, wins + losses + draws into ra, ga from chess_ratings where user_id = v_user for update;
  select rating, wins + losses + draws into rb, gb from chess_ratings where user_id = p_opponent for update;
  sa := case p_result when 'win' then 1 when 'loss' then 0 else 0.5 end;
  ea := 1 / (1 + power(10, (rb - ra) / 400.0));
  ka := case when ga < 10 then 40 else 32 end;
  kb := case when gb < 10 then 40 else 32 end;
  da := round(ka * (sa - ea));
  db := round(kb * ((1 - sa) - (1 - ea)));

  update chess_ratings set rating = greatest(100, rating + da),
    wins = wins + (p_result = 'win')::int, losses = losses + (p_result = 'loss')::int, draws = draws + (p_result = 'draw')::int,
    updated_at = now()
  where user_id = v_user;
  update chess_ratings set rating = greatest(100, rating + db),
    wins = wins + (p_result = 'loss')::int, losses = losses + (p_result = 'win')::int, draws = draws + (p_result = 'draw')::int,
    updated_at = now()
  where user_id = p_opponent;
  update chess_reports set applied = true where match_id = p_match;

  return jsonb_build_object('applied', true, 'rating', (select rating from chess_ratings where user_id = v_user), 'delta', da);
end;
$$;

-- Top players with their names and avatars. (The avatar column comes from schema.sql; add it
-- here too in case this database was set up before it existed.)
alter table public.profiles add column if not exists avatar jsonb;

create or replace view public.chess_leaderboard as
select r.user_id, coalesce(p.display_name, 'Player') as display_name, p.avatar, r.rating, r.wins, r.losses, r.draws
from chess_ratings r
left join profiles p on p.id = r.user_id
where r.wins + r.losses + r.draws > 0;

grant select on public.chess_leaderboard to anon, authenticated;
revoke all on function public.chess_report(text, uuid, text) from public, anon;
grant execute on function public.chess_report(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
