import { supabase, USER_ID } from './supabase';

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
function clean(items: Row[]): Row[] {
  return items.map((item) => {
    const cleaned: Row = { ...item, user_id: USER_ID };
    Object.keys(cleaned).forEach((k) => {
      if (cleaned[k] === '' || cleaned[k] === undefined) cleaned[k] = null;
    });
    return cleaned;
  });
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
      const { batchId, batchNotes, experimentNotes, colorSketch, ...rest } = item;
      return {
        ...rest,
        batch_id: batchId || null,
        batch_notes: batchNotes || null,
        experiment_notes: experimentNotes || null,
        color_sketch: colorSketch || null,
      };
    });
  }
  if (key === 'dye_sessions') {
    return items.map((item) => {
      const { sessionId, ...rest } = item;
      return { ...rest, session_id: sessionId || null };
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
 * Upsert rows keyed on `id`, retrying once if the DB rejects an unknown column
 * (the schema has accumulated stray fields over time). Returns true on success.
 */
async function upsertWithRetry(key: CollectionKey, items: Row[]): Promise<boolean> {
  const { error } = await supabase.from(key).upsert(items, { onConflict: 'id' });
  if (!error) return true;

  console.error(`Error upserting ${key}:`, error.message, error);

  // Strip a single unknown column and retry once (PostgREST names it in the message).
  if (error.message.includes('Could not find') && error.message.includes('column')) {
    const match = error.message.match(/Could not find the '(\w+)' column/);
    if (match) {
      const badColumn = match[1];
      console.warn(`Stripping unknown column "${badColumn}" and retrying upsert...`);
      const stripped = items.map(({ [badColumn]: _removed, ...rest }) => rest);
      const { error: retryError } = await supabase.from(key).upsert(stripped, { onConflict: 'id' });
      if (retryError) {
        console.error(`Retry failed for ${key}:`, retryError);
        return false;
      }
      console.log(`Retry succeeded for ${key} (stripped "${badColumn}")`);
      return true;
    }
  }
  return false;
}

export const StorageManager = {
  async get(key: CollectionKey | 'settings'): Promise<any> {
    try {
      if (key === 'settings') {
        const { data, error } = await supabase
          .from('settings')
          .select('settings_data')
          .eq('user_id', USER_ID)
          .maybeSingle();
        if (error) {
          console.error('Error fetching settings:', error);
          return null;
        }
        return data?.settings_data || null;
      }

      const { data, error } = await supabase.from(key).select('*').eq('user_id', USER_ID);
      if (error) {
        console.error(`Error fetching ${key}:`, error.message, error);
        return [];
      }

      let resultData: Row[] = data || [];

      // snake_case -> camelCase on read (preserved verbatim).
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

      console.log(`Fetched ${key}:`, resultData?.length || 0, 'items');
      return resultData;
    } catch (error) {
      console.error(`Exception in get(${key}):`, error);
      return key === 'settings' ? null : [];
    }
  },

  async set(key: CollectionKey | 'settings', value: any): Promise<boolean> {
    try {
      if (key === 'settings') {
        const { error } = await supabase
          .from('settings')
          .upsert({ user_id: USER_ID, settings_data: value }, { onConflict: 'user_id' });
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
      const items = toDbShape(key, clean(value));
      if (items.length > 0) {
        const ok = await upsertWithRetry(key, items);
        if (!ok) return false;
      }

      // 2. Surgically delete only the rows that were removed in the UI:
      //    ids present in the DB but absent from the saved array.
      const keepIds = new Set(
        value.map((it: Row) => Number(it.id)).filter((n: number) => Number.isFinite(n))
      );
      const { data: existing, error: exErr } = await supabase
        .from(key)
        .select('id')
        .eq('user_id', USER_ID);

      if (exErr) {
        // The upsert already succeeded; a failed diff just leaves stale rows
        // (no data loss). Surface it but don't fail the save.
        console.error(`Could not compute removals for ${key}:`, exErr.message);
      } else {
        const removedIds = (existing || [])
          .map((r: Row) => Number(r.id))
          .filter((id: number) => Number.isFinite(id) && !keepIds.has(id));
        if (removedIds.length > 0) {
          const { error: delErr } = await supabase
            .from(key)
            .delete()
            .eq('user_id', USER_ID)
            .in('id', removedIds);
          if (delErr) console.error(`Error deleting removed ${key} rows:`, delErr.message);
          else console.log(`Removed ${removedIds.length} ${key} row(s)`);
        }
      }

      console.log(`Saved ${value.length} items to ${key}`);
      return true;
    } catch (error) {
      console.error(`Exception in set(${key}):`, error);
      return false;
    }
  },
};
