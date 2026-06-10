// Seed a TEST Supabase account with a copy of the latest backup.
//
// Why this exists: the app's Restore upserts rows by their global `id`. When you
// restore one account's backup into a DIFFERENT account, every id collides with
// the original owner's rows and RLS blocks the write (nothing lands). This script
// re-ids every row by a constant OFFSET and remaps the id references (batches +
// session pans point at recipe/sketch/kit ids), then INSERTs them under the test
// account — fresh ids, no collision.
//
// Run: TEST_EMAIL=… TEST_PASSWORD=… node --env-file=.env scripts/seed-test-account.mjs
// (Creds are read from env so they're never committed.)

import { readFileSync, readdirSync } from 'fs';

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !anon || !email || !password) {
  console.error('Need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (.env) and TEST_EMAIL/TEST_PASSWORD (inline).');
  process.exit(1);
}

// Push ids well clear of real (~1.77e12) ones, staying inside JS safe-int range.
const OFFSET = 1_000_000_000_000_000;
const isNum = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
const offId = (v) => Number(v) + OFFSET;            // PK — always present & numeric
const offRef = (v) => (isNum(v) ? Number(v) + OFFSET : v); // reference — may be blank

// Newest backup file.
const file = readdirSync('outputs')
  .filter((f) => f.startsWith('supabase-backup-') && f.endsWith('.json'))
  .sort().reverse()[0];
if (!file) { console.error('No backup found in outputs/.'); process.exit(1); }
const backup = JSON.parse(readFileSync(`outputs/${file}`, 'utf8'));
console.log('Seeding from', file);

// Sign in as the test account.
const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authRes.json();
if (!auth.access_token) { console.error('Auth failed:', auth); process.exit(1); }
const uid = auth.user.id;
console.log('Authenticated as', email, '→', uid);
const headers = { apikey: anon, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };

const remapPan = (p) => ({
  ...p,
  recipeId: offRef(p.recipeId),
  colorSketchId: offRef(p.colorSketchId),
  kitId: offRef(p.kitId),
  recipe: p.recipe ? { ...p.recipe, id: offRef(p.recipe.id) } : p.recipe,
  colorSketch: p.colorSketch ? { ...p.colorSketch, id: offRef(p.colorSketch.id) } : p.colorSketch,
});

// Secondary columns that carry a GLOBALLY-unique code (not the PK). They'd
// collide with the owner's, and they're only display labels — null them so the
// seeded copy inserts cleanly. New rows made in the test app get fresh codes.
const NULL_CODE = { inventory: 'item_id', kits: 'bundle_id', batches: 'batch_id', dye_sessions: 'session_id' };

const remap = (table, row) => {
  const base = { ...row, id: offId(row.id), user_id: uid };
  if (NULL_CODE[table]) base[NULL_CODE[table]] = null;
  if (table === 'batches') base.recipeId = offRef(row.recipeId);
  if (table === 'dye_sessions') base.pans = (row.pans || []).map(remapPan);
  return base;
};

// Wipe the test account's existing rows so the seed is re-runnable.
const wipe = async (table) => {
  const res = await fetch(`${url}/rest/v1/${table}?user_id=eq.${uid}`, {
    method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' },
  });
  if (!res.ok) console.error(`  wipe ${table}: ${res.status} — ${(await res.text()).slice(0, 150)}`);
};

const post = async (table, rows) => {
  if (!rows.length) { console.log(`  ${table}: 0 rows (skip)`); return; }
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) console.error(`  ${table}: FAILED ${res.status} — ${(await res.text()).slice(0, 300)}`);
  else console.log(`  ${table}: inserted ${rows.length}`);
};

const TABLES = ['recipes', 'inventory', 'color_sketches', 'kits', 'gradients', 'batches', 'dye_sessions', 'sales'];

console.log('Wiping existing test rows…');
for (const table of [...TABLES].reverse()) await wipe(table);

console.log('Inserting copy…');
for (const table of TABLES) {
  const rows = (backup[table] || []).map((r) => remap(table, r));
  await post(table, rows);
}

// Settings is a single row keyed by user_id (upsert on conflict).
if (backup.settings) {
  const res = await fetch(`${url}/rest/v1/settings?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: uid, settings_data: backup.settings }),
  });
  console.log(res.ok ? '  settings: saved' : `  settings: FAILED ${res.status} — ${(await res.text()).slice(0, 200)}`);
}

console.log('Done.');
