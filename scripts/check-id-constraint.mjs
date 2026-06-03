// Tests whether `id` has a unique/PK constraint on each table (required for
// upsert on_conflict=id). Method: read one existing row and upsert it back to
// its OWN current values (a no-op update). A missing constraint returns
// PostgREST error 42P10. Safe to run with a backup in hand.
// Run: node --env-file=.env scripts/check-id-constraint.mjs
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const USER_ID = 'default-user';
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const tables = ['recipes', 'inventory', 'batches', 'sales', 'dye_sessions', 'kits', 'color_sketches', 'gradients'];

for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?user_id=eq.${USER_ID}&select=*&limit=1`, { headers });
  const rows = await res.json();
  if (!rows.length) { console.log(`  ${t}: (no rows to test — skipped)`); continue; }
  const row = rows[0];
  const up = await fetch(`${url}/rest/v1/${t}?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (up.ok) {
    console.log(`  ${t}: ✅ id upsert OK (unique constraint present)`);
  } else {
    const txt = await up.text();
    const noConstraint = txt.includes('42P10') || txt.includes('no unique or exclusion constraint');
    console.log(`  ${t}: ${noConstraint ? '❌ NO id unique constraint' : '⚠️  ' + up.status} — ${txt.slice(0, 160)}`);
  }
}
