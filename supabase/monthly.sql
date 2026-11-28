-- ============================================================
-- Monthly leaderboard prizes.
-- Run in: Supabase Dashboard → SQL Editor, AFTER schema.sql, tokens.sql, play.sql (token_wallet_for),
-- leaderboard.sql and notifications.sql. Safe to re-run.
--
--   * A monthly race: the same points as the overall board (a top-10 finish in a game = 10..1
--     points), counting only scores set during the month (India time). Fresh on the 1st.
--   * Ties: more first places, then more rounds played, then whoever's last score came first.
--   * Prizes for the top 10: 1st 2,000 · 2nd 700 · 3rd 300 · 4th–10th 15 chips. They are earned
--     chips (like every reward), ledger reason 'leaderboard', ref '2026-11 #2'.
--   * Settled lazily: the first leaderboard / prize call after a month ends records that month's
--     top 10 (month_prizes) and sends each winner a bell notification. Winners claim from the
--     Leaderboards page (month_prize_claim); an unclaimed prize waits for them.
--   * The first prize month is November 2026 (_month_first): earlier months are never paid.
-- ============================================================

-- the ledger's reasons (keep in sync with tokens.sql and the other files that set this list)
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in ('signup', 'play', 'ad', 'subscription', 'admin', 'guest', 'purchase', 'carrom', 'adfree', 'shop', 'match',
                    'daily', 'challenge', 'achievement', 'referral', 'weekly', 'friend', 'tournament', 'entry', 'gift', 'club',
                    'leaderboard'));

-- the monthly board reads one month of scores
create index if not exists game_scores_created_idx on public.game_scores (created_at);

create or replace function public._month_tz() returns text language sql immutable as $$ select 'Asia/Kolkata' $$;
create or replace function public._month_first() returns date language sql immutable as $$ select date '2026-11-01' $$;
-- the current month (its 1st), India time
create or replace function public._month_now() returns date language sql stable as $$
  select date_trunc('month', now() at time zone _month_tz())::date
$$;
create or replace function public._month_prize(p_rank integer) returns integer language sql immutable as $$
  select case when p_rank = 1 then 2000 when p_rank = 2 then 700 when p_rank = 3 then 300
              when p_rank between 4 and 10 then 15 else 0 end
$$;

-- One month's standings: points as on leaderboard_overall (leaderboard.sql), from that month's scores.
create or replace function public._month_board(p_month date)
returns table (user_id uuid, points integer, firsts integer, rounds integer, games integer, rank integer)
language sql stable security definer set search_path = public as $$
  with s as (
    select g.user_id, g.game_id, g.score, g.created_at
    from game_scores g
    where g.created_at >= (p_month::timestamp at time zone _month_tz())
      and g.created_at < ((p_month + interval '1 month')::timestamp at time zone _month_tz())
  ),
  best as (
    select game_id, user_id,
      case when game_id in ('minefield', 'slide') then min(score) else max(score) end as best
    from s group by game_id, user_id
  ),
  ranked as (
    select user_id, rank() over (
      partition by game_id
      order by case when game_id in ('minefield', 'slide') then best end asc nulls last,
               case when game_id not in ('minefield', 'slide') then best end desc nulls last) as place
    from best
  ),
  pts as (
    select user_id, sum(greatest(0, 11 - place))::integer as points, (count(*) filter (where place = 1))::integer as firsts
    from ranked group by user_id
  ),
  plays as (
    select user_id, count(*)::integer as rounds, count(distinct game_id)::integer as games, max(created_at) as last_at
    from s group by user_id
  )
  select p.user_id, p.points, p.firsts, pl.rounds, pl.games,
    (row_number() over (order by p.points desc, p.firsts desc, pl.rounds desc, pl.last_at asc, p.user_id))::integer
  from pts p join plays pl on pl.user_id = p.user_id
  where p.points > 0
$$;

-- the winners of each finished month (and whether they've claimed)
create table if not exists public.month_prizes (
  month date not null,                  -- the month's 1st
  user_id uuid not null references auth.users(id) on delete cascade,
  rank integer not null check (rank between 1 and 10),
  points integer not null,
  prize integer not null check (prize > 0),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (month, user_id)
);
create index if not exists month_prizes_user_idx on public.month_prizes (user_id) where claimed_at is null;
-- months already settled (also the ones nobody scored in)
create table if not exists public.month_settled (
  month date primary key,
  settled_at timestamptz not null default now()
);
alter table public.month_prizes enable row level security;
alter table public.month_settled enable row level security;
-- No policies: read through the functions below.

-- Record the top 10 of every finished month not settled yet, and tell the winners.
create or replace function public._month_settle()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last date := (_month_now() - interval '1 month')::date;
  v_m date;
  b record;
begin
  if v_last < _month_first() or exists (select 1 from month_settled where month = v_last) then return; end if;
  -- one settler at a time; anyone else carries on with the board as it is
  if not pg_try_advisory_xact_lock(hashtext('month_settle')) then return; end if;
  for v_m in select generate_series(_month_first(), v_last, interval '1 month')::date loop
    continue when exists (select 1 from month_settled where month = v_m);
    for b in select * from _month_board(v_m) where rank <= 10 order by rank loop
      insert into month_prizes (month, user_id, rank, points, prize)
      values (v_m, b.user_id, b.rank, b.points, _month_prize(b.rank)) on conflict do nothing;
      -- bell notification (notifications.sql); never let it block the prizes
      begin
        perform _notify(b.user_id, 'prize', null, _month_prize(b.rank), to_char(v_m, 'FMMonth YYYY'), b.rank);
      exception when others then null;
      end;
    end loop;
    insert into month_settled (month) values (v_m) on conflict do nothing;
  end loop;
end;
$$;

-- This month's race (top p_limit, you, the prizes, when it ends) and last month's top 3.
create or replace function public.leaderboard_month(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_m date := _month_now();
  v_last date := (_month_now() - interval '1 month')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 10), 100);
  v_board jsonb;
begin
  perform _month_settle();
  with b as materialized (select * from _month_board(v_m))
  select jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', b.user_id, 'name', coalesce(p.display_name, 'Player'), 'avatar', p.avatar,
        'points', b.points, 'firsts', b.firsts, 'rounds', b.rounds, 'games', b.games, 'rank', b.rank) order by b.rank)
      from b left join profiles p on p.id = b.user_id where b.rank <= v_limit), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', b.rank, 'points', b.points) from b where b.user_id = v_user)
  ) into v_board;
  return v_board || jsonb_build_object(
    'month', v_m,
    'ends_at', ((v_m + interval '1 month')::timestamp at time zone _month_tz()),
    'pays', v_m >= _month_first(),
    'prizes', jsonb_build_array(_month_prize(1), _month_prize(2), _month_prize(3), _month_prize(4)),
    'last', jsonb_build_object(
      'month', v_last,
      'winners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', w.user_id, 'name', coalesce(p.display_name, 'Player'), 'avatar', p.avatar,
          'rank', w.rank, 'points', w.points, 'prize', w.prize) order by w.rank)
        from month_prizes w left join profiles p on p.id = w.user_id
        where w.month = v_last and w.rank <= 3), '[]'::jsonb))
  );
end;
$$;

-- Your prizes still waiting to be claimed.
create or replace function public.month_prizes_mine()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  perform _month_settle();
  return coalesce((
    select jsonb_agg(jsonb_build_object('month', w.month, 'rank', w.rank, 'points', w.points, 'prize', w.prize) order by w.month)
    from month_prizes w where w.user_id = auth.uid() and w.claimed_at is null), '[]'::jsonb);
end;
$$;

-- Claim one month's prize into your wallet.
create or replace function public.month_prize_claim(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  w month_prizes%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into w from month_prizes where month = p_month and user_id = v_user for update;
  if not found then raise exception 'no_prize'; end if;
  if w.claimed_at is not null then raise exception 'already_claimed'; end if;
  perform token_wallet_for(v_user);
  perform _tok_credit(v_user, w.prize, 'leaderboard', to_char(w.month, 'YYYY-MM') || ' #' || w.rank);
  update month_prizes set claimed_at = now() where month = p_month and user_id = v_user;
  return jsonb_build_object('amount', w.prize, 'rank', w.rank, 'month', w.month);
end;
$$;

-- ---------- access ----------
revoke all on function public._month_tz() from public, anon, authenticated;
revoke all on function public._month_first() from public, anon, authenticated;
revoke all on function public._month_now() from public, anon, authenticated;
revoke all on function public._month_prize(integer) from public, anon, authenticated;
revoke all on function public._month_board(date) from public, anon, authenticated;
revoke all on function public._month_settle() from public, anon, authenticated;
revoke all on function public.leaderboard_month(integer) from public;
grant execute on function public.leaderboard_month(integer) to anon, authenticated;
revoke all on function public.month_prizes_mine() from public, anon;
grant execute on function public.month_prizes_mine() to authenticated;
revoke all on function public.month_prize_claim(date) from public, anon;
grant execute on function public.month_prize_claim(date) to authenticated;

notify pgrst, 'reload schema';
