-- ============================================================
-- ONE-TIME: delete every recorded page view and game play, to start counting from zero.
-- PERMANENT: this can't be undone.
--
-- Run it in Supabase → SQL Editor only AFTER:
--   1. analytics.sql has been run, and
--   2. the new site build (with the new tracking) is live on games.senevon.in,
-- otherwise old builds and dev servers keep adding wrong rows.
--
-- It only empties public.events (views, game starts / finishes). Accounts, sign-ins, scores,
-- tokens, purchases and ads are not touched. Ad impression / click counters on each ad have
-- their own "Reset counts" button in Admin → Ads.
-- ============================================================

delete from public.events;
