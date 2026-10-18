-- Shopify sales import: repurpose the (unused, empty) `sales` table
-- ------------------------------------------------------------------
-- Each row is ONE Shopify order line item, imported from the Orders CSV export
-- (Demand tab → Import). Only what demand analytics needs is stored — order
-- number, date, product/variant, vendor, SKU, quantity, price, discount, status. NO
-- customer names, emails or addresses are ever saved.
--
-- The table already has per-user RLS, backup and test-seeding wired up
-- (auth-rls.sql, scripts/backup.mjs, scripts/seed-test-account.mjs).
--
-- Run in the Supabase SQL editor (project hqjuyceebdujenrrtoth).
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS "lineKey"         text,
  ADD COLUMN IF NOT EXISTS "orderName"       text,
  ADD COLUMN IF NOT EXISTS "orderDate"       date,
  ADD COLUMN IF NOT EXISTS "productTitle"    text,
  ADD COLUMN IF NOT EXISTS "variantTitle"    text,
  ADD COLUMN IF NOT EXISTS "lineName"        text,
  ADD COLUMN IF NOT EXISTS "sku"             text,
  ADD COLUMN IF NOT EXISTS "quantity"        integer,
  ADD COLUMN IF NOT EXISTS "unitPrice"       numeric,
  ADD COLUMN IF NOT EXISTS "discount"        numeric,
  ADD COLUMN IF NOT EXISTS "financialStatus" text,
  ADD COLUMN IF NOT EXISTS "cancelled"       boolean,
  ADD COLUMN IF NOT EXISTS "importedAt"      timestamptz,
  ADD COLUMN IF NOT EXISTS "vendor"          text;

-- The table predates this feature and may carry legacy NOT NULL columns the
-- import doesn't fill. It holds no data (verified 0 rows), so relax them.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales'
      AND is_nullable = 'NO' AND column_name NOT IN ('id', 'user_id')
  LOOP
    EXECUTE format('ALTER TABLE public.sales ALTER COLUMN %I DROP NOT NULL', c.column_name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS sales_user_order_date ON public.sales (user_id, "orderDate");

-- PostgREST caches the schema; reload it so the new columns are writable now.
NOTIFY pgrst, 'reload schema';
