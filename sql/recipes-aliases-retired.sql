-- Recipes: remember old colorway names (so renamed colors keep matching
-- Shopify sales, the Shopify stock upload and kits) and mark colors retired.
-- ------------------------------------------------------------------
-- Run in the Supabase SQL editor (project hqjuyceebdujenrrtoth).
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS "aliases" jsonb,
  ADD COLUMN IF NOT EXISTS "retired" boolean;

-- PostgREST caches the schema; reload it so the new columns are writable now.
NOTIFY pgrst, 'reload schema';
