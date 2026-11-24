-- ============================================================
-- Draw a Tune: posted songs, likes, a posting streak and XP.
-- Run in: Supabase Dashboard → SQL Editor, AFTER shop.sql (game_xp) and schema.sql (profiles).
-- Safe to re-run.
--
--   * A song is a drawing (strokes + scale/key/tempo/beat) stored as jsonb. Anyone can open a
--     song by its id (share links); lists come from tune_list(): today's songs, the most liked
--     of all time, and your own.
--   * tune_post(): up to 20 songs a day, one every 10 seconds. The first song each day (India time)
--     gives 30 XP and keeps your streak going. No chips.
--   * tune_like() toggles a like (not on your own songs). tune_delete() removes your own song.
--   * hidden = true takes a song out of every list and link (set it by hand to moderate).
-- ============================================================

-- XP for tune (keep this game list in sync with shop.sql, matches.sql and chain.sql)
alter table public.game_xp drop constraint if exists game_xp_game_check;
alter table public.game_xp add constraint game_xp_game_check check (game in ('chess', 'ludo', 'arrows', 'pool', 'chain', 'tune'));

create table if not exists public.tune_songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  title text check (title is null or char_length(title) between 1 and 32),
  song jsonb not null,
  likes integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tune_songs_day on public.tune_songs (day, likes desc, created_at desc) where not hidden;
create index if not exists tune_songs_best on public.tune_songs (likes desc, created_at desc) where not hidden;
create index if not exists tune_songs_user on public.tune_songs (user_id, created_at desc);
alter table public.tune_songs enable row level security;

create table if not exists public.tune_likes (
  song_id uuid not null references public.tune_songs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);
alter table public.tune_likes enable row level security;
-- No policies on either table: read and write through the functions below.

create or replace function public._tune_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- days in a row (ending today, or yesterday if nothing is posted yet today) with a song posted
create or replace function public._tune_streak(p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  d date := _tune_today();
  n integer := 0;
begin
  if not exists (select 1 from tune_songs where user_id = p_user and day = d) then
    d := d - 1;
  end if;
  while exists (select 1 from tune_songs where user_id = p_user and day = d) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end;
$$;

create or replace function public.tune_streak()
returns integer language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else _tune_streak(auth.uid()) end
$$;

-- one song as the browser sees it
create or replace function public._tune_row(s public.tune_songs, p_me uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id,
    'user_id', s.user_id,
    'name', coalesce(p.display_name, 'Player'),
    'avatar', p.avatar,
    'title', s.title,
    'likes', s.likes,
    'liked', p_me is not null and exists (select 1 from tune_likes l where l.song_id = s.id and l.user_id = p_me),
    'mine', p_me is not null and s.user_id = p_me,
    'day', s.day,
    'song', s.song
  )
  from (select 1) one left join profiles p on p.id = s.user_id
$$;

-- Post a song. Returns { id, xp, streak }.
create or replace function public.tune_post(p_title text, p_song jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := _tune_today();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_first boolean;
  v_id uuid;
  v_xp integer := 0;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_song is null or jsonb_typeof(p_song) <> 'object' or jsonb_typeof(p_song -> 'strokes') <> 'array' then raise exception 'bad_song'; end if;
  if jsonb_array_length(p_song -> 'strokes') = 0 then raise exception 'empty'; end if;
  if jsonb_array_length(p_song -> 'strokes') > 400 or length(p_song::text) > 60000 then raise exception 'too_big'; end if;
  if v_title is not null then v_title := left(v_title, 32); end if;
  if exists (select 1 from tune_songs where user_id = v_user and created_at > now() - interval '10 seconds') then
    raise exception 'too_fast';
  end if;
  if (select count(*) from tune_songs where user_id = v_user and day = v_today) >= 20 then
    raise exception 'daily_limit';
  end if;
  v_first := not exists (select 1 from tune_songs where user_id = v_user and day = v_today);
  insert into tune_songs (user_id, day, title, song) values (v_user, v_today, v_title, p_song) returning id into v_id;
  if v_first then
    v_xp := 30;
    insert into game_xp (user_id, game) values (v_user, 'tune') on conflict do nothing;
    update game_xp set xp = xp + v_xp, last_award = now() where user_id = v_user and game = 'tune';
  end if;
  -- a name on the cards
  insert into profiles (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
  from auth.users u where u.id = v_user
  on conflict (id) do nothing;
  return jsonb_build_object('id', v_id, 'xp', v_xp, 'streak', _tune_streak(v_user));
end;
$$;

-- One song by id (share links). Null if it doesn't exist or is hidden.
create or replace function public.tune_get(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select _tune_row(s, auth.uid()) from tune_songs s where s.id = p_id and not s.hidden
$$;

-- A list: 'today' (today's songs, most liked first), 'best' (most liked ever), 'mine'.
create or replace function public.tune_list(p_tab text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_out jsonb;
begin
  if p_tab = 'today' then
    select coalesce(jsonb_agg(_tune_row(s, v_me) order by s.likes desc, s.created_at desc), '[]'::jsonb) into v_out
    from (select * from tune_songs where day = _tune_today() and not hidden order by likes desc, created_at desc limit 30) s;
  elsif p_tab = 'best' then
    select coalesce(jsonb_agg(_tune_row(s, v_me) order by s.likes desc, s.created_at desc), '[]'::jsonb) into v_out
    from (select * from tune_songs where not hidden and likes > 0 order by likes desc, created_at desc limit 30) s;
  elsif p_tab = 'mine' then
    if v_me is null then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(_tune_row(s, v_me) order by s.created_at desc), '[]'::jsonb) into v_out
    from (select * from tune_songs where user_id = v_me and not hidden order by created_at desc limit 30) s;
  else
    raise exception 'bad_tab';
  end if;
  return v_out;
end;
$$;

-- Like / unlike. Returns { liked, likes }.
create or replace function public.tune_like(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_liked boolean;
  v_likes integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select user_id into v_owner from tune_songs where id = p_id and not hidden for update;
  if v_owner is null then raise exception 'no_song'; end if;
  if v_owner = v_user then raise exception 'own_song'; end if;
  delete from tune_likes where song_id = p_id and user_id = v_user;
  if found then
    v_liked := false;
  else
    insert into tune_likes (song_id, user_id) values (p_id, v_user);
    v_liked := true;
  end if;
  update tune_songs set likes = (select count(*) from tune_likes where song_id = p_id) where id = p_id returning likes into v_likes;
  return jsonb_build_object('liked', v_liked, 'likes', v_likes);
end;
$$;

create or replace function public.tune_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from tune_songs where id = p_id and user_id = auth.uid();
end;
$$;

revoke all on function public._tune_today() from public, anon, authenticated;
revoke all on function public._tune_streak(uuid) from public, anon, authenticated;
revoke all on function public._tune_row(public.tune_songs, uuid) from public, anon, authenticated;
revoke all on function public.tune_post(text, jsonb) from public, anon;
grant execute on function public.tune_post(text, jsonb) to authenticated;
revoke all on function public.tune_like(uuid) from public, anon;
grant execute on function public.tune_like(uuid) to authenticated;
revoke all on function public.tune_delete(uuid) from public, anon;
grant execute on function public.tune_delete(uuid) to authenticated;
revoke all on function public.tune_streak() from public;
grant execute on function public.tune_streak() to anon, authenticated;
revoke all on function public.tune_get(uuid) from public;
grant execute on function public.tune_get(uuid) to anon, authenticated;
revoke all on function public.tune_list(text) from public;
grant execute on function public.tune_list(text) to anon, authenticated;

notify pgrst, 'reload schema';
