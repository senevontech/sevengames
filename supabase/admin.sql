-- ============================================================
-- 7games — Admin panel, analytics and ads
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor
--
-- Security model: the browser (anon key) can only
--   * read active ads and site settings,
--   * insert page/game events,
--   * call record_ad_event() to count ad impressions/clicks.
-- Everything else (reading analytics, creating/editing ads, changing
-- settings) happens inside the `admin` Edge Function using the
-- service-role key, behind the ADMIN_PASSWORD secret.
-- ============================================================

-- 1) Ads ------------------------------------------------------
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  link_url text not null,
  cover_url text,                 -- wide banner image (Cloudinary)
  thumb_url text,                 -- small square image (Cloudinary)
  body text,                      -- optional short text
  cta_label text not null default 'Learn more',
  active boolean not null default true,
  starts_at timestamptz,          -- null = no start limit
  ends_at timestamptz,            -- null = no end limit
  daily_start time,               -- optional daily window (viewer local time)
  daily_end time,
  max_impressions integer,        -- "quantity"; null/0 = unlimited
  impressions integer not null default 0,
  clicks integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Where an ad may appear: 'all' (banners + home-page promo disks), 'banner' or 'disk' only.
alter table public.ads add column if not exists placement text not null default 'all';
alter table public.ads drop constraint if exists ads_placement_check;
alter table public.ads add constraint ads_placement_check check (placement in ('all', 'banner', 'disk'));

alter table public.ads enable row level security;

drop policy if exists "Public can read active ads" on public.ads;
create policy "Public can read active ads"
on public.ads for select
to anon, authenticated
using (active = true);
-- No insert/update/delete policies: only the service role (Edge Function) can write.

-- 2) Site settings -------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "Public can read settings" on public.site_settings;
create policy "Public can read settings"
on public.site_settings for select
to anon, authenticated
using (true);

insert into public.site_settings (key, value) values
  ('ads_enabled', 'true'::jsonb),
  ('ad_rotate_seconds', '8'::jsonb),
  ('tracking_enabled', 'true'::jsonb),
  ('announcement_enabled', 'false'::jsonb),
  ('announcement_text', '""'::jsonb)
on conflict (key) do nothing;

-- 3) Events (traffic + game plays + ad events) ---------------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id text not null,
  type text not null check (type in
    ('pageview', 'game_start', 'game_finish', 'ad_impression', 'ad_click')),
  path text,
  game_id text,
  ad_id uuid,
  referrer text,
  device text,
  score integer
);

create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_type_created_idx on public.events (type, created_at desc);

alter table public.events enable row level security;

drop policy if exists "Anyone can log events" on public.events;
create policy "Anyone can log events"
on public.events for insert
to anon, authenticated
with check (
  type in ('pageview', 'game_start', 'game_finish')
  and length(visitor_id) between 8 and 64
  and (path is null or length(path) <= 200)
  and (referrer is null or length(referrer) <= 300)
);
-- No select policy: analytics are only readable through the Edge Function.

grant insert on public.events to anon, authenticated;

-- 4) Ad impression / click counter ---------------------------
-- Impressions only count while the ad is active and under its cap, so the
-- cap is enforced server-side even if a client misbehaves.
create or replace function public.record_ad_event(
  p_ad uuid,
  p_kind text,
  p_visitor text default null,
  p_path text default null
) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_kind = 'impression' then
    update public.ads
       set impressions = impressions + 1
     where id = p_ad
       and active
       and (max_impressions is null or max_impressions <= 0 or impressions < max_impressions);
    if found then
      insert into public.events (visitor_id, type, ad_id, path)
      values (coalesce(p_visitor, 'unknown-visitor'), 'ad_impression', p_ad, left(p_path, 200));
    end if;
  elsif p_kind = 'click' then
    update public.ads set clicks = clicks + 1 where id = p_ad and active;
    if found then
      insert into public.events (visitor_id, type, ad_id, path)
      values (coalesce(p_visitor, 'unknown-visitor'), 'ad_click', p_ad, left(p_path, 200));
    end if;
  end if;
end;
$$;

revoke all on function public.record_ad_event(uuid, text, text, text) from public;
grant execute on function public.record_ad_event(uuid, text, text, text) to anon, authenticated;
