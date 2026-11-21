-- ============================================================
-- Accurate analytics + the admin dashboard.
-- Run in: Supabase Dashboard → SQL Editor, AFTER admin.sql, tokens.sql, shop.sql, play.sql,
-- razorpay.sql, adfree.sql and matches.sql. Safe to re-run.
--
-- What counts as a view / play now:
--   * only through track_event() (the old direct insert into events is closed)
--   * only from the live site (site setting tracking_hosts, default games.senevon.in) or the
--     Android app (origin https://localhost); localhost dev servers, preview links and other
--     sites are ignored
--   * not from known bots, not from devices that logged into the admin panel
--     (analytics_excluded), at most 200 events per visitor per 10 minutes
-- Sign-ins: every real login is logged by a trigger on auth.users (signin_log).
-- The dashboard reads everything through admin_dashboard() / admin_detail(), which only the
-- admin Edge Function (service role) can call.
-- ============================================================

-- 1) Events: platform + account ----------------------------------------
alter table public.events add column if not exists platform text;
alter table public.events add column if not exists user_id uuid;
create index if not exists events_visitor_time_idx on public.events (visitor_id, created_at desc);
create index if not exists events_user_time_idx on public.events (user_id, created_at desc) where user_id is not null;

-- browsers can no longer write rows directly: only through track_event()
drop policy if exists "Anyone can log events" on public.events;
revoke insert on public.events from anon, authenticated;

-- devices that never count (the admin's browsers). Server only.
create table if not exists public.analytics_excluded (
  visitor_id text primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table public.analytics_excluded enable row level security;

insert into public.site_settings (key, value) values ('tracking_hosts', '["games.senevon.in"]'::jsonb)
on conflict (key) do nothing;

create or replace function public.track_event(
  p_visitor text,
  p_type text,
  p_path text default null,
  p_game text default null,
  p_score integer default null,
  p_referrer text default null,
  p_device text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  h json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  v_origin text := lower(coalesce(h ->> 'origin', ''));
  v_ua text := lower(coalesce(h ->> 'user-agent', ''));
  v_hosts jsonb;
  v_platform text;
begin
  if p_type not in ('pageview', 'game_start', 'game_finish') then return; end if;
  if p_visitor is null or length(p_visitor) not between 8 and 64 then return; end if;
  if coalesce((select value from site_settings where key = 'tracking_enabled'), 'true'::jsonb) = 'false'::jsonb then return; end if;

  -- where it came from: the Android app (Capacitor serves the app from localhost, no port),
  -- or one of the live site's hosts. Anything else (dev servers have a port) is ignored.
  if v_origin in ('https://localhost', 'http://localhost', 'capacitor://localhost') then
    v_platform := 'app';
  else
    select value into v_hosts from site_settings where key = 'tracking_hosts';
    v_hosts := coalesce(v_hosts, '["games.senevon.in"]'::jsonb);
    if not exists (select 1 from jsonb_array_elements_text(v_hosts) x where v_origin = 'https://' || lower(x)) then
      return;
    end if;
    v_platform := 'web';
  end if;

  if v_ua ~ '(bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|prerender)' then return; end if;
  if exists (select 1 from analytics_excluded where visitor_id = p_visitor) then return; end if;
  if (select count(*) from events where visitor_id = p_visitor and created_at > now() - interval '10 minutes') >= 200 then
    return;
  end if;

  insert into events (visitor_id, type, path, game_id, score, referrer, device, platform, user_id)
  values (
    p_visitor,
    p_type,
    left(p_path, 200),
    left(p_game, 64),
    p_score,
    left(p_referrer, 300),
    case when p_device in ('mobile', 'tablet', 'desktop') then p_device else null end,
    v_platform,
    auth.uid()
  );
end;
$$;

revoke all on function public.track_event(text, text, text, text, integer, text, text) from public;
grant execute on function public.track_event(text, text, text, text, integer, text, text) to anon, authenticated;

-- 2) Sign-ins -----------------------------------------------------------
create table if not exists public.signin_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null,
  provider text,
  unique (user_id, at)
);
create index if not exists signin_log_at_idx on public.signin_log (at desc);
alter table public.signin_log enable row level security;

-- every real login updates auth.users.last_sign_in_at (token refreshes don't)
create or replace function public._log_signin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null
     and (tg_op = 'INSERT' or new.last_sign_in_at is distinct from old.last_sign_in_at) then
    begin
      insert into public.signin_log (user_id, at, provider)
      values (new.id, new.last_sign_in_at, coalesce(new.raw_app_meta_data ->> 'provider', 'email'))
      on conflict (user_id, at) do nothing;
    exception when others then
      null; -- logging must never block a sign-in
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signin on auth.users;
create trigger on_auth_user_signin
after insert or update of last_sign_in_at on auth.users
for each row execute function public._log_signin();

-- the last sign-in of existing accounts (earlier ones weren't recorded)
insert into public.signin_log (user_id, at, provider)
select id, last_sign_in_at, coalesce(raw_app_meta_data ->> 'provider', 'email')
from auth.users where last_sign_in_at is not null
on conflict (user_id, at) do nothing;

-- 3) Dashboard numbers for one period -------------------------------------
create or replace function public._dash(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (
    select type, visitor_id, user_id, platform from events where created_at >= p_from and created_at < p_to
  ),
  active as (
    select user_id from ev where user_id is not null
    union select user_id from signin_log where at >= p_from and at < p_to
    union select user_id from game_scores where created_at >= p_from and created_at < p_to
  ),
  rp as (
    -- website payments: paid token packs + started subscriptions (renewals aren't recorded yet)
    select currency, amount from razorpay_orders
    where kind = 'pack' and status = 'paid' and updated_at >= p_from and updated_at < p_to
    union all
    select currency, amount from razorpay_orders
    where kind = 'plus' and status in ('active', 'cancelled', 'expired') and created_at >= p_from and created_at < p_to
  ),
  led as (
    select reason, delta from token_ledger where created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'users_total', (select count(*) from profiles where created_at < p_to),
    'signups', (select count(*) from profiles where created_at >= p_from and created_at < p_to),
    'signins', (select count(*) from signin_log where at >= p_from and at < p_to),
    'active_users', (select count(*) from active),
    'views', (select count(*) from ev where type = 'pageview'),
    'views_web', (select count(*) from ev where type = 'pageview' and platform = 'web'),
    'views_app', (select count(*) from ev where type = 'pageview' and platform = 'app'),
    'visitors', (select count(distinct visitor_id) from ev),
    'visitors_web', (select count(distinct visitor_id) from ev where platform = 'web'),
    'visitors_app', (select count(distinct visitor_id) from ev where platform = 'app'),
    'game_starts', (select count(*) from ev where type = 'game_start'),
    'game_finishes', (select count(*) from ev where type = 'game_finish'),
    'players', (select count(distinct visitor_id) from ev where type = 'game_start'),
    'online_matches', (select count(distinct (game, match_id)) from match_reports where created_at >= p_from and created_at < p_to),
    'scores_saved', (select count(*) from game_scores where created_at >= p_from and created_at < p_to),
    'revenue', coalesce((select jsonb_object_agg(currency, total) from (select currency, sum(amount) total from rp group by currency) x), '{}'::jsonb),
    'purchases_web', (select count(*) from rp),
    'purchases_app', (select count(*) from play_purchases where created_at >= p_from and created_at < p_to),
    'new_subs', (select count(*) from subscriptions where provider <> 'mock' and created_at >= p_from and created_at < p_to),
    'active_subs', (select count(*) from subscriptions where provider <> 'mock' and started_at < p_to and period_end > p_to),
    'adfree_active', (select count(*) from ad_free_passes where expires_at > p_to and updated_at < p_to),
    'tokens_earned', (select coalesce(sum(delta), 0) from led where delta > 0),
    'tokens_spent', (select coalesce(-sum(delta), 0) from led where delta < 0),
    'shop_sales', (select count(*) from led where reason = 'shop'),
    'ad_rewards', (select count(*) from ad_views where claimed_at >= p_from and claimed_at < p_to)
  )
$$;

-- This period and the one before it (same length), for the "+12%" comparisons.
create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cur', _dash(p_from, p_to),
    'prev', _dash(p_from - (p_to - p_from), p_from)
  )
$$;

-- 4) Detail pages -------------------------------------------------------
-- Returns { series: [{d, a, b}], labels: [a, b], breakdowns: [{title, rows: [[label, n]]}],
--           table: { columns: [...], rows: [[...]] } }
create or replace function public.admin_detail(p_metric text, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  v_days date[];
  r jsonb;
begin
  select array_agg(d::date order by d) into v_days
  from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d;

  if p_metric = 'signups' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('New accounts'),
      'series', (select jsonb_agg(jsonb_build_object('d', d, 'a',
          (select count(*) from profiles where (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(jsonb_build_object('title', 'Sign-up method', 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
            select coalesce(u.raw_app_meta_data ->> 'provider', 'email') k, count(*) n
            from profiles p join auth.users u on u.id = p.id
            where p.created_at >= p_from and p.created_at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Name', 'Email', 'Method', 'Joined'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(p.display_name, u.email, coalesce(u.raw_app_meta_data ->> 'provider', 'email'), p.created_at) order by p.created_at desc)
          from (select * from profiles where created_at >= p_from and created_at < p_to order by created_at desc limit 100) p
          join auth.users u on u.id = p.id), '[]'::jsonb)));

  elsif p_metric = 'signins' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Sign-ins', 'Different accounts'),
      'series', (select jsonb_agg(jsonb_build_object('d', d,
          'a', (select count(*) from signin_log where (at at time zone v_tz)::date = d),
          'b', (select count(distinct user_id) from signin_log where (at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(jsonb_build_object('title', 'Method', 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
            select coalesce(provider, 'email') k, count(*) n from signin_log where at >= p_from and at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Name', 'Email', 'Method', 'Signed in'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(p.display_name, u.email, s.provider, s.at) order by s.at desc)
          from (select * from signin_log where at >= p_from and at < p_to order by at desc limit 100) s
          join auth.users u on u.id = s.user_id left join profiles p on p.id = s.user_id), '[]'::jsonb)));

  elsif p_metric = 'active' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Active accounts'),
      'series', (select jsonb_agg(jsonb_build_object('d', d, 'a', (
          select count(*) from (
            select user_id from events where user_id is not null and (created_at at time zone v_tz)::date = d
            union select user_id from signin_log where (at at time zone v_tz)::date = d
            union select user_id from game_scores where (created_at at time zone v_tz)::date = d) x)) order by d) from unnest(v_days) d),
      'breakdowns', '[]'::jsonb,
      'table', jsonb_build_object('columns', jsonb_build_array('Name', 'Email', 'Views', 'Games played', 'Last seen'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(p.display_name, u.email, x.views, x.plays, x.last_seen) order by x.views + x.plays desc)
          from (
            select user_id, count(*) filter (where type = 'pageview') views, count(*) filter (where type = 'game_start') plays, max(created_at) last_seen
            from events where user_id is not null and created_at >= p_from and created_at < p_to
            group by user_id order by count(*) desc limit 100) x
          join auth.users u on u.id = x.user_id left join profiles p on p.id = x.user_id), '[]'::jsonb)));

  elsif p_metric = 'traffic' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Page views', 'Unique visitors'),
      'series', (select jsonb_agg(jsonb_build_object('d', d,
          'a', (select count(*) from events where type = 'pageview' and (created_at at time zone v_tz)::date = d),
          'b', (select count(distinct visitor_id) from events where (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(
        jsonb_build_object('title', 'Website vs app (views)', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select coalesce(platform, 'unknown') k, count(*) n from events where type = 'pageview' and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Top pages', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select coalesce(path, '/') k, count(*) n from events where type = 'pageview' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 15) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Where visitors came from', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select coalesce(substring(referrer from '^https?://([^/]+)'), '(direct)') k, count(*) n
          from events where type = 'pageview' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 10) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Devices', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select coalesce(device, 'unknown') k, count(*) n from events where type = 'pageview' and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Busiest hours', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k || ':00', n) order by k) from (
          select lpad(extract(hour from created_at at time zone v_tz)::text, 2, '0') k, count(*) n
          from events where type = 'pageview' and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Time', 'Page', 'Platform', 'Device', 'From'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(created_at, path, platform, device, coalesce(substring(referrer from '^https?://([^/]+)'), '')) order by created_at desc)
          from (select * from events where type = 'pageview' and created_at >= p_from and created_at < p_to order by created_at desc limit 100) e), '[]'::jsonb)));

  elsif p_metric = 'games' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Games started', 'Finished'),
      'series', (select jsonb_agg(jsonb_build_object('d', d,
          'a', (select count(*) from events where type = 'game_start' and (created_at at time zone v_tz)::date = d),
          'b', (select count(*) from events where type = 'game_finish' and (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(jsonb_build_object('title', 'Plays per game', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select coalesce(game_id, 'unknown') k, count(*) n from events where type = 'game_start' and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Game', 'Started', 'Finished', 'Players', 'Avg score'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(g, s, f, pl, av) order by s desc) from (
            select coalesce(game_id, 'unknown') g,
              count(*) filter (where type = 'game_start') s,
              count(*) filter (where type = 'game_finish') f,
              count(distinct visitor_id) pl,
              round(avg(score) filter (where type = 'game_finish')) av
            from events where type in ('game_start', 'game_finish') and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)));

  elsif p_metric = 'matches' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Online matches'),
      'series', (select jsonb_agg(jsonb_build_object('d', d, 'a',
          (select count(distinct (game, match_id)) from match_reports where (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(
        jsonb_build_object('title', 'Matches per game', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select game k, count(distinct match_id) n from match_reports where created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Win tokens paid', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select game k, count(*) n from match_tokens where paid_at >= p_from and paid_at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Time', 'Game', 'Player', 'Result', 'XP'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(m.created_at, m.game, coalesce(p.display_name, u.email),
              case when m.draw then 'draw' when m.user_id = any (m.winners) then 'win' else 'loss' end, m.xp_delta) order by m.created_at desc)
          from (select * from match_reports where created_at >= p_from and created_at < p_to order by created_at desc limit 100) m
          join auth.users u on u.id = m.user_id left join profiles p on p.id = m.user_id), '[]'::jsonb)));

  elsif p_metric = 'money' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Website payments', 'App purchases'),
      'series', (select jsonb_agg(jsonb_build_object('d', d,
          'a', (select count(*) from razorpay_orders where status in ('paid', 'active', 'cancelled', 'expired')
                  and (case when kind = 'pack' then updated_at else created_at end at time zone v_tz)::date = d),
          'b', (select count(*) from play_purchases where (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(
        jsonb_build_object('title', 'Website revenue', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select currency || ' · ' || case when kind = 'pack' then 'token packs' else 'subscriptions' end k, sum(amount) n
          from razorpay_orders where status in ('paid', 'active', 'cancelled', 'expired')
            and (case when kind = 'pack' then updated_at else created_at end) >= p_from
            and (case when kind = 'pack' then updated_at else created_at end) < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'App purchases (Google Play)', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select product_id k, count(*) n from play_purchases where created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Active subscriptions', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select provider || ' · ' || plan k, count(*) n from subscriptions where provider <> 'mock' and period_end > now() and status in ('active', 'cancelled') group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Time', 'Player', 'What', 'Amount', 'Via'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(t, who, what, amt, via) order by t desc) from (
            select (case when o.kind = 'pack' then o.updated_at else o.created_at end) t, coalesce(p.display_name, u.email) who,
              case when o.kind = 'pack' then 'Token pack · ' || o.item else 'Plus · ' || o.item end what,
              o.currency || ' ' || o.amount amt, 'Razorpay' via
            from razorpay_orders o join auth.users u on u.id = o.user_id left join profiles p on p.id = o.user_id
            where o.status in ('paid', 'active', 'cancelled', 'expired')
              and (case when o.kind = 'pack' then o.updated_at else o.created_at end) >= p_from
              and (case when o.kind = 'pack' then o.updated_at else o.created_at end) < p_to
            union all
            select pp.created_at, coalesce(p.display_name, u.email), pp.product_id, '—', 'Google Play'
            from play_purchases pp join auth.users u on u.id = pp.user_id left join profiles p on p.id = pp.user_id
            where pp.created_at >= p_from and pp.created_at < p_to
            order by 1 desc limit 100) x), '[]'::jsonb)));

  elsif p_metric = 'tokens' then
    r := jsonb_build_object(
      'labels', jsonb_build_array('Earned', 'Spent'),
      'series', (select jsonb_agg(jsonb_build_object('d', d,
          'a', (select coalesce(sum(delta), 0) from token_ledger where delta > 0 and (created_at at time zone v_tz)::date = d),
          'b', (select coalesce(-sum(delta), 0) from token_ledger where delta < 0 and (created_at at time zone v_tz)::date = d)) order by d) from unnest(v_days) d),
      'breakdowns', jsonb_build_array(
        jsonb_build_object('title', 'Earned from', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select reason k, sum(delta) n from token_ledger where delta > 0 and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Spent on', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select reason k, -sum(delta) n from token_ledger where delta < 0 and created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)),
        jsonb_build_object('title', 'Rewarded ads watched', 'rows', coalesce((select jsonb_agg(jsonb_build_array(k, n) order by n desc) from (
          select source k, count(*) n from ad_views where claimed_at >= p_from and claimed_at < p_to group by 1) x), '[]'::jsonb))),
      'table', jsonb_build_object('columns', jsonb_build_array('Time', 'Player', 'Change', 'Reason', 'Detail'), 'rows', coalesce((
          select jsonb_agg(jsonb_build_array(l.created_at, coalesce(p.display_name, u.email), l.delta, l.reason, l.ref) order by l.created_at desc)
          from (select * from token_ledger where created_at >= p_from and created_at < p_to order by created_at desc limit 100) l
          join auth.users u on u.id = l.user_id left join profiles p on p.id = l.user_id), '[]'::jsonb)));
  else
    raise exception 'bad_metric';
  end if;
  return r;
end;
$$;

revoke all on function public._dash(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_detail(text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_detail(text, timestamptz, timestamptz, text) to service_role;

notify pgrst, 'reload schema';
