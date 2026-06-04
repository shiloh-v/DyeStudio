-- Sold → Stocked data migration (OPTIONAL cleanup)
-- ------------------------------------------------------------------
-- The app treats legacy status='sold' batches as 'stocked' everywhere
-- (see src/lib/batches.ts isStocked), so it works correctly WITHOUT this
-- migration. Running it just normalizes old rows to the new value so the
-- data is consistent. Reversible.
--
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs
--
-- Replace <OWNER_UUID> with the owner's auth user id
-- (current owner: 8b6cf033-b0b8-41f0-bef3-bfc562f5ee88).

-- 1. Preview how many rows will change:
SELECT count(*) AS legacy_sold_rows
FROM public.batches
WHERE status = 'sold'
  AND user_id = '<OWNER_UUID>';

-- 2. Migrate:
UPDATE public.batches
SET status = 'stocked'
WHERE status = 'sold'
  AND user_id = '<OWNER_UUID>';

-- 3. Verify (should be 0):
SELECT count(*) AS remaining_sold
FROM public.batches
WHERE status = 'sold'
  AND user_id = '<OWNER_UUID>';

-- Rollback if ever needed:
-- UPDATE public.batches SET status = 'sold'
-- WHERE status = 'stocked' AND user_id = '<OWNER_UUID>';
