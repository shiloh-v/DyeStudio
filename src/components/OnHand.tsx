import { useMemo, useState } from 'react';
import { DateUtils } from '../lib/dates';
import { demandSummary } from '../lib/demandSummary';
import { comboLabel } from '../lib/demand';
import { onHandSummary, type OnHandRow } from '../lib/onHand';

const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
const money = (n: number) => `$${(n || 0).toFixed(2)}`;

type Show = 'stock' | 'soldout' | 'all';
type Sort = 'colorway' | 'value' | 'weeks' | 'onhand';

/** Finished skeins on the shelf right now, per colorway + base + size. */
export function OnHand({ sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients = [], colorSketches = [], setActiveTab }) {
    const S = useMemo(() => {
        const D = demandSummary({ sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches });
        return onHandSummary(D, settings?.shopifyInventory);
    }, [sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches]);

    const [show, setShow] = useState<Show>('stock');
    const [sort, setSort] = useState<Sort>('colorway');
    const [q, setQ] = useState('');

    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const by: Record<Sort, (a: OnHandRow, b: OnHandRow) => number> = {
            colorway: (a, b) => a.colorway.localeCompare(b.colorway) || a.base.localeCompare(b.base) || a.hankSize - b.hankSize,
            value: (a, b) => b.value - a.value,
            weeks: (a, b) => a.weeksLeft - b.weeksLeft || b.perWeek - a.perWeek,
            onhand: (a, b) => b.onHand - a.onHand,
        };
        return S.rows
            .filter((r) => show === 'all' || (show === 'stock' ? r.onHand > 0 : r.soldOut))
            .filter((r) => !needle || `${r.colorway} ${r.base}`.toLowerCase().includes(needle))
            .sort(by[sort]);
    }, [S, show, sort, q]);

    const chip = (id: Show, label: string) => (
        <button key={id} onClick={() => setShow(id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${show === id ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-gray-900">On hand</h2>
                <p className="text-sm text-gray-600 mt-1">Finished skeins on the shelf right now, and what they're worth at the prices they actually sell for.</p>
            </div>

            {/* Where the counts come from */}
            {S.source === 'shopify' ? (
                <div className="bg-teal-50 border border-teal-200 text-teal-800 text-sm rounded-lg px-4 py-3">
                    📦 Counts are from your Shopify stock levels{S.snapshotDate ? <>, uploaded {DateUtils.formatDate(S.snapshotDate.slice(0, 10))}</> : ''}.{' '}
                    <button onClick={() => setActiveTab('demand')} className="underline">Upload newer ones in Shop → Sales →</button>
                </div>
            ) : (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3">
                    {S.hasSales
                        ? <>⚠️ These counts are <strong>estimates</strong>: skeins you've stocked minus Shopify sales since. </>
                        : <>⚠️ No Shopify sales are imported yet, so this counts <strong>every skein ever stocked</strong>. </>}
                    For exact counts, <button onClick={() => setActiveTab('demand')} className="underline">upload your Shopify stock levels in Shop → Sales →</button>
                </div>
            )}

            {S.unmatched.length > 0 && (
                <details className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3">
                    <summary className="cursor-pointer">
                        ⚠️ {S.unmatched.reduce((n, u) => n + u.available, 0)} skeins in your Shopify stock upload aren't matched to a colorway, so they're not counted below.
                        {' '}<span className="underline">Show them</span>
                    </summary>
                    <ul className="mt-2 space-y-0.5 list-disc pl-5">
                        {S.unmatched.map((u) => <li key={u.name}>{u.name} <span className="tabular-nums">×{u.available}</span></li>)}
                    </ul>
                    <p className="mt-2">Usually the colorway has no recipe yet, or its recipe goes by a different name. Add the recipe in <button onClick={() => setActiveTab('recipes')} className="underline">Colorways → Recipes</button>, or add the Shopify name as an alias on the existing one.</p>
                </details>
            )}

            {/* Totals */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Skeins on hand" value={S.skeins.toLocaleString()} sub={`${S.colorways} colorway${S.colorways === 1 ? '' : 's'}`} />
                <Kpi label="Stock value" value={money0(S.value)} accent="text-green-600"
                    sub={S.unpriced ? `${S.unpriced} skein${S.unpriced === 1 ? '' : 's'} not priced yet` : 'at recent selling prices'} />
                <Kpi label="Cost tied up" value={money0(S.cost)} accent="text-blue-600" sub={S.value > 0 ? `${Math.round(((S.value - S.cost) / S.value) * 100)}% margin when sold` : ''} />
                <Kpi label="Running out" value={String(S.lowSoon)} accent={S.lowSoon ? 'text-red-600' : 'text-gray-900'}
                    sub={`under 4 weeks · ${S.soldOut} sold out`} />
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg card-shadow overflow-hidden">
                <div className="p-4 flex flex-wrap items-center gap-2 border-b">
                    {chip('stock', 'In stock')}
                    {chip('soldout', `Sold out (${S.soldOut})`)}
                    {chip('all', 'All')}
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search colorway or base…"
                        className="flex-1 min-w-[10rem] px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="px-3 py-1.5 border rounded-lg text-sm">
                        <option value="colorway">Sort: Colorway</option>
                        <option value="weeks">Sort: Runs out soonest</option>
                        <option value="value">Sort: Value</option>
                        <option value="onhand">Sort: Most on hand</option>
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                                <th className="px-4 py-3">Colorway</th>
                                <th className="px-4 py-3">Base · size</th>
                                <th className="px-4 py-3 text-right">On hand</th>
                                <th className="px-4 py-3 text-right" title="In the Pipeline or in planned dye sessions">Coming</th>
                                <th className="px-4 py-3 text-right">Sells / wk</th>
                                <th className="px-4 py-3 text-right">Lasts</th>
                                <th className="px-4 py-3 text-right">Price</th>
                                <th className="px-4 py-3 text-right">Value</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {rows.map((r) => (
                                <tr key={r.key} className="hover:bg-gray-50">
                                    <td className="px-4 py-2.5 font-medium">{r.colorway}</td>
                                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{comboLabel(r.base, r.hankSize)}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                                        {r.soldOut ? <span className="text-red-600">Sold out</span> : r.onHand}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{r.coming || '—'}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{r.perWeek ? r.perWeek.toFixed(1) : '—'}</td>
                                    <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${r.onHand > 0 && r.weeksLeft < 2 ? 'text-red-600 font-semibold' : r.onHand > 0 && r.weeksLeft < 4 ? 'text-yellow-700' : 'text-gray-600'}`}>
                                        {r.soldOut
                                            ? (r.lastSale ? `last sold ${DateUtils.formatDate(r.lastSale)}` : '—')
                                            : r.weeksLeft === Infinity ? '—' : `${r.weeksLeft.toFixed(1)} wk`}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{r.price ? money(r.price) : '—'}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{r.value ? money0(r.value) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {rows.length === 0 && (
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-xl mb-2">📦</p>
                        <p>{S.rows.length ? 'Nothing matches.' : 'No finished stock yet. Move batches to "Stocked" in the Pipeline!'}</p>
                    </div>
                )}
            </div>
            <p className="text-xs text-gray-500 -mt-3">
                Price is the average a skein of that colorway, base and size sold for on Shopify over the past year (or the same base and size across colorways), after discounts. "Lasts" uses the sales pace from your Demand window.
            </p>
        </div>
    );
}

function Kpi({ label, value, sub, accent = 'text-gray-900' }: { label: string; value: string; sub?: string; accent?: string }) {
    return (
        <div className="bg-white rounded-lg card-shadow p-4">
            <div className="text-sm text-gray-600">{label}</div>
            <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
            {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
        </div>
    );
}
