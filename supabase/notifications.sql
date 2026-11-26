-- ============================================================
-- Notifications: a popup for the player when someone
--   * gifts them chips        (chip_gifts, from entries.sql)
--   * sends a friend request  (friend_requests, from social.sql)
--   * starts following them   (follows, from social.sql)
-- Run in: Supabase Dashboard → SQL Editor, AFTER social.sql (and entries.sql for gifts). Safe to re-run.
--
--   * Rows are written only by triggers (nobody inserts from the browser).
--   * A player sees only their own rows; new rows arrive live (Supabase Realtime), and rows not
--     yet seen pop up the next time they open the site.
--   * Follow spam (follow / unfollow / follow…) makes at most one notification a day per follower.
--   * Each player keeps their latest 100.
-- ============================================================

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('gift', 'friend_request', 'follow')),
  from_user uuid references auth.users(id) on delete cascade,
  amount integer,
  note text,
  ref bigint, -- gift id / friend request id
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, seen, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "Own notifications" on public.notifications;
create policy "Own notifications" on public.notifications for select to authenticated using (auth.uid() = user_id);
-- No insert / update / delete policies: triggers write, notif_seen() marks as seen.

create or replace function public._notify(p_user uuid, p_kind text, p_from uuid, p_amount integer, p_note text, p_ref bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_from then return; end if;
  insert into notifications (user_id, kind, from_user, amount, note, ref) values (p_user, p_kind, p_from, p_amount, p_note, p_ref);
  -- keep the latest 100
  delete from notifications where user_id = p_user and id < (
    select id from notifications where user_id = p_user order by id desc offset 99 limit 1
  );
end;
$$;
revoke execute on function public._notify(uuid, text, uuid, integer, text, bigint) from public, anon, authenticated;

-- someone followed you (once a day per follower, so unfollow / follow again doesn't spam)
create or replace function public._notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from notifications where user_id = new.followee and kind = 'follow'
                 and from_user = new.follower and created_at > now() - interval '1 day') then
    perform _notify(new.followee, 'follow', new.follower, null, null, null);
  end if;
  return null;
end;
$$;
drop trigger if exists notify_follow on public.follows;
create trigger notify_follow after insert on public.follows for each row execute function public._notify_follow();

-- someone sent you a friend request
create or replace function public._notify_friend_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform _notify(new.to_user, 'friend_request', new.from_user, null, null, new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists notify_friend_request on public.friend_requests;
create trigger notify_friend_request after insert on public.friend_requests for each row execute function public._notify_friend_request();

-- someone gifted you chips (only if entries.sql has been run)
create or replace function public._notify_gift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _notify(new.to_user, 'gift', new.from_user, new.amount, new.note, new.id);
  return null;
end;
$$;
do $$
begin
  if to_regclass('public.chip_gifts') is not null then
    drop trigger if exists notify_gift on public.chip_gifts;
    create trigger notify_gift after insert on public.chip_gifts for each row execute function public._notify_gift();
  end if;
end;
$$;

-- the player closed these popups
create or replace function public.notif_seen(p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update notifications set seen = true where user_id = auth.uid() and id = any(p_ids) and not seen;
$$;
grant execute on function public.notif_seen(bigint[]) to authenticated;

-- new notifications arrive live (Supabase Realtime)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  null; -- no realtime publication on this database
end;
$$;
