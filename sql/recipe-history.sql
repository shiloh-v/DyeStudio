-- Recipe history log
-- ------------------------------------------------------------------
-- One append-style log per recipe, shown under "History" on each recipe
-- card. The app writes to it automatically (src/lib/recipeHistory.ts):
--   kind 'note'    — dye-day notes typed in the Queue (per pan) and batch
--                    notes added in Pipeline. Keyed by source_key, so editing
--                    a note updates its entry instead of adding a new one,
--                    and clearing the note removes it.
--   kind 'edit'    — every saved change to a recipe, with before → after
--                    for each field (dye amounts, instructions, notes, name…).
--   kind 'created' — when the recipe was made.
--
-- WITHOUT THIS MIGRATION the app still works; the History panel just says
-- to run this file.
--
-- Run in the Supabase SQL editor (project hqjuyceebdujenrrtoth).
-- BACKUP FIRST (dev-notes rule):
--   node --env-file=.env scripts/backup.mjs

-- 1. Table + per-user RLS (same "owner_rw" rule as the other tables).
CREATE TABLE IF NOT EXISTS public.recipe_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      text        NOT NULL DEFAULT (auth.uid())::text,
  recipe_id    bigint      NOT NULL,          -- recipes.id
  kind         text        NOT NULL CHECK (kind IN ('note', 'edit', 'created')),
  source_key   text,                          -- notes only: where the note lives
  source_label text,                          -- e.g. "Dye day · Nov 12 session"
  body         text,
  changes      jsonb,                         -- edits: [{field, from, to}]
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_history_source_unique UNIQUE (user_id, source_key)
);

CREATE INDEX IF NOT EXISTS recipe_history_recipe_idx
  ON public.recipe_history (user_id, recipe_id, created_at DESC);

ALTER TABLE public.recipe_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_rw" ON public.recipe_history;
CREATE POLICY "owner_rw" ON public.recipe_history FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- 2. Backfill from what's already saved, using the same source keys the app
--    uses, so nothing is logged twice. Safe to re-run (ON CONFLICT DO NOTHING).

-- 2a. "Created" entry for every recipe.
INSERT INTO public.recipe_history (user_id, recipe_id, kind, body, created_at, source_key)
SELECT r.user_id, r.id, 'created', 'Recipe created',
       CASE WHEN (to_jsonb(r)->>'created') ~ '^\d{4}-\d{2}-\d{2}'
            THEN (to_jsonb(r)->>'created')::timestamptz ELSE now() END,
       'created:' || r.id
FROM public.recipes r
ON CONFLICT (user_id, source_key) DO NOTHING;

-- 2b. Dye-day notes still on session pans.
INSERT INTO public.recipe_history (user_id, recipe_id, kind, source_key, source_label, body, created_at)
SELECT s.user_id, r.id, 'note',
       'pan:' || s.id || ':' || COALESCE(p.pan->>'id', 'i' || (p.idx - 1)),
       'Dye day · ' || COALESCE(NULLIF(to_jsonb(s)->>'name', ''), 'session'),
       btrim(p.pan->>'experimentNotes'),
       CASE WHEN (to_jsonb(s)->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
            THEN (to_jsonb(s)->>'date')::date::timestamptz ELSE now() END
FROM public.dye_sessions s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(to_jsonb(s)->'pans') = 'array' THEN to_jsonb(s)->'pans' ELSE '[]'::jsonb END
) WITH ORDINALITY AS p(pan, idx)
JOIN public.recipes r
  ON r.user_id = s.user_id
 AND r.id::text = COALESCE(NULLIF(p.pan->>'recipeId', ''), p.pan->'recipe'->>'id')
WHERE btrim(COALESCE(p.pan->>'experimentNotes', '')) <> ''
ON CONFLICT (user_id, source_key) DO NOTHING;

-- 2c. Batch notes (Pipeline) and dye-day notes on older batches.
INSERT INTO public.recipe_history (user_id, recipe_id, kind, source_key, source_label, body, created_at)
SELECT b.user_id, r.id, 'note', n.key, n.label, n.body,
       CASE WHEN (to_jsonb(b)->>'startDate') ~ '^\d{4}-\d{2}-\d{2}$'
            THEN (to_jsonb(b)->>'startDate')::date::timestamptz
            ELSE COALESCE(b.last_moved_at, now()) END
FROM public.batches b
JOIN public.recipes r
  ON r.user_id = b.user_id AND r.id::text = to_jsonb(b)->>'recipeId'
CROSS JOIN LATERAL (VALUES
  ('batch:' || b.id,
   'Batch notes' || COALESCE(' · ' || NULLIF(b.batch_id, ''), ''),
   btrim(COALESCE(b.batch_notes, ''))),
  ('batch:' || b.id || ':exp',
   'Dye-day notes' || COALESCE(' · ' || NULLIF(b.batch_id, ''), ''),
   CASE WHEN to_jsonb(b)->>'sourceSessionId' IS NULL   -- newer batches: logged from the pan
        THEN btrim(COALESCE(b.experiment_notes, '')) ELSE '' END)
) AS n(key, label, body)
WHERE n.body <> ''
ON CONFLICT (user_id, source_key) DO NOTHING;

-- PostgREST caches the schema; reload it so the app sees the new table now.
NOTIFY pgrst, 'reload schema';

-- 3. Verify.
SELECT kind, count(*) FROM public.recipe_history GROUP BY kind ORDER BY kind;
