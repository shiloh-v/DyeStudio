import { useMemo } from 'react';
import { DateUtils, byPlannedDate } from '../lib/dates';
import { isStocked } from '../lib/batches';
import { isLowStock } from '../lib/lowStock';
import { demandSummary, periodStats } from '../lib/demandSummary';
import { byColorway, isResolved, normText, resolveName, windowUnits } from '../lib/demand';
import { isCountable } from '../lib/shopify';
import { onHandSummary } from '../lib/onHand';
import { currentColorName } from '../lib/recipeMatch';

const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const daysSince = (iso: string | null | undefined, today: string) =>
    iso ? Math.floor((Date.parse(today + 'T12:00:00') - Date.parse(iso.length > 10 ? iso : iso + 'T12:00:00')) / 86400000) : Infinity;

// Data older than this gets a nudge to re-import / back up.
const STALE_DAYS = 7;

interface Action { icon: string; text: string; sub?: string; tab: string; urgent?: boolean }

/** Home: the next dye session, what needs you, and a quick look at the shop. */
export function Today({ recipes, inventory, batches, sales, kits, settings, dyeSessions, gradients = [], colorSketches = [], setActiveTab }) {
    const D = useMemo(
        () => demandSummary({ sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches }),
        [sales, batches, recipes, kits, settings, inventory, dyeSessions, gradients, colorSketches]
    );
    const S = useMemo(() => onHandSummary(D, settings?.shopifyInventory), [D, settings]);
    const today = D.today;

    // ---------- Next session ----------
    // The one the Queue is partway through wins; otherwise the next dated session.
    const live = (dyeSessions || []).filter((s) => !s.archived && (s.pans || []).length);
    const savedId = localStorage.getItem('queue_session') || '';
    const doneCount = (id: any): number => { try { return JSON.parse(localStorage.getItem('queue_done_' + id) || '[]').length; } catch { return 0; } };
    const inProgress = live.find((s) => String(s.id) === savedId && doneCount(s.id) > 0);
    // Falls back to an undated draft: the Queue can still run it.
    const next = inProgress
        || live.filter((s) => s.date && !s.needsReview).sort(byPlannedDate)[0]
        || live.slice().sort((a, b) => byPlannedDate(a, b) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))[0];
    const isDraft = !!next && !inProgress && (next.needsReview || !next.date);
    const openQueue = () => {
        if (next && String(next.id) !== savedId) {
            localStorage.setItem('queue_session', String(next.id));
            localStorage.setItem('queue_pan', '0');
        }
        setActiveTab('queue');
    };
    const nextColors = next
        ? [...new Set((next.pans || []).map((p) => (p.type === 'gradientTray' ? null : currentColorName(p, recipes, colorSketches))).filter(Boolean))]
        : [];

    // ---------- Needs attention ----------
    const actions: Action[] = [];
    const drafts = live.filter((s) => s.needsReview || !s.date);
    if (drafts.length) actions.push({ icon: '📋', text: `${plural(drafts.length, 'draft session')} to review and date`, sub: drafts.map((s) => s.name).join(', '), tab: 'sessions' });

    const ready = batches.filter((b) => b.status === 'ready').length;
    const drying = batches.filter((b) => b.status === 'drying').length;
    const dyeing = batches.filter((b) => b.status === 'dyeing').length;
    if (ready || drying || dyeing) {
        actions.push({
            icon: '🔄',
            text: ready ? `${plural(ready, 'batch', 'batches')} ready for labels` : `${plural(drying + dyeing, 'batch', 'batches')} in the Pipeline`,
            sub: [dyeing && `${dyeing} dyeing`, drying && `${drying} drying`, ready && `${ready} ready for labels`].filter(Boolean).join(' · '),
            tab: 'pipeline',
        });
    }

    if (D.suggestions.length) {
        const soldOut = D.suggestions.filter((s) => s.soldOut).length;
        const urgent = D.suggestions.filter((s) => s.weeksLeft < 2).length;
        actions.push({
            icon: '🧪',
            text: `${plural(D.suggestions.length, 'color')} to dye soon`,
            sub: [urgent && `${urgent} under 2 weeks of stock`, soldOut && `${soldOut} sold out`, D.plan.batches.length && `plan ready: ${plural(D.plan.batches.length, 'batch', 'batches')}`].filter(Boolean).join(' · '),
            tab: 'plan',
            urgent: urgent > 0,
        });
    }
    if (D.toBuy.length) {
        actions.push({
            icon: '🧶',
            text: `Order yarn${D.yarnOrderCost > 0 ? ` (≈ ${money0(D.yarnOrderCost)})` : ''}`,
            sub: D.toBuy.map((r) => `${r.base} ${r.hankSize}g × ${r.packs}`).join(' · '),
            tab: 'plan',
        });
    }

    const lowSupplies = inventory.filter(isLowStock);
    if (lowSupplies.length) actions.push({ icon: '⚠️', text: `${plural(lowSupplies.length, 'supply', 'supplies')} running low`, sub: lowSupplies.map((i) => i.name).join(', '), tab: 'inventory', urgent: true });

    // Shopify data health
    const unmapped = useMemo(() => {
        const seen = new Map<string, number>();
        for (const l of D.lines) {
            if (!isCountable(l)) continue;
            const k = normText(l.lineName);
            if (!seen.has(k)) seen.set(k, isResolved(resolveName(l.lineName, D.ctx)) ? 0 : 1);
        }
        return [...seen.values()].reduce((a, b) => a + b, 0);
    }, [D]);
    if (D.lines.length) {
        const ordersAge = daysSince(D.lastDate, today);
        if (ordersAge > STALE_DAYS) actions.push({ icon: '🛍️', text: 'Import new Shopify orders', sub: `Latest imported order is from ${DateUtils.formatDate(D.lastDate)} (${ordersAge} days ago)`, tab: 'demand' });
        const stockAge = daysSince(settings?.shopifyInventory?.importedAt, today);
        if (S.source === 'shopify' && stockAge > STALE_DAYS) actions.push({ icon: '📦', text: 'Update Shopify stock levels', sub: `Last uploaded ${stockAge} days ago`, tab: 'demand' });
        if (unmapped) actions.push({ icon: '🔗', text: `${plural(unmapped, 'Shopify product')} not matched to a colorway`, sub: 'Map them so their sales count', tab: 'demand' });
    } else {
        actions.push({ icon: '🛍️', text: 'Import your Shopify orders', sub: 'Unlocks dye planning, yarn ordering and sales numbers', tab: 'demand' });
    }
    if (S.unmatched.length) actions.push({ icon: '📦', text: `${plural(S.unmatched.reduce((n, u) => n + u.available, 0), 'skein')} in stock not matched to a colorway`, sub: 'Not counted in On hand', tab: 'sales' });

    const backupAge = daysSince(localStorage.getItem('last_backup'), today);
    if (backupAge >= STALE_DAYS) actions.push({ icon: '💾', text: backupAge === Infinity ? 'Back up your studio data' : `Last backup was ${backupAge} days ago`, sub: 'Settings → Export backup', tab: 'settings' });

    // ---------- Shop snapshot ----------
    const now = periodStats(D.lines, D.units, today, 30);
    const prev = periodStats(D.lines, D.units, today, 30, 30);
    const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const top = byColorway(windowUnits(D.units, today, 30)).slice(0, 5);
    const stockedSkeins = batches.filter(isStocked).length;

    const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Today</h2>
                <p className="text-sm text-gray-600">{dateLabel}</p>
            </div>

            {/* Next dye session */}
            <div className="bg-white rounded-lg card-shadow p-6">
                {next ? (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-sm text-gray-600">{inProgress ? 'In progress' : isDraft ? 'Next up · draft, not dated yet' : 'Next dye session'}</div>
                            <div className="text-xl font-semibold text-gray-900">
                                {next.name}
                                <span className="text-gray-500 font-normal"> · {next.date ? DateUtils.formatDate(next.date) : 'no date'}</span>
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                                {plural(next.pans.length, 'pan')}
                                {inProgress ? ` · ${doneCount(next.id)} dyed` : ''}
                                {nextColors.length ? ` · ${nextColors.slice(0, 6).join(', ')}${nextColors.length > 6 ? ` +${nextColors.length - 6} more` : ''}` : ''}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {isDraft && (
                                <button onClick={() => setActiveTab('sessions')} className="px-4 py-3 rounded-lg font-medium text-teal-700 border border-teal-200 hover:bg-teal-50 whitespace-nowrap">
                                    Review &amp; date
                                </button>
                            )}
                            <button onClick={openQueue} className="bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 font-semibold text-lg whitespace-nowrap">
                                ▶ {inProgress ? 'Continue' : 'Start'} Queue
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <div className="text-xl font-semibold text-gray-900">No dye session scheduled</div>
                            <div className="text-sm text-gray-600 mt-1">
                                {D.plan.batches.length ? `The plan suggests ${plural(D.plan.batches.length, 'batch', 'batches')} from current demand.` : 'Plan one from current demand.'}
                            </div>
                        </div>
                        <button onClick={() => setActiveTab('plan')} className="bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 font-semibold whitespace-nowrap">
                            🧪 Open Plan
                        </button>
                    </div>
                )}
            </div>

            {/* Needs attention */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-3">Needs attention</h3>
                {actions.length ? (
                    <ul className="list-none p-0 m-0 divide-y divide-gray-200">
                        {actions.map((a) => (
                            <li key={a.text}>
                                <button onClick={() => setActiveTab(a.tab)} className="w-full text-left flex items-start gap-3 py-3 hover:bg-gray-50 rounded px-2 -mx-2">
                                    <span className="text-xl leading-6">{a.icon}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className={`block font-medium ${a.urgent ? 'text-red-600' : 'text-gray-900'}`}>{a.text}</span>
                                        {a.sub && <span className="block text-sm text-gray-500 truncate">{a.sub}</span>}
                                    </span>
                                    <span className="text-gray-400">→</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-500 text-center py-6">All caught up ✓</p>
                )}
            </div>

            {/* Shop snapshot */}
            <div className="bg-white rounded-lg card-shadow p-6 space-y-5">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">🛍️ Shop · last 30 days</h3>
                    <button onClick={() => setActiveTab('demand')} className="text-sm text-teal-700 hover:underline">Sales →</button>
                </div>
                {D.lines.length ? (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Stat label="Revenue" value={money0(now.revenue)} delta={delta(now.revenue, prev.revenue)} accent="text-green-600" />
                            <Stat label="Skeins sold" value={String(now.skeins)} delta={delta(now.skeins, prev.skeins)} />
                            <Stat label="Orders" value={String(now.orders)} delta={delta(now.orders, prev.orders)} />
                            <button onClick={() => setActiveTab('sales')} className="text-left hover:bg-gray-50 rounded -m-1 p-1">
                                <div className="text-sm text-gray-600">On hand{S.source === 'shopify' ? '' : ' (est.)'}</div>
                                <div className="text-2xl font-bold text-gray-900 tabular-nums">{S.skeins.toLocaleString()}</div>
                                <div className="text-xs text-gray-500">skeins · {money0(S.value)}</div>
                            </button>
                        </div>
                        <div className="text-sm">
                            <div className="font-semibold text-gray-800 mb-2">🏆 Top sellers</div>
                            {top.length ? (
                                <ol className="list-none p-0 m-0 space-y-1 max-w-md">
                                    {top.map((t, i) => <li key={t.key} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {t.label}</span><span className="tabular-nums text-gray-600">{t.units}</span></li>)}
                                </ol>
                            ) : <p className="text-gray-500">No sales in the last 30 days.</p>}
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-gray-600">
                        {stockedSkeins ? `${plural(stockedSkeins, 'stocked batch', 'stocked batches')}. ` : ''}Import your Shopify orders in Shop → Sales to see revenue and best sellers here.
                    </p>
                )}
            </div>
        </div>
    );
}

function Stat({ label, value, delta, accent = 'text-gray-900' }: { label: string; value: string; delta: number | null; accent?: string }) {
    return (
        <div>
            <div className="text-sm text-gray-600">{label}</div>
            <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
            {delta != null && (
                <div className={`text-xs font-medium ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs prior 30 days</div>
            )}
        </div>
    );
}
