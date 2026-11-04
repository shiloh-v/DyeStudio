import { useEffect, useMemo, useState } from 'react';
import { DateUtils } from '../lib/dates';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { PAN_GRAMS, LAB_TESTS_PER_BATCH, comboLabel } from '../lib/demand';
import { DEMAND_WINDOWS, demandPrefs, demandSummary, type PlanEdits } from '../lib/demandSummary';

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What to dye next and what yarn to order, from Shopify demand. */
export function Plan({ sales, batches, recipes, kits, settings, inventory, dyeSessions, saveDyeSessions, gradients = [], colorSketches = [], setActiveTab }) {
    const today = DateUtils.getTodayEST();
    // Sales window + weeks of stock (shared with the Sales tab via prefs).
    const [windowIdx, setWindowIdx] = useState<number>(() => demandPrefs.windowIdx());
    const [targetWeeks, setTargetWeeks] = useState<number>(() => demandPrefs.targetWeeks());
    useEffect(() => { demandPrefs.set('demand_window', windowIdx); }, [windowIdx]);
    useEffect(() => { demandPrefs.set('demand_target_weeks', targetWeeks); }, [targetWeeks]);
    // Floor for every color × default-base size, sales or not (0 = off).
    const [comboMin, setComboMin] = useState<number>(() => demandPrefs.comboMin());
    useEffect(() => { demandPrefs.set('demand_combo_min', comboMin); }, [comboMin]);
    // Edits to the auto-built restock plan (shared with Today/Inventory via prefs).
    const [edits, setEdits] = useState<PlanEdits>(() => demandPrefs.planEdits());
    useEffect(() => { demandPrefs.set('demand_plan_edits', edits); }, [edits]);
    const [addPick, setAddPick] = useState('');
    // Yarn-to-order horizon (months of dyeing, batches per month; null = history).
    const [yarnMonths, setYarnMonths] = useState<number>(() => demandPrefs.yarnMonths());
    const [pace, setPace] = useState<number | null>(() => demandPrefs.batchesPerMonth());
    useEffect(() => { demandPrefs.set('demand_yarn_months', yarnMonths); }, [yarnMonths]);
    useEffect(() => { demandPrefs.set('demand_batches_per_month', pace); }, [pace]);

    const D = useMemo(
        () => demandSummary({ sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches, planEdits: edits, yarnMonths, batchesPerMonth: pace, windowIdx, targetWeeks, comboMin, today }),
        [sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches, edits, yarnMonths, pace, windowIdx, targetWeeks, comboMin, today]
    );
    const { supply, suggestions, yarnOrder, toBuy, yarnOrderCost } = D;
    const snapshot = settings?.shopifyInventory || null;
    const win = D.win;

    // ---------- Dye next → draft session ----------

    const plan = D.plan;
    const planPans = plan.batches.flat().filter((p) => p.type === 'pan' || p.type === 'colorLab');
    const planColorways = [...new Set(planPans.map((p) => p.colorway))];
    const removeColorway = (c: string) => setEdits((e) => ({ ...e, removed: [...new Set([...e.removed, c])], added: e.added.filter((x) => x !== c) }));
    const addColorway = (c: string) => c && setEdits((e) => ({ ...e, added: [...new Set([...e.added, c])], removed: e.removed.filter((x) => x !== c) }));
    const labIds = edits.labTests || [];
    const addLabTest = (id: string) => id && setEdits((e) => ({ ...e, labTests: [...new Set([...(e.labTests || []), id])] }));
    const removeLabTest = (id: string) => setEdits((e) => ({ ...e, labTests: (e.labTests || []).filter((x) => x !== id) }));
    // Nothing running low: plan a batch anyway, starting with untested Color Lab sketches.
    const planAnyway = () => setEdits((e) => ({
        ...e,
        forceBatch: true,
        labTests: (e.labTests || []).length ? e.labTests : D.labCandidates.filter((c) => !c.tested).slice(0, LAB_TESTS_PER_BATCH).map((c) => String(c.sketch.id)),
    }));
    const edited = edits.removed.length > 0 || edits.added.length > 0 || labIds.length > 0 || !!edits.forceBatch;
    const resetPlan = () => {
        const fresh = { removed: [], added: [], fill: edits.fill, labTests: [], forceBatch: false };
        // Save now: drafting navigates away before the effect would persist it.
        demandPrefs.set('demand_plan_edits', fresh);
        setEdits(fresh);
    };

    const createDraftSessions = async () => {
        if (!plan.batches.length) return;
        const nums = (dyeSessions || [])
            .map((s) => s.sessionId || s.session_id)
            .filter((id) => id && String(id).startsWith('DS-'))
            .map((id) => parseInt(String(id).substring(3)))
            .filter((n) => !isNaN(n));
        let next = (nums.length ? Math.max(...nums) : 0) + 1;
        const label = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const notes = `Drafted from Plan (${win.label} of Shopify sales, ${targetWeeks}-week target).` +
            (plan.topUps ? ` Pans topped up to ${PAN_GRAMS}g in each color's sales mix (see pan notes).` : '') +
            (plan.extras.length ? ` Batch filled with next best sellers: ${plan.extras.join(', ')}.` : '') +
            (plan.labTests.length ? ` Color Lab tests: ${plan.labTests.join(', ')}.` : '');
        const parts = plan.batches.length;
        // Studio naming: "YYYY Session N", continuing the year's numbering
        // (counts both "YYYY Session N" and older "YYYY Batch N" names).
        const year = today.slice(0, 4);
        let sessionNo = Math.max(0, ...(dyeSessions || []).map((s) => {
            const m = String(s.name || '').match(/^(\d{4})\s+(?:Session|Batch)\s+(\d+)/i);
            return m && m[1] === year ? parseInt(m[2]) : 0;
        }));
        const created = plan.batches.map((load, i) => {
            const tray = load.find((p) => p.type === 'gradientTray');
            return {
                id: Date.now() + i,
                sessionId: `DS-${String(next++).padStart(3, '0')}`,
                name: `${year} Session ${++sessionNo}`,
                date: '', // no date until you set one (so a draft is never mistaken for scheduled)
                needsReview: true, // until you confirm it in Dye Sessions
                pans: load,
                notes: `${load.some((p) => p.type === 'colorLab') ? 'Test & restock' : 'Restock'}${parts > 1 ? ` (${i + 1} of ${parts})` : ''} drafted ${label}. ` + notes + (tray ? ` Gradient tray: ${tray.gradientDye}.` : ''),
            };
        });
        // The "needs review" flag needs its DB column (sql/dye-sessions-needs-review.sql).
        const { error: reviewColErr } = await supabase.from('dye_sessions').select('needsReview').limit(1);
        if (reviewColErr) toast('Heads up: run sql/dye-sessions-needs-review.sql in Supabase so drafts keep their "Needs review" flag.', 'info', 9000);
        await saveDyeSessions([...(dyeSessions || []), ...created]);
        resetPlan();
        toast(`${parts} draft batch${parts === 1 ? '' : 'es'} created with no date yet. Review and date ${parts === 1 ? 'it' : 'them'} in Dye Sessions.`, 'success', 7000);
        setActiveTab('sessions');
    };

    if (!D.lines.length) {
        return (
            <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Plan</h2>
                <button onClick={() => setActiveTab('demand')} className="w-full text-left bg-white rounded-lg card-shadow p-6 hover:bg-gray-50">
                    <p className="text-gray-700">Planning works from your Shopify sales. Import your orders on <strong>Shop → Sales</strong> to see what to dye next and what yarn to order. →</p>
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-start gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Plan</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Sales through {DateUtils.formatDate(D.lastDate)}
                        {' · '}{supply.source === 'shopify'
                            ? <>stock levels from {DateUtils.formatDate(String(snapshot.importedAt).slice(0, 10))}</>
                            : <>stock <strong>estimated</strong></>}
                        {' · '}<button onClick={() => setActiveTab('demand')} className="text-teal-700 underline">update in Shop → Sales</button>
                    </p>
                </div>
                <label className="text-sm text-gray-600 flex items-center gap-2">
                    Based on the last
                    <select value={windowIdx} onChange={(e) => setWindowIdx(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1">
                        {DEMAND_WINDOWS.map((w, i) => <option key={w.label} value={i}>{w.label.toLowerCase()}</option>)}
                    </select>
                    of sales
                </label>
            </div>

                    {/* Dye next */}
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
                            <h3 className="text-lg font-semibold">🧪 Dye next</h3>
                            <label className="text-sm text-gray-600 flex items-center gap-2">
                                Keep
                                <input type="number" min={1} max={52} value={targetWeeks}
                                    onChange={(e) => setTargetWeeks(Math.max(1, Math.min(52, parseInt(e.target.value) || 1)))}
                                    className="w-16 border border-gray-300 rounded px-2 py-1" />
                                weeks of stock
                            </label>
                            <label className="text-sm text-gray-600 flex items-center gap-2" title="Every active color on every default-base size (no specialty bases or micros), even ones that don't sell. A size with its own minimum in Yarn Bases uses that instead. 0 = only those sizes.">
                                and at least
                                <input type="number" min={0} max={20} value={comboMin}
                                    onChange={(e) => setComboMin(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                                    className="w-16 border border-gray-300 rounded px-2 py-1" />
                                of every combo
                            </label>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">
                            Based on the last {win.label.toLowerCase()} of sales; <strong>sold-out</strong> colors use their 12-month pace, since a sold-out color can't show recent sales. These feed the batch plan below.{' '}
                            {supply.source === 'shopify'
                                ? <>On-hand counts from your Shopify stock levels ({DateUtils.formatDateTime(snapshot.importedAt)}).</>
                                : <>On-hand is <strong>estimated</strong> from Stocked batches minus sales. Use <em>Update stock levels</em> for exact counts.</>}
                        </p>
                        {D.specialtyLow.length > 0 && (
                            <p className="text-xs text-gray-500 mb-3">
                                Also low on <strong>specialty bases</strong> (not dyed automatically; these colors are planned on your default bases):{' '}
                                {D.specialtyLow.map((s) => `${s.colorway} · ${comboLabel(s.base!, s.hankSize!)}${s.soldOut ? ' (sold out)' : ''}`).join('; ')}.
                            </p>
                        )}
                        {suggestions.length === 0 ? (
                            <p className="text-sm text-gray-600">Nothing is running low at this target. 🎉</p>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-gray-500 border-b">
                                                <th className="py-2 pr-4">Colorway · base</th>
                                                <th className="py-2 pr-4 text-right">Sold / wk</th>
                                                <th className="py-2 pr-4 text-right">On hand</th>
                                                <th className="py-2 pr-4 text-right" title="In the Pipeline (dyeing/drying/ready) or in a planned dye session">Coming</th>
                                                <th className="py-2 pr-4 text-right">Weeks left</th>
                                                <th className="py-2 text-right">Dye</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {suggestions.slice(0, 30).map((s) => {
                                                const urgent = s.weeksLeft < 2;
                                                return (
                                                    <tr key={s.key} className="border-b border-gray-100">
                                                        <td className="py-2 pr-4">
                                                            <span className="font-medium text-gray-900">{s.colorway}</span> <span className="text-gray-500">· {comboLabel(s.base!, s.hankSize!)}</span>
                                                            {s.belowMin && (
                                                                <span className="ml-2 text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 whitespace-nowrap"
                                                                    title={`No sales need: added to keep at least ${s.belowMin} of this base/size.`}>
                                                                    Min {s.belowMin}
                                                                </span>
                                                            )}
                                                            {s.soldOut && (
                                                                <span className="ml-2 text-xs bg-red-50 text-red-700 rounded px-1.5 py-0.5 whitespace-nowrap"
                                                                    title={`No stock left. Sold ${s.yearUnits} in the past 12 months${s.lastSale ? `, last on ${DateUtils.formatDate(s.lastSale)}` : ''} — recent sales are low because it's sold out, so this uses the 12-month pace.`}>
                                                                    Sold out{s.lastSale ? ` since ${DateUtils.formatDate(s.lastSale)}` : ''} · {s.yearUnits}/yr
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.perWeek.toFixed(1)}</td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.onHand}{supply.source === 'estimate' && <span className="text-gray-400"> est.</span>}</td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.coming || '—'}</td>
                                                        <td className={`py-2 pr-4 text-right tabular-nums ${urgent ? 'text-red-600 font-semibold' : ''}`}>
                                                            {urgent ? '⚠ ' : ''}{Number.isFinite(s.weeksLeft) ? s.weeksLeft.toFixed(1) : '—'}
                                                        </td>
                                                        <td className={`py-2 text-right tabular-nums ${edits.removed.includes(s.colorway!) ? 'text-gray-400 line-through' : ''}`} title={edits.removed.includes(s.colorway!) ? 'Removed from the plan' : undefined}>{s.suggest}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {suggestions.length > 30 && (
                                    <p className="text-xs text-gray-500 mt-2">+ {suggestions.length - 30} more (all of them feed the batch plan).</p>
                                )}
                            </>
                        )}
                    </div>

                    {/* Restock plan */}
                    <PlanPreview
                        plan={plan}
                        planColorways={planColorways}
                        edits={edits}
                        setEdits={setEdits}
                        edited={edited}
                        resetPlan={resetPlan}
                        removeColorway={removeColorway}
                        addColorway={addColorway}
                        addPick={addPick}
                        setAddPick={setAddPick}
                        recipes={recipes}
                        onCreate={createDraftSessions}
                        labCandidates={D.labCandidates}
                        labIds={labIds}
                        addLabTest={addLabTest}
                        removeLabTest={removeLabTest}
                        planAnyway={planAnyway}
                    />

                    {/* Yarn to order */}
                    <YarnToOrder rows={yarnOrder} toBuy={toBuy} total={yarnOrderCost} horizon={D.horizon} yarnMonths={yarnMonths} setYarnMonths={setYarnMonths} pace={pace} setPace={setPace} />
        </div>
    );
}

/** Undyed yarn to buy, rounded to supplier packs, grouped by supplier. */
function YarnToOrder({ rows, toBuy, total, horizon, yarnMonths, setYarnMonths, pace, setPace }) {
    const [showCovered, setShowCovered] = useState(false);
    const covered = rows.filter((r) => r.short === 0);
    const bySupplier = new Map<string, typeof toBuy>();
    toBuy.forEach((r) => {
        const k = r.supplier || 'Supplier not set';
        if (!bySupplier.has(k)) bySupplier.set(k, []);
        bySupplier.get(k).push(r);
    });
    const label = (r) => `${r.base} ${r.hankSize}g`;
    const copy = async () => {
        const text = [...bySupplier.entries()].map(([sup, rs]) =>
            `${sup}\n` + rs.map((r) => `  ${r.packs} × ${label(r)}${r.packSize > 1 ? ` (${r.packSize}-pack)` : ''}${r.sku ? ` — SKU ${r.sku}` : ''}${r.packPrice != null ? ` — ${money(r.cost)}` : ''}`).join('\n')
        ).join('\n\n');
        try { await navigator.clipboard.writeText(text); toast('Order list copied.', 'success'); }
        catch { toast('Could not copy — select the list and copy it manually.', 'error'); }
    };
    const Row = ({ r }) => (
        <tr className="border-b border-gray-100">
            <td className="py-2 pr-4"><span className="font-medium text-gray-900">{label(r)}</span>{r.sku && <span className="text-xs text-gray-500"> · SKU {r.sku}</span>}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.forDyeNext || '—'}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.forPlanned || '—'}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.forProjected || '—'}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.keep || '—'}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.have}</td>
            <td className="py-2 pr-4 text-right tabular-nums font-semibold">{r.short ? `${r.packs} × ${r.packSize}` : '✓'}</td>
            <td className="py-2 text-right tabular-nums">{r.short && r.packPrice != null ? money(r.cost) : r.short ? '—' : ''}</td>
        </tr>
    );
    const head = (
        <thead>
            <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-4">Base · size</th>
                <th className="py-2 pr-4 text-right" title="Skeins the batch plan below needs (pans + gradient trays)">This plan</th>
                <th className="py-2 pr-4 text-right" title="Skeins your already-planned dye sessions need">Sessions</th>
                <th className="py-2 pr-4 text-right" title="Typical batches projected for the rest of the stock-up period, in your overall sales mix">Projected</th>
                <th className="py-2 pr-4 text-right" title="Low-stock minimum set on the Inventory item">Keep</th>
                <th className="py-2 pr-4 text-right" title="Undyed skeins in Inventory">Have</th>
                <th className="py-2 pr-4 text-right">Order (packs)</th>
                <th className="py-2 text-right">Cost</th>
            </tr>
        </thead>
    );
    return (
        <div className="bg-white rounded-lg card-shadow p-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
                <h3 className="text-lg font-semibold">🧶 Yarn to order</h3>
                {toBuy.length > 0 && <button onClick={copy} className="text-sm bg-white text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 font-medium">📋 Copy order list</button>}
            </div>
            <div className="text-sm text-gray-600 mb-2 flex flex-wrap items-center gap-2">
                Stock up for
                <input type="number" min={0} max={12} step={0.5} value={yarnMonths}
                    onChange={(e) => setYarnMonths(Math.max(0, Math.min(12, parseFloat(e.target.value) || 0)))}
                    className="w-16 border border-gray-300 rounded px-2 py-1" aria-label="Months of dyeing to stock up for" />
                months of dyeing at
                <input type="number" min={0.5} max={8} step={0.1} value={pace ?? horizon.historyPace}
                    onChange={(e) => setPace(Math.max(0.5, Math.min(8, parseFloat(e.target.value) || 1)))}
                    className="w-16 border border-gray-300 rounded px-2 py-1" aria-label="Batches per month" />
                batches/month
                {pace == null
                    ? <span className="text-xs text-gray-500">(from your history)</span>
                    : <button onClick={() => setPace(null)} className="text-xs text-teal-700 hover:underline">use history ({horizon.historyPace})</button>}
            </div>
            <p className="text-sm text-gray-500 mb-4">
                {horizon.horizonBatches} batch{horizon.horizonBatches === 1 ? '' : 'es'}: {horizon.upcomingSessions} already planned in Dye Sessions + {horizon.planBatches} from the plan above
                {horizon.projectedBatches > 0 && <> + <strong>{horizon.projectedBatches} projected</strong> (typical batches in your overall sales mix)</>}.
                {horizon.planBeyond > 0 && <> The plan's last {horizon.planBeyond} batch{horizon.planBeyond === 1 ? ' is' : 'es are'} past this window and not in the order yet.</>}
                Plus each item's low-stock minimum, minus what's in Inventory, rounded up to the pack sizes in Yarn Bases.
            </p>
            {rows.length === 0 ? <p className="text-sm text-gray-600">Nothing planned, so no yarn needed.</p> : (
                <>
                    {toBuy.length === 0 ? <p className="text-sm text-gray-600 mb-2">You have enough undyed yarn for everything above. 🎉</p> : (
                        [...bySupplier.entries()].map(([sup, rs]) => (
                            <div key={sup} className="mb-4">
                                <div className="text-sm font-semibold text-gray-700 mb-1">{sup}</div>
                                <div className="overflow-x-auto"><table className="w-full text-sm">{head}<tbody>{rs.map((r) => <Row key={r.base + r.hankSize} r={r} />)}</tbody></table></div>
                            </div>
                        ))
                    )}
                    {toBuy.length > 0 && <div className="text-right text-sm text-gray-700">Estimated total: <strong>{money(total)}</strong> <span className="text-gray-500">(before shipping)</span></div>}
                    {covered.length > 0 && (
                        <div className="mt-3">
                            <button onClick={() => setShowCovered(!showCovered)} className="text-sm text-teal-700 hover:underline">
                                {showCovered ? 'Hide' : 'Show'} {covered.length} base{covered.length === 1 ? '' : 's'} already covered
                            </button>
                            {showCovered && <div className="overflow-x-auto mt-2"><table className="w-full text-sm">{head}<tbody>{covered.map((r) => <Row key={r.base + r.hankSize} r={r} />)}</tbody></table></div>}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/** The auto-built batch plan: batches → colorway pairs (+ gradient tray), editable before drafting. */
function PlanPreview({ plan, planColorways, edits, setEdits, edited, resetPlan, removeColorway, addColorway, addPick, setAddPick, recipes, onCreate, labCandidates, labIds, addLabTest, removeLabTest, planAnyway }) {
    const [labPick, setLabPick] = useState('');
    const sumYarns = (pans: any[]) => {
        const m = new Map<string, number>();
        pans.forEach((p) => (p.yarns || []).forEach((y) => m.set(`${y.base} ${y.hankSize}g`, (m.get(`${y.base} ${y.hankSize}g`) || 0) + y.quantity)));
        return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`).join(' · ');
    };
    // Top-up skeins are listed in each pan's notes as "+N× Base Size".
    const extraCount = (pans: any[]): number => pans.reduce((t: number, p: any) => {
        const found: string[] = String(p.notes || '').match(/\+(\d+)×/g) || [];
        return t + found.reduce((n: number, m: string) => n + parseInt(m.slice(1)), 0);
    }, 0);
    const options = [...recipes].filter((r) => !r.retired).map((r) => r.name).filter((n) => n && !planColorways.includes(n)).sort((a, b) => a.localeCompare(b));
    return (
        <div className="bg-white rounded-lg card-shadow p-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
                <h3 className="text-lg font-semibold">📋 Batch plan</h3>
                <label className="text-sm text-gray-600 flex items-center gap-2" title="Top each pan up to 300g in the bases/sizes that colorway sells in, and fill a short last batch with your next best sellers.">
                    <input type="checkbox" checked={edits.fill} onChange={(e) => setEdits((x) => ({ ...x, fill: e.target.checked }))} />
                    Fill pans to 300g
                </label>
            </div>
            <p className="text-sm text-gray-500 mb-4">
                Built automatically from Dye next: each colorway as 2 × 300g pans, 9 racks per batch, at most 2 yarn combos (base + size, e.g. Nova Fingering 20g + Luna DK 50g) per batch, plus a gradient tray while dyes still need one. Pans are listed in dye order, lightest to darkest. Remove or add colorways, then create the drafts. Everything stays editable in Dye Sessions.
            </p>
            {plan.unplanned?.length > 0 && (
                <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm">
                    <div className="font-semibold text-amber-900 mb-1">⚠️ Not planned — nothing to fill the pans with</div>
                    <p className="text-amber-900 mb-2">
                        {edits.fill
                            ? "These colors have no sales mix or catalog sizes on a default base to fill a pair with, so they weren't given pans. Add their yarn by hand in Dye Sessions after creating the drafts."
                            : 'With "Fill pans to 300g" off, these colors have no sized demand to put in a pair. Turn fill on, or add their yarn by hand in Dye Sessions.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {plan.unplanned.map((c) => (
                            <span key={c} className="inline-flex items-center gap-1 bg-white border border-amber-200 rounded px-2 py-1 text-amber-900">
                                {c}
                                <button type="button" onClick={() => removeColorway(c)} className="ml-1 px-1.5 text-amber-700 hover:text-amber-900" aria-label={`Remove ${c} from the plan`}>✕</button>
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {plan.adjust.length > 0 && (
                <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm">
                    <div className="font-semibold text-amber-900 mb-1">⏭ Already scheduled — dye more in a later batch</div>
                    <p className="text-amber-900 mb-2">These base/sizes are already in an upcoming session (one pair per color per batch), so more of them waits for a later batch. The colors' other base/sizes are planned in new batches above. Quantities are at least your minimums. They aren't in the yarn order yet.</p>
                    <ul className="list-none m-0 p-0 space-y-1">
                        {(Object.entries(plan.adjust.reduce((m: Record<string, any[]>, a) => {
                            const k = `${a.sessionName}|${a.date}`;
                            (m[k] ||= []).push(a);
                            return m;
                        }, {} as Record<string, any[]>)) as [string, any[]][]).map(([k, items]) => (
                            <li key={k}>
                                <span className="font-medium text-amber-900">After {items[0].sessionName}{items[0].date ? ` (${DateUtils.formatDate(items[0].date)})` : ''}:</span>{' '}
                                <span className="text-amber-900">{items.map((a) => `${a.colorway} · ${a.qty}× ${a.base} ${a.hankSize}g${a.soldOut ? ' (sold out)' : ''}`).join('; ')}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {plan.batches.length === 0 ? (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-4">
                    <p>Nothing is running low right now. 🎉 A good time to test Color Lab sketches.</p>
                    <button onClick={planAnyway} className="mt-3 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium">
                        🧪 Plan a batch anyway
                    </button>
                    <p className="text-xs text-gray-500 mt-2">Starts with 2 untested Color Lab sketches (each 2 pans mixing Nova Fingering and Luna DK), fills the rest with the colorways that have the fewest weeks of stock, plus the gradient tray.</p>
                    {edited && <button onClick={resetPlan} className="mt-2 text-teal-700 hover:underline">Reset plan</button>}
                </div>
            ) : (
                <div className="space-y-4">
                    {plan.batches.map((batch, bi) => {
                        const groups: any[][] = [];
                        batch.filter((p) => p.type === 'pan' || p.type === 'colorLab').forEach((p) => {
                            const g = groups[groups.length - 1];
                            if (g && g[0].colorway === p.colorway) g.push(p); else groups.push([p]);
                        });
                        const tray = batch.find((p) => p.type === 'gradientTray');
                        const racks = Math.ceil(groups.reduce((t, g) => t + g.length, 0) / 2) + (tray ? 1 : 0);
                        const combos = [...new Set(groups.flat().flatMap((p) => (p.yarns || []).map((y: any) => `${y.base} ${y.hankSize}g`)))];
                        return (
                            <div key={bi} className="border border-gray-200 rounded-lg">
                                <div className="flex justify-between items-center px-4 py-2 bg-gray-50 rounded-t-lg text-sm">
                                    <span className="font-semibold text-gray-800">Batch {bi + 1}{combos.length > 0 && <span className="font-normal text-gray-500"> · {combos.join(' + ')}</span>}</span>
                                    <span className="text-gray-500">{racks} of 9 racks</span>
                                </div>
                                <ul className="list-none m-0 p-0 divide-y divide-gray-100">
                                    {groups.map((g) => {
                                        const extra = extraCount(g);
                                        const fromBestSellers = plan.extras.includes(g[0].colorway);
                                        const manual = plan.manual.includes(g[0].colorway);
                                        const lab = g[0].type === 'colorLab';
                                        return (
                                            <li key={g[0].colorway} className="px-4 py-2 text-sm flex gap-3 items-start">
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-gray-900">
                                                        {g[0].colorway} <span className="text-gray-500 font-normal">· {g.length} pans</span>
                                                        {fromBestSellers && <span className="ml-2 text-xs bg-teal-50 text-teal-700 rounded px-1.5 py-0.5">best seller, fills the batch</span>}
                                                        {manual && <span className="ml-2 text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">added</span>}
                                                        {lab && <span className="ml-2 text-xs bg-amber-50 text-amber-800 rounded px-1.5 py-0.5">🎨 Color Lab test</span>}
                                                    </div>
                                                    <div className="text-gray-600 break-words">{sumYarns(g)}</div>
                                                    {extra > 0 && !fromBestSellers && !manual && !lab && <div className="text-xs text-gray-500">incl. {extra} extra skein{extra === 1 ? '' : 's'} to fill the pans</div>}
                                                </div>
                                                <button onClick={() => lab ? removeLabTest(String(g[0].colorSketchId)) : removeColorway(g[0].colorway)} className="text-gray-400 hover:text-red-600 px-1" aria-label={`Remove ${g[0].colorway} from the plan`} title="Remove from plan">✕</button>
                                            </li>
                                        );
                                    })}
                                    {tray && (
                                        <li className="px-4 py-2 text-sm">
                                            <span className="font-medium text-gray-900">🌈 Gradient tray · {tray.gradientDye}</span>
                                            <span className="text-gray-600"> · 10× {tray.gradientYarnBase} {tray.gradientHankSize}g</span>
                                        </li>
                                    )}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-4">
                <select value={addPick} onChange={(e) => setAddPick(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm max-w-[16rem]">
                    <option value="">Add a colorway…</option>
                    {options.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button disabled={!addPick} onClick={() => { addColorway(addPick); setAddPick(''); }} className="text-sm bg-white text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 font-medium disabled:opacity-40">+ Add</button>
                <select value={labPick} onChange={(e) => setLabPick(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm max-w-[16rem]">
                    <option value="">Add a Color Lab test (max 2 per batch)…</option>
                    {labCandidates.filter((c) => !labIds.includes(String(c.sketch.id))).map((c) => (
                        <option key={c.sketch.id} value={String(c.sketch.id)}>{c.name}{c.tested ? ' (tested before)' : ''}</option>
                    ))}
                </select>
                <button disabled={!labPick} onClick={() => { addLabTest(labPick); setLabPick(''); }} className="text-sm bg-white text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-50 font-medium disabled:opacity-40">+ Test</button>
                {edited && <button onClick={resetPlan} className="text-sm text-gray-500 hover:underline">Reset plan</button>}
                <button disabled={!plan.batches.length} onClick={onCreate}
                    className="ml-auto bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium disabled:opacity-40">
                    Create {plan.batches.length || ''} draft batch{plan.batches.length === 1 ? '' : 'es'}
                </button>
            </div>
        </div>
    );
}
