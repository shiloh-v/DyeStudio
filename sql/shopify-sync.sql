-- Shopify live sync: one status row per user
-- ------------------------------------------
-- Written ONLY by the server function api/shopify-sync.ts (service-role key).
-- The app reads it to show "Last synced …" and to pick up the latest Shopify
-- stock levels (`inventory` has the same shape as settings.shopifyInventory).
--
-- Kept out of the `settings` row on purpose: the app saves settings from its
-- in-memory copy, so a tab left open overnight would overwrite the morning's
-- synced stock levels with yesterday's.
--
-- Run once in the Supabase SQL editor (project hqjuyceebdujenrrtoth).

CREATE TABLE IF NOT EXISTS public.shopify_sync (
  user_id      text PRIMARY KEY,
  inventory    jsonb,
  last_sync_at timestamptz,
  last_result  jsonb
);

ALTER TABLE public.shopify_sync ENABLE ROW LEVEL SECURITY;

-- Signed-in owner can read their row; nobody but the service role writes.
DROP POLICY IF EXISTS "owner_read" ON public.shopify_sync;
CREATE POLICY "owner_read" ON public.shopify_sync
  FOR SELECT TO authenticated USING (auth.uid()::text = user_id);

NOTIFY pgrst, 'reload schema';
