-- ============================================================
-- Social: follows, friend requests, public player profiles, live leaderboard activity
-- Run in: Supabase Dashboard → SQL Editor, AFTER schema.sql and leaderboard.sql. Safe to re-run.
-- (carrom.sql, chess.sql and shop.sql are optional: their stats show on profiles when present.)
--
--   * follows: one-way, instant. Anyone can see who follows whom (counts on profiles).
--   * friend_requests: two-way; the other player accepts or declines. Only the two players
--     involved can see a request; friend counts are public through public_profile().
--   * public_profile(id): what anyone (even signed out) may see about a player — never the email.
--   * score_activity: a public "player X just finished a round of game Y" feed (no scores),
--     filled by a trigger on game_scores, so the live leaderboard can refresh in real time.
-- ============================================================

-- 1) Follows ------------------------------------------------------
create table if not exists public.follows (
  follower uuid not null references auth.users(id) on delete cascade,
  followee uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee);

alter table public.follows enable row level security;
drop policy if exists "Public follows" on public.follows;
create policy "Public follows" on public.follows for select to anon, authenticated using (true);
drop policy if exists "Follow as yourself" on public.follows;
create policy "Follow as yourself" on public.follows for insert to authenticated with check (auth.uid() = follower);
drop policy if exists "Unfollow as yourself" on public.follows;
create policy "Unfollow as yourself" on public.follows for delete to authenticated using (auth.uid() = follower);

-- 2) Friend requests ------------------------------------------------
create table if not exists public.friend_requests (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists friend_requests_to_idx on public.friend_requests (to_user, status);

alter table public.friend_requests enable row level security;
drop policy if exists "Own friend requests" on public.friend_requests;
create policy "Own friend requests" on public.friend_requests for select to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);
-- No insert / update / delete policies: changes only through the functions below.

-- Send a request (or accept theirs if they already asked you).
create or replace function public.friend_request(p_to uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_theirs friend_requests%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_to is null or p_to = v_user then raise exception 'bad_player'; end if;
  if exists (select 1 from friend_requests where status = 'accepted'
             and ((from_user = v_user and to_user = p_to) or (from_user = p_to and to_user = v_user))) then
    return 'friends';
  end if;
  select * into v_theirs from friend_requests where from_user = p_to and to_user = v_user;
  if found then
    update friend_requests set status = 'accepted', responded_at = now() where id = v_theirs.id;
    return 'friends';
  end if;
  -- at most 30 open requests a day, to stop spam
  if (select count(*) from friend_requests where from_user = v_user and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too_many_requests';
  end if;
  insert into friend_requests (from_user, to_user) values (v_user, p_to) on conflict (from_user, to_user) do nothing;
  return 'pending';
end;
$$;

-- Accept or decline a request sent to you (declining deletes it, so they may ask again later).
create or replace function public.friend_respond(p_id bigint, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_accept then
    update friend_requests set status = 'accepted', responded_at = now()
    where id = p_id and to_user = v_user and status = 'pending';
    return 'friends';
  end if;
  delete from friend_requests where id = p_id and to_user = v_user and status = 'pending';
  return 'none';
end;
$$;

-- Cancel your request, or unfriend.
create or replace function public.friend_remove(p_other uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  delete from friend_requests
  where (from_user = v_user and to_user = p_other) or (from_user = p_other and to_user = v_user and status = 'accepted');
  return 'none';
end;
$$;

-- 3) Public profile -------------------------------------------------
-- Optional stats from other modules (carrom, chess, shop) are read with dynamic SQL so this
-- function works whether or not those files have been run.
create or replace function public._opt_int(p_sql text, p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v integer;
begin
  execute p_sql into v using p_user;
  return v;
exception when undefined_table or undefined_column or undefined_function then
  return null;
end;
$$;

create or replace function public._opt_text(p_sql text, p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  execute p_sql into v using p_user;
  return v;
exception when undefined_table or undefined_column or undefined_function then
  return null;
end;
$$;

create or replace function public.public_profile(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_avatar jsonb;
  v_since timestamptz;
  v_overall record;
  v_rank integer;
  v_best jsonb;
  v_rel text := 'none';
  v_req bigint;
begin
  select coalesce(p.display_name, 'Player'), u.created_at into v_name, v_since
  from auth.users u left join profiles p on p.id = u.id where u.id = p_user;
  if v_since is null then return null; end if;
  begin
    execute 'select avatar from profiles where id = $1' into v_avatar using p_user;
  exception when undefined_column then v_avatar := null;
  end;

  select points, firsts, rounds, games into v_overall from leaderboard_overall where user_id = p_user;
  select count(*) + 1 into v_rank from leaderboard_overall where points > coalesce(v_overall.points, -1);

  -- best 3 games by place (then by how many rounds they've played there)
  with best as (
    select game_id, user_id,
      case when game_id in ('minefield', 'slide') then min(score) else max(score) end as best,
      count(*) as rounds
    from game_scores group by game_id, user_id
  ), ranked as (
    select game_id, user_id, best, rounds, rank() over (
      partition by game_id order by
        case when game_id in ('minefield', 'slide') then best end asc nulls last,
        case when game_id not in ('minefield', 'slide') then best end desc nulls last
    ) as place
    from best
  )
  select coalesce(jsonb_agg(jsonb_build_object('game', game_id, 'best', best, 'place', place) order by place, rounds desc), '[]'::jsonb)
  into v_best
  from (select * from ranked where user_id = p_user order by place, rounds desc limit 3) t;

  if v_me is not null and v_me <> p_user then
    select id into v_req from friend_requests where status = 'accepted'
      and ((from_user = v_me and to_user = p_user) or (from_user = p_user and to_user = v_me)) limit 1;
    if v_req is not null then v_rel := 'friends';
    else
      select id into v_req from friend_requests where from_user = v_me and to_user = p_user and status = 'pending';
      if v_req is not null then v_rel := 'requested';
      else
        select id into v_req from friend_requests where from_user = p_user and to_user = v_me and status = 'pending';
        if v_req is not null then v_rel := 'incoming'; end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id', p_user,
    'name', v_name,
    'avatar', v_avatar,
    'since', v_since,
    'followers', (select count(*) from follows where followee = p_user),
    'following', (select count(*) from follows where follower = p_user),
    'friends', (select count(*) from friend_requests where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'rounds', coalesce(v_overall.rounds, 0),
    'games', coalesce(v_overall.games, 0),
    'points', coalesce(v_overall.points, 0),
    'firsts', coalesce(v_overall.firsts, 0),
    'rank', case when v_overall.points is null then null else v_rank end,
    'best', v_best,
    'carrom_xp', _opt_int('select xp from carrom_profiles where user_id = $1', p_user),
    'chess_xp', _opt_int('select xp from game_xp where user_id = $1 and game = ''chess''', p_user),
    'ludo_xp', _opt_int('select xp from game_xp where user_id = $1 and game = ''ludo''', p_user),
    'chess_rating', _opt_int('select rating from chess_ratings where user_id = $1', p_user),
    'frame', _opt_text('select frame from player_cosmetics where user_id = $1', p_user),
    'chips', coalesce(_opt_int('select balance from token_wallets where user_id = $1', p_user), 0),
    'is_following', v_me is not null and exists (select 1 from follows where follower = v_me and followee = p_user),
    'relation', v_rel,
    'request_id', case when v_rel = 'incoming' then v_req end
  );
end;
$$;

-- 4) Live leaderboard activity --------------------------------------
create table if not exists public.score_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  game_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists score_activity_time_idx on public.score_activity (created_at);
alter table public.score_activity enable row level security;
drop policy if exists "Public score activity" on public.score_activity;
create policy "Public score activity" on public.score_activity for select to anon, authenticated using (true);

create or replace function public._score_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into score_activity (user_id, game_id) values (new.user_id, new.game_id);
  delete from score_activity where created_at < now() - interval '1 day';
  return new;
end;
$$;

drop trigger if exists game_scores_activity on public.game_scores;
create trigger game_scores_activity after insert on public.game_scores
  for each row execute function public._score_activity();

-- stream new activity rows to browsers (Supabase Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'score_activity') then
    alter publication supabase_realtime add table public.score_activity;
  end if;
end $$;

-- 5) Grants -------------------------------------------------------------
revoke all on function public._opt_int(text, uuid) from public, anon, authenticated;
revoke all on function public._opt_text(text, uuid) from public, anon, authenticated;
revoke all on function public._score_activity() from public, anon, authenticated;
revoke all on function public.friend_request(uuid) from public, anon;
revoke all on function public.friend_respond(bigint, boolean) from public, anon;
revoke all on function public.friend_remove(uuid) from public, anon;
grant execute on function public.friend_request(uuid) to authenticated;
grant execute on function public.friend_respond(bigint, boolean) to authenticated;
grant execute on function public.friend_remove(uuid) to authenticated;
grant execute on function public.public_profile(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
