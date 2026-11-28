-- ============================================================
-- Communication: emoji, phrase and sticker packs, used in online matches, game lobbies and
-- friends chat. Only ready-made items can be sent (no typed text), so nothing needs moderation.
-- Run in: Supabase Dashboard → SQL Editor, AFTER shop.sql and social.sql. Safe to re-run.
--
--   * Packs are shop items (kind 'chat_pack'): price 0 = free for everyone, a price = buy once
--     with tokens, plus_only = free for Senevon Plus members. Prices / Plus flag: admin panel.
--     Built-in pack contents live in src/lib/chatPacks.ts (ids must match).
--   * Custom art packs: uploaded from the admin panel (chat_custom_packs) + a shop item 'chat:c:<id>'.
--   * Friends chat: friend_messages (last 100 per pair kept), chat_blocks, one message per 3 s.
-- ============================================================

-- the shop accepts chat packs (also in shop.sql's list)
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('arrow_skin', 'arrow_fx', 'arrow_board', 'arrow_head', 'frame', 'booster', 'chess_board', 'chess_pieces', 'ludo_board', 'ludo_dice',
                  'dd_levels', 'dd_skin', 'dd_weapon', 'chat_pack', 'ludo_token', 'pool_table', 'pool_cue', 'tune_pack', 'sf_ship', 'sf_sky'));
-- (keep this list the same as in shop.sql)

insert into public.shop_items (item_id, kind, price, sort, plus_only) values
  ('chat:emoji', 'chat_pack', 0, 0, false),
  ('chat:phrases', 'chat_pack', 0, 1, false),
  ('chat:starter', 'chat_pack', 0, 2, false),
  ('chat:party', 'chat_pack', 300, 3, false),
  ('chat:trash', 'chat_pack', 500, 4, false),
  ('chat:cheers', 'chat_pack', 400, 5, false),
  ('chat:animated', 'chat_pack', 800, 6, false),
  ('chat:games', 'chat_pack', 600, 7, false),
  ('chat:royal', 'chat_pack', 0, 8, true)
on conflict (item_id) do nothing;

-- 1) Custom art packs (admin uploads) ----------------------------------
create table if not exists public.chat_custom_packs (
  id text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  name text not null check (length(name) between 2 and 40),
  -- [{ "id": "wave", "label": "Wave", "url": "https://res.cloudinary.com/…" }, …]
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.chat_custom_packs enable row level security;
drop policy if exists "Public custom chat packs" on public.chat_custom_packs;
create policy "Public custom chat packs" on public.chat_custom_packs for select to anon, authenticated using (true);

-- 2) Friends chat --------------------------------------------------------
create table if not exists public.friend_messages (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  pack text not null check (length(pack) <= 64),
  item text not null check (length(item) <= 64),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (from_user <> to_user)
);
create index if not exists friend_messages_pair_idx on public.friend_messages (least(from_user, to_user), greatest(from_user, to_user), created_at desc);
create index if not exists friend_messages_unread_idx on public.friend_messages (to_user) where read_at is null;
alter table public.friend_messages enable row level security;
drop policy if exists "Own friend messages" on public.friend_messages;
create policy "Own friend messages" on public.friend_messages for select to authenticated using (auth.uid() in (from_user, to_user));
-- No insert / update / delete policies: changes only through the functions below.

create table if not exists public.chat_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked)
);
alter table public.chat_blocks enable row level security;
drop policy if exists "Own chat blocks" on public.chat_blocks;
create policy "Own chat blocks" on public.chat_blocks for select to authenticated using (auth.uid() = user_id);

-- new messages arrive live (Supabase Realtime)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_messages') then
    alter publication supabase_realtime add table public.friend_messages;
  end if;
exception when undefined_object then
  null; -- no realtime publication on this database
end;
$$;

-- Send one pack item to a friend. The pack must be owned (free / bought / Plus); one message
-- every 3 seconds; nothing is delivered if they blocked you. Keeps the last 100 per pair.
create or replace function public.chat_send(p_to uuid, p_pack text, p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id bigint;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from friend_requests where status = 'accepted'
      and ((from_user = v_user and to_user = p_to) or (from_user = p_to and to_user = v_user))) then
    raise exception 'not_friends';
  end if;
  if not exists (select 1 from shop_items where item_id = p_pack and kind = 'chat_pack') then raise exception 'bad_pack'; end if;
  if not _shop_owns(v_user, p_pack) then raise exception 'not_owned'; end if;
  if p_item is null or length(p_item) not between 1 and 64 then raise exception 'bad_item'; end if;
  if exists (select 1 from friend_messages where from_user = v_user and created_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from chat_blocks where user_id = p_to and blocked = v_user) then
    return jsonb_build_object('ok', true); -- blocked: looks sent, isn't delivered
  end if;
  insert into friend_messages (from_user, to_user, pack, item) values (v_user, p_to, p_pack, p_item) returning id into v_id;
  -- keep the last 100 messages between the two
  delete from friend_messages where id in (
    select id from friend_messages
    where least(from_user, to_user) = least(v_user, p_to) and greatest(from_user, to_user) = greatest(v_user, p_to)
    order by created_at desc offset 100
  );
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- The conversation with one friend (oldest first); marks their messages to me as read.
create or replace function public.chat_thread(p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  update friend_messages set read_at = now() where to_user = v_user and from_user = p_other and read_at is null;
  return jsonb_build_object(
    'blocked', exists (select 1 from chat_blocks where user_id = v_user and blocked = p_other),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'mine', from_user = v_user, 'pack', pack, 'item', item, 'at', created_at) order by created_at)
      from (
        select * from friend_messages
        where least(from_user, to_user) = least(v_user, p_other) and greatest(from_user, to_user) = greatest(v_user, p_other)
        order by created_at desc limit 100
      ) m), '[]'::jsonb)
  );
end;
$$;

-- Unread messages per friend: { "<friend id>": n, … }
create or replace function public.chat_unread()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(from_user, n), '{}'::jsonb)
  from (select from_user, count(*) n from friend_messages
        where to_user = auth.uid() and read_at is null
          and not exists (select 1 from chat_blocks b where b.user_id = auth.uid() and b.blocked = friend_messages.from_user)
        group by from_user) x
$$;

create or replace function public.chat_block(p_other uuid, p_block boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_block then
    insert into chat_blocks (user_id, blocked) values (v_user, p_other) on conflict do nothing;
    update friend_messages set read_at = now() where to_user = v_user and from_user = p_other and read_at is null;
  else
    delete from chat_blocks where user_id = v_user and blocked = p_other;
  end if;
  return jsonb_build_object('blocked', p_block);
end;
$$;

revoke all on function public.chat_send(uuid, text, text) from public, anon;
grant execute on function public.chat_send(uuid, text, text) to authenticated;
revoke all on function public.chat_thread(uuid) from public, anon;
grant execute on function public.chat_thread(uuid) to authenticated;
revoke all on function public.chat_unread() from public, anon;
grant execute on function public.chat_unread() to authenticated;
revoke all on function public.chat_block(uuid, boolean) from public, anon;
grant execute on function public.chat_block(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
