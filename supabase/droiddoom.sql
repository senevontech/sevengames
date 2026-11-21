-- ============================================================
-- DroidDoom (embedded Godot game) unlocks, sold through the Senevon shop
-- Run in: Supabase Dashboard → SQL Editor, AFTER tokens.sql and shop.sql. Safe to re-run.
--
--   * Items are ordinary shop_items with kind dd_levels / dd_skin / dd_weapon and ids "dd:…".
--     Prices are tokens and can be changed in Admin → Tokens like any other shop item.
--     The ids after "dd:" must match the ids the game uses (see integrations/droiddoom/README.md).
--   * All access (every DroidDoom item, no purchase): Senevon Plus subscribers (active, or
--     cancelled but still inside the paid period), Pro members and unlimited accounts.
--   * droiddoom_state() → what this player can use in DroidDoom.
--   * droiddoom_buy(id)  → buy one DroidDoom item with tokens (refused for all-access players,
--                          so they're never charged for something they already have).
--   * The game never talks to Supabase: Senevon calls these and passes the result into the
--     game's frame (src/components/GameBridge.tsx).
-- ============================================================

-- DroidDoom's paid items. The id after "dd:" must match `unlock_id` in the game's
-- game/data/weapons/*.tres (empty unlock_id = free weapon).
-- On re-run only new items are added: prices changed in the admin panel stay.
insert into public.shop_items (item_id, kind, price, sort) values
  ('dd:weapon_railgun', 'dd_weapon', 2000, 0),
  ('dd:weapon_rocket_pod', 'dd_weapon', 1500, 1),
  ('dd:weapon_grenade_launcher', 'dd_weapon', 1200, 2)
on conflict (item_id) do nothing;

-- Retire the early placeholder items (not in the game). Deactivated, not deleted,
-- so anyone who already bought one keeps the record.
update public.shop_items set active = false
where item_id in ('dd:levels_premium', 'dd:skin_crimson', 'dd:skin_chrome', 'dd:weapon_plasma');

-- Does this player get every DroidDoom item without buying? Why ('plus' | 'pro' | 'unlimited'), or null.
create or replace function public._dd_all_access(p_user uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pro boolean := false;
begin
  if exists (select 1 from token_unlimited where user_id = p_user) then return 'unlimited'; end if;
  if exists (
    select 1 from subscriptions
    where user_id = p_user and status in ('active', 'cancelled') and period_end > now()
  ) then
    return 'plus';
  end if;
  if to_regclass('public.pro_members') is not null then -- pro.sql is optional
    execute 'select exists (select 1 from public.pro_members where user_id = $1)' into v_pro using p_user;
    if v_pro then return 'pro'; end if;
  end if;
  return null;
end;
$$;

create or replace function public._dd_state(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_access text := _dd_all_access(p_user);
begin
  return jsonb_build_object(
    'signed_in', true,
    'all_access', v_access is not null,
    'access_reason', v_access,
    'owned', coalesce((
      select jsonb_agg(i.item_id order by i.sort)
      from shop_items i
      where i.kind like 'dd\_%' and i.active
        and (v_access is not null or i.price = 0
             or exists (select 1 from shop_owned o where o.user_id = p_user and o.item_id = i.item_id))
    ), '[]'::jsonb),
    'tokens', coalesce((select balance from token_wallets where user_id = p_user), 0)
  );
end;
$$;

create or replace function public.droiddoom_state()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  return _dd_state(v_user);
end;
$$;

create or replace function public.droiddoom_buy(p_item text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_item is null or p_item not like 'dd:%' then raise exception 'bad_item'; end if;
  if _dd_all_access(v_user) is not null then return _dd_state(v_user); end if; -- already has it all
  perform shop_buy(p_item); -- takes the tokens (raises insufficient_tokens / bad_item)
  return _dd_state(v_user);
end;
$$;

revoke all on function public._dd_all_access(uuid) from public, anon, authenticated;
revoke all on function public._dd_state(uuid) from public, anon, authenticated;
grant execute on function public.droiddoom_state() to authenticated;
grant execute on function public.droiddoom_buy(text) to authenticated;
