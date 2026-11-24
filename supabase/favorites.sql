-- ============================================================
-- Favourite games: a player's saved games, so they follow the account to every device.
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
-- Guests keep favourites on their device only (src/lib/favorites.ts); signing in merges them in.
-- ============================================================

create table if not exists public.favorite_games (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null check (length(game_id) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
create index if not exists favorite_games_user_idx on public.favorite_games (user_id, created_at desc);

alter table public.favorite_games enable row level security;

drop policy if exists "Own favourites: read" on public.favorite_games;
create policy "Own favourites: read" on public.favorite_games for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own favourites: add" on public.favorite_games;
create policy "Own favourites: add" on public.favorite_games for insert to authenticated
  with check (auth.uid() = user_id and (select count(*) from public.favorite_games f where f.user_id = auth.uid()) < 200);
drop policy if exists "Own favourites: remove" on public.favorite_games;
create policy "Own favourites: remove" on public.favorite_games for delete to authenticated using (auth.uid() = user_id);

grant select, insert, delete on public.favorite_games to authenticated;

notify pgrst, 'reload schema';
