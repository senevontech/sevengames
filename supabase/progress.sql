-- ============================================================
-- 7games — saved game progress (level reached per game)
-- Run this whole file in: Supabase Dashboard → SQL Editor
--
-- One row per (player, game). The client keeps a copy on the device and the newest save
-- (by updated_at) wins, so a reset on one device carries over to the others.
-- Used by src/lib/progress.ts.
-- ============================================================

create table if not exists public.game_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null check (length(game_id) between 1 and 64),
  level integer not null default 1 check (level between 1 and 100000),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.game_progress enable row level security;

drop policy if exists "Players read own progress" on public.game_progress;
create policy "Players read own progress"
on public.game_progress for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players insert own progress" on public.game_progress;
create policy "Players insert own progress"
on public.game_progress for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Players update own progress" on public.game_progress;
create policy "Players update own progress"
on public.game_progress for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Players delete own progress" on public.game_progress;
create policy "Players delete own progress"
on public.game_progress for delete
to authenticated
using (auth.uid() = user_id);
