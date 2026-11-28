-- ============================================================
-- Engagement (business plan): daily login rewards, daily challenges, achievements, referrals,
-- weekly competitions, friend challenges, tournaments, Plus-only / early-access games and the
-- Senevon Interactive (B2B) enquiry form.
-- Run in: Supabase Dashboard → SQL Editor, AFTER schema.sql, social.sql, tokens.sql, shop.sql,
-- carrom.sql, matches.sql and analytics.sql. Safe to re-run.
--
-- Every reward goes through _tok_credit (tokens.sql), so it shows in the player's history.
-- Progress is read from what the server already records: saved scores (game_scores), online
-- match results (match_reports), friendships, levels and purchases.
-- ============================================================

-- the token ledger's reasons for these rewards (keep in sync with tokens.sql and friends)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match',
                    'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club', 'leaderboard'));

-- the week / day for weekly competitions (India first, per the plan)
create or replace function public._eng_tz() returns text language sql immutable as $$ select 'Asia/Kolkata' $$;

-- a valid time zone name, or the default
create or replace function public._eng_safe_tz(p_tz text)
returns text language sql stable as $$
  select case when p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else _eng_tz() end
$$;

-- Games where a lower score is better (time / moves). Keep in sync with isLowerBetter() in src/lib/scores.ts.
create or replace function public._lower_better(p_game text)
returns boolean language sql immutable as $$ select p_game in ('minefield', 'slide') $$;

-- ============================================================
-- 1) Daily login reward: a 7-day cycle, Plus members get double + 50
-- ============================================================
create table if not exists public.daily_login (
  user_id uuid primary key references auth.users(id) on delete cascade,
  run integer not null default 0,          -- consecutive days claimed
  best_run integer not null default 0,
  last_day date,
  last_at timestamptz,
  total integer not null default 0
);
alter table public.daily_login enable row level security;
drop policy if exists "Own daily login" on public.daily_login;
create policy "Own daily login" on public.daily_login for select to authenticated using (auth.uid() = user_id);

create or replace function public._daily_rewards() returns integer[] language sql immutable as $$
  select array[20, 25, 30, 40, 50, 60, 100]
$$;

create or replace function public.daily_state(p_tz text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone _eng_safe_tz(p_tz))::date;
  d daily_login%rowtype;
  v_run integer;
  v_claimed boolean;
  v_plus boolean;
  v_rewards integer[] := _daily_rewards();
  v_day integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into d from daily_login where user_id = v_user;
  v_claimed := d.last_day is not null and (d.last_day >= v_today or d.last_at > now() - interval '18 hours');
  v_run := case when v_claimed then d.run when d.last_day = v_today - 1 then coalesce(d.run, 0) + 1 else 1 end;
  v_day := ((v_run - 1) % 7) + 1;
  v_plus := _is_plus(v_user);
  return jsonb_build_object(
    'claimed', v_claimed,
    'run', coalesce(case when v_claimed then d.run else v_run - 1 end, 0),
    'day', v_day,
    'rewards', to_jsonb(v_rewards),
    'plus', v_plus,
    'reward', v_rewards[v_day] * (case when v_plus then 2 else 1 end) + (case when v_plus then 50 else 0 end),
    'best', coalesce(d.best_run, 0)
  );
end;
$$;

create or replace function public.daily_claim(p_tz text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone _eng_safe_tz(p_tz))::date;
  d daily_login%rowtype;
  v_run integer;
  v_day integer;
  v_plus boolean;
  v_amount integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  insert into daily_login (user_id) values (v_user) on conflict do nothing;
  select * into d from daily_login where user_id = v_user for update;
  -- once a day (and at least 18 h apart, so changing time zone doesn't give a second claim)
  if d.last_day is not null and (d.last_day >= v_today or d.last_at > now() - interval '18 hours') then
    raise exception 'already_claimed';
  end if;
  v_run := case when d.last_day = v_today - 1 then d.run + 1 else 1 end;
  v_day := ((v_run - 1) % 7) + 1;
  v_plus := _is_plus(v_user);
  v_amount := (_daily_rewards())[v_day] * (case when v_plus then 2 else 1 end) + (case when v_plus then 50 else 0 end);
  update daily_login set run = v_run, best_run = greatest(best_run, v_run), last_day = v_today, last_at = now(), total = total + 1
  where user_id = v_user;
  perform token_wallet_for(v_user);
  perform _tok_credit(v_user, v_amount, 'daily', 'day ' || v_day);
  return jsonb_build_object('amount', v_amount, 'day', v_day, 'run', v_run);
end;
$$;

-- ============================================================
-- 2) Daily challenges: the same 3 for everyone each day, + a bonus for all three
-- ============================================================
create table if not exists public.challenge_pool (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('play_any', 'play_game', 'play_distinct', 'score_game', 'win_online')),
  game_id text,
  target integer not null check (target > 0),
  reward integer not null check (reward between 0 and 1000),
  active boolean not null default true
);
alter table public.challenge_pool enable row level security;
drop policy if exists "Public challenge pool" on public.challenge_pool;
create policy "Public challenge pool" on public.challenge_pool for select to anon, authenticated using (true);

insert into public.challenge_pool (id, title, kind, game_id, target, reward) values
  ('play3', 'Play 3 games', 'play_any', null, 3, 40),
  ('play5', 'Play 5 games', 'play_any', null, 5, 60),
  ('variety3', 'Play 3 different games', 'play_distinct', null, 3, 60),
  ('win1', 'Win an online match', 'win_online', null, 1, 80),
  ('merge2', 'Play Merge twice', 'play_game', 'merge', 2, 30),
  ('serpent2', 'Play Serpent twice', 'play_game', 'serpent', 2, 30),
  ('stack2', 'Play Stack twice', 'play_game', 'stack', 2, 30),
  ('dodge2', 'Play Dodge twice', 'play_game', 'dodge', 2, 30),
  ('minefield1', 'Clear a Minefield board', 'play_game', 'minefield', 1, 40),
  ('gallows2', 'Play Gallows twice', 'play_game', 'gallows', 2, 30),
  ('brainline1', 'Finish a Brainline quiz', 'play_game', 'brainline', 1, 30),
  ('typewave2', 'Play Typewave twice', 'play_game', 'typewave', 2, 30),
  ('carrom1', 'Finish a Carrom match', 'play_game', 'carrom', 1, 50),
  ('noughts3', 'Play Noughts 3 times', 'play_game', 'noughts', 3, 30),
  ('merge1000', 'Score 1,000 in Merge', 'score_game', 'merge', 1000, 70)
on conflict (id) do nothing;

create table if not exists public.challenge_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  challenge_id text not null,           -- a pool id, or 'bonus'
  reward integer not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, day, challenge_id)
);
alter table public.challenge_claims enable row level security;
drop policy if exists "Own challenge claims" on public.challenge_claims;
create policy "Own challenge claims" on public.challenge_claims for select to authenticated using (auth.uid() = user_id);

-- the day's three challenges (the same for everyone, shuffled by the date)
create or replace function public._challenges_for(p_day date)
returns setof public.challenge_pool language sql stable as $$
  select * from challenge_pool where active order by md5(p_day::text || id) limit 3
$$;

-- a player's progress on one challenge, for one day (in their time zone)
create or replace function public._challenge_progress(p_user uuid, c public.challenge_pool, p_day date, p_tz text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := (p_day::timestamp) at time zone p_tz;
  v_to timestamptz := ((p_day + 1)::timestamp) at time zone p_tz;
begin
  return case c.kind
    when 'play_any' then (select count(*) from game_scores where user_id = p_user and created_at >= v_from and created_at < v_to)
    when 'play_game' then (select count(*) from game_scores where user_id = p_user and game_id = c.game_id and created_at >= v_from and created_at < v_to)
    when 'play_distinct' then (select count(distinct game_id) from game_scores where user_id = p_user and created_at >= v_from and created_at < v_to)
    when 'score_game' then coalesce((select max(score) from game_scores where user_id = p_user and game_id = c.game_id and created_at >= v_from and created_at < v_to), 0)
    when 'win_online' then (select count(*) from match_reports where user_id = p_user and user_id = any (winners) and created_at >= v_from and created_at < v_to)
    else 0 end;
end;
$$;

create or replace function public.challenges_today(p_tz text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tz text := _eng_safe_tz(p_tz);
  v_day date := (now() at time zone v_tz)::date;
begin
  return jsonb_build_object(
    'day', v_day,
    'bonus', 50,
    'bonus_claimed', v_user is not null and exists (select 1 from challenge_claims where user_id = v_user and day = v_day and challenge_id = 'bonus'),
    'ends_at', ((v_day + 1)::timestamp) at time zone v_tz,
    'list', (select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'game_id', c.game_id, 'target', c.target, 'reward', c.reward,
        'progress', case when v_user is null then 0 else least(c.target, _challenge_progress(v_user, c, v_day, v_tz)) end,
        'claimed', v_user is not null and exists (select 1 from challenge_claims where user_id = v_user and day = v_day and challenge_id = c.id)
      )) from _challenges_for(v_day) c)
  );
end;
$$;

create or replace function public.challenge_claim(p_id text, p_tz text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tz text := _eng_safe_tz(p_tz);
  v_day date := (now() at time zone v_tz)::date;
  c challenge_pool%rowtype;
  v_total integer := 0;
  v_rows integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into c from _challenges_for(v_day) x where x.id = p_id;
  if not found then raise exception 'bad_challenge'; end if;
  if _challenge_progress(v_user, c, v_day, v_tz) < c.target then raise exception 'not_done'; end if;
  insert into challenge_claims (user_id, day, challenge_id, reward) values (v_user, v_day, c.id, c.reward) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'already_claimed'; end if;
  perform token_wallet_for(v_user);
  perform _tok_credit(v_user, c.reward, 'challenge', c.id);
  v_total := c.reward;
  -- all three done: the bonus
  if (select count(*) from challenge_claims where user_id = v_user and day = v_day and challenge_id <> 'bonus') >= 3 then
    insert into challenge_claims (user_id, day, challenge_id, reward) values (v_user, v_day, 'bonus', 50) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform _tok_credit(v_user, 50, 'challenge', 'bonus');
      v_total := v_total + 50;
    end if;
  end if;
  return jsonb_build_object('amount', v_total);
end;
$$;

-- ============================================================
-- 3) Referrals: 250 tokens each when a new account signs up with a code
-- ============================================================
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique
);
create table if not exists public.referrals (
  referee uuid primary key references auth.users(id) on delete cascade,
  referrer uuid not null references auth.users(id) on delete cascade,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
drop policy if exists "Own referral code" on public.referral_codes;
create policy "Own referral code" on public.referral_codes for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own referrals" on public.referrals;
create policy "Own referrals" on public.referrals for select to authenticated using (auth.uid() = referrer or auth.uid() = referee);

create or replace function public.referral_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select code into v_code from referral_codes where user_id = v_user;
  if v_code is null then
    loop
      v_code := upper(substr(md5(random()::text || v_user::text), 1, 6));
      begin
        insert into referral_codes (user_id, code) values (v_user, v_code);
        exit;
      exception when unique_violation then
        -- this player already has one (two tabs), or the code is taken: try again / use theirs
        select code into v_code from referral_codes where user_id = v_user;
        exit when v_code is not null;
      end;
    end loop;
  end if;
  return jsonb_build_object(
    'code', v_code,
    'reward', 250,
    'cap', 20,
    'joined', (select count(*) from referrals where referrer = v_user),
    'paid', (select count(*) from referrals where referrer = v_user and paid),
    'referred_by', exists (select 1 from referrals where referee = v_user)
  );
end;
$$;

-- A new account uses a friend's code (within 7 days of signing up, once). Both get 250 tokens;
-- each player is paid for at most 20 friends.
create or replace function public.referral_claim(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ref uuid;
  v_created timestamptz;
  v_paid boolean := false;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select user_id into v_ref from referral_codes where code = upper(trim(coalesce(p_code, '')));
  if v_ref is null then raise exception 'bad_code'; end if;
  if v_ref = v_user then raise exception 'own_code'; end if;
  select created_at into v_created from profiles where id = v_user;
  if v_created is null or v_created < now() - interval '7 days' then raise exception 'too_late'; end if;
  if exists (select 1 from referrals where referee = v_user) then raise exception 'already_referred'; end if;
  v_paid := (select count(*) from referrals where referrer = v_ref and paid) < 20;
  insert into referrals (referee, referrer, paid) values (v_user, v_ref, v_paid);
  if v_paid then
    perform token_wallet_for(v_user);
    perform token_wallet_for(v_ref);
    perform _tok_credit(v_user, 250, 'referral', 'joined');
    perform _tok_credit(v_ref, 250, 'referral', v_user::text);
  end if;
  return jsonb_build_object('paid', v_paid, 'amount', case when v_paid then 250 else 0 end);
end;
$$;

-- ============================================================
-- 4) Weekly competition: one game a week, best score wins (prizes paid when the week ends)
-- ============================================================
create table if not exists public.weekly_games (
  week_start date primary key,           -- Monday (India time)
  game_id text not null,
  set_by_admin boolean not null default false,
  settled_at timestamptz
);
create table if not exists public.weekly_prizes (
  week_start date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank integer not null,
  score integer not null,
  prize integer not null,
  primary key (week_start, user_id)
);
alter table public.weekly_games enable row level security;
alter table public.weekly_prizes enable row level security;
drop policy if exists "Public weekly games" on public.weekly_games;
create policy "Public weekly games" on public.weekly_games for select to anon, authenticated using (true);
drop policy if exists "Public weekly prizes" on public.weekly_prizes;
create policy "Public weekly prizes" on public.weekly_prizes for select to anon, authenticated using (true);

create or replace function public._weekly_prize(p_rank integer) returns integer language sql immutable as $$
  select case when p_rank = 1 then 2000 when p_rank = 2 then 1000 when p_rank = 3 then 500 when p_rank <= 10 then 100 else 0 end
$$;

-- the week's game: set by the admin, or picked in turn from score games (higher score wins)
create or replace function public._weekly_game(p_week date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_game text;
  v_pool text[] := array['merge', 'serpent', 'stack', 'dodge', 'number-rush', 'typewave', 'brainline', 'mole patrol', 'pulse', 'echo', 'skyline', 'hue duo'];
begin
  select game_id into v_game from weekly_games where week_start = p_week;
  if v_game is null then
    v_game := v_pool[1 + ((p_week - date '2026-01-05') / 7) % array_length(v_pool, 1)];
    insert into weekly_games (week_start, game_id) values (p_week, v_game) on conflict (week_start) do nothing;
    select game_id into v_game from weekly_games where week_start = p_week;
  end if;
  return v_game;
end;
$$;

-- the week's board: best score per player in that week
create or replace function public._weekly_board(p_week date, p_game text)
returns table (user_id uuid, score integer, rank integer) language sql stable security definer set search_path = public as $$
  with best as (
    select s.user_id,
      case when _lower_better(p_game) then min(s.score) else max(s.score) end score,
      min(s.created_at) first_at
    from game_scores s
    where s.game_id = p_game
      and s.created_at >= (p_week::timestamp at time zone _eng_tz())
      and s.created_at < ((p_week + 7)::timestamp at time zone _eng_tz())
    group by s.user_id
  )
  select user_id, score, (row_number() over (
    order by case when _lower_better(p_game) then score end asc, case when not _lower_better(p_game) then score end desc, first_at))::integer
  from best
$$;

-- pay the prizes of weeks that have ended (once each)
create or replace function public._weekly_settle()
returns void language plpgsql security definer set search_path = public as $$
declare
  w weekly_games%rowtype;
  b record;
  v_now_week date := date_trunc('week', now() at time zone _eng_tz())::date;
begin
  for w in select * from weekly_games where week_start < v_now_week and settled_at is null for update skip locked loop
    for b in select * from _weekly_board(w.week_start, w.game_id) where rank <= 10 loop
      insert into weekly_prizes (week_start, user_id, rank, score, prize) values (w.week_start, b.user_id, b.rank, b.score, _weekly_prize(b.rank))
      on conflict do nothing;
      perform token_wallet_for(b.user_id);
      perform _tok_credit(b.user_id, _weekly_prize(b.rank), 'weekly', w.week_start::text || ' #' || b.rank);
    end loop;
    update weekly_games set settled_at = now() where week_start = w.week_start;
  end loop;
end;
$$;

create or replace function public.weekly_current()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now() at time zone _eng_tz())::date;
  v_game text;
  v_last date := v_week - 7;
begin
  perform _weekly_settle();
  v_game := _weekly_game(v_week);
  return jsonb_build_object(
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone _eng_tz()),
    'game_id', v_game,
    'lower_better', _lower_better(v_game),
    'prizes', jsonb_build_array(2000, 1000, 500, 100),
    'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', p.display_name, 'avatar', p.avatar, 'score', b.score, 'rank', b.rank) order by b.rank)
      from _weekly_board(v_week, v_game) b left join profiles p on p.id = b.user_id where b.rank <= 10), '[]'::jsonb),
    'me', (select jsonb_build_object('score', b.score, 'rank', b.rank) from _weekly_board(v_week, v_game) b where b.user_id = v_user),
    'last', jsonb_build_object(
      'game_id', (select game_id from weekly_games where week_start = v_last),
      'winners', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'rank', w.rank, 'prize', w.prize, 'score', w.score) order by w.rank)
        from weekly_prizes w left join profiles p on p.id = w.user_id where w.week_start = v_last and w.rank <= 3), '[]'::jsonb))
  );
end;
$$;

-- ============================================================
-- 5) Friend challenges: "beat my score" within 48 hours; the winner gets 50 tokens
-- ============================================================
create table if not exists public.friend_challenges (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  target integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  status text not null default 'open' check (status in ('open', 'beaten', 'held')),
  winner uuid,
  best integer,
  settled_at timestamptz,
  check (from_user <> to_user)
);
create index if not exists friend_challenges_to_idx on public.friend_challenges (to_user, status);
create index if not exists friend_challenges_from_idx on public.friend_challenges (from_user, status);
alter table public.friend_challenges enable row level security;
drop policy if exists "Own friend challenges" on public.friend_challenges;
create policy "Own friend challenges" on public.friend_challenges for select to authenticated using (auth.uid() in (from_user, to_user));

create or replace function public._are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from friend_requests where status = 'accepted'
    and ((from_user = a and to_user = b) or (from_user = b and to_user = a)))
$$;

create or replace function public.friend_challenge_send(p_to uuid, p_game text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_best integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not _are_friends(v_user, p_to) then raise exception 'not_friends'; end if;
  select case when _lower_better(p_game) then min(score) else max(score) end into v_best
  from game_scores where user_id = v_user and game_id = p_game;
  if v_best is null then raise exception 'no_score'; end if;
  if exists (select 1 from friend_challenges where from_user = v_user and to_user = p_to and game_id = p_game and status = 'open') then
    raise exception 'already_open';
  end if;
  if (select count(*) from friend_challenges where from_user = v_user and status = 'open') >= 10 then raise exception 'too_many'; end if;
  insert into friend_challenges (from_user, to_user, game_id, target) values (v_user, p_to, left(p_game, 64), v_best);
  return jsonb_build_object('target', v_best);
end;
$$;

-- decide challenges that are beaten or ran out (winner: 50 tokens, at most 5 paid a day per player)
create or replace function public._friend_settle(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c friend_challenges%rowtype;
  v_best integer;
  v_beaten boolean;
  v_win uuid;
begin
  for c in select * from friend_challenges where status = 'open' and p_user in (from_user, to_user) for update skip locked loop
    select case when _lower_better(c.game_id) then min(score) else max(score) end into v_best
    from game_scores where user_id = c.to_user and game_id = c.game_id and created_at > c.created_at and created_at <= c.expires_at;
    v_beaten := v_best is not null and (case when _lower_better(c.game_id) then v_best < c.target else v_best > c.target end);
    continue when not v_beaten and now() <= c.expires_at;
    v_win := case when v_beaten then c.to_user else c.from_user end;
    update friend_challenges set status = case when v_beaten then 'beaten' else 'held' end, winner = v_win, best = v_best, settled_at = now()
    where id = c.id;
    if (select count(*) from token_ledger where user_id = v_win and reason = 'friend' and created_at > now() - interval '1 day') < 5 then
      perform token_wallet_for(v_win);
      perform _tok_credit(v_win, 50, 'friend', c.id::text);
    end if;
  end loop;
end;
$$;

create or replace function public.friend_challenges_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  perform _friend_settle(v_user);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'game_id', c.game_id, 'target', c.target, 'status', c.status, 'best', c.best,
      'mine', c.from_user = v_user, 'won', c.winner = v_user, 'expires_at', c.expires_at, 'created_at', c.created_at,
      'other', jsonb_build_object('id', o.id, 'name', o.display_name, 'avatar', o.avatar)
    ) order by (c.status = 'open') desc, c.created_at desc)
    from (select * from friend_challenges where v_user in (from_user, to_user) order by created_at desc limit 40) c
    left join profiles o on o.id = case when c.from_user = v_user then c.to_user else c.from_user end
  ), '[]'::jsonb);
end;
$$;

-- ============================================================
-- 6) Tournaments (token entry, token prizes). Off until the admin switches them on.
-- ============================================================
insert into public.site_settings (key, value) values ('tournaments_enabled', 'false'::jsonb) on conflict (key) do nothing;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 80),
  game_id text not null,
  entry_fee integer not null default 0 check (entry_fee between 0 and 100000),
  bonus integer not null default 0 check (bonus between 0 and 1000000),   -- added to the prize pool
  prize_pct integer[] not null default array[50, 30, 20],
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists public.tournament_entries (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  rank integer,
  prize integer,
  primary key (tournament_id, user_id)
);
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
drop policy if exists "Public tournaments" on public.tournaments;
create policy "Public tournaments" on public.tournaments for select to anon, authenticated using (true);
drop policy if exists "Public tournament entries" on public.tournament_entries;
create policy "Public tournament entries" on public.tournament_entries for select to anon, authenticated using (true);

create or replace function public._tournaments_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from site_settings where key = 'tournaments_enabled'), false)
$$;

-- standings: each entrant's best score in the game between joining (or the start) and the end
create or replace function public._tournament_board(p_id uuid)
returns table (user_id uuid, score integer, rank integer) language sql stable security definer set search_path = public as $$
  with t as (select * from tournaments where id = p_id),
  best as (
    select e.user_id,
      case when _lower_better(t.game_id) then min(s.score) else max(s.score) end score,
      min(s.created_at) first_at
    from tournament_entries e join t on t.id = e.tournament_id
    join game_scores s on s.user_id = e.user_id and s.game_id = t.game_id
      and s.created_at >= greatest(t.starts_at, e.joined_at) and s.created_at < t.ends_at
    group by e.user_id, t.game_id
  )
  select b.user_id, b.score, (row_number() over (
    order by case when _lower_better((select game_id from t)) then b.score end asc,
             case when not _lower_better((select game_id from t)) then b.score end desc, b.first_at))::integer
  from best b
$$;

create or replace function public._tournament_settle()
returns void language plpgsql security definer set search_path = public as $$
declare
  t tournaments%rowtype;
  b record;
  v_pool integer;
  v_prize integer;
begin
  for t in select * from tournaments where ends_at <= now() and settled_at is null for update skip locked loop
    v_pool := t.entry_fee * (select count(*) from tournament_entries where tournament_id = t.id) + t.bonus;
    for b in select * from _tournament_board(t.id) where rank <= coalesce(array_length(t.prize_pct, 1), 0) loop
      v_prize := (v_pool * t.prize_pct[b.rank]) / 100;
      update tournament_entries set rank = b.rank, prize = v_prize where tournament_id = t.id and user_id = b.user_id;
      if v_prize > 0 then
        perform token_wallet_for(b.user_id);
        perform _tok_credit(b.user_id, v_prize, 'tournament', t.id::text || ' #' || b.rank);
      end if;
    end loop;
    update tournaments set settled_at = now() where id = t.id;
  end loop;
end;
$$;

create or replace function public.tournaments_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if not _tournaments_on() then return jsonb_build_object('enabled', false, 'list', '[]'::jsonb); end if;
  perform _tournament_settle();
  return jsonb_build_object('enabled', true, 'list', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'game_id', t.game_id, 'entry_fee', t.entry_fee, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
      'settled', t.settled_at is not null, 'prize_pct', to_jsonb(t.prize_pct),
      'entrants', (select count(*) from tournament_entries where tournament_id = t.id),
      'pool', t.entry_fee * (select count(*) from tournament_entries where tournament_id = t.id) + t.bonus,
      'joined', exists (select 1 from tournament_entries where tournament_id = t.id and user_id = v_user),
      'top', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'score', b.score, 'rank', b.rank) order by b.rank)
        from _tournament_board(t.id) b left join profiles p on p.id = b.user_id where b.rank <= 5), '[]'::jsonb),
      'me', (select jsonb_build_object('score', b.score, 'rank', b.rank) from _tournament_board(t.id) b where b.user_id = v_user)
    ) order by t.settled_at is not null, t.starts_at)
    from tournaments t where t.ends_at > now() - interval '7 days'), '[]'::jsonb));
end;
$$;

create or replace function public.tournament_join(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  t tournaments%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not _tournaments_on() then raise exception 'tournaments_off'; end if;
  select * into t from tournaments where id = p_id;
  if not found or t.ends_at <= now() then raise exception 'tournament_closed'; end if;
  if exists (select 1 from tournament_entries where tournament_id = p_id and user_id = v_user) then raise exception 'already_joined'; end if;
  if t.entry_fee > 0 and not _shop_free(v_user) then
    perform token_wallet_for(v_user);
    perform _tok_credit(v_user, -t.entry_fee, 'tournament', 'entry ' || p_id::text); -- raises insufficient_tokens
  end if;
  insert into tournament_entries (tournament_id, user_id) values (p_id, v_user);
  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- 7) Achievements: badges with token rewards, shown on profiles
-- ============================================================
create table if not exists public.achievements (
  id text primary key,
  title text not null,
  description text not null,
  icon text not null,
  metric text not null,
  target integer not null check (target > 0),
  reward integer not null default 0,
  sort integer not null default 0
);
alter table public.achievements enable row level security;
drop policy if exists "Public achievements" on public.achievements;
create policy "Public achievements" on public.achievements for select to anon, authenticated using (true);

insert into public.achievements (id, title, description, icon, metric, target, reward, sort) values
  ('first_game', 'First steps', 'Finish your first game', '🎮', 'games_played', 1, 50, 1),
  ('games_10', 'Warming up', 'Finish 10 games', '🔥', 'games_played', 10, 100, 2),
  ('games_100', 'Regular', 'Finish 100 games', '💯', 'games_played', 100, 300, 3),
  ('games_500', 'Devoted', 'Finish 500 games', '🏅', 'games_played', 500, 500, 4),
  ('explorer_5', 'Explorer', 'Play 5 different games', '🧭', 'distinct_games', 5, 100, 5),
  ('explorer_10', 'Globetrotter', 'Play 10 different games', '🗺️', 'distinct_games', 10, 250, 6),
  ('online_10', 'Social player', 'Play 10 online matches', '🌐', 'online_matches', 10, 100, 7),
  ('first_win', 'First victory', 'Win an online match', '🏆', 'online_wins', 1, 100, 8),
  ('wins_10', 'Contender', 'Win 10 online matches', '⚔️', 'online_wins', 10, 250, 9),
  ('wins_50', 'Champion', 'Win 50 online matches', '👑', 'online_wins', 50, 500, 10),
  ('streak_3', 'Habit', 'Claim the daily reward 3 days in a row', '📅', 'best_streak', 3, 50, 11),
  ('streak_7', 'Week streak', 'Claim the daily reward 7 days in a row', '🗓️', 'best_streak', 7, 150, 12),
  ('streak_30', 'Unstoppable', 'Claim the daily reward 30 days in a row', '⚡', 'best_streak', 30, 500, 13),
  ('friend_1', 'Buddy', 'Make your first friend', '🤝', 'friends', 1, 50, 14),
  ('friends_5', 'Squad', 'Have 5 friends', '👥', 'friends', 5, 150, 15),
  ('referral_1', 'Recruiter', 'Invite a friend who joins', '📨', 'referrals', 1, 100, 16),
  ('referral_5', 'Ambassador', 'Invite 5 friends who join', '📣', 'referrals', 5, 300, 17),
  ('challenges_10', 'Go-getter', 'Complete 10 daily challenges', '✅', 'challenges_done', 10, 150, 18),
  ('challenges_50', 'Taskmaster', 'Complete 50 daily challenges', '🎯', 'challenges_done', 50, 400, 19),
  ('rival', 'Rival', 'Win a friend challenge', '🥊', 'friend_wins', 1, 100, 20),
  ('podium', 'Podium', 'Finish top 3 in a weekly competition', '🥇', 'weekly_podium', 1, 300, 21),
  ('chess_5', 'Chess adept', 'Reach Chess level 5', '♟️', 'chess_level', 5, 150, 22),
  ('ludo_5', 'Ludo adept', 'Reach Ludo level 5', '🎲', 'ludo_level', 5, 150, 23),
  ('carrom_10', 'Carrom ace', 'Reach Carrom level 10', '🎯', 'carrom_level', 10, 300, 24),
  ('collector_5', 'Collector', 'Own 5 shop items', '🛍️', 'shop_items', 5, 150, 25),
  ('plus', 'Plus member', 'Join Senevon Plus', '⭐', 'plus', 1, 100, 26)
on conflict (id) do nothing;

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
drop policy if exists "Public user achievements" on public.user_achievements;
create policy "Public user achievements" on public.user_achievements for select to anon, authenticated using (true);

create or replace function public._lvl(p_xp integer) returns integer language sql immutable as $$
  select least(30, greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 50.0)) / 2)::integer))
$$;

create or replace function public._ach_metrics(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'games_played', (select count(*) from game_scores where user_id = p_user),
    'distinct_games', (select count(distinct game_id) from game_scores where user_id = p_user),
    'online_matches', (select count(*) from match_reports where user_id = p_user),
    'online_wins', (select count(*) from match_reports where user_id = p_user and user_id = any (winners)),
    'best_streak', coalesce((select best_run from daily_login where user_id = p_user), 0),
    'friends', (select count(*) from friend_requests where status = 'accepted' and p_user in (from_user, to_user)),
    'referrals', (select count(*) from referrals where referrer = p_user),
    'challenges_done', (select count(*) from challenge_claims where user_id = p_user and challenge_id <> 'bonus'),
    'friend_wins', (select count(*) from friend_challenges where winner = p_user),
    'weekly_podium', (select count(*) from weekly_prizes where user_id = p_user and rank <= 3),
    'chess_level', _lvl(coalesce((select xp from game_xp where user_id = p_user and game = 'chess'), 0)),
    'ludo_level', _lvl(coalesce((select xp from game_xp where user_id = p_user and game = 'ludo'), 0)),
    'carrom_level', _lvl(coalesce((select xp from carrom_profiles where user_id = p_user), 0)),
    'shop_items', (select count(*) from shop_owned where user_id = p_user),
    'plus', case when _is_plus(p_user) then 1 else 0 end
  );
end;
$$;

-- Unlock (and pay for) every achievement now reached; returns the full list with progress.
create or replace function public.achievements_sync()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  m jsonb;
  a achievements%rowtype;
  v_rows integer;
  v_new jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  m := _ach_metrics(v_user);
  for a in select * from achievements order by sort loop
    continue when coalesce((m ->> a.metric)::integer, 0) < a.target;
    insert into user_achievements (user_id, achievement_id) values (v_user, a.id) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_new := v_new || jsonb_build_array(jsonb_build_object('id', a.id, 'title', a.title, 'icon', a.icon, 'reward', a.reward));
      if a.reward > 0 then
        perform token_wallet_for(v_user);
        perform _tok_credit(v_user, a.reward, 'achievement', a.id);
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'new', v_new,
    -- alias "ac", not "a": "a" is the loop variable above, and reusing it makes a.id ambiguous
    'list', (select jsonb_agg(jsonb_build_object(
      'id', ac.id, 'title', ac.title, 'description', ac.description, 'icon', ac.icon, 'reward', ac.reward, 'target', ac.target,
      'progress', least(ac.target, coalesce((m ->> ac.metric)::integer, 0)),
      'unlocked_at', u.unlocked_at) order by ac.sort)
      from achievements ac left join user_achievements u on u.achievement_id = ac.id and u.user_id = v_user)
  );
end;
$$;

-- ============================================================
-- 8) Plus-only and early-access games (the game page checks this; members play them)
-- ============================================================
create table if not exists public.game_access (
  game_id text primary key,
  mode text not null check (mode in ('plus', 'early')),
  updated_at timestamptz not null default now()
);
alter table public.game_access enable row level security;
drop policy if exists "Public game access" on public.game_access;
create policy "Public game access" on public.game_access for select to anon, authenticated using (true);

-- ============================================================
-- 9) Senevon Interactive: business enquiries (anyone can send one; only the admin reads them)
-- ============================================================
create table if not exists public.business_enquiries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  organisation text,
  email text not null,
  phone text,
  service text,
  budget text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  note text
);
create index if not exists business_enquiries_time_idx on public.business_enquiries (created_at desc);
alter table public.business_enquiries enable row level security;

create or replace function public.submit_enquiry(
  p_name text, p_email text, p_message text,
  p_org text default null, p_phone text default null, p_service text default null, p_budget text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name'; end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if length(trim(coalesce(p_message, ''))) < 10 then raise exception 'bad_message'; end if;
  -- spam limits: 3 an hour per email, 40 an hour overall
  if (select count(*) from business_enquiries where lower(email) = lower(p_email) and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from business_enquiries where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'too_many';
  end if;
  insert into business_enquiries (name, organisation, email, phone, service, budget, message)
  values (left(trim(p_name), 120), left(trim(p_org), 160), left(trim(p_email), 200), left(trim(p_phone), 40),
          left(trim(p_service), 80), left(trim(p_budget), 80), left(trim(p_message), 4000));
  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- 10) KPIs for the admin dashboard (service role only)
-- ============================================================
create or replace function public.admin_kpis(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := _eng_safe_tz(p_tz);
  r jsonb;
begin
  with act as (   -- account activity: (user, day)
    select user_id, (created_at at time zone v_tz)::date d from events where user_id is not null and created_at >= p_from - interval '31 days' and created_at < p_to
    union select user_id, (at at time zone v_tz)::date from signin_log where at >= p_from - interval '31 days' and at < p_to
    union select user_id, (created_at at time zone v_tz)::date from game_scores where created_at >= p_from - interval '31 days' and created_at < p_to
  ),
  days as (select d::date d from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d),
  dau as (select days.d, (select count(distinct user_id) from act where act.d = days.d) n from days),
  cohort as (     -- sign-ups in the period, with their sign-up day
    select id user_id, (created_at at time zone v_tz)::date d0 from profiles where created_at >= p_from and created_at < p_to
  ),
  sess as (       -- visits split into sessions (30 minutes without activity ends one)
    select visitor_id, created_at, type,
      sum(case when gap is null or gap > interval '30 minutes' then 1 else 0 end) over (partition by visitor_id order by created_at) sn
    from (select visitor_id, created_at, type, created_at - lag(created_at) over (partition by visitor_id order by created_at) gap
          from events where created_at >= p_from and created_at < p_to) x
  ),
  sessions as (
    select visitor_id, sn, extract(epoch from max(created_at) - min(created_at)) secs, count(*) filter (where type = 'game_start') games
    from sess group by visitor_id, sn
  ),
  payers as (
    select user_id from razorpay_orders where status in ('paid', 'active', 'cancelled', 'expired') and updated_at >= p_from and updated_at < p_to
    union select user_id from play_purchases where created_at >= p_from and created_at < p_to
    union select user_id from subscriptions where provider <> 'mock' and created_at >= p_from and created_at < p_to
  ),
  active_period as (select distinct user_id from act where d >= (p_from at time zone v_tz)::date)
  select jsonb_build_object(
    'dau', coalesce((select round(avg(n), 1) from dau), 0),
    'mau', (select count(distinct user_id) from act where d > ((p_to at time zone v_tz)::date - 30)),
    'd1', (select round(100.0 * count(*) filter (where exists (select 1 from act a where a.user_id = c.user_id and a.d = c.d0 + 1)) / nullif(count(*), 0), 1)
           from cohort c where c.d0 + 1 < (now() at time zone v_tz)::date),
    'd7', (select round(100.0 * count(*) filter (where exists (select 1 from act a where a.user_id = c.user_id and a.d = c.d0 + 7)) / nullif(count(*), 0), 1)
           from cohort c where c.d0 + 7 < (now() at time zone v_tz)::date),
    'd30', (select round(100.0 * count(*) filter (where exists (select 1 from act a where a.user_id = c.user_id and a.d = c.d0 + 30)) / nullif(count(*), 0), 1)
            from cohort c where c.d0 + 30 < (now() at time zone v_tz)::date),
    'session_minutes', coalesce((select round((avg(secs) / 60)::numeric, 1) from sessions), 0),
    'games_per_session', coalesce((select round(avg(games), 2) from sessions), 0),
    'sessions', (select count(*) from sessions),
    'conversion', (select round(100.0 * (select count(*) from payers) / nullif(count(*), 0), 2) from active_period),
    'payers', (select count(*) from payers),
    'arpdau_inr', (select round(coalesce((
        select sum(amount) from razorpay_orders where currency = 'INR' and status in ('paid', 'active', 'cancelled', 'expired')
          and updated_at >= p_from and updated_at < p_to), 0) / nullif((select sum(n) from dau), 0), 2)),
    'sub_retention', (select round(100.0 * count(*) filter (where status in ('active', 'cancelled') and period_end > now()) / nullif(count(*), 0), 1)
                      from subscriptions where provider <> 'mock' and started_at < now() - interval '30 days')
  ) into r;
  return r;
end;
$$;

-- ============================================================
-- Permissions
-- ============================================================
revoke all on function public._daily_rewards() from public;
revoke all on function public._challenge_progress(uuid, public.challenge_pool, date, text) from public, anon, authenticated;
revoke all on function public._weekly_game(date) from public, anon, authenticated;
revoke all on function public._weekly_board(date, text) from public, anon, authenticated;
revoke all on function public._weekly_settle() from public, anon, authenticated;
revoke all on function public._friend_settle(uuid) from public, anon, authenticated;
revoke all on function public._are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public._tournament_board(uuid) from public, anon, authenticated;
revoke all on function public._tournament_settle() from public, anon, authenticated;
revoke all on function public._ach_metrics(uuid) from public, anon, authenticated;
revoke all on function public.admin_kpis(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_kpis(timestamptz, timestamptz, text) to service_role;

revoke all on function public.daily_state(text) from public, anon;
grant execute on function public.daily_state(text) to authenticated;
revoke all on function public.daily_claim(text) from public, anon;
grant execute on function public.daily_claim(text) to authenticated;
grant execute on function public.challenges_today(text) to anon, authenticated;
revoke all on function public.challenge_claim(text, text) from public, anon;
grant execute on function public.challenge_claim(text, text) to authenticated;
revoke all on function public.referral_state() from public, anon;
grant execute on function public.referral_state() to authenticated;
revoke all on function public.referral_claim(text) from public, anon;
grant execute on function public.referral_claim(text) to authenticated;
grant execute on function public.weekly_current() to anon, authenticated;
revoke all on function public.friend_challenge_send(uuid, text) from public, anon;
grant execute on function public.friend_challenge_send(uuid, text) to authenticated;
revoke all on function public.friend_challenges_list() from public, anon;
grant execute on function public.friend_challenges_list() to authenticated;
grant execute on function public.tournaments_list() to anon, authenticated;
revoke all on function public.tournament_join(uuid) from public, anon;
grant execute on function public.tournament_join(uuid) to authenticated;
revoke all on function public.achievements_sync() from public, anon;
grant execute on function public.achievements_sync() to authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
