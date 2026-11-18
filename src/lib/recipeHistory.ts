// Recipe history log (table: recipe_history, see sql/recipe-history.sql).
//
// Fed automatically from StorageManager.set after every successful
// change-only save, so every screen that edits a recipe or types a note is
// covered without wiring each one:
//   - recipes      → 'created' on a new recipe, 'edit' (field before → after)
//                    on every change
//   - dye_sessions → a pan's dye-day note → 'note' on the pan's recipe
//   - batches      → Pipeline batch notes → 'note' on the batch's recipe
// Notes are keyed by where they live (source_key) and upserted, so a note
// that's edited (dye-day notes save after every pause in typing) updates one
// entry instead of piling up; clearing the note removes its entry.

import { supabase, getUserId } from './supabase';

type Row = Record<string, any>;

export interface FieldChange { field: string; from: string | null; to: string | null }

export interface HistoryEntry {
  id: number;
  recipe_id: number;
  kind: 'note' | 'edit' | 'created';
  source_key?: string | null;
  source_label?: string | null;
  body?: string | null;
  changes?: FieldChange[] | null;
  created_at: string;
  updated_at?: string;
}

interface NoteWrite { key: string; recipeId: number | null; label: string; body: string; at?: string }
interface EditWrite { recipeId: number; changes: FieldChange[] }

const TABLE = 'recipe_history';
export const HISTORY_EVENT = 'recipe-history-changed';

// ---------------------------------------------------------------------------
// Recipe field diff (pure).
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  recipeId: 'Recipe ID',
  yarnWeight: 'Yarn weight (g)',
  colorType: 'Type',
  instructions: 'Instructions',
  notes: 'Notes',
  totalMl: 'Total ml',
  stockSolutionPercent: 'Stock solution %',
  citricAcidPerBatch: 'Citric acid per batch',
  aliases: 'Old names',
  retired: 'Retired',
};
// Bookkeeping, not recipe content.
const SKIP = new Set(['id', 'user_id', 'recipe_id', 'created', 'photo', 'photos', 'ingredients', 'colorSolutions', '_aliasText']);

const str = (v: any): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim() || null;
};
const amt = (d: Row) => (d?.amount === '' || d?.amount == null ? null : `${d.amount}${d.unit || ''}`);
const dyeMap = (dyes: any): Map<string, string | null> => {
  const m = new Map<string, string | null>();
  (Array.isArray(dyes) ? dyes : []).forEach((d, i) => {
    if (!d?.name && (d?.amount === '' || d?.amount == null)) return; // blank form row
    let k = String(d?.name || `Dye ${i + 1}`).trim();
    while (m.has(k)) k += ' (2)';
    m.set(k, amt(d));
  });
  return m;
};
function diffDyes(prefix: string, a: any, b: any, out: FieldChange[]) {
  const A = dyeMap(a), B = dyeMap(b);
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const from = A.has(k) ? A.get(k) ?? '—' : null;
    const to = B.has(k) ? B.get(k) ?? '—' : null;
    if (from !== to) out.push({ field: `${prefix}${k}`, from, to });
  }
}

/** Human-readable field changes between two versions of a recipe. */
export function describeRecipeChanges(prev: Row, next: Row): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])) {
    if (SKIP.has(k)) continue;
    const from = str(prev?.[k]), to = str(next?.[k]);
    if (from !== to && !(k === 'retired' && (from ?? 'No') === (to ?? 'No'))) {
      out.push({ field: FIELD_LABELS[k] || k, from, to });
    }
  }
  diffDyes('Dye · ', prev?.ingredients, next?.ingredients, out);

  const sols = (r: Row) => (Array.isArray(r?.colorSolutions) ? r.colorSolutions : []);
  const pa = sols(prev), na = sols(next);
  for (let i = 0; i < Math.max(pa.length, na.length); i++) {
    const name = na[i]?.name || pa[i]?.name || `Solution ${i + 1}`;
    if (str(pa[i]?.targetMl) !== str(na[i]?.targetMl)) {
      out.push({ field: `${name} · target ml`, from: str(pa[i]?.targetMl), to: str(na[i]?.targetMl) });
    }
    diffDyes(`${name} · `, pa[i]?.dyes, na[i]?.dyes, out);
  }

  const photoCount = (r: Row) => (Array.isArray(r?.photos) && r.photos.length ? r.photos.length : r?.photo ? 1 : 0);
  const pc = photoCount(prev), nc = photoCount(next);
  if (pc !== nc) out.push({ field: 'Photos', from: String(pc), to: String(nc) });
  else if (JSON.stringify(prev?.photos ?? null) !== JSON.stringify(next?.photos ?? null)) {
    out.push({ field: 'Photos', from: null, to: 'changed' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a save should log (pure).
// ---------------------------------------------------------------------------

const recipeIdNum = (v: any): number | null => {
  const n = Number(v);
  return v !== '' && v != null && Number.isFinite(n) && n > 0 ? n : null;
};
const byId = (rows: Row[]) => new Map((rows || []).map((r) => [String(r.id), r]));
const panKey = (sessionId: any, pan: Row, idx: number) => `pan:${sessionId}:${pan?.id ?? `i${idx}`}`;

export function planHistory(key: string, prev: Row[], next: Row[]): { notes: NoteWrite[]; edits: EditWrite[]; created: NoteWrite[] } {
  const notes: NoteWrite[] = [];
  const edits: EditWrite[] = [];
  const created: NoteWrite[] = [];
  const old = byId(prev);

  if (key === 'recipes') {
    for (const r of next || []) {
      const id = recipeIdNum(r.id);
      if (!id) continue;
      const p = old.get(String(r.id));
      if (!p) {
        created.push({ key: `created:${id}`, recipeId: id, label: '', body: 'Recipe created' });
        continue;
      }
      const changes = describeRecipeChanges(p, r);
      if (changes.length) edits.push({ recipeId: id, changes });
    }
  }

  if (key === 'dye_sessions') {
    for (const s of next || []) {
      const ps = old.get(String(s.id));
      const prevPans = new Map<string, Row>();
      (ps?.pans || []).forEach((p: Row, i: number) => prevPans.set(panKey(s.id, p, i), p));
      const label = `Dye day · ${s.name || 'session'}`;
      const at = /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') ? new Date(`${s.date}T12:00:00`).toISOString() : undefined;
      (s.pans || []).forEach((pan: Row, i: number) => {
        const k = panKey(s.id, pan, i);
        const before = String(prevPans.get(k)?.experimentNotes || '').trim();
        const now = String(pan?.experimentNotes || '').trim();
        if (before === now) return;
        notes.push({ key: k, recipeId: recipeIdNum(pan?.recipeId) ?? recipeIdNum(pan?.recipe?.id), label, body: now, at });
      });
    }
  }

  if (key === 'batches') {
    for (const b of next || []) {
      const p = old.get(String(b.id));
      const tag = b.batchId ? ` · ${b.batchId}` : '';
      const before = String(p?.batchNotes || '').trim();
      const now = String(b.batchNotes || '').trim();
      if (before !== now) {
        notes.push({ key: `batch:${b.id}`, recipeId: recipeIdNum(b.recipeId), label: `Batch notes${tag}`, body: now });
      }
      // Batches made from a Queue pan already logged that note from the pan.
      if (b.sourceSessionId == null) {
        const eb = String(p?.experimentNotes || '').trim();
        const en = String(b.experimentNotes || '').trim();
        if (eb !== en) notes.push({ key: `batch:${b.id}:exp`, recipeId: recipeIdNum(b.recipeId), label: `Dye-day notes${tag}`, body: en });
      }
    }
  }
  return { notes, edits, created };
}

// ---------------------------------------------------------------------------
// Writing + reading.
// ---------------------------------------------------------------------------

let warned = false;
const report = (error: any) => {
  if (!warned) console.warn('Recipe history not saved (run sql/recipe-history.sql?):', error?.message || error);
  warned = true;
};

/** Log whatever a successful save changed. Never throws — history must not block saving. */
export async function recordHistory(key: string, prev: Row[], next: Row[]): Promise<void> {
  if (!['recipes', 'dye_sessions', 'batches'].includes(key)) return;
  try {
    const { notes, edits, created } = planHistory(key, prev, next);
    if (!notes.length && !edits.length && !created.length) return;
    const userId = await getUserId();
    if (!userId) return;
    const now = new Date().toISOString();

    const upserts = [
      ...created.map((c) => ({ user_id: userId, recipe_id: c.recipeId, kind: 'created', source_key: c.key, body: c.body })),
      ...notes.filter((n) => n.body && n.recipeId).map((n) => ({
        user_id: userId, recipe_id: n.recipeId, kind: 'note', source_key: n.key,
        source_label: n.label, body: n.body, updated_at: now,
      })),
    ];
    // Clearing a note (or a pan losing its recipe) removes its entry.
    const removeKeys = notes.filter((n) => !n.body || !n.recipeId).map((n) => n.key);
    const inserts = edits.map((e) => ({ user_id: userId, recipe_id: e.recipeId, kind: 'edit', changes: e.changes }));

    // New note entries take the dye day's date; existing ones keep theirs.
    const fresh = notes.filter((n) => n.body && n.recipeId && n.at);
    if (fresh.length) {
      const { data } = await supabase.from(TABLE).select('source_key').eq('user_id', userId).in('source_key', fresh.map((n) => n.key));
      const have = new Set((data || []).map((r: Row) => r.source_key));
      for (const n of fresh) {
        if (have.has(n.key)) continue;
        const row = upserts.find((u) => u.source_key === n.key) as Row | undefined;
        if (row) row.created_at = n.at;
      }
    }

    // One request per row shape: a column missing from some rows would be
    // written as null/default on the others (e.g. resetting created_at).
    const groups = new Map<string, Row[]>();
    for (const u of upserts as Row[]) {
      const shape = Object.keys(u).sort().join(',');
      groups.set(shape, [...(groups.get(shape) || []), u]);
    }
    for (const rows of groups.values()) {
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'user_id,source_key' });
      if (error) return report(error);
    }
    if (removeKeys.length) {
      const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).in('source_key', removeKeys);
      if (error) return report(error);
    }
    if (inserts.length) {
      const { error } = await supabase.from(TABLE).insert(inserts);
      if (error) return report(error);
    }
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
  } catch (e) {
    report(e);
  }
}

/** A recipe's history, newest first. Identical note text is shown once. */
export async function fetchRecipeHistory(recipeId: number): Promise<HistoryEntry[]> {
  const userId = await getUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE).select('*').eq('user_id', userId).eq('recipe_id', recipeId)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  // Oldest copy of a repeated note wins (two pans of one colorway share a note).
  return [...(data as HistoryEntry[])].reverse().filter((e) => {
    if (e.kind !== 'note') return true;
    const k = String(e.body || '').trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).reverse();
}
