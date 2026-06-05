-- Pipeline "newest on top" column ordering
-- ------------------------------------------------------------------
-- Adds a `last_moved_at` timestamp column to public.batches. The app
-- stamps this on every batch creation and every status change, then
-- sorts each Pipeline column by it (newest at the top).
--
-- WITHOUT THIS MIGRATION the app still works: storage.ts auto-strips
-- the unknown column on save, and the in-memory sort falls back to
-- startDate / id. Running this migration makes the ordering persist
-- across page reloads.
--
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs
--
-- Replace <OWNER_UUID> with the owner's auth user id
-- (current owner: 8b6cf033-b0b8-41f0-bef3-bfc562f5ee88).

-- 1. Add the column (nullable; existing rows backfilled below).
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS last_moved_at timestamptz;

-- 2. Backfill existing rows so they don't all sink to the bottom of
--    every column. Prefer soldDate (terminal stage) where set, else
--    startDate, else NULL (will fall back to id in the client sort).
UPDATE public.batches
SET last_moved_at = COALESCE(
    "soldDate"::timestamptz,
    "startDate"::timestamptz
  )
WHERE last_moved_at IS NULL
  AND user_id = '<OWNER_UUID>';

-- 3. Verify (should be 0 once you've stocked or moved every batch at
--    least once; harmless to leave NULL rows — they just sort to the
--    bottom of their column).
SELECT count(*) AS rows_without_last_moved_at
FROM public.batches
WHERE last_moved_at IS NULL
  AND user_id = '<OWNER_UUID>';

-- 4. (Optional) Index for column-by-column sort performance. Only
--    worth it once you have thousands of batches.
-- CREATE INDEX IF NOT EXISTS batches_last_moved_at_idx
--   ON public.batches (user_id, status, last_moved_at DESC);
