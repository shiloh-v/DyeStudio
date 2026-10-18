// One place that turns imported Shopify sales + studio data into the demand
// picture every tab shares (Demand, Dashboard, Inventory, Recipes), so they all
// agree on the numbers.

import type { Batch, Kit, Recipe } from '../types';
import { DateUtils } from './dates';
import { isCountable, isOwnBrand, lineRevenue, type SaleLine } from './shopify';
import {
    makeContext, allUnits, windowUnits, byCombo, byColorway, computeSupply, dyeNext, costLookup,
    plannedSkeins, yarnToOrder, daysAgo, planRestock, type Unit,
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
export interface PlanEdits { removed: string[]; added: string[]; fill: boolean }
export const demandPrefs = {
    windowIdx: (): number => read('demand_window', 1),
    targetWeeks: (): number => read('demand_target_weeks', 8),
    // Changes made to the auto-built restock plan (Demand tab).
    planEdits: (): PlanEdits => ({ removed: [], added: [], fill: true, ...read('demand_plan_edits', {}) }),
    set: (k: 'demand_window' | 'demand_target_weeks' | 'demand_plan_edits', v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
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
    planEdits?: PlanEdits;
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
    const suggestions = dyeNext(byCombo(inWindow), windowDays, supply, targetWeeks);

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
    });
    // Yarn to order = everything the plan (pans + gradient trays) and the
    // already-planned sessions will use.
    const planYarn = plannedSkeins(plan.batches.map((pans) => ({ pans })), ctx).byBaseSize;
    const yarnOrder = yarnToOrder(
        [...planYarn.entries()].map(([k, q]) => { const [base, h] = k.split('||'); return { base, hankSize: Number(h), suggest: q }; }),
        planned.byBaseSize,
        input.inventory || [],
        ctx
    );
    const toBuy = yarnOrder.filter((r) => r.short > 0);

    return {
        today, win, targetWeeks, ctx, lines, units, firstDate, lastDate, windowDays, inWindow,
        planned, supply, suggestions, plan, edits, yarnOrder, toBuy,
        yarnOrderCost: toBuy.reduce((s, r) => s + r.cost, 0),
        getCost: costLookup(input.batches, ctx),
        /** Units sold per colorway in the current window (for Recipes badges). */
        colorwaySales: () => new Map(byColorway(inWindow).map((a) => [a.colorway!, a.units])),
    };
}

export type DemandSummary = ReturnType<typeof demandSummary>;
