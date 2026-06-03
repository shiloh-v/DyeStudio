-- Per-user Row Level Security for Celestial Dyeworks.
-- Run in Supabase → SQL Editor AFTER the data has been migrated to your auth
-- UUID (see auth-data-migration.sql). This is the lockdown step: it removes the
-- permissive "anyone can read/write" policies and restricts every table to the
-- authenticated owner of each row.
--
-- Effect:
--   * anon role (anon key with no logged-in session)  -> NO policy -> denied
--   * authenticated role -> may touch only rows where auth.uid()::text = user_id
--
-- Reversible: to roll back, recreate a permissive policy, e.g.
--   CREATE POLICY "tmp_all" ON public.recipes FOR ALL USING (true) WITH CHECK (true);

-- 1) Drop ALL existing policies on the app tables (names vary, so do it dynamically).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'recipes','inventory','batches','sales',
        'dye_sessions','kits','color_sketches','gradients','settings'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2) Ensure RLS is enabled and add one per-user policy per table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'recipes','inventory','batches','sales',
    'dye_sessions','kits','color_sketches','gradients','settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "owner_rw" ON public.%I FOR ALL TO authenticated '
      || 'USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id)',
      t
    );
  END LOOP;
END $$;

-- 3) Sanity check — should list one "owner_rw" policy per table.
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
