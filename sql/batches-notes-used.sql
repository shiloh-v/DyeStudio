-- Pipeline "use the batch notes before stocking" check
-- ------------------------------------------------------------------
-- Adds a "notesUsedAt" timestamp column to public.batches. The app
-- stamps it when a batch's notes are marked used (the "✓ Notes used"
-- button, or confirming the notes dialog when stocking) and clears it
-- when the notes are edited. Batches with notes and no "notesUsedAt"
-- trigger the notes check before they can move to Stocked.
--
-- WITHOUT THIS MIGRATION the app still works: storage.ts auto-strips
-- the unknown column on save, so the check simply asks again every
-- time. Running this migration makes the "used" mark persist.
--
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs
--
-- Replace <OWNER_UUID> with the owner's auth user id
-- (current owner: 8b6cf033-b0b8-41f0-bef3-bfc562f5ee88).

-- 1. Add the column (camelCase, like "soldDate" — the app passes it through).
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS "notesUsedAt" timestamptz;

-- 2. Backfill: batches already stocked are past the check, so don't
--    flag their old notes.
UPDATE public.batches
SET "notesUsedAt" = COALESCE(last_moved_at, "soldDate"::timestamptz, now())
WHERE "notesUsedAt" IS NULL
  AND status IN ('stocked', 'sold')
  AND COALESCE(batch_notes, '') <> ''
  AND user_id = '<OWNER_UUID>';

-- 3. Verify: in-progress batches still waiting on their notes.
SELECT status, count(*) AS notes_not_yet_used
FROM public.batches
WHERE "notesUsedAt" IS NULL
  AND COALESCE(batch_notes, '') <> ''
  AND user_id = '<OWNER_UUID>'
GROUP BY status;
