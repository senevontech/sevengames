-- ============================================================
-- Clubs (community clans).
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql and entries.sql (gift limits).
-- Safe to re-run.
--
--   * A club has a unique club ID (6 characters, shown as #K7Q2MX). Names don't have to be unique.
--   * 3 to 50 members. A club with fewer than 3 members is "forming": the club wallet opens at 3.
--   * One club per player. Public clubs: anyone can join with the club ID. Private clubs:
--     only with the owner's invite code (the owner can make a new one, which stops the old one).
--   * The owner runs the club: edits it, removes or bans members, hands ownership on, deletes it,
--     and decides how the club wallet is spent (pays chips out to members).
--   * Club wallet: members put EARNED chips in (never bought ones). That counts toward the same
--     daily limit as gifts (500 a day, India time) and needs an account 3+ days old, so a club
--     can't be used to get around the gift rules. Ledger reason 'club'.
--   * Club rooms: a member posts an open room (game + room code) so other members can join it.
--     Posts disappear after 30 minutes.
--   * Tournaments: later.
-- Needs the entries.sql version of _gift_sent_today (it counts club deposits too).
-- ============================================================

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique check (tag ~ '^[2-9A-HJ-NP-Z]{6}$'),
  name text not null check (length(name) between 3 and 30),
  about text not null default '' check (length(about) <= 160),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null check (invite_code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  wallet integer not null default 0 check (wallet >= 0),
  members integer not null default 1 check (members between 0 and 50),
  created_at timestamptz not null default now()
);
create index if not exists clubs_public_idx on public.clubs (visibility, members desc);
create index if not exists clubs_name_idx on public.clubs (lower(name));

create table if not exists public.club_members (
  user_id uuid primary key references auth.users(id) on delete cascade, -- one club per player
  club_id uuid not null references public.clubs(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  given integer not null default 0,   -- chips this member has put in the club wallet
  joined_at timestamptz not null default now()
);
create index if not exists club_members_club_idx on public.club_members (club_id, joined_at);

create table if not exists public.club_bans (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create table if not exists public.club_wallet_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,   -- who put chips in / the owner who paid out
  to_user uuid references auth.users(id) on delete set null,   -- payouts: who got them
  kind text not null check (kind in ('deposit', 'payout')),
  amount integer not null check (amount > 0),
  note text check (note is null or length(note) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists club_wallet_log_club_idx on public.club_wallet_log (club_id, created_at desc);
create index if not exists club_wallet_log_user_idx on public.club_wallet_log (user_id, created_at desc) where kind = 'deposit';

create table if not exists public.club_rooms (
  user_id uuid primary key references auth.users(id) on delete cascade, -- one posted room per member
  club_id uuid not null references public.clubs(id) on delete cascade,
  game text not null check (game in ('chess', 'ludo', 'carrom', 'pool', 'arrows')),
  code text not null check (code ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now()
);

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_bans enable row level security;
alter table public.club_wallet_log enable row level security;
alter table public.club_rooms enable row level security;
-- No policies: everything goes through the functions below.

-- ---------- rules ----------
create or replace function public._club_const(p_name text)
returns integer language sql immutable as $$
  select case p_name
    when 'max_members' then 50
    when 'min_members' then 3        -- the club wallet opens at this many members
    when 'room_minutes' then 30
  end
$$;

create or replace function public._club_code(p_len integer)
returns text language sql volatile as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::integer, 1), '')
  from generate_series(1, p_len)
$$;

-- tidy a name / about text: no control characters, single spaces
create or replace function public._club_text(p_text text, p_max integer)
returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max)
$$;

create or replace function public._club_name_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select display_name from profiles where id = p_user),
    (select coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1)) from auth.users where id = p_user),
    'Player')
$$;

create or replace function public._club_me(p_user uuid)
returns club_members language sql stable security definer set search_path = public as $$
  select * from club_members where user_id = p_user
$$;

-- the caller's membership, or an error
create or replace function public._club_need(p_owner boolean)
returns club_members language plpgsql stable security definer set search_path = public as $$
declare
  m club_members%rowtype;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into m from club_members where user_id = auth.uid();
  if not found then raise exception 'not_in_club'; end if;
  if p_owner and m.role <> 'owner' then raise exception 'not_owner'; end if;
  return m;
end;
$$;

create or replace function public._club_card(c clubs)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'tag', c.tag, 'name', c.name, 'about', c.about, 'visibility', c.visibility,
    'members', c.members, 'owner_id', c.owner_id, 'owner_name', _club_name_of(c.owner_id),
    'created_at', c.created_at)
$$;

-- ---------- reading ----------
-- Your club with everything a member sees, or null when you're not in one.
create or replace function public.club_mine()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  m club_members%rowtype;
  c clubs%rowtype;
  v_owner boolean;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into m from club_members where user_id = v_user;
  if not found then return null; end if;
  select * into c from clubs where id = m.club_id;
  v_owner := m.role = 'owner';
  delete from club_rooms where club_id = c.id and created_at < now() - make_interval(mins => _club_const('room_minutes'));
  return _club_card(c) || jsonb_build_object(
    'role', m.role,
    'wallet', c.wallet,
    'wallet_open', c.members >= _club_const('min_members'),
    'invite_code', case when v_owner then c.invite_code end,
    'given_today', _gift_sent_today(v_user),
    'give_cap', _entry_const('gift_daily_cap'),
    'old_enough', (select now() - created_at from auth.users where id = v_user) >= make_interval(days => _entry_const('gift_min_age_days')),
    'member_list', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', cm.user_id, 'role', cm.role, 'given', cm.given, 'joined_at', cm.joined_at,
        'name', _club_name_of(cm.user_id), 'avatar', p.avatar) order by cm.role = 'owner' desc, cm.joined_at), '[]'::jsonb)
      from club_members cm left join profiles p on p.id = cm.user_id where cm.club_id = c.id),
    'rooms', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'name', _club_name_of(r.user_id), 'game', r.game, 'code', r.code, 'created_at', r.created_at)
        order by r.created_at desc), '[]'::jsonb)
      from club_rooms r where r.club_id = c.id),
    'log', (
      select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object('id', l.id, 'kind', l.kind, 'amount', l.amount, 'note', l.note, 'at', l.created_at,
          'from', case when l.user_id is null then null else _club_name_of(l.user_id) end,
          'to', case when l.to_user is null then null else _club_name_of(l.to_user) end) as x
        from club_wallet_log l where l.club_id = c.id order by l.id desc limit 30) t),
    'bans', case when v_owner then (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', _club_name_of(b.user_id)) order by b.created_at desc), '[]'::jsonb)
      from club_bans b where b.club_id = c.id) end
  );
end;
$$;

-- A club's public card by its club ID (private clubs show their card too, but not who's in them).
create or replace function public.club_view(p_tag text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c clubs%rowtype;
  v_user uuid := auth.uid();
begin
  select * into c from clubs where tag = upper(btrim(replace(coalesce(p_tag, ''), '#', '')));
  if not found then return null; end if;
  return _club_card(c) || jsonb_build_object(
    'mine', v_user is not null and exists (select 1 from club_members where user_id = v_user and club_id = c.id),
    'banned', v_user is not null and exists (select 1 from club_bans where user_id = v_user and club_id = c.id),
    'full', c.members >= _club_const('max_members'),
    'member_list', case when c.visibility = 'public' then (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role, 'name', _club_name_of(cm.user_id), 'avatar', p.avatar)
        order by cm.role = 'owner' desc, cm.joined_at), '[]'::jsonb)
      from club_members cm left join profiles p on p.id = cm.user_id where cm.club_id = c.id) end
  );
end;
$$;

-- Public clubs by name or club ID (empty search: the biggest public clubs).
create or replace function public.club_search(p_query text default '')
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select btrim(replace(coalesce(p_query, ''), '#', '')) as s)
  select coalesce(jsonb_agg(_club_card(c) order by c.members desc, c.created_at), '[]'::jsonb)
  from clubs c
  where c.id in (
    select k.id from clubs k, q
    where (k.visibility = 'public' and (q.s = '' or k.name ilike '%' || replace(replace(q.s, '%', ''), '_', '') || '%'))
       or k.tag = upper(q.s)
    order by k.members desc, k.created_at
    limit 30
  )
$$;

-- Which club a player is in (for profiles): { tag, name } or null.
create or replace function public.club_of(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tag', c.tag, 'name', c.name, 'role', m.role)
  from club_members m join clubs c on c.id = m.club_id where m.user_id = p_user
$$;

-- ---------- joining and leaving ----------
create or replace function public.club_create(p_name text, p_about text default '', p_visibility text default 'public')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_name text := _club_text(p_name, 30);
  v_tag text;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if length(v_name) < 3 then raise exception 'bad_name'; end if;
  if p_visibility not in ('public', 'private') then raise exception 'bad_visibility'; end if;
  perform pg_advisory_xact_lock(hashtext('club-user:' || v_user::text));
  if exists (select 1 from club_members where user_id = v_user) then raise exception 'in_club'; end if;
  loop
    v_tag := _club_code(6);
    exit when not exists (select 1 from clubs where tag = v_tag);
  end loop;
  insert into clubs (tag, name, about, visibility, owner_id, invite_code)
  values (v_tag, v_name, _club_text(p_about, 160), p_visibility, v_user, _club_code(8))
  returning id into v_id;
  insert into club_members (user_id, club_id, role) values (v_user, v_id, 'owner');
  return club_mine();
end;
$$;

-- Public clubs: the club ID is enough. Private clubs: the owner's invite code too.
create or replace function public.club_join(p_tag text, p_invite text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  c clubs%rowtype;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into c from clubs where tag = upper(btrim(replace(coalesce(p_tag, ''), '#', '')));
  if not found then raise exception 'no_club'; end if;
  perform pg_advisory_xact_lock(hashtext('club-user:' || v_user::text));
  perform pg_advisory_xact_lock(hashtext('club:' || c.id::text));
  select * into c from clubs where id = c.id;
  if exists (select 1 from club_members where user_id = v_user) then raise exception 'in_club'; end if;
  if exists (select 1 from club_bans where club_id = c.id and user_id = v_user) then raise exception 'banned'; end if;
  if c.visibility = 'private' and upper(btrim(coalesce(p_invite, ''))) <> c.invite_code then raise exception 'need_invite'; end if;
  if c.members >= _club_const('max_members') then raise exception 'club_full'; end if;
  insert into club_members (user_id, club_id) values (v_user, c.id);
  update clubs set members = members + 1 where id = c.id;
  return club_mine();
end;
$$;

-- Leave your club. The owner hands it on first (club_transfer), unless they're the last member:
-- then the club closes and anything left in its wallet goes back to them.
create or replace function public.club_leave()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(false);
  c clubs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('club:' || m.club_id::text));
  select * into c from clubs where id = m.club_id;
  if m.role = 'owner' then
    if c.members > 1 then raise exception 'owner_must_transfer'; end if;
    return club_delete();
  end if;
  delete from club_members where user_id = m.user_id;
  delete from club_rooms where user_id = m.user_id;
  update clubs set members = members - 1 where id = c.id;
  return null;
end;
$$;

-- The owner closes the club. Whatever is in the wallet goes to the owner.
create or replace function public.club_delete()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
  c clubs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('club:' || m.club_id::text));
  select * into c from clubs where id = m.club_id for update;
  if c.wallet > 0 then
    perform _tok_credit(m.user_id, c.wallet, 'club', 'closed:' || c.tag);
  end if;
  delete from clubs where id = c.id; -- members, bans, rooms and log go with it
  return null;
end;
$$;

-- ---------- the owner ----------
create or replace function public.club_update(p_name text, p_about text, p_visibility text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
  v_name text := _club_text(p_name, 30);
begin
  if length(v_name) < 3 then raise exception 'bad_name'; end if;
  if p_visibility not in ('public', 'private') then raise exception 'bad_visibility'; end if;
  update clubs set name = v_name, about = _club_text(p_about, 160), visibility = p_visibility where id = m.club_id;
  return club_mine();
end;
$$;

create or replace function public.club_new_invite()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
begin
  update clubs set invite_code = _club_code(8) where id = m.club_id;
  return club_mine();
end;
$$;

-- Remove a member (and optionally ban them from rejoining).
create or replace function public.club_remove(p_user uuid, p_ban boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
begin
  if p_user is null or p_user = m.user_id then raise exception 'bad_member'; end if;
  perform pg_advisory_xact_lock(hashtext('club:' || m.club_id::text));
  delete from club_members where user_id = p_user and club_id = m.club_id;
  if found then
    update clubs set members = members - 1 where id = m.club_id;
    delete from club_rooms where user_id = p_user;
  end if;
  if p_ban then
    insert into club_bans (club_id, user_id) values (m.club_id, p_user) on conflict do nothing;
  end if;
  return club_mine();
end;
$$;

create or replace function public.club_unban(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
begin
  delete from club_bans where club_id = m.club_id and user_id = p_user;
  return club_mine();
end;
$$;

-- Hand the club to another member; you become a member.
create or replace function public.club_transfer(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
begin
  if p_user is null or p_user = m.user_id then raise exception 'bad_member'; end if;
  perform pg_advisory_xact_lock(hashtext('club:' || m.club_id::text));
  if not exists (select 1 from club_members where user_id = p_user and club_id = m.club_id) then raise exception 'bad_member'; end if;
  update club_members set role = 'member' where user_id = m.user_id;
  update club_members set role = 'owner' where user_id = p_user;
  update clubs set owner_id = p_user where id = m.club_id;
  return club_mine();
end;
$$;

-- ---------- the club wallet ----------
-- Put earned chips in the club wallet (shares the 500-a-day gift limit).
create or replace function public.club_give(p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(false);
  c clubs%rowtype;
  v_age interval;
begin
  if p_amount is null or p_amount < 1 then raise exception 'bad_amount'; end if;
  select now() - created_at into v_age from auth.users where id = m.user_id;
  if v_age < make_interval(days => _entry_const('gift_min_age_days')) then raise exception 'account_too_new'; end if;
  perform pg_advisory_xact_lock(hashtext('gift:' || m.user_id::text)); -- same lock as gift_chips
  if _gift_sent_today(m.user_id) + p_amount > _entry_const('gift_daily_cap') then raise exception 'gift_limit'; end if;
  select * into c from clubs where id = m.club_id for update;
  if c.members < _club_const('min_members') then raise exception 'club_forming'; end if;
  perform token_wallet();
  perform _tok_credit(m.user_id, -p_amount, 'club', 'give:' || c.tag); -- raises insufficient_earned
  update clubs set wallet = wallet + p_amount where id = c.id;
  update club_members set given = given + p_amount where user_id = m.user_id;
  insert into club_wallet_log (club_id, user_id, kind, amount) values (c.id, m.user_id, 'deposit', p_amount);
  return club_mine();
end;
$$;

-- The owner pays chips from the club wallet to a member (themselves included).
create or replace function public.club_pay(p_user uuid, p_amount integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(true);
  c clubs%rowtype;
begin
  if p_amount is null or p_amount < 1 then raise exception 'bad_amount'; end if;
  select * into c from clubs where id = m.club_id for update;
  if not exists (select 1 from club_members where user_id = p_user and club_id = c.id) then raise exception 'bad_member'; end if;
  if c.wallet < p_amount then raise exception 'club_wallet_low'; end if;
  update clubs set wallet = wallet - p_amount where id = c.id;
  perform _tok_credit(p_user, p_amount, 'club', 'pay:' || c.tag);
  insert into club_wallet_log (club_id, user_id, to_user, kind, amount, note)
  values (c.id, m.user_id, p_user, 'payout', p_amount, nullif(_club_text(p_note, 80), ''));
  return club_mine();
end;
$$;

-- ---------- club rooms ----------
-- Post the room you're waiting in so club members can join it (one post per member).
create or replace function public.club_room_post(p_game text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(false);
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if p_game not in ('chess', 'ludo', 'carrom', 'pool', 'arrows') then raise exception 'bad_game'; end if;
  if v_code !~ '^[A-Z0-9]{4}$' then raise exception 'bad_code'; end if;
  insert into club_rooms (user_id, club_id, game, code) values (m.user_id, m.club_id, p_game, v_code)
  on conflict (user_id) do update set club_id = excluded.club_id, game = excluded.game, code = excluded.code, created_at = now();
  return club_mine();
end;
$$;

create or replace function public.club_room_clear()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m club_members%rowtype := _club_need(false);
begin
  delete from club_rooms where user_id = m.user_id;
  return club_mine();
end;
$$;

-- ---------- access ----------
revoke all on function public._club_const(text) from public, anon, authenticated;
revoke all on function public._club_code(integer) from public, anon, authenticated;
revoke all on function public._club_text(text, integer) from public, anon, authenticated;
revoke all on function public._club_name_of(uuid) from public, anon, authenticated;
revoke all on function public._club_me(uuid) from public, anon, authenticated;
revoke all on function public._club_need(boolean) from public, anon, authenticated;
revoke all on function public._club_card(clubs) from public, anon, authenticated;
revoke all on function public.club_mine() from public, anon;
revoke all on function public.club_view(text) from public;
revoke all on function public.club_search(text) from public;
revoke all on function public.club_of(uuid) from public;
revoke all on function public.club_create(text, text, text) from public, anon;
revoke all on function public.club_join(text, text) from public, anon;
revoke all on function public.club_leave() from public, anon;
revoke all on function public.club_delete() from public, anon;
revoke all on function public.club_update(text, text, text) from public, anon;
revoke all on function public.club_new_invite() from public, anon;
revoke all on function public.club_remove(uuid, boolean) from public, anon;
revoke all on function public.club_unban(uuid) from public, anon;
revoke all on function public.club_transfer(uuid) from public, anon;
revoke all on function public.club_give(integer) from public, anon;
revoke all on function public.club_pay(uuid, integer, text) from public, anon;
revoke all on function public.club_room_post(text, text) from public, anon;
revoke all on function public.club_room_clear() from public, anon;
grant execute on function public.club_view(text) to anon, authenticated;
grant execute on function public.club_search(text) to anon, authenticated;
grant execute on function public.club_of(uuid) to anon, authenticated;
grant execute on function public.club_mine() to authenticated;
grant execute on function public.club_create(text, text, text) to authenticated;
grant execute on function public.club_join(text, text) to authenticated;
grant execute on function public.club_leave() to authenticated;
grant execute on function public.club_delete() to authenticated;
grant execute on function public.club_update(text, text, text) to authenticated;
grant execute on function public.club_new_invite() to authenticated;
grant execute on function public.club_remove(uuid, boolean) to authenticated;
grant execute on function public.club_unban(uuid) to authenticated;
grant execute on function public.club_transfer(uuid) to authenticated;
grant execute on function public.club_give(integer) to authenticated;
grant execute on function public.club_pay(uuid, integer, text) to authenticated;
grant execute on function public.club_room_post(text, text) to authenticated;
grant execute on function public.club_room_clear() to authenticated;

notify pgrst, 'reload schema';
