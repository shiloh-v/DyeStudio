// One place that turns imported Shopify sales + studio data into the demand
// picture every tab shares (Demand, Dashboard, Inventory, Recipes), so they all
// agree on the numbers.

import type { Batch, Kit, Recipe } from '../types';
import { DateUtils } from './dates';
import { isCountable, isOwnBrand, lineRevenue, type SaleLine } from './shopify';
import {
    makeContext, allUnits, windowUnits, byCombo, byColorway, computeSupply, dyeNext, costLookup,
    plannedSkeins, yarnToOrder, daysAgo, planRestock, dyeCadence, projectedBatchYarn, salesMix,
    labTestCandidates, gradientTrayYarn, comboKey, isSpecialtyBase, type Unit,
} from './demand';

export const DEMAND_WINDOWS: { label: string; days: number | null }[] = [
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
    { label: '6 months', days: 182 },
    { label: '12 months', days: 365 },
    { label: 'All time', days: null },
];

// Per-viewer preferences set on the Demand tab (window, weeks of stock to keep).
const read = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export interface PlanEdits {
    removed: string[];      // colorways taken out of the plan
    added: string[];        // colorways put in
    fill: boolean;          // top pans to 300g + fill a short batch
    labTests?: string[];    // Color Lab sketch ids to test in the plan
    forceBatch?: boolean;   // plan a batch even when nothing is running low
}
export const demandPrefs = {
    windowIdx: (): number => read('demand_window', 1),
    targetWeeks: (): number => read('demand_target_weeks', 8),
    // Changes made to the auto-built restock plan (Demand tab).
    planEdits: (): PlanEdits => ({ removed: [], added: [], fill: true, labTests: [], forceBatch: false, ...read('demand_plan_edits', {}) }),
    // Yarn to order covers this many months of dyeing at this pace (null = from history).
    yarnMonths: (): number => read('demand_yarn_months', 2),
    batchesPerMonth: (): number | null => read('demand_batches_per_month', null),
    set: (k: 'demand_window' | 'demand_target_weeks' | 'demand_plan_edits' | 'demand_yarn_months' | 'demand_batches_per_month', v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/** Revenue / skeins / orders for our lines in (today-days-offset, today-offset]. */
export function periodStats(lines: SaleLine[], units: Unit[], today: string, days: number, offset = 0) {
    const to = daysAgo(today, offset);
    const from = daysAgo(today, offset + days);
    const ls = lines.filter((l) => isCountable(l) && l.orderDate > from && l.orderDate <= to);
    return {
        revenue: ls.reduce((s, l) => s + lineRevenue(l), 0),
        orders: new Set(ls.map((l) => l.orderName)).size,
        skeins: units.filter((u) => u.date > from && u.date <= to).reduce((s, u) => s + u.qty, 0),
    };
}

export interface DemandInput {
    sales: SaleLine[];
    batches: Batch[];
    recipes: Recipe[];
    kits: Kit[];
    settings: any;
    inventory?: any[];
    dyeSessions?: any[];
    gradients?: any[];
    colorSketches?: any[];
    planEdits?: PlanEdits;
    yarnMonths?: number;
    batchesPerMonth?: number | null;
    windowIdx?: number;
    targetWeeks?: number;
    today?: string;
}

export function demandSummary(input: DemandInput) {
    const today = input.today || DateUtils.getTodayEST();
    const win = DEMAND_WINDOWS[input.windowIdx ?? demandPrefs.windowIdx()] || DEMAND_WINDOWS[1];
    const targetWeeks = input.targetWeeks ?? demandPrefs.targetWeeks();
    const ctx = makeContext(input.recipes, input.kits, input.settings);

    const lines = (input.sales || []).filter((s) => s.lineKey && isOwnBrand(s.vendor, s.productTitle || s.lineName));
    const units = allUnits(lines, ctx);
    const firstDate = lines.reduce((m, l) => (!m || l.orderDate < m ? l.orderDate : m), '');
    const lastDate = lines.reduce((m, l) => (l.orderDate > m ? l.orderDate : m), '');
    // "All time" velocity spans from the first imported order.
    const windowDays = win.days || Math.max(7, Math.round((Date.parse(today) - Date.parse(firstDate || today)) / 86400000) + 1);
    const inWindow = windowUnits(units, today, win.days);

    const planned = plannedSkeins(input.dyeSessions || [], ctx);
    const supply = computeSupply(input.batches, units, ctx, input.settings?.shopifyInventory, planned.byCombo);
    // Past year, for spotting sold-out colors (no stock → no recent sales).
    const lastSale = new Map<string, string>();
    for (const u of units) {
        const k = comboKey(u.colorway, u.base, u.hankSize);
        if (!lastSale.has(k) || u.date > lastSale.get(k)!) lastSale.set(k, u.date);
    }
    const suggestions = dyeNext(byCombo(inWindow), windowDays, supply, targetWeeks, byCombo(windowUnits(units, today, 365)), lastSale);

    // The restock plan: built automatically from dye-next, then the user's edits.
    const edits = input.planEdits || demandPrefs.planEdits();
    const plan = planRestock({
        suggestions,
        removed: new Set(edits.removed),
        added: edits.added,
        fill: edits.fill,
        recipes: input.recipes,
        inventory: input.inventory || [],
        sessions: input.dyeSessions || [],
        gradients: input.gradients || [],
        ctx,
        plannedByBaseSize: planned.byBaseSize,
        inWindow,
        units,
        supply,
        windowDays,
        labTests: (edits.labTests || [])
            .map((id) => (input.colorSketches || []).find((k) => String(k.id) === String(id)))
            .filter(Boolean),
        forceBatch: !!edits.forceBatch,
    });
    // Stock up for the next N months of dyeing: batches at your pace, minus
    // the ones already planned (sessions) or in this plan; the rest are
    // projected as typical batches in the shop's overall sales mix.
    const historyPace = dyeCadence(input.dyeSessions || [], today);
    const months = input.yarnMonths ?? demandPrefs.yarnMonths();
    const pace = input.batchesPerMonth ?? demandPrefs.batchesPerMonth() ?? historyPace;
    const horizonBatches = Math.ceil(months * pace - 1e-9);
    const upcomingSessions = (input.dyeSessions || []).filter((s) => !s.archived && (s.pans || []).length).length;
    // Only plan batches that fall inside the stock-up window are ordered for
    // now; later ones are shown in the plan but bought for next time.
    const planInHorizon = Math.min(plan.batches.length, Math.max(0, horizonBatches - upcomingSessions));
    const planBeyond = plan.batches.length - planInHorizon;
    const projectedBatches = Math.max(0, horizonBatches - upcomingSessions - plan.batches.length);
    const traysLeft = Math.max(0, plan.gradientDyes.length - plan.batches.length);
    // Yarn to order = plan batches in the window (pans + trays) + skeins to add
    // to already-planned sessions + those sessions themselves (+ projected).
    const planYarn = plannedSkeins(plan.batches.slice(0, planInHorizon).map((pans) => ({ pans })), ctx).byBaseSize;
    for (const a of plan.adjust) {
        const k = `${a.base}||${a.hankSize}`;
        planYarn.set(k, (planYarn.get(k) || 0) + a.qty);
    }
    const defaultMix = salesMix('', inWindow, units).filter((m) => !isSpecialtyBase(m.base, ctx.catalog));
    const projected = projectedBatchYarn(projectedBatches, Math.min(projectedBatches, traysLeft), defaultMix, gradientTrayYarn(input.dyeSessions || [], ctx));
    const yarnOrder = yarnToOrder(
        [...planYarn.entries()].map(([k, q]) => { const [base, h] = k.split('||'); return { base, hankSize: Number(h), suggest: q }; }),
        planned.byBaseSize,
        input.inventory || [],
        ctx,
        projected
    );
    const toBuy = yarnOrder.filter((r) => r.short > 0);

    return {
        today, win, targetWeeks, ctx, lines, units, firstDate, lastDate, windowDays, inWindow,
        planned, supply, suggestions, plan, edits, yarnOrder, toBuy,
        horizon: { months, pace, historyPace, horizonBatches, upcomingSessions, planBatches: planInHorizon, planBeyond, projectedBatches },
        labCandidates: labTestCandidates(input.colorSketches || [], input.dyeSessions || [], input.recipes),
        yarnOrderCost: toBuy.reduce((s, r) => s + r.cost, 0),
        getCost: costLookup(input.batches, ctx),
        /** Units sold per colorway in the current window (for Recipes badges). */
        colorwaySales: () => new Map(byColorway(inWindow).map((a) => [a.colorway!, a.units])),
    };
}

export type DemandSummary = ReturnType<typeof demandSummary>;
