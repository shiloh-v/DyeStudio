// Verifies the new save semantics against the live DB, fully reversibly:
//   1. upsert updates a row IN PLACE without deleting the others (no wipe)
//   2. surgical delete removes ONLY the row dropped from the saved array
// Uses a clearly-fake sentinel row that is always cleaned up. Backup in hand.
// Run: node --env-file=.env scripts/test-save-semantics.mjs
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const USER_ID = 'default-user';
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const T = 'recipes';
const SENTINEL_ID = 1; // real ids are Date.now() (~1.7e12), so 1 never collides

const get = async (q) => (await fetch(`${url}/rest/v1/${T}?user_id=eq.${USER_ID}&${q}`, { headers: H })).json();
const upsert = (row) =>
  fetch(`${url}/rest/v1/${T}?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
const del = (ids) =>
  fetch(`${url}/rest/v1/${T}?user_id=eq.${USER_ID}&id=in.(${ids.join(',')})`, { method: 'DELETE', headers: H });

let pass = 0, fail = 0;
const check = (name, cond) => { (cond ? pass++ : fail++); console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}`); };

// Baseline
const before = await get('select=id');
const beforeIds = before.map((r) => Number(r.id)).sort();
const N = before.length;
console.log(`Baseline: ${N} recipes`);

const sample = (await get('select=*&limit=1'))[0];
const origNotes = sample.notes ?? null;

try {
  // --- Test 1: upsert updates IN PLACE, no wipe ---
  await upsert({ ...sample, notes: '__TMP_TEST__' });
  const afterEdit = await get('select=id,notes');
  check('count unchanged after edit-upsert', afterEdit.length === N);
  check('all original ids still present', beforeIds.every((id) => afterEdit.some((r) => Number(r.id) === id)));
  check('edited row reflects new value', afterEdit.find((r) => Number(r.id) === Number(sample.id))?.notes === '__TMP_TEST__');
  // revert
  await upsert({ ...sample, notes: origNotes });
  const reverted = await get(`select=notes&id=eq.${sample.id}`);
  check('edit reverted to original', (reverted[0]?.notes ?? null) === origNotes);

  // --- Test 2: surgical delete removes ONLY the dropped row ---
  await upsert({ ...sample, id: SENTINEL_ID, name: 'ZZZ_TEST_SENTINEL', recipe_id: 'TEST-SENTINEL' });
  const withSentinel = await get('select=id');
  check('sentinel inserted (count N+1)', withSentinel.length === N + 1);

  // Simulate save of the array WITHOUT the sentinel: keep = originals, delete the rest.
  const keep = new Set(beforeIds);
  const existing = (await get('select=id')).map((r) => Number(r.id));
  const removed = existing.filter((id) => !keep.has(id));
  check('diff identifies exactly the sentinel for removal', removed.length === 1 && removed[0] === SENTINEL_ID);
  if (removed.length) await del(removed);

  const after = await get('select=id');
  const afterIds = after.map((r) => Number(r.id)).sort();
  check('count back to N', after.length === N);
  check('sentinel gone', !afterIds.includes(SENTINEL_ID));
  check('every original recipe survived', JSON.stringify(afterIds) === JSON.stringify(beforeIds));
} finally {
  // Safety net: ensure sentinel is gone and notes restored regardless of failures.
  await del([SENTINEL_ID]);
  await upsert({ ...sample, notes: origNotes });
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
