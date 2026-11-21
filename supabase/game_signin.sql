-- ============================================================
-- Sign-in hand-off to partner game sites (e.g. DroidDoom)
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- When a signed-in player opens a connected game from Senevon, Senevon asks for a one-time code
-- (create_game_signin) and opens the game's site with it. The game's site sends the code to the
-- `game-signin` Edge Function, which checks it (once, within 60 seconds) and signs the player in
-- there with the same Senevon account. Only a hash of the code is stored.
-- ============================================================

create table if not exists public.game_signin_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.game_signin_codes enable row level security;
-- No policies: the browser can't read or write it. Codes are made below and used by the
-- Edge Function (service role).

-- Games allowed to receive a sign-in (keep in sync with `signIn: true` in src/catalog.ts).
create or replace function public._game_signin_allowed(p_game text)
returns boolean language sql immutable as $$
  select p_game in ('droiddoom')
$$;

create or replace function public.create_game_signin(p_game text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not _game_signin_allowed(p_game) then raise exception 'bad_game'; end if;
  -- tidy up: this player's old codes and anything expired
  delete from game_signin_codes where user_id = v_user or expires_at < now();
  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into game_signin_codes (code_hash, user_id, game_id, expires_at)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_user, p_game, now() + interval '60 seconds');
  return v_code;
end;
$$;

revoke all on function public.create_game_signin(text) from public, anon;
grant execute on function public.create_game_signin(text) to authenticated;
