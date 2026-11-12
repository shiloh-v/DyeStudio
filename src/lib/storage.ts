import { supabase, getUserId } from './supabase';

// Collections backed by their own table. `settings` is handled specially.
export type CollectionKey =
  | 'recipes'
  | 'inventory'
  | 'batches'
  | 'sales'
  | 'dye_sessions'
  | 'kits'
  | 'color_sketches'
  | 'gradients';

type Row = Record<string, any>;

/**
 * Convert empty-string / undefined fields to null and stamp the user id.
 * (Matches the original cleaning step so numeric columns accept the value.)
 */
function clean(items: Row[], userId: string): Row[] {
  return items.map((item) => {
    const cleaned: Row = { ...item, user_id: userId };
    Object.keys(cleaned).forEach((k) => {
      if (cleaned[k] === '' || cleaned[k] === undefined) cleaned[k] = null;
    });
    return cleaned;
  });
}

/**
 * Pans used to carry a full copy of their recipe's / sketch's photos (base64),
 * which made dye_sessions ~10 MB — almost all photos — and every save re-sent
 * all of it until the database started rejecting the request. Photos live on
 * the recipe/sketch; screens look them up from there (see lib/panPhotos.ts).
 */
function stripPanPhotos(pan: Row): Row {
  if (!pan || typeof pan !== 'object') return pan;
  const out: Row = { ...pan };
  for (const k of ['recipe', 'colorSketch']) {
    if (out[k] && typeof out[k] === 'object') {
      const { photo: _p, photos: _ps, ...rest } = out[k];
      out[k] = rest;
    }
  }
  return out;
}

/**
 * Per-collection camelCase -> snake_case conversion for the columns that are
 * actually stored snake_case in the DB. Everything else is passed through
 * unchanged. (Preserved verbatim from the original StorageManager.)
 */
function toDbShape(key: CollectionKey, items: Row[]): Row[] {
  if (key === 'color_sketches') {
    return items.map((item) => {
      const { colorId, customName, yarnWeight, baseColors, experimentNotes, ...rest } = item;
      return {
        ...rest,
        name: colorId || 'TEMP', // name mirrors colorId for backwards compatibility
        color_id: colorId || null,
        custom_name: customName || null,
        yarn_weight: yarnWeight || 100,
        base_colors: baseColors || [],
        experiment_notes: experimentNotes || null,
      };
    });
  }
  if (key === 'recipes') {
    return items.map((item) => {
      const { recipeId, ...rest } = item;
      return { ...rest, recipe_id: recipeId || null };
    });
  }
  if (key === 'batches') {
    return items.map((item) => {
      const { batchId, batchNotes, experimentNotes, colorSketch, lastMovedAt, ...rest } = item;
      return {
        ...rest,
        batch_id: batchId || null,
        batch_notes: batchNotes || null,
        experiment_notes: experimentNotes || null,
        color_sketch: colorSketch || null,
        last_moved_at: lastMovedAt || null,
      };
    });
  }
  if (key === 'dye_sessions') {
    return items.map((item) => {
      const { sessionId, ...rest } = item;
      return {
        ...rest,
        pans: Array.isArray(rest.pans) ? rest.pans.map(stripPanPhotos) : rest.pans,
        session_id: sessionId || null,
      };
    });
  }
  if (key === 'kits') {
    return items.map((item) => {
      const { bundleId, bundleType, baseYarn, ...rest } = item;
      return {
        ...rest,
        bundle_id: bundleId || null,
        bundle_type: bundleType || null,
        base_yarn: baseYarn || null,
      };
    });
  }
  return items;
}

/**
 * Upsert rows keyed on `id`. If the DB rejects an unknown column (the schema
 * has accumulated stray fields over time), strip it and retry — repeatedly, so
 * several missing columns can't sink the whole save. Returns true on success.
 */
async function upsertWithRetry(key: CollectionKey, items: Row[]): Promise<boolean> {
  let rows = items;
  const stripped: string[] = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    const { error } = await supabase.from(key).upsert(rows, { onConflict: 'id' });
    if (!error) {
      if (stripped.length) console.warn(`Saved ${key} without unknown column(s): ${stripped.join(', ')}`);
      return true;
    }

    // PostgREST names the missing column in the message.
    const match = error.message.match(/Could not find the '(\w+)' column/);
    if (!match || stripped.includes(match[1])) {
      console.error(`Error upserting ${key}:`, error.message, error);
      return false;
    }
    const badColumn = match[1];
    stripped.push(badColumn);
    rows = rows.map(({ [badColumn]: _removed, ...rest }) => rest);
  }
  console.error(`Gave up upserting ${key} after stripping: ${stripped.join(', ')}`);
  return false;
}

/**
 * snake_case -> camelCase on read (preserved verbatim). Also used to restore
 * raw-row backups written by scripts/backup.mjs.
 */
export function fromDbShape(key: CollectionKey, rows: Row[]): Row[] {
  let resultData = rows;

  if (key === 'color_sketches') {
    resultData = resultData.map((item) => ({
      ...item,
      colorId: item.color_id,
      customName: item.custom_name,
      yarnWeight: item.yarn_weight,
      baseColors: item.base_colors,
      experimentNotes: item.experiment_notes || '',
    }));
  }
  if (key === 'recipes') {
    resultData = resultData.map((item) => ({ ...item, recipeId: item.recipe_id }));
  }
  if (key === 'batches') {
    resultData = resultData.map((item) => ({
      ...item,
      batchId: item.batch_id || '',
      batchNotes: item.batch_notes || '',
      experimentNotes: item.experiment_notes || '',
      colorSketch: item.color_sketch || null,
      lastMovedAt: item.last_moved_at || null,
    }));
  }
  if (key === 'kits') {
    resultData = resultData.map((item) => ({
      ...item,
      bundleId: item.bundle_id || '',
      bundleType: item.bundle_type || '',
      baseYarn: item.base_yarn || '',
    }));
  }
  if (key === 'dye_sessions') {
    resultData = resultData.map((item) => ({ ...item, sessionId: item.session_id || '' }));
  }
  return resultData;
}

// PostgREST caps every response at 1000 rows (Supabase default max-rows), so a
// plain select silently truncates big tables — and a truncated load followed by
// a save would DELETE the missing rows. Page through with .range() instead.
const PAGE = 1000;
async function selectAll(key: CollectionKey, columns: string, userId: string): Promise<{ data: Row[]; error: any }> {
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(key)
      .select(columns)
      .eq('user_id', userId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return { data: all, error };
    all.push(...((data as Row[]) || []));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

// Upsert in chunks so a large import (thousands of Shopify lines) stays well
// under request-size limits.
const UPSERT_CHUNK = 500;

// ---------------------------------------------------------------------------
// Change-only saves.
//
// Every screen saves by handing over the whole collection. Writing all of it
// back meant a tab (or device) holding an old copy overwrote everything other
// tabs had saved since it loaded — e.g. a dye-day note typed on a stale phone
// un-finished a session that the laptop had just finished — and deleted any
// row it didn't know about. Instead we diff against the copy this tab last
// had (`prev`) and write only what this tab actually changed:
//   - new rows are inserted whole,
//   - edited rows get only their changed columns,
//   - only rows this tab removed are deleted.
// ---------------------------------------------------------------------------

const sameJson = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface SavePlan {
  inserts: Row[];
  patches: { id: number; patch: Row }[];
  deletes: number[];
}

/** Pure: what a save of `next` (replacing `prev`) must write. Exported for tests. */
export function planSave(key: CollectionKey, prev: Row[], next: Row[], userId: string): SavePlan {
  const prevDb = new Map<string, Row>(toDbShape(key, clean(prev, userId)).map((r) => [String(r.id), r]));
  const nextDb = toDbShape(key, clean(next, userId));
  const inserts: Row[] = [];
  const patches: { id: number; patch: Row }[] = [];
  for (const row of nextDb) {
    const old = prevDb.get(String(row.id));
    if (!old) { inserts.push(row); continue; }
    const patch: Row = {};
    for (const k of new Set([...Object.keys(row), ...Object.keys(old)])) {
      if (k === 'id' || k === 'user_id') continue;
      if (!sameJson(row[k], old[k])) patch[k] = row[k] ?? null;
    }
    if (Object.keys(patch).length) patches.push({ id: row.id, patch });
  }
  const nextIds = new Set(nextDb.map((r) => String(r.id)));
  const deletes = [...prevDb.keys()]
    .filter((id) => !nextIds.has(id))
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return { inserts, patches, deletes };
}

/** Update only `patch`'s columns on one row; strips unknown columns like upsertWithRetry. */
async function updateWithRetry(key: CollectionKey, id: number, patch: Row, userId: string): Promise<boolean> {
  let cols = patch;
  for (let attempt = 0; attempt < 15; attempt++) {
    if (Object.keys(cols).length === 0) return true;
    const { error } = await supabase.from(key).update(cols).eq('user_id', userId).eq('id', id);
    if (!error) return true;
    const match = error.message.match(/Could not find the '(\w+)' column/);
    if (!match || !(match[1] in cols)) {
      console.error(`Error updating ${key} ${id}:`, error.message, error);
      return false;
    }
    const { [match[1]]: _removed, ...rest } = cols;
    cols = rest;
  }
  return false;
}

/** Run async jobs a few at a time; true only if every job succeeded. */
async function allOk(jobs: Array<() => Promise<boolean>>, concurrency = 6): Promise<boolean> {
  let ok = true;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const results = await Promise.all(jobs.slice(i, i + concurrency).map((j) => j()));
    if (results.includes(false)) ok = false;
  }
  return ok;
}

// Above this many edited rows in one save (bulk imports), send whole rows in
// chunked upserts instead of one request per row.
const MAX_ROW_PATCHES = 150;

async function deleteIds(key: CollectionKey, ids: number[], userId: string): Promise<boolean> {
  // Chunked so the id list stays within URL-length limits.
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from(key).delete().eq('user_id', userId).in('id', ids.slice(i, i + 200));
    if (error) {
      console.error(`Error deleting removed ${key} rows:`, error.message);
      return false;
    }
  }
  if (ids.length > 0) console.log(`Removed ${ids.length} ${key} row(s)`);
  return true;
}

async function saveChanges(key: CollectionKey, prev: Row[], next: Row[], userId: string): Promise<boolean> {
  const { inserts, patches, deletes } = planSave(key, prev, next, userId);
  for (let i = 0; i < inserts.length; i += UPSERT_CHUNK) {
    if (!(await upsertWithRetry(key, inserts.slice(i, i + UPSERT_CHUNK)))) return false;
  }
  if (patches.length > MAX_ROW_PATCHES) {
    const ids = new Set(patches.map((p) => String(p.id)));
    const rows = toDbShape(key, clean(next, userId)).filter((r) => ids.has(String(r.id)));
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      if (!(await upsertWithRetry(key, rows.slice(i, i + UPSERT_CHUNK)))) return false;
    }
  } else if (!(await allOk(patches.map((p) => () => updateWithRetry(key, p.id, p.patch, userId))))) {
    return false;
  }
  if (!(await deleteIds(key, deletes, userId))) return false;
  console.log(`Saved ${key}: ${inserts.length} new, ${patches.length} changed, ${deletes.length} removed`);
  return true;
}

/**
 * Settings are one JSON blob. Write back only the top-level keys this tab
 * changed, on top of what's in the database now, so a stale tab can't revert
 * settings changed elsewhere.
 */
async function saveSettingsChanges(prev: Row | null, next: Row, userId: string): Promise<boolean> {
  const changed = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])]
    .filter((k) => !sameJson((prev || {})[k], (next || {})[k]));
  if (changed.length === 0) return true;
  const { data, error: readErr } = await supabase
    .from('settings').select('settings_data').eq('user_id', userId).maybeSingle();
  if (readErr) {
    console.error('Error reading settings before save:', readErr);
    return false;
  }
  const merged: Row = { ...(data?.settings_data || prev || {}) };
  for (const k of changed) {
    if (next[k] === undefined) delete merged[k];
    else merged[k] = next[k];
  }
  const { error } = await supabase
    .from('settings').upsert({ user_id: userId, settings_data: merged }, { onConflict: 'user_id' });
  if (error) {
    console.error('Error saving settings:', error);
    return false;
  }
  return true;
}

export const StorageManager = {
  // Throws on any failure. A failed load must never look like an empty table:
  // set() deletes every row missing from the saved array, so saving after a
  // silently-empty load would wipe the real data.
  async get(key: CollectionKey | 'settings'): Promise<any> {
    const userId = await getUserId();
    if (!userId) throw new Error(`Not signed in (loading ${key})`);
    if (key === 'settings') {
      const { data, error } = await supabase
        .from('settings')
        .select('settings_data')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.error('Error fetching settings:', error);
        throw new Error(`Could not load settings: ${error.message}`);
      }
      return data?.settings_data || null;
    }

    const { data, error } = await selectAll(key, '*', userId);
    if (error) {
      console.error(`Error fetching ${key}:`, error.message, error);
      throw new Error(`Could not load ${key}: ${error.message}`);
    }

    const resultData = fromDbShape(key, data || []);

    console.log(`Fetched ${key}:`, resultData?.length || 0, 'items');
    return resultData;
  },

  /**
   * Save a collection. Pass `prev` (the copy this tab had before the change)
   * for a change-only save — what every screen does. Without `prev` (backup
   * restore) the database is made to match `value` exactly.
   */
  async set(key: CollectionKey | 'settings', value: any, prev?: any): Promise<boolean> {
    try {
      const userId = await getUserId();
      if (!userId) return false;
      if (prev !== undefined) {
        if (key === 'settings') return await saveSettingsChanges(prev, value, userId);
        if (!Array.isArray(value) || !Array.isArray(prev)) return false;
        return await saveChanges(key, prev, value, userId);
      }
      if (key === 'settings') {
        const { error } = await supabase
          .from('settings')
          .upsert({ user_id: userId, settings_data: value }, { onConflict: 'user_id' });
        if (error) {
          console.error('Error saving settings:', error);
          return false;
        }
        console.log('Settings saved successfully');
        return true;
      }

      if (!Array.isArray(value)) return false;

      // 1. Upsert all current rows (insert new, update existing) keyed on `id`.
      //    We never delete first, so a failed/interrupted write cannot wipe data
      //    — this is the core fix for the old delete-all-then-insert pattern.
      const items = toDbShape(key, clean(value, userId));
      for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
        const ok = await upsertWithRetry(key, items.slice(i, i + UPSERT_CHUNK));
        if (!ok) return false;
      }

      // 2. Surgically delete only the rows that were removed in the UI:
      //    ids present in the DB but absent from the saved array.
      const keepIds = new Set(
        value.map((it: Row) => Number(it.id)).filter((n: number) => Number.isFinite(n))
      );
      const { data: existing, error: exErr } = await selectAll(key, 'id', userId);

      if (exErr) {
        // The upsert succeeded but removals didn't happen, so deleted items
        // would reappear on reload. Report failure so the caller can say so.
        console.error(`Could not compute removals for ${key}:`, exErr.message);
        return false;
      } else {
        const removedIds = (existing || [])
          .map((r: Row) => Number(r.id))
          .filter((id: number) => Number.isFinite(id) && !keepIds.has(id));
        // Chunked so the id list stays within URL-length limits.
        for (let i = 0; i < removedIds.length; i += 200) {
          const chunk = removedIds.slice(i, i + 200);
          const { error: delErr } = await supabase
            .from(key)
            .delete()
            .eq('user_id', userId)
            .in('id', chunk);
          if (delErr) {
            console.error(`Error deleting removed ${key} rows:`, delErr.message);
            return false;
          }
        }
        if (removedIds.length > 0) console.log(`Removed ${removedIds.length} ${key} row(s)`);
      }

      console.log(`Saved ${value.length} items to ${key}`);
      return true;
    } catch (error) {
      console.error(`Exception in set(${key}):`, error);
      return false;
    }
  },
};
