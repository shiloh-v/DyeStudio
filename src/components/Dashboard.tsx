import { StatCard } from './StatCard';
import { isStocked } from '../lib/batches';
import { isLowStock, lowStockLabel } from '../lib/lowStock';
import { useMemo } from 'react';
import { demandSummary, periodStats } from '../lib/demandSummary';
import { byColorway, comboLabel, windowUnits } from '../lib/demand';

const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`;

export function Dashboard({ recipes, inventory, batches, sales, kits, settings, dyeSessions, setActiveTab }) {
    const activeBatches = batches.filter(b => !isStocked(b)).length;
    const lowStock = inventory.filter(isLowStock).length;

    // Projected value/profit from finished stock (not realized sales — those come from Shopify later)
    const stocked = batches.filter(isStocked);
    const totalRevenue = stocked.reduce((sum, b) => sum + (b.salePrice || 0), 0);
    const totalProfit = stocked.reduce((sum, b) => sum + (b.profit || 0), 0);
    const avgProfitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;
    

    const statusCounts = batches.reduce((acc, batch) => {
        acc[batch.status] = (acc[batch.status] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Studio Overview</h2>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatCard 
                    title="Total Recipes" 
                    value={recipes.length} 
                    icon="📝"
                    color="purple"
                />
                <StatCard 
                    title="Active Batches" 
                    value={activeBatches} 
                    icon="🔄"
                    color="blue"
                />
                <StatCard 
                    title="Low Stock Items" 
                    value={lowStock} 
                    icon="⚠️"
                    color={lowStock > 0 ? "red" : "green"}
                />
                <StatCard
                    title="Projected Revenue"
                    value={`$${totalRevenue.toFixed(2)}`}
                    icon="🏷️"
                    color="green"
                />
                <StatCard
                    title="Projected Profit"
                    value={`$${totalProfit.toFixed(2)}`}
                    icon="📈"
                    color={totalProfit >= 0 ? "green" : "red"}
                />
                <StatCard
                    title="Avg Margin"
                    value={`${avgProfitMargin.toFixed(1)}%`}
                    icon="📊"
                    color={avgProfitMargin >= 30 ? "green" : avgProfitMargin >= 15 ? "yellow" : "red"}
                />
            </div>

            <ShopifyPanel {...{ recipes, inventory, batches, sales, kits, settings, dyeSessions, setActiveTab }} />

            {/* Pipeline Status */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Production Pipeline</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                        <div className="text-3xl font-bold text-yellow-700">{statusCounts.dyeing || 0}</div>
                        <div className="text-sm text-yellow-600 mt-1">Dyeing</div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                        <div className="text-3xl font-bold text-blue-700">{statusCounts.drying || 0}</div>
                        <div className="text-sm text-blue-600 mt-1">Drying</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                        <div className="text-3xl font-bold text-green-700">{statusCounts.ready || 0}</div>
                        <div className="text-sm text-green-600 mt-1">Ready for Labels</div>
                    </div>
                    <div className="text-center p-4 bg-teal-50 rounded-lg">
                        <div className="text-3xl font-bold text-teal-700">{batches.filter(isStocked).length}</div>
                        <div className="text-sm text-teal-600 mt-1">Stocked</div>
                    </div>
                </div>
            </div>

            {/* Low stock */}
            <div className="grid gap-6">
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-lg font-semibold mb-4">Low Stock Alert</h3>
                    {lowStock > 0 ? (
                        <div className="space-y-2">
                            {inventory.filter(isLowStock).map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3 bg-red-50 rounded border-l-4 border-red-500">
                                    <div>
                                        <div className="font-medium">{item.name}</div>
                                        <div className="text-sm text-gray-600">{item.category}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold text-red-600">{item.quantity} {item.unit}</div>
                                        <div className="text-xs text-gray-500">Min: {lowStockLabel(item)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-400 text-center py-8">All items well stocked ✓</p>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Last 30 days of real Shopify sales + what to dye and order (from the Demand tab's model). */
function ShopifyPanel({ recipes, inventory, batches, sales, kits, settings, dyeSessions, setActiveTab }) {
    const D = useMemo(
        () => demandSummary({ sales, batches, recipes, kits, settings, inventory, dyeSessions }),
        [sales, batches, recipes, kits, settings, inventory, dyeSessions]
    );
    const go = () => setActiveTab('demand');

    if (!D.lines.length) {
        return (
            <button onClick={go} className="w-full text-left bg-white rounded-lg card-shadow p-6 hover:bg-gray-50">
                <div className="text-lg font-semibold">🛍️ Shopify sales</div>
                <p className="text-sm text-gray-600 mt-1">Import your Shopify orders on the 📈 Demand tab to see real revenue, what to dye next and what yarn to order. →</p>
            </button>
        );
    }

    const now = periodStats(D.lines, D.units, D.today, 30);
    const prev = periodStats(D.lines, D.units, D.today, 30, 30);
    const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const top = byColorway(windowUnits(D.units, D.today, 30)).slice(0, 5);
    const urgent = D.suggestions.filter((s) => s.weeksLeft < 4).slice(0, 5);
    const Delta = ({ v }) => v == null ? null : (
        <span className={`text-xs font-medium ${v >= 0 ? 'text-green-600' : 'text-red-600'}`}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}% vs prior 30 days</span>
    );

    return (
        <div className="bg-white rounded-lg card-shadow p-6 space-y-5">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">🛍️ Shopify · last 30 days</h3>
                <button onClick={go} className="text-sm text-teal-700 hover:underline">Open Demand →</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <div className="text-sm text-gray-600">Revenue</div>
                    <div className="text-2xl font-bold text-green-600 tabular-nums">{money0(now.revenue)}</div>
                    <Delta v={delta(now.revenue, prev.revenue)} />
                </div>
                <div>
                    <div className="text-sm text-gray-600">Skeins sold</div>
                    <div className="text-2xl font-bold text-gray-900 tabular-nums">{now.skeins}</div>
                    <Delta v={delta(now.skeins, prev.skeins)} />
                </div>
                <div>
                    <div className="text-sm text-gray-600">Orders</div>
                    <div className="text-2xl font-bold text-gray-900 tabular-nums">{now.orders}</div>
                    <Delta v={delta(now.orders, prev.orders)} />
                </div>
            </div>
            <div className="grid md:grid-cols-3 gap-6 text-sm">
                <div>
                    <div className="font-semibold text-gray-800 mb-2">🏆 Top sellers</div>
                    {top.length ? (
                        <ol className="space-y-1">
                            {top.map((t, i) => <li key={t.key} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {t.label}</span><span className="tabular-nums text-gray-600">{t.units}</span></li>)}
                        </ol>
                    ) : <p className="text-gray-500">No sales in the last 30 days.</p>}
                </div>
                <div>
                    <div className="font-semibold text-gray-800 mb-2">🧪 Running low</div>
                    {urgent.length ? (
                        <ul className="space-y-1">
                            {urgent.map((s) => (
                                <li key={s.key} className="flex justify-between gap-2">
                                    <span className="truncate">{s.colorway} <span className="text-gray-500">· {comboLabel(s.base!, s.hankSize!)}</span></span>
                                    <span className={`tabular-nums whitespace-nowrap ${s.weeksLeft < 2 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{s.weeksLeft.toFixed(1)} wk</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-gray-500">Nothing under 4 weeks of stock.</p>}
                    {D.suggestions.length > urgent.length && <button onClick={go} className="text-teal-700 hover:underline mt-1">{D.suggestions.length} to dye in total →</button>}
                </div>
                <div>
                    <div className="font-semibold text-gray-800 mb-2">🧶 Yarn to order</div>
                    {D.toBuy.length ? (
                        <>
                            <ul className="space-y-1">
                                {D.toBuy.slice(0, 5).map((r) => (
                                    <li key={r.base + r.hankSize} className="flex justify-between gap-2">
                                        <span className="truncate">{r.base} {r.hankSize}g</span>
                                        <span className="tabular-nums text-gray-600 whitespace-nowrap">{r.packs} pack{r.packs === 1 ? '' : 's'}</span>
                                    </li>
                                ))}
                            </ul>
                            {D.yarnOrderCost > 0 && <div className="mt-1 text-gray-700">≈ {money0(D.yarnOrderCost)}</div>}
                        </>
                    ) : <p className="text-gray-500">Enough undyed yarn on hand.</p>}
                </div>
            </div>
        </div>
    );
}
