-- One-time data migration: reassign all existing rows from the 'default-user'
-- sentinel to your real Supabase Auth UUID. Run BEFORE applying auth-rls.sql.
--
-- The assistant normally runs this via the REST API (the anon key can still
-- write while RLS is permissive), but this SQL is the equivalent / a fallback.
--
-- Replace <OWNER_UUID> with the UUID from Authentication → Users.
-- Take a backup first (scripts/backup.mjs). Reversible by swapping the values.

UPDATE public.recipes        SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.inventory      SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.batches        SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.sales          SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.dye_sessions   SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.kits           SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.color_sketches SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.gradients      SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';
UPDATE public.settings       SET user_id = '<OWNER_UUID>' WHERE user_id = 'default-user';

-- Verify: every table should now report 0 rows still on 'default-user'.
SELECT 'recipes' t, count(*) FROM public.recipes WHERE user_id='default-user'
UNION ALL SELECT 'inventory', count(*) FROM public.inventory WHERE user_id='default-user'
UNION ALL SELECT 'batches', count(*) FROM public.batches WHERE user_id='default-user'
UNION ALL SELECT 'sales', count(*) FROM public.sales WHERE user_id='default-user'
UNION ALL SELECT 'dye_sessions', count(*) FROM public.dye_sessions WHERE user_id='default-user'
UNION ALL SELECT 'kits', count(*) FROM public.kits WHERE user_id='default-user'
UNION ALL SELECT 'color_sketches', count(*) FROM public.color_sketches WHERE user_id='default-user'
UNION ALL SELECT 'gradients', count(*) FROM public.gradients WHERE user_id='default-user'
UNION ALL SELECT 'settings', count(*) FROM public.settings WHERE user_id='default-user';
