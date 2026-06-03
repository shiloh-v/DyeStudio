// Read-only backup of all Supabase collections to outputs/.
// Uses PostgREST directly (no supabase-js, which needs WebSocket on Node <22).
// Run: node --env-file=.env scripts/backup.mjs
import { writeFileSync, mkdirSync } from 'fs';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing env. Run: node --env-file=.env scripts/backup.mjs');
  process.exit(1);
}

const USER_ID = 'default-user';
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const tables = ['recipes', 'inventory', 'batches', 'sales', 'dye_sessions', 'kits', 'color_sketches', 'gradients'];

async function getAll(table, select = '*') {
  const res = await fetch(`${url}/rest/v1/${table}?user_id=eq.${USER_ID}&select=${select}`, { headers });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const backup = { exportDate: new Date().toISOString(), source: 'scripts/backup.mjs' };
let total = 0;
for (const t of tables) {
  try {
    const data = await getAll(t);
    console.log(`  ${t}: ${data.length} rows`);
    backup[t] = data;
    total += data.length;
  } catch (e) {
    console.error(`  ${e.message}`);
    backup[t] = { __error: e.message };
  }
}
try {
  const settings = await getAll('settings', 'settings_data');
  backup.settings = settings[0]?.settings_data || null;
} catch (e) {
  backup.settings = { __error: e.message };
}

mkdirSync('outputs', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const fname = `outputs/supabase-backup-${stamp}.json`;
writeFileSync(fname, JSON.stringify(backup, null, 2));
console.log(`\nWrote ${fname} (${total} total rows across ${tables.length} tables)`);
