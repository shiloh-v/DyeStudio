-- Batch columns the app writes but the table never had
-- ------------------------------------------------------------------
-- The app stamps these on every batch it creates from a finished dye
-- session. Without them storage.ts strips the fields on save, which means:
--   - color_sketch            → Color Lab data on Pipeline batches is lost
--   - sourceSessionId/PanIndex → notes added to a FINISHED session in the
--                                Queue can't find their batches
--   - isAdHoc                 → ad hoc batches aren't flagged
--
-- Run in the Supabase SQL editor (project hqjuyceebdujenrrtoth).
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS color_sketch       jsonb,
  ADD COLUMN IF NOT EXISTS "sourceSessionId"  bigint,
  ADD COLUMN IF NOT EXISTS "sourcePanIndex"   integer,
  ADD COLUMN IF NOT EXISTS "isAdHoc"          boolean;

-- PostgREST caches the schema; reload it so the new columns are writable now.
NOTIFY pgrst, 'reload schema';
