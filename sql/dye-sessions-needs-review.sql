-- Dye sessions drafted by the Demand batch plan are flagged "needs review"
-- until you confirm them in Dye Sessions.
-- ------------------------------------------------------------------
-- Run in the Supabase SQL editor (project hqjuyceebdujenrrtoth).
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs

ALTER TABLE public.dye_sessions
  ADD COLUMN IF NOT EXISTS "needsReview" boolean;

-- PostgREST caches the schema; reload it so the new column is writable now.
NOTIFY pgrst, 'reload schema';
