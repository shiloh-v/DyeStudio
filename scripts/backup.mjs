// Read-only backup of all collections to outputs/.
// Since RLS now requires an authenticated user, this signs in first using
// OWNER_EMAIL / OWNER_PASSWORD (add them to .env), then reads via the user's
// token (RLS scopes results to that user's rows automatically).
// Run: node --env-file=.env scripts/backup.mjs
import { writeFileSync, mkdirSync } from 'fs';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Run: node --env-file=.env scripts/backup.mjs');
  process.exit(1);
}

// Authenticate (RLS denies the anon key). Falls back to anon with a warning.
let token = key;
if (email && password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    console.error('Sign-in failed:', j.error_description || j.msg || j.error || res.status);
    process.exit(1);
  }
  token = j.access_token;
  console.log(`Signed in as ${email}`);
} else {
  console.warn('No OWNER_EMAIL/OWNER_PASSWORD in .env — reading with the anon key.');
  console.warn('Under RLS this returns 0 rows. Add OWNER_EMAIL/OWNER_PASSWORD for a real backup.');
}

const headers = { apikey: key, Authorization: `Bearer ${token}` };
const tables = ['recipes', 'inventory', 'batches', 'sales', 'dye_sessions', 'kits', 'color_sketches', 'gradients'];

async function getAll(table, select = '*') {
  // No user_id filter — RLS returns only the signed-in user's rows.
  const res = await fetch(`${url}/rest/v1/${table}?select=${select}`, { headers });
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
