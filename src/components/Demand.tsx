import { useEffect, useMemo, useRef, useState } from 'react';
import { DateUtils } from '../lib/dates';
import { toast } from '../lib/toast';
import { confirmDialog } from '../lib/dialog';
import {
    parseOrdersCsv, parseInventoryCsv, mergeSales, salesSchemaReady, isCountable, isOwnBrand, ImportError, OWN_VENDOR,
    type SaleLine,
} from '../lib/shopify';
import {
    makeContext, resolveName, isResolved, normText, byColorway, byBase,
    byCombo, lastMonths, monthlyUnits, PAN_GRAMS,
    comboLabel, daysAgo, type ShopifyMapping, type Suggestion,
} from '../lib/demand';
import { DEMAND_WINDOWS, demandPrefs, demandSummary, type PlanEdits } from '../lib/demandSummary';


const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`;


export function Demand({ sales, saveSales, batches, recipes, kits, settings, saveSettings, inventory, dyeSessions, saveDyeSessions, gradients = [], setActiveTab }) {
    const today = DateUtils.getTodayEST();
    const [schemaOk, setSchemaOk] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [windowIdx, setWindowIdx] = useState<number>(() => demandPrefs.windowIdx());
    const [targetWeeks, setTargetWeeks] = useState<number>(() => demandPrefs.targetWeeks());
    const [rankBy, setRankBy] = useState<'colorway' | 'base' | 'combo'>('colorway');
    const [showAllRank, setShowAllRank] = useState(false);
    const [trendColorway, setTrendColorway] = useState('');
    const [showMapper, setShowMapper] = useState(false);
    // Edits to the auto-built restock plan (shared with Dashboard/Inventory via prefs).
    const [edits, setEdits] = useState<PlanEdits>(() => demandPrefs.planEdits());
    useEffect(() => { demandPrefs.set('demand_plan_edits', edits); }, [edits]);
    const [addPick, setAddPick] = useState('');
    const ordersInput = useRef<HTMLInputElement>(null);
    const invInput = useRef<HTMLInputElement>(null);

    useEffect(() => { salesSchemaReady().then(setSchemaOk); }, []);
    useEffect(() => { demandPrefs.set('demand_window', windowIdx); }, [windowIdx]);
    useEffect(() => { demandPrefs.set('demand_target_weeks', targetWeeks); }, [targetWeeks]);

    const allLines: SaleLine[] = useMemo(() => (sales || []).filter((s) => s.lineKey), [sales]);
    // Shared with Dashboard / Inventory / Recipes so every tab shows the same numbers.
    const D = useMemo(
        () => demandSummary({ sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, planEdits: edits, windowIdx, targetWeeks, today }),
        [sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, edits, windowIdx, targetWeeks, today]
    );
    const { ctx, lines, units, firstDate, windowDays, inWindow, getCost, supply, suggestions, yarnOrder, toBuy, yarnOrderCost } = D;
    const snapshot = settings?.shopifyInventory || null;
    const win = D.win;

    // Distinct line names → resolution, for the mapper + "needs review" count.
    const distinct = useMemo(() => {
        const m = new Map<string, { name: string; units: number; revenue: number }>();
        for (const l of lines) {
            if (!isCountable(l)) continue;
            const k = normText(l.lineName);
            const v = m.get(k) || { name: l.lineName, units: 0, revenue: 0 };
            v.units += Number(l.quantity) || 0;
            v.revenue += (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0) - (Number(l.discount) || 0);
            m.set(k, v);
        }
        return [...m.entries()]
            .map(([key, v]) => ({ key, ...v, resolved: resolveName(v.name, ctx) }))
            .sort((a, b) => b.units - a.units);
    }, [lines, ctx]);
    const needsReview = distinct.filter((d) => !isResolved(d.resolved));
    const needsReviewUnits = needsReview.reduce((s, d) => s + d.units, 0);

    // Window totals
    const windowLines = useMemo(() => {
        const from = win.days ? daysAgo(today, win.days) : '';
        return lines.filter((l) => isCountable(l) && (!from || l.orderDate > from) && l.orderDate <= today);
    }, [lines, win.days, today]);
    const revenue = windowLines.reduce((s, l) => s + Math.max(0, l.unitPrice * l.quantity - (l.discount || 0)), 0);
    const orders = new Set(windowLines.map((l) => l.orderName)).size;
    const skeins = inWindow.reduce((s, u) => s + u.qty, 0);
    const matchedRevenue = inWindow.reduce((s, u) => s + u.revenue, 0);
    const cogs = inWindow.reduce((s, u) => s + getCost(u) * u.qty, 0);
    const grossProfit = matchedRevenue - cogs;
    const margin = matchedRevenue > 0 ? (grossProfit / matchedRevenue) * 100 : 0;

    const ranking = rankBy === 'colorway' ? byColorway(inWindow) : rankBy === 'base' ? byBase(inWindow) : byCombo(inWindow);
    const rankMax = Math.max(1, ...ranking.map((r) => r.units));

    const profitRows = useMemo(() => {
        const m = new Map<string, { colorway: string; units: number; revenue: number; cost: number }>();
        for (const u of inWindow) {
            const v = m.get(u.colorway) || { colorway: u.colorway, units: 0, revenue: 0, cost: 0 };
            v.units += u.qty; v.revenue += u.revenue; v.cost += getCost(u) * u.qty;
            m.set(u.colorway, v);
        }
        return [...m.values()].sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost));
    }, [inWindow, getCost]);

    const months = useMemo(() => lastMonths(today, 12), [today]);
    const trend = useMemo(() => monthlyUnits(units, months, trendColorway || undefined), [units, months, trendColorway]);
    const trendColorways = useMemo(() => byColorway(units).map((a) => a.colorway), [units]);

    // ---------- Import ----------

    const readFile = (file: File) => new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ''));
        r.onerror = () => rej(r.error);
        r.readAsText(file);
    });

    const importOrders = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!(await salesSchemaReady())) { setSchemaOk(false); toast('Run the one-time database setup first (see the banner).', 'error'); return; }
        setBusy(true);
        try {
            const { lines: parsed, skipped } = parseOrdersCsv(await readFile(file));
            // Merge into our own lines only, so any other-vendor rows saved by an
            // earlier version are removed from the database on this save.
            const { sales: merged, added, updated } = mergeSales(lines, parsed);
            const ok = await saveSales(merged);
            if (ok === false) throw new Error('Saving to the database failed — nothing was imported.');
            const orderCount = new Set(parsed.map((p) => p.orderName)).size;
            toast(`Imported ${orderCount} ${OWN_VENDOR} orders: ${added} new line${added === 1 ? '' : 's'}${updated ? `, ${updated} updated` : ''}.` +
                (skipped ? ` Skipped ${skipped} line${skipped === 1 ? '' : 's'} from other vendors.` : ''), 'success', 7000);
        } catch (err) {
            toast(err instanceof ImportError ? err.message : `Import failed: ${err?.message || err}`, 'error', 8000);
        }
        setBusy(false);
    };

    const importInventory = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
            const snap = parseInventoryCsv(await readFile(file));
            await saveSettings({ ...settings, shopifyInventory: snap });
            const total = snap.rows.reduce((s, r) => s + r.available, 0);
            toast(`Stock levels updated: ${snap.rows.length} variants, ${total} units available.`, 'success', 6000);
        } catch (err) {
            toast(err instanceof ImportError ? err.message : `Import failed: ${err?.message || err}`, 'error', 8000);
        }
        setBusy(false);
    };

    const clearSales = async () => {
        if (!(await confirmDialog({ title: 'Remove imported Shopify sales?', message: `This deletes all ${allLines.length} imported order lines from the app (your Shopify store is not touched). You can re-import any time.`, confirmText: 'Remove', danger: true }))) return;
        await saveSales((sales || []).filter((s) => !s.lineKey));
        toast('Imported sales removed.', 'success');
    };

    // ---------- Dye next → draft session ----------

    const plan = D.plan;
    const planPans = plan.batches.flat().filter((p) => p.type === 'pan');
    const planColorways = [...new Set(planPans.map((p) => p.colorway))];
    const removeColorway = (c: string) => setEdits((e) => ({ ...e, removed: [...new Set([...e.removed, c])], added: e.added.filter((x) => x !== c) }));
    const addColorway = (c: string) => c && setEdits((e) => ({ ...e, added: [...new Set([...e.added, c])], removed: e.removed.filter((x) => x !== c) }));
    const edited = edits.removed.length > 0 || edits.added.length > 0;
    const resetPlan = () => {
        const fresh = { removed: [], added: [], fill: edits.fill };
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
        const notes = `Drafted from Demand (${win.label} of Shopify sales, ${targetWeeks}-week target).` +
            (plan.topUps ? ` Pans topped up to ${PAN_GRAMS}g in each color's sales mix (see pan notes).` : '') +
            (plan.extras.length ? ` Batch filled with next best sellers: ${plan.extras.join(', ')}.` : '');
        const parts = plan.batches.length;
        const created = plan.batches.map((load, i) => {
            const tray = load.find((p) => p.type === 'gradientTray');
            return {
                id: Date.now() + i,
                sessionId: `DS-${String(next++).padStart(3, '0')}`,
                name: `Restock – ${label}${parts > 1 ? ` (${i + 1} of ${parts})` : ''}`,
                date: today,
                pans: load,
                notes: notes + (tray ? ` Gradient tray: ${tray.gradientDye}.` : ''),
            };
        });
        await saveDyeSessions([...(dyeSessions || []), ...created]);
        resetPlan();
        toast(`${parts} draft batch${parts === 1 ? '' : 'es'} created. Review and edit ${parts === 1 ? 'it' : 'them'} in Dye Sessions.`, 'success', 7000);
        setActiveTab('sessions');
    };

    // ---------- Render ----------

    const hasData = allLines.length > 0;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-start gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Shopify Demand</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        {hasData
                            ? <>{lines.length.toLocaleString()} order lines · {DateUtils.formatDate(firstDate)} – {DateUtils.formatDate(lines.reduce((m, l) => (l.orderDate > m ? l.orderDate : m), ''))}</>
                            : 'Import your Shopify orders to see what sells and what to dye next.'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input ref={ordersInput} type="file" accept=".csv,text/csv" className="hidden" onChange={importOrders} />
                    <input ref={invInput} type="file" accept=".csv,text/csv" className="hidden" onChange={importInventory} />
                    <button disabled={busy} onClick={() => ordersInput.current?.click()} className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium disabled:opacity-50">
                        {busy ? 'Importing…' : '⬆ Import orders CSV'}
                    </button>
                    <button disabled={busy} onClick={() => invInput.current?.click()} className="bg-white text-teal-700 border border-teal-200 px-4 py-2 rounded-lg hover:bg-teal-50 font-medium disabled:opacity-50">
                        ⬆ Update stock levels
                    </button>
                    {hasData && (
                        <button onClick={() => setShowMapper(true)} className="bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 font-medium">
                            🔗 Map products{needsReview.length ? ` (${needsReview.length})` : ''}
                        </button>
                    )}
                </div>
            </div>

            {schemaOk === false && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3">
                    <strong>One-time setup needed:</strong> the database doesn't have the sales columns yet. Run <code>sql/shopify-sales.sql</code> in the Supabase SQL editor, then reload this page.
                </div>
            )}

            {!hasData && <HowTo />}

            {hasData && (
                <>
                    {/* Window */}
                    <div className="flex flex-wrap items-center gap-2">
                        {DEMAND_WINDOWS.map((w, i) => (
                            <button key={w.label} onClick={() => setWindowIdx(i)}
                                className={`px-3 py-1.5 rounded-full text-sm font-medium ${i === windowIdx ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
                                {w.label}
                            </button>
                        ))}
                    </div>

                    {needsReviewUnits > 0 && (
                        <button onClick={() => setShowMapper(true)} className="w-full text-left bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3 hover:bg-amber-100">
                            ⚠️ {needsReview.length} Shopify product{needsReview.length === 1 ? '' : 's'} ({needsReviewUnits} units, all time) aren't fully matched to a colorway, base and size, so some numbers below are incomplete. <span className="underline">Map them →</span>
                        </button>
                    )}

                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Kpi label="Skeins sold" value={skeins.toLocaleString()} sub={`${(skeins / Math.max(1, windowDays / 7)).toFixed(1)} / week`} />
                        <Kpi label="Revenue" value={money0(revenue)} sub={`${orders} orders`} accent="text-green-600" />
                        <Kpi label="Gross profit" value={money0(grossProfit)} sub={`${margin.toFixed(0)}% margin`} accent="text-blue-600" />
                        <Kpi label="Avg per skein" value={skeins ? money(matchedRevenue / skeins) : '—'} sub={skeins ? `cost ${money(cogs / skeins)}` : ''} />
                    </div>
                    <p className="text-xs text-gray-500 -mt-3">Revenue is item price minus discounts, excluding shipping and tax. Profit subtracts your batch cost per skein; Shopify fees and shipping aren't included.</p>

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
                        </div>
                        <p className="text-sm text-gray-500 mb-4">
                            Based on the last {win.label.toLowerCase()} of sales. These feed the batch plan below.{' '}
                            {supply.source === 'shopify'
                                ? <>On-hand counts from your Shopify stock levels ({DateUtils.formatDateTime(snapshot.importedAt)}).</>
                                : <>On-hand is <strong>estimated</strong> from Stocked batches minus sales. Use <em>Update stock levels</em> for exact counts.</>}
                        </p>
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
                                                        <td className="py-2 pr-4"><span className="font-medium text-gray-900">{s.colorway}</span> <span className="text-gray-500">· {comboLabel(s.base!, s.hankSize!)}</span></td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.perWeek.toFixed(1)}</td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.onHand}{supply.source === 'estimate' && <span className="text-gray-400"> est.</span>}</td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">{s.coming || '—'}</td>
                                                        <td className={`py-2 pr-4 text-right tabular-nums ${urgent ? 'text-red-600 font-semibold' : ''}`}>
                                                            {urgent ? '⚠ ' : ''}{s.weeksLeft.toFixed(1)}
                                                        </td>
                                                        <td className={`py-2 text-right tabular-nums ${edits.removed.includes(s.colorway!) ? 'text-gray-400 line-through' : ''}`} title={edits.removed.includes(s.colorway!) ? 'Removed from the plan' : undefined}>{s.suggest}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
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
                    />

                    {/* Yarn to order */}
                    <YarnToOrder rows={yarnOrder} toBuy={toBuy} total={yarnOrderCost} targetWeeks={targetWeeks} />

                    {/* Best sellers */}
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                            <h3 className="text-lg font-semibold">🏆 Best sellers · {win.label.toLowerCase()}</h3>
                            <div className="flex gap-1 text-sm">
                                {(['colorway', 'base', 'combo'] as const).map((k) => (
                                    <button key={k} onClick={() => { setRankBy(k); setShowAllRank(false); }}
                                        className={`px-3 py-1 rounded-lg ${rankBy === k ? 'bg-teal-100 text-teal-800 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                                        {k === 'colorway' ? 'Colorway' : k === 'base' ? 'Base' : 'Colorway + base'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {ranking.length === 0 ? <p className="text-sm text-gray-600">No matched sales in this window.</p> : (
                            <ol className="space-y-2">
                                {(showAllRank ? ranking : ranking.slice(0, 12)).map((r, i) => (
                                    <li key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={`${r.label}: ${r.units} skeins · ${money(r.revenue)} · ${r.orders} orders`}>
                                        <span className="text-gray-400 tabular-nums text-right">{i + 1}</span>
                                        <div className="min-w-0">
                                            <div className="truncate text-gray-900">{r.label}</div>
                                            <div className="h-2 mt-1 rounded bg-gray-100">
                                                <div className="h-2 rounded bg-teal-500" style={{ width: `${(r.units / rankMax) * 100}%` }} />
                                            </div>
                                        </div>
                                        <span className="text-right tabular-nums whitespace-nowrap"><strong>{r.units}</strong> <span className="text-gray-500">· {money0(r.revenue)}</span></span>
                                    </li>
                                ))}
                            </ol>
                        )}
                        {ranking.length > 12 && (
                            <button onClick={() => setShowAllRank(!showAllRank)} className="mt-3 text-sm text-teal-700 hover:underline">
                                {showAllRank ? 'Show top 12' : `Show all ${ranking.length}`}
                            </button>
                        )}
                    </div>

                    {/* Trends */}
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                            <h3 className="text-lg font-semibold">📈 Skeins sold per month</h3>
                            <select value={trendColorway} onChange={(e) => setTrendColorway(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                                <option value="">All colorways</option>
                                {trendColorways.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <MonthlyBars months={months} values={trend} />
                    </div>

                    {/* Real profit */}
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <h3 className="text-lg font-semibold mb-1">💵 Real profit by colorway · {win.label.toLowerCase()}</h3>
                        <p className="text-sm text-gray-500 mb-4">Actual Shopify revenue minus your average batch cost per skein.</p>
                        {profitRows.length === 0 ? <p className="text-sm text-gray-600">No matched sales in this window.</p> : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-500 border-b">
                                            <th className="py-2 pr-4">Colorway</th>
                                            <th className="py-2 pr-4 text-right">Skeins</th>
                                            <th className="py-2 pr-4 text-right">Revenue</th>
                                            <th className="py-2 pr-4 text-right">Cost</th>
                                            <th className="py-2 pr-4 text-right">Profit</th>
                                            <th className="py-2 text-right">Margin</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {profitRows.map((r) => (
                                            <tr key={r.colorway} className="border-b border-gray-100">
                                                <td className="py-2 pr-4 text-gray-900">{r.colorway}</td>
                                                <td className="py-2 pr-4 text-right tabular-nums">{r.units}</td>
                                                <td className="py-2 pr-4 text-right tabular-nums">{money(r.revenue)}</td>
                                                <td className="py-2 pr-4 text-right tabular-nums text-gray-500">{money(r.cost)}</td>
                                                <td className="py-2 pr-4 text-right tabular-nums font-medium">{money(r.revenue - r.cost)}</td>
                                                <td className="py-2 text-right tabular-nums">{r.revenue > 0 ? `${(((r.revenue - r.cost) / r.revenue) * 100).toFixed(0)}%` : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="text-right">
                        <button onClick={clearSales} className="text-xs text-gray-400 hover:text-red-600 hover:underline">Remove imported sales</button>
                    </div>
                </>
            )}

            {showMapper && (
                <Mapper
                    rows={distinct}
                    recipes={recipes}
                    kits={kits}
                    settings={settings}
                    saveSettings={saveSettings}
                    onClose={() => setShowMapper(false)}
                />
            )}
        </div>
    );
}

function Kpi({ label, value, sub, accent = 'text-gray-900' }: { label: string; value: string; sub?: string; accent?: string }) {
    return (
        <div className="bg-white rounded-lg card-shadow p-5">
            <div className="text-sm text-gray-600 mb-1">{label}</div>
            <div className={`text-2xl md:text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
            {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
        </div>
    );
}

function HowTo() {
    return (
        <div className="bg-white rounded-lg card-shadow p-6 space-y-4 text-sm text-gray-700">
            <h3 className="text-lg font-semibold text-gray-900">How to get your sales in</h3>
            <ol className="list-decimal ml-5 space-y-2">
                <li>In Shopify admin, open <strong>Orders</strong> → <strong>Export</strong>. Choose a date range (or <em>All orders</em>) and <strong>Plain CSV file</strong>. Shopify emails you the file.</li>
                <li>Tap <strong>⬆ Import orders CSV</strong> and pick that file. Re-import any time; overlapping orders update instead of duplicating.</li>
                <li><em>Optional, for accurate "weeks left":</em> open <strong>Products</strong> → <strong>Inventory</strong> → <strong>Export</strong>, then tap <strong>⬆ Update stock levels</strong>.</li>
                <li>Open <strong>🔗 Map products</strong> to link any Shopify listing the app couldn't match on its own to a colorway (or kit), base and size.</li>
            </ol>
            <p className="text-xs text-gray-500">Only Celestial Dyeworks products are imported (other brands in your order history are skipped), and only product, quantity, price and date are kept. Customer names, emails and addresses in the export are never saved.</p>
        </div>
    );
}

/** Single-series monthly bar chart (SVG) with hover tooltip. */
function MonthlyBars({ months, values }: { months: string[]; values: number[] }) {
    const [hover, setHover] = useState<number | null>(null);
    // Draw at the container's real pixel width so labels stay 11px on a phone.
    const box = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(640);
    useEffect(() => {
        const el = box.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const H = 220, padL = 32, padB = 24, padT = 12;
    const max = Math.max(1, ...values);
    const step = max <= 4 ? 1 : Math.ceil(max / 4 / 5) * 5 || 1;
    const top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
    const plotW = W - padL, plotH = H - padB - padT;
    const slot = plotW / months.length;
    const barW = Math.max(4, slot - 6);
    const y = (v: number) => padT + plotH - (v / top) * plotH;
    const monthLabel = (m: string) => {
        const s = new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short' });
        return slot < 30 ? s[0] : s; // single letters when bars are narrow
    };
    const fullLabel = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // One always-mounted wrapper, so the size observer stays attached.
    const empty = values.every((v) => v === 0);
    return (
        <div className="relative" ref={box}>
            {empty ? <p className="text-sm text-gray-600">No sales in the last 12 months.</p> : <>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Skeins sold per month, last 12 months">
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="text-gray-200" stroke="currentColor" strokeWidth={1} />
                        <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="text-gray-500" fill="currentColor" fontSize={11}>{t}</text>
                    </g>
                ))}
                {values.map((v, i) => {
                    const x = padL + i * slot + (slot - barW) / 2;
                    const h = (v / top) * plotH;
                    const r = Math.min(4, h, barW / 2);
                    const yTop = padT + plotH - h;
                    // Rounded top, square baseline.
                    const d = h <= 0 ? '' : `M${x},${padT + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${padT + plotH} Z`;
                    return (
                        <g key={months[i]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
                            <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
                            {d && <path d={d} className={hover === i ? 'text-teal-700' : 'text-teal-500'} fill="currentColor" />}
                            <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="text-gray-500" fill="currentColor" fontSize={11}>{monthLabel(months[i])}</text>
                        </g>
                    );
                })}
            </svg>
            {hover != null && (
                <div className="absolute pointer-events-none bg-gray-900 text-white text-xs rounded px-2 py-1 shadow whitespace-nowrap"
                    style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
                    {fullLabel(months[hover])}: <strong>{values[hover]}</strong> skeins
                </div>
            )}
            </>}
        </div>
    );
}

/** Map Shopify line names to colorway/kit + base + size (saved in settings.shopifyMap). */
function Mapper({ rows, recipes, kits, settings, saveSettings, onClose }) {
    const [map, setMap] = useState<Record<string, ShopifyMapping>>(() => ({ ...(settings?.shopifyMap || {}) }));
    const [filter, setFilter] = useState<'review' | 'all'>('review');
    const [q, setQ] = useState('');
    const catalog = settings?.yarnBases || [];
    const ctx = useMemo(() => makeContext(recipes, kits, { ...settings, shopifyMap: map }), [recipes, kits, settings, map]);
    const sortedRecipes = useMemo(() => [...recipes].sort((a, b) => String(a.name).localeCompare(String(b.name))), [recipes]);

    const live = rows.map((r) => ({ ...r, resolved: resolveName(r.name, ctx) }));
    const shown = live.filter((r) => (filter === 'all' || !isResolved(rows.find((x) => x.key === r.key)!.resolved) || map[r.key])
        && (!q || r.name.toLowerCase().includes(q.toLowerCase())));

    const set = (key: string, patch: Partial<ShopifyMapping>) =>
        setMap((m) => {
            const next = { ...(m[key] || {}), ...patch };
            Object.keys(next).forEach((k) => (next[k] === undefined || next[k] === '') && delete next[k]);
            const copy = { ...m };
            if (Object.keys(next).length) copy[key] = next; else delete copy[key];
            return copy;
        });

    const save = async () => {
        await saveSettings({ ...settings, shopifyMap: map });
        toast('Product mappings saved.', 'success');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b">
                    <div>
                        <h3 className="text-xl font-semibold">🔗 Map Shopify products</h3>
                        <p className="text-sm text-gray-500">Auto-matched by name. Change anything that's wrong; leave a field on <em>Auto</em> to keep the match.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" aria-label="Close">✕</button>
                </div>
                <div className="flex flex-wrap gap-2 items-center px-5 py-3 border-b">
                    <button onClick={() => setFilter('review')} className={`px-3 py-1 rounded-lg text-sm ${filter === 'review' ? 'bg-teal-100 text-teal-800 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>Needs review</button>
                    <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded-lg text-sm ${filter === 'all' ? 'bg-teal-100 text-teal-800 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>All ({rows.length})</button>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 max-w-full" />
                </div>
                <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
                    {shown.length === 0 && <p className="p-5 text-sm text-gray-600">Everything is matched. 🎉</p>}
                    {shown.map((r) => {
                        const m = map[r.key] || {};
                        const res = r.resolved;
                        const kind = m.kind || '';
                        const ok = isResolved(res);
                        const baseEntry = catalog.find((b) => b.myName === (m.base || res.base));
                        const sizes = (baseEntry?.sizes || []).map((s) => Number(s.amount)).filter(Boolean);
                        return (
                            <div key={r.key} className="p-4 space-y-2">
                                <div className="flex flex-wrap justify-between gap-2">
                                    <div className="font-medium text-gray-900 break-words min-w-0">{r.name}</div>
                                    <div className="text-xs text-gray-500 whitespace-nowrap">{r.units} sold · {money0(r.revenue)}</div>
                                </div>
                                <div className="text-xs">
                                    {res.kind === 'ignore' ? <span className="text-gray-500">Ignored (not yarn)</span>
                                        : res.kind === 'kit' ? <span className="text-teal-700">→ Kit: {res.kitName}</span>
                                        : res.kind === 'colorway' ? <span className={ok ? 'text-teal-700' : 'text-amber-700'}>→ {res.colorway} · {res.base ? comboLabel(res.base, res.hankSize || 0) : 'base unknown'}{res.sizeAssumed ? ' (size assumed)' : ''}</span>
                                        : <span className="text-amber-700">Not matched</span>}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <select value={kind} onChange={(e) => set(r.key, { kind: (e.target.value || undefined) as any, recipeId: undefined, kitId: undefined })} className="border border-gray-300 rounded px-2 py-1 text-sm">
                                        <option value="">Type: Auto</option>
                                        <option value="colorway">Colorway</option>
                                        <option value="kit">Kit / bundle</option>
                                        <option value="ignore">Ignore (not yarn)</option>
                                    </select>
                                    {kind === 'colorway' && (
                                        <select value={m.recipeId ?? ''} onChange={(e) => set(r.key, { recipeId: e.target.value ? Number(e.target.value) : undefined })} className="border border-gray-300 rounded px-2 py-1 text-sm max-w-[14rem]">
                                            <option value="">Choose colorway…</option>
                                            {sortedRecipes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                                        </select>
                                    )}
                                    {kind === 'kit' && (
                                        <select value={m.kitId ?? ''} onChange={(e) => set(r.key, { kitId: e.target.value ? Number(e.target.value) : undefined })} className="border border-gray-300 rounded px-2 py-1 text-sm max-w-[14rem]">
                                            <option value="">Choose kit…</option>
                                            {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                                        </select>
                                    )}
                                    {kind !== 'ignore' && kind !== 'kit' && res.kind !== 'kit' && (
                                        <>
                                            <select value={m.base ?? ''} onChange={(e) => set(r.key, { base: e.target.value || undefined, hankSize: undefined })} className="border border-gray-300 rounded px-2 py-1 text-sm">
                                                <option value="">Base: Auto</option>
                                                {catalog.map((b) => <option key={b.id} value={b.myName}>{b.myName}</option>)}
                                            </select>
                                            <select value={m.hankSize ?? ''} onChange={(e) => set(r.key, { hankSize: e.target.value ? Number(e.target.value) : undefined })} className="border border-gray-300 rounded px-2 py-1 text-sm">
                                                <option value="">Size: Auto</option>
                                                {(sizes.length ? sizes : [100, 50, 20, 10]).map((s) => <option key={s} value={s}>{s}g</option>)}
                                            </select>
                                        </>
                                    )}
                                    {map[r.key] && <button onClick={() => setMap((mm) => { const c = { ...mm }; delete c[r.key]; return c; })} className="text-xs text-gray-500 hover:underline">Reset to auto</button>}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100">Cancel</button>
                    <button onClick={save} className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium">Save mappings</button>
                </div>
            </div>
        </div>
    );
}

/** Undyed yarn to buy, rounded to supplier packs, grouped by supplier. */
function YarnToOrder({ rows, toBuy, total, targetWeeks }) {
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
            <p className="text-sm text-gray-500 mb-4">
                Undyed skeins for the batch plan above and your already-planned sessions, plus each item's low-stock minimum, minus what's in Inventory. Rounded up to the pack sizes in Yarn Bases.
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
function PlanPreview({ plan, planColorways, edits, setEdits, edited, resetPlan, removeColorway, addColorway, addPick, setAddPick, recipes, onCreate }) {
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
    const options = [...recipes].map((r) => r.name).filter((n) => n && !planColorways.includes(n)).sort((a, b) => a.localeCompare(b));
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
                Built automatically from Dye next: each colorway as 2 × 300g pans, 9 racks per batch, plus a gradient tray while dyes still need one. Remove or add colorways, then create the drafts. Everything stays editable in Dye Sessions.
            </p>
            {plan.batches.length === 0 ? (
                <p className="text-sm text-gray-600">Nothing to plan right now.{edited && <> <button onClick={resetPlan} className="text-teal-700 hover:underline">Reset plan</button></>}</p>
            ) : (
                <div className="space-y-4">
                    {plan.batches.map((batch, bi) => {
                        const groups: any[][] = [];
                        batch.filter((p) => p.type === 'pan').forEach((p) => {
                            const g = groups[groups.length - 1];
                            if (g && g[0].colorway === p.colorway) g.push(p); else groups.push([p]);
                        });
                        const tray = batch.find((p) => p.type === 'gradientTray');
                        const racks = Math.ceil(groups.reduce((t, g) => t + g.length, 0) / 2) + (tray ? 1 : 0);
                        return (
                            <div key={bi} className="border border-gray-200 rounded-lg">
                                <div className="flex justify-between items-center px-4 py-2 bg-gray-50 rounded-t-lg text-sm">
                                    <span className="font-semibold text-gray-800">Batch {bi + 1}</span>
                                    <span className="text-gray-500">{racks} of 9 racks</span>
                                </div>
                                <ul className="list-none m-0 p-0 divide-y divide-gray-100">
                                    {groups.map((g) => {
                                        const extra = extraCount(g);
                                        const fromBestSellers = plan.extras.includes(g[0].colorway);
                                        const manual = plan.manual.includes(g[0].colorway);
                                        return (
                                            <li key={g[0].colorway} className="px-4 py-2 text-sm flex gap-3 items-start">
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-gray-900">
                                                        {g[0].colorway} <span className="text-gray-500 font-normal">· {g.length} pans</span>
                                                        {fromBestSellers && <span className="ml-2 text-xs bg-teal-50 text-teal-700 rounded px-1.5 py-0.5">best seller, fills the batch</span>}
                                                        {manual && <span className="ml-2 text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">added</span>}
                                                    </div>
                                                    <div className="text-gray-600 break-words">{sumYarns(g)}</div>
                                                    {extra > 0 && !fromBestSellers && !manual && <div className="text-xs text-gray-500">incl. {extra} extra skein{extra === 1 ? '' : 's'} to fill the pans</div>}
                                                </div>
                                                <button onClick={() => removeColorway(g[0].colorway)} className="text-gray-400 hover:text-red-600 px-1" aria-label={`Remove ${g[0].colorway} from the plan`} title="Remove from plan">✕</button>
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
                {edited && <button onClick={resetPlan} className="text-sm text-gray-500 hover:underline">Reset plan</button>}
                <button disabled={!plan.batches.length} onClick={onCreate}
                    className="ml-auto bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium disabled:opacity-40">
                    Create {plan.batches.length || ''} draft batch{plan.batches.length === 1 ? '' : 'es'}
                </button>
            </div>
        </div>
    );
}
