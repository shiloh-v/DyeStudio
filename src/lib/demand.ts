// Demand analytics — turns imported Shopify sale lines into "what sells, what's
// running low, what to dye next".
//
// Every sale line is resolved to (colorway, yarn base, skein size) — a "combo".
// Resolution order: a manual mapping saved in Settings (settings.shopifyMap,
// keyed by the normalized line name) wins field by field, then auto-matching:
//   * colorway = the longest recipe (or kit) name found in the line name
//   * base     = a Yarn Bases catalog myName/supplierName in the text, else a
//                yarn-weight word that only one base has ("DK" → Luna DK)
//   * size     = "50g" / "Mini" / "Half skein"… else the base's largest size
// Mappings are applied at read time, so fixing one re-labels all history.

import type { Batch, Kit, Recipe, Settings, YarnBase } from '../types';
import { canonicalYarnRef, matchesYarnBase } from './yarnMatch';
import { isStocked } from './batches';
import { isCountable, isOwnBrand, lineRevenue, type SaleLine, type InventorySnapshot } from './shopify';

export interface ShopifyMapping {
    kind?: 'colorway' | 'kit' | 'ignore';
    recipeId?: number;
    kitId?: number;
    base?: string;
    hankSize?: number;
}

export interface Resolved {
    kind: 'colorway' | 'kit' | 'ignore' | 'unknown';
    recipeId?: number;
    colorway?: string;
    kitId?: number;
    kitName?: string;
    base?: string;
    hankSize?: number;
    sizeAssumed?: boolean;
    manual?: boolean;
}

export interface DemandContext {
    recipes: Recipe[];
    kits: Kit[];
    catalog: YarnBase[];
    sizeMappings: { grams: number; name: string }[];
    map: Record<string, ShopifyMapping>;
}

export function makeContext(recipes: Recipe[], kits: Kit[], settings: Settings | any): DemandContext {
    return {
        recipes: recipes || [],
        kits: kits || [],
        catalog: settings?.yarnBases || [],
        sizeMappings: settings?.sizeMappings || [],
        map: settings?.shopifyMap || {},
    };
}

/** Lower-case, quotes/punctuation → spaces, collapsed. Also the mapping key. */
export const normText = (s: any): string =>
    String(s ?? '')
        .toLowerCase()
        .replace(/[’'"“”()]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const containsPhrase = (hay: string, needle: string) =>
    !!needle && ` ${hay} `.includes(` ${needle} `);

const SIZE_WORDS: [RegExp, number][] = [
    [/\bmicros?\b/, 10],
    [/\bminis?\b/, 20],
    [/\bhalf\b/, 50],
    [/\bfull\b/, 100],
];

/**
 * Names a recipe can be sold under: its full name plus any quoted nickname in
 * it — `WnF Muted Teal ("Fuzzy")` is listed in Shopify as "Fuzzy Mini".
 */
export function recipeNames(name: any): string[] {
    const out = [normText(name)];
    for (const m of String(name ?? '').matchAll(/["“”']([^"“”']{2,})["“”']/g)) out.push(normText(m[1]));
    return out.filter(Boolean);
}

/** Skein size in grams mentioned in text ("50g", "50s", "Mini", "Half skein"). */
export function sizeFromText(text: string, sizeMappings: { grams: number; name: string }[] = []): number | undefined {
    const t = normText(text);
    const g = t.match(/\b(\d{1,4})\s?(g|gr|gram|grams|s)\b/);
    if (g) return Number(g[1]);
    for (const m of sizeMappings) {
        if (m?.name && containsPhrase(t, normText(m.name))) return Number(m.grams);
    }
    for (const [re, grams] of SIZE_WORDS) if (re.test(t)) return grams;
    return undefined;
}

function largestSize(base?: YarnBase): number | undefined {
    const sizes = (base?.sizes || []).map((s) => Number(s.amount)).filter((n) => n > 0);
    return sizes.length ? Math.max(...sizes) : undefined;
}

function autoBase(text: string, catalog: YarnBase[]): YarnBase | undefined {
    const t = normText(text);
    let best: YarnBase | undefined;
    let bestLen = 0;
    for (const b of catalog) {
        for (const n of [b.myName, b.supplierName, ...(b.aliases || [])]) {
            const nn = normText(n);
            if (nn.length > bestLen && containsPhrase(t, nn)) { best = b; bestLen = nn.length; }
        }
    }
    if (best) return best;
    // A base family word ("nova", "luna"…) with no full-name match means a base
    // that isn't in the catalog yet (e.g. "Nova DK") — don't guess from weight.
    const families = new Set(catalog.map((b) => normText(b.myName).split(' ')[0]).filter(Boolean));
    if (t.split(' ').some((w) => families.has(w))) return undefined;
    // A weight word only one base has ("dk", "bulky", "worsted").
    const byWeight = catalog.filter((b) => b.weight && containsPhrase(t, normText(b.weight)));
    return byWeight.length === 1 ? byWeight[0] : undefined;
}

/** Resolve a Shopify line name (orders) or variant name (inventory). */
export function resolveName(name: string, ctx: DemandContext): Resolved {
    const key = normText(name);
    const m = ctx.map[key] || {};
    if (m.kind === 'ignore') return { kind: 'ignore', manual: true };

    let out: Resolved = { kind: 'unknown' };

    if (m.kind === 'kit' && m.kitId != null) {
        const kit = ctx.kits.find((k) => Number(k.id) === Number(m.kitId));
        if (kit) out = { kind: 'kit', kitId: kit.id, kitName: kit.name, manual: true };
    } else if (m.kind === 'colorway' && m.recipeId != null) {
        const r = ctx.recipes.find((x) => Number(x.id) === Number(m.recipeId));
        if (r) out = { kind: 'colorway', recipeId: r.id, colorway: r.name, manual: true };
    }

    if (out.kind === 'unknown') {
        // Longest recipe or kit name contained in the text wins.
        let bestLen = 0;
        for (const r of ctx.recipes) {
            for (const n of recipeNames(r.name)) {
                if (n.length > bestLen && containsPhrase(key, n)) {
                    bestLen = n.length;
                    out = { kind: 'colorway', recipeId: r.id, colorway: r.name };
                }
            }
        }
        for (const k of ctx.kits) {
            const n = normText(k.name);
            if (n.length >= bestLen && n.length > 0 && containsPhrase(key, n)) {
                bestLen = n.length;
                out = { kind: 'kit', kitId: k.id, kitName: k.name };
            }
        }
    }

    if (out.kind === 'colorway') {
        const baseEntry = m.base
            ? ctx.catalog.find((b) => b.myName === m.base) || ({ myName: m.base } as YarnBase)
            : autoBase(name, ctx.catalog);
        out.base = baseEntry?.myName;
        const size = m.hankSize ?? sizeFromText(name, ctx.sizeMappings);
        if (size) out.hankSize = Number(size);
        else if (baseEntry) {
            out.hankSize = largestSize(baseEntry);
            out.sizeAssumed = out.hankSize != null;
        }
        if (m.base || m.hankSize) out.manual = true;
    }
    return out;
}

/** Fully matched = we know colorway + base + size (or it's a kit / ignored). */
export function isResolved(r: Resolved): boolean {
    if (r.kind === 'ignore' || r.kind === 'kit') return true;
    return r.kind === 'colorway' && !!r.base && !!r.hankSize;
}

// ---------- Units (one skein-level demand entry) ----------

export interface Unit {
    colorway: string;
    recipeId?: number;
    base: string;      // '' when unknown
    hankSize: number;  // 0 when unknown
    qty: number;
    revenue: number;
    date: string;
    order: string;
    viaKit?: string;
}

export const comboKey = (colorway: string, base: string, hankSize: number) =>
    `${colorway}||${base}||${hankSize || 0}`;

export const comboLabel = (base: string, hankSize: number) =>
    base ? `${base}${hankSize ? ` ${hankSize}g` : ''}` : 'Base not matched';

/** Expand one sale line into skein-level units (kits explode into their colors). */
export function unitsForLine(line: SaleLine, ctx: DemandContext, resolveCache?: Map<string, Resolved>): Unit[] {
    // Import already drops other brands; this also guards rows saved before that.
    if (!isCountable(line) || !isOwnBrand(line.vendor, line.productTitle || line.lineName)) return [];
    let r = resolveCache?.get(line.lineName);
    if (!r) {
        r = resolveName(line.lineName, ctx);
        resolveCache?.set(line.lineName, r);
    }
    const revenue = lineRevenue(line);
    const qty = Number(line.quantity) || 0;
    const common = { date: line.orderDate, order: line.orderName };

    if (r.kind === 'colorway' && r.colorway) {
        return [{ ...common, colorway: r.colorway, recipeId: r.recipeId, base: r.base || '', hankSize: r.hankSize || 0, qty, revenue }];
    }
    if (r.kind === 'kit') {
        const kit = ctx.kits.find((k) => Number(k.id) === Number(r!.kitId));
        const colors = (kit?.colors || []).filter((c: any) => c?.colorwayName);
        const perKit = colors.reduce((s: number, c: any) => s + (Number(c.quantity) || 1), 0);
        if (!perKit) return [];
        return colors.map((c: any) => {
            const each = Number(c.quantity) || 1;
            const recipe = ctx.recipes.find((x) => normText(x.name) === normText(c.colorwayName));
            const baseRef = c.baseYarn || kit?.baseYarn || '';
            const base = canonicalYarnRef(baseRef, ctx.catalog);
            const entry = ctx.catalog.find((b) => b.myName === base);
            const hank = sizeFromText(baseRef, ctx.sizeMappings) || largestSize(entry) || 0;
            return {
                ...common,
                colorway: recipe?.name || c.colorwayName,
                recipeId: recipe?.id,
                base,
                hankSize: hank,
                qty: qty * each,
                revenue: (revenue * each) / perKit,
                viaKit: kit?.name,
            };
        });
    }
    return [];
}

// ---------- Analytics ----------

export interface Agg { key: string; label: string; colorway?: string; recipeId?: number; base?: string; hankSize?: number; units: number; revenue: number; orders: number; }

function aggregate(units: Unit[], keyFn: (u: Unit) => string, labelFn: (u: Unit) => string): Agg[] {
    const map = new Map<string, Agg & { _orders: Set<string> }>();
    for (const u of units) {
        const k = keyFn(u);
        let a = map.get(k);
        if (!a) {
            a = { key: k, label: labelFn(u), colorway: u.colorway, recipeId: u.recipeId, base: u.base, hankSize: u.hankSize, units: 0, revenue: 0, orders: 0, _orders: new Set() };
            map.set(k, a);
        }
        a.units += u.qty;
        a.revenue += u.revenue;
        a._orders.add(u.order);
    }
    return [...map.values()]
        .map(({ _orders, ...a }) => ({ ...a, orders: _orders.size }))
        .sort((x, y) => y.units - x.units || y.revenue - x.revenue);
}

export const daysAgo = (today: string, days: number) => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
};

/** All units from all lines (resolved once). */
export function allUnits(sales: SaleLine[], ctx: DemandContext): Unit[] {
    const cache = new Map<string, Resolved>();
    return sales.flatMap((l) => unitsForLine(l, ctx, cache));
}

export function windowUnits(units: Unit[], today: string, days: number | null): Unit[] {
    if (!days) return units;
    const from = daysAgo(today, days);
    return units.filter((u) => u.date > from && u.date <= today);
}

export const byColorway = (units: Unit[]) => aggregate(units, (u) => u.colorway, (u) => u.colorway);
export const byBase = (units: Unit[]) =>
    aggregate(units, (u) => (u.base ? `${u.base}||${u.hankSize}` : '?'), (u) => comboLabel(u.base, u.hankSize));
export const byCombo = (units: Unit[]) =>
    aggregate(units, (u) => comboKey(u.colorway, u.base, u.hankSize), (u) => `${u.colorway} · ${comboLabel(u.base, u.hankSize)}`);

/** Last `n` months (YYYY-MM), oldest first, ending with the month of `today`. */
export function lastMonths(today: string, n: number): string[] {
    const [y, m] = today.split('-').map(Number);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        out.push(d.toISOString().slice(0, 7));
    }
    return out;
}

export function monthlyUnits(units: Unit[], months: string[], colorway?: string): number[] {
    const idx = new Map(months.map((m, i) => [m, i]));
    const out = months.map(() => 0);
    for (const u of units) {
        if (colorway && u.colorway !== colorway) continue;
        const i = idx.get(u.date.slice(0, 7));
        if (i != null) out[i] += u.qty;
    }
    return out;
}

// ---------- Supply (on hand + in progress) ----------

function batchColorway(b: Batch, recipes: Recipe[]): string {
    const r = b.recipeId != null ? recipes.find((x) => String(x.id) === String(b.recipeId)) : undefined;
    return r?.name || b.recipeName || b.colorway || '';
}

/** Skeins per combo from batches matching `pred` (status filter). */
function batchSkeins(batches: Batch[], ctx: DemandContext, pred: (b: Batch) => boolean) {
    const out = new Map<string, { qty: number; firstDate: string }>();
    for (const b of batches || []) {
        if (!pred(b)) continue;
        const cw = batchColorway(b, ctx.recipes);
        if (!cw) continue;
        const date = b.soldDate || b.startDate || '';
        for (const y of b.yarnDetails || []) {
            const base = canonicalYarnRef(y.base, ctx.catalog);
            const hank = Number(y.hankSize) || sizeFromText(String(y.base || ''), ctx.sizeMappings) || 0;
            const k = comboKey(cw, base, hank);
            const prev = out.get(k) || { qty: 0, firstDate: date };
            prev.qty += parseInt(String(y.quantity)) || 0;
            if (date && (!prev.firstDate || date < prev.firstDate)) prev.firstDate = date;
            out.set(k, prev);
        }
    }
    return out;
}

export interface Supply {
    onHand: Map<string, number>;
    coming: Map<string, number>;
    source: 'shopify' | 'estimate';
    listed?: Set<string>;   // combos with a live Shopify listing (from the stock upload)
}

/**
 * On hand: the Shopify inventory snapshot when one was uploaded; otherwise an
 * ESTIMATE = stocked skeins − skeins sold since that combo was first stocked.
 * Coming: skeins still in the pipeline (dyeing / drying / ready).
 */
export function computeSupply(
    batches: Batch[],
    units: Unit[],
    ctx: DemandContext,
    snapshot?: InventorySnapshot | null,
    planned?: Map<string, number>
): Supply {
    const coming = new Map<string, number>();
    batchSkeins(batches, ctx, (b) => !isStocked(b)).forEach((v, k) => coming.set(k, v.qty));
    // Skeins already planned in upcoming dye sessions are on their way too, so
    // a restock you've drafted stops being suggested again.
    planned?.forEach((q, k) => coming.set(k, (coming.get(k) || 0) + q));

    const onHand = new Map<string, number>();
    if (snapshot?.rows?.length) {
        const listed = new Set<string>();
        for (const row of snapshot.rows) {
            if (!isOwnBrand(row.vendor, row.name)) continue;
            const r = resolveName(row.name, ctx);
            if (r.kind !== 'colorway' || !r.colorway) continue; // kits are made from stock
            const k = comboKey(r.colorway, r.base || '', r.hankSize || 0);
            onHand.set(k, (onHand.get(k) || 0) + row.available);
            listed.add(k);
        }
        return { onHand, coming, source: 'shopify', listed };
    }

    const stocked = batchSkeins(batches, ctx, isStocked);
    const soldSince = new Map<string, number>();
    for (const u of units) {
        const k = comboKey(u.colorway, u.base, u.hankSize);
        const s = stocked.get(k);
        if (s && u.date >= s.firstDate) soldSince.set(k, (soldSince.get(k) || 0) + u.qty);
    }
    stocked.forEach((v, k) => onHand.set(k, Math.max(0, v.qty - (soldSince.get(k) || 0))));
    return { onHand, coming, source: 'estimate' };
}

// ---------- Planned (not yet dyed) sessions ----------

/**
 * Skeins in upcoming (non-archived) dye sessions. `byCombo` = colorway pans
 * (counted as supply on the way); `byBaseSize` = ALL undyed yarn those
 * sessions will use, incl. gradient (10) and dye-square (25) trays — mirrors
 * DyeSessions' calculatePanNeeds.
 */
export function plannedSkeins(sessions: any[], ctx: DemandContext) {
    const byCombo = new Map<string, number>();
    const byBaseSize = new Map<string, number>();
    const addBase = (base: any, hank: any, q: number) => {
        const b = canonicalYarnRef(base, ctx.catalog);
        const h = Number(hank) || sizeFromText(String(base || ''), ctx.sizeMappings) || 0;
        if (!b || !q) return;
        const k = `${b}||${h}`;
        byBaseSize.set(k, (byBaseSize.get(k) || 0) + q);
        return { b, h };
    };
    for (const s of sessions || []) {
        if (s?.archived) continue;
        for (const pan of s.pans || []) {
            if (pan.type === 'gradientTray') { addBase(pan.gradientYarnBase, pan.gradientHankSize, 10); continue; }
            if (pan.type === 'dyeSquareTray') { addBase(pan.gradientYarnBase, pan.gradientHankSize, 25); continue; }
            const recipe = pan.recipeId ? ctx.recipes.find((r) => String(r.id) === String(pan.recipeId)) : undefined;
            const colorway = recipe?.name || (pan.type === 'pan' ? pan.colorway : '');
            for (const y of pan.yarns || []) {
                const q = parseInt(String(y.quantity)) || 0;
                const r = addBase(y.base, y.hankSize, q);
                if (r && colorway) {
                    const k = comboKey(colorway, r.b, r.h);
                    byCombo.set(k, (byCombo.get(k) || 0) + q);
                }
            }
        }
    }
    return { byCombo, byBaseSize };
}

// ---------- Yarn to order ----------

export interface YarnOrderRow {
    base: string;
    hankSize: number;
    forDyeNext: number;   // skeins the restock plan needs (pans + gradient trays)
    forPlanned: number;   // skeins already-planned sessions need
    forProjected: number; // skeins for projected batches (rest of the stock-up horizon)
    keep: number;         // low-stock minimum to keep on the shelf
    have: number;         // undyed skeins in Inventory
    short: number;        // skeins to buy
    supplier?: string;
    sku?: string;
    packSize: number;
    packPrice?: number;
    packs: number;
    cost: number;
}

/**
 * What undyed yarn to buy: (dye-next + planned sessions + keep-minimum) −
 * undyed skeins on hand, per base + size, rounded up to the supplier's pack.
 */
export function yarnToOrder(
    suggestions: { base?: string; hankSize?: number; suggest: number }[],
    plannedByBaseSize: Map<string, number>,
    inventory: any[],
    ctx: DemandContext,
    projectedByBaseSize: Map<string, number> = new Map()
): YarnOrderRow[] {
    const need = new Map<string, { dye: number; planned: number; projected: number }>();
    const bump = (k: string, f: 'dye' | 'planned' | 'projected', q: number) => {
        const v = need.get(k) || { dye: 0, planned: 0, projected: 0 };
        v[f] += q; need.set(k, v);
    };
    for (const s of suggestions) if (s.base && s.hankSize) bump(`${s.base}||${s.hankSize}`, 'dye', s.suggest);
    plannedByBaseSize.forEach((q, k) => bump(k, 'planned', q));
    projectedByBaseSize.forEach((q, k) => bump(k, 'projected', q));

    const rows: YarnOrderRow[] = [];
    need.forEach((v, k) => {
        const [base, h] = k.split('||');
        const hankSize = Number(h) || 0;
        const items = (inventory || []).filter((i) =>
            i.category === 'yarn base' && matchesYarnBase(i, base, ctx.catalog) && Number(i.hankSize) === hankSize);
        const have = items.reduce((t, i) => t + (parseFloat(String(i.quantity)) || 0), 0);
        const keep = Math.max(0, ...items.map((i) => parseFloat(String(i.lowStockThreshold)) || 0));
        const entry = ctx.catalog.find((b) => b.myName === base);
        const size = (entry?.sizes || []).find((z) => Number(z.amount) === hankSize);
        const packSize = Math.max(1, Number(size?.packSize) || 1);
        const packPrice = size?.packPrice !== '' && size?.packPrice != null ? Number(size.packPrice) : undefined;
        const short = Math.max(0, Math.ceil(v.dye + v.planned + v.projected + keep - have));
        const packs = Math.ceil(short / packSize);
        rows.push({
            base, hankSize, forDyeNext: v.dye, forPlanned: v.planned, forProjected: v.projected, keep, have, short,
            supplier: entry?.supplier, sku: size?.sku, packSize, packPrice, packs,
            cost: packPrice != null ? packs * packPrice : 0,
        });
    });
    return rows.sort((a, b) => b.short - a.short || a.base.localeCompare(b.base) || b.hankSize - a.hankSize);
}

// ---------- Dye-next ----------

export interface Suggestion extends Agg {
    perWeek: number;
    onHand: number;
    coming: number;
    weeksLeft: number;   // Infinity when nothing sells
    suggest: number;     // skeins to dye to reach the target cover
    soldOut?: boolean;   // no stock, but sold over the past year (recent sales hidden by the stockout)
    lastSale?: string;   // YYYY-MM-DD of the last sale (sold-out rows)
    yearUnits?: number;  // units sold in the past 12 months (sold-out rows)
}

// A sold-out color/base needs at least this many sales in 12 months to count.
export const SOLD_OUT_MIN_YEAR_UNITS = 3;

/**
 * What to dye next: combos whose stock (on hand + Pipeline + planned) lasts
 * less than `targetWeeks` at the window's sales pace.
 *
 * Sold-out rescue: a combo with NO stock has no recent sales *because* it's
 * sold out, so the window pace understates demand. If it sold at least
 * SOLD_OUT_MIN_YEAR_UNITS in the past 12 months (and, when a Shopify stock
 * upload exists, is still listed there), use the 12-month pace instead and
 * flag it as sold out.
 */
export function dyeNext(
    windowAgg: Agg[],
    windowDays: number,
    supply: Supply,
    targetWeeks: number,
    yearAgg: Agg[] = [],
    lastSale: Map<string, string> = new Map()
): Suggestion[] {
    const weeks = Math.max(1, windowDays / 7);
    const byKey = new Map(windowAgg.map((a) => [a.key, a]));
    yearAgg.forEach((a) => { if (!byKey.has(a.key)) byKey.set(a.key, { ...a, units: 0, revenue: 0, orders: 0 }); });
    const year = new Map(yearAgg.map((a) => [a.key, a]));
    return [...byKey.values()]
        .filter((a) => a.colorway && a.base && a.hankSize)
        .map((a) => {
            const onHand = supply.onHand.get(a.key) || 0;
            const coming = supply.coming.get(a.key) || 0;
            const have = onHand + coming;
            let perWeek = a.units / weeks;
            let soldOut = false;
            const y = year.get(a.key);
            const listed = supply.source !== 'shopify' || !supply.listed || supply.listed.has(a.key);
            if (have <= 0 && listed && y && y.units >= SOLD_OUT_MIN_YEAR_UNITS && y.units / 52 > perWeek) {
                perWeek = y.units / 52;
                soldOut = true;
            }
            const weeksLeft = perWeek > 0 ? have / perWeek : Infinity;
            const suggest = Math.max(0, Math.ceil(perWeek * targetWeeks - have));
            return {
                ...a, perWeek, onHand, coming, weeksLeft, suggest,
                ...(soldOut ? { soldOut, yearUnits: y!.units, lastSale: lastSale.get(a.key) } : {}),
            };
        })
        .filter((s) => s.suggest > 0)
        .sort((x, y) => x.weeksLeft - y.weeksLeft || y.perWeek - x.perWeek);
}

// ---------- Real profit ----------

/**
 * Average cost per skein, learned from batch cost breakdowns: exact colorway +
 * base + size first, then base + size across all colorways, then the overall
 * average. Returns 0 when there are no costed batches at all.
 */
export function costLookup(batches: Batch[], ctx: DemandContext) {
    const combo = new Map<string, { sum: number; n: number }>();
    const baseSize = new Map<string, { sum: number; n: number }>();
    let all = { sum: 0, n: 0 };
    const add = (m: Map<string, { sum: number; n: number }>, k: string, c: number) => {
        const v = m.get(k) || { sum: 0, n: 0 };
        v.sum += c; v.n++; m.set(k, v);
    };
    for (const b of batches || []) {
        const cw = batchColorway(b, ctx.recipes);
        const details = (b.costBreakdown as any)?.skeinDetails;
        if (Array.isArray(details) && details.length) {
            for (const d of details) {
                const c = Number(d.cost);
                if (!(c > 0)) continue;
                const base = canonicalYarnRef(d.base, ctx.catalog);
                const hank = Number(d.hankSize) || 0;
                add(combo, comboKey(cw, base, hank), c);
                add(baseSize, `${base}||${hank}`, c);
                all = { sum: all.sum + c, n: all.n + 1 };
            }
        } else if (Number(b.costPerSkein) > 0) {
            all = { sum: all.sum + Number(b.costPerSkein), n: all.n + 1 };
        }
    }
    const avg = (v?: { sum: number; n: number }) => (v && v.n ? v.sum / v.n : undefined);
    const overall = avg(all) || 0;
    return (u: Unit) =>
        avg(combo.get(comboKey(u.colorway, u.base, u.hankSize))) ??
        avg(baseSize.get(`${u.base}||${u.hankSize}`)) ??
        overall;
}

// ---------- Draft dye session from suggestions ----------

/**
 * Undyed yarn on hand per `${base}||${hankSize}` (canonical base names). With
 * `minusKeep`, each item's low-stock minimum is held back (what's spare).
 */
export function undyedStock(inventory: any[], ctx: DemandContext, minusKeep = false): Map<string, number> {
    const m = new Map<string, number>();
    for (const i of inventory || []) {
        if (i.category !== 'yarn base') continue;
        const base = canonicalYarnRef(i.myYarnName || i.name, ctx.catalog);
        const k = `${base}||${Number(i.hankSize) || 0}`;
        const keep = minusKeep ? parseFloat(String(i.lowStockThreshold)) || 0 : 0;
        m.set(k, (m.get(k) || 0) + (parseFloat(String(i.quantity)) || 0) - keep);
    }
    return m;
}

/**
 * How a colorway sells, as base/size shares of skeins: the window if it sold
 * then, else all time, else the shop's overall mix.
 */
export function salesMix(colorway: string, inWindow: Unit[], all: Unit[]): { base: string; hankSize: number; share: number }[] {
    const tally = (us: Unit[], only?: string) => {
        const m = new Map<string, number>();
        for (const u of us) {
            if (!u.base || !(u.hankSize > MICRO_GRAMS) || (only && u.colorway !== only)) continue;
            const k = `${u.base}||${u.hankSize}`;
            m.set(k, (m.get(k) || 0) + u.qty);
        }
        return m;
    };
    let m = tally(inWindow, colorway);
    if (!m.size) m = tally(all, colorway);
    if (!m.size) m = tally(all);
    const tot = [...m.values()].reduce((t, n) => t + n, 0) || 1;
    return [...m.entries()]
        .map(([k, n]) => { const [base, h] = k.split('||'); return { base, hankSize: Number(h), share: n / tot }; })
        .sort((a, b) => b.share - a.share);
}

// ---------- Draft batches (studio process) ----------
//
// How a batch is dyed: 9 oven racks; a rack holds 2 pans or 1 tray. Every
// colorway is dyed as a PAIR of 300g pans. While some dye colors don't have a
// gradient yet, each batch also gets one gradient tray (1 rack) → 8 colorways
// + 1 tray; after that, 9 colorways.
export const PAN_GRAMS = 300;
// Micro skeins (10g) are only for gradient trays — never sold, never pan filler.
export const MICRO_GRAMS = 10;
export const MINI_GRAMS = 20;
/**
 * Per color/base/size in a batch (across the colorway's pans, any split):
 * if a size is dyed at all, at least `min` and at most `max` skeins.
 *   minis 5–12 · 50s 6–10 · fulls 4–8
 */
export const SIZE_BOUNDS: Record<number, { min: number; max: number }> = {
    20: { min: 5, max: 12 },
    50: { min: 6, max: 10 },
    100: { min: 4, max: 8 },
};
export const sizeBounds = (h: number) => SIZE_BOUNDS[h] || { min: 1, max: 99 };

/**
 * Specialty bases (Solis, Stardust, Nova DK) aren't planned automatically — not
 * as pan fill, in sales mixes or projected yarn. A base's `specialty` flag in
 * Yarn Bases wins; otherwise these names default to specialty.
 */
export const DEFAULT_SPECIALTY_BASES = ['Solis Fingering', 'Stardust Fingering', 'Nova DK'];
export function isSpecialtyBase(base: string, catalog: YarnBase[]): boolean {
    const entry = catalog.find((b) => normText(b.myName) === normText(base));
    if (entry && typeof (entry as any).specialty === 'boolean') return (entry as any).specialty;
    return DEFAULT_SPECIALTY_BASES.some((n) => normText(n) === normText(base));
}
export const RACKS_PER_BATCH = 9;
export const GRADIENT_DEPTHS = [0.0625, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2.0, 2.5, 3.0];

/**
 * Dye colors that still need a gradient, in dye-number order: every dye in
 * Inventory minus those with a saved gradient (same rule as the Dye Sessions
 * gradient picker) or already in a gradient tray in any session.
 */
export function dyesNeedingGradient(inventory: any[], gradients: any[], sessions: any[]): string[] {
    const done = new Set<string>();
    (gradients || []).forEach((g) => g?.dyeColor && done.add(normText(g.dyeColor)));
    (sessions || []).forEach((s) => (s.pans || []).forEach((p: any) => p.type === 'gradientTray' && p.gradientDye && done.add(normText(p.gradientDye))));
    return (inventory || [])
        .filter((i) => i.category === 'dye' && i.name && !done.has(normText(i.name)))
        .map((i) => String(i.name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Yarn for gradient trays: whatever the most recent tray used (else Nova Fingering 10g). */
export function gradientTrayYarn(sessions: any[], ctx: DemandContext): { base: string; hankSize: number } {
    const trays = (sessions || [])
        .slice()
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        .flatMap((s) => (s.pans || []).filter((p: any) => p.type === 'gradientTray' && p.gradientYarnBase));
    const last = trays[trays.length - 1];
    return last
        ? { base: canonicalYarnRef(last.gradientYarnBase, ctx.catalog), hankSize: Number(last.gradientHankSize) || 10 }
        : { base: 'Nova Fingering', hankSize: 10 };
}

/**
 * Group a restock's pans into batches: whole colorway pairs only, up to
 * 8 colorways + a gradient tray while dyes still need gradients, else 9.
 */
export const LAB_TESTS_PER_BATCH = 2;

export function planBatches(pans: any[], gradientDyes: string[], trayYarn: { base: string; hankSize: number }) {
    const groups: any[][] = [];
    for (const p of pans) {
        const g = groups[groups.length - 1];
        if (g && g[0].colorway === p.colorway && g[0].type === p.type) g.push(p); else groups.push([p]);
    }
    const dyes = [...gradientDyes];
    type B = { items: any[]; racks: number; tray: any | null; labs: number };
    const batches: B[] = [];
    const open = (): B => {
        const tray = dyes.length ? {
            id: Date.now() + batches.length / 100 + 0.5,
            type: 'gradientTray',
            gradientDye: dyes.shift(),
            gradientYarnBase: trayYarn.base,
            gradientHankSize: trayYarn.hankSize,
            depths: GRADIENT_DEPTHS,
        } : null;
        const b: B = { items: [], racks: tray ? 1 : 0, tray, labs: 0 };
        batches.push(b);
        return b;
    };
    // Color Lab tests claim their slots first: LAB_TESTS_PER_BATCH per batch.
    const labGroups = groups.filter((g) => g[0].type === 'colorLab');
    labGroups.forEach((g, i) => {
        const b = batches[Math.floor(i / LAB_TESTS_PER_BATCH)] || open();
        b.items.push(...g);
        b.racks += Math.ceil(g.length / 2);
        b.labs++;
    });
    // Colorways then fill batches in order (first batch with room).
    for (const g of groups.filter((x) => x[0].type !== 'colorLab')) {
        const need = Math.ceil(g.length / 2);
        const b = batches.find((x) => x.racks + need <= RACKS_PER_BATCH) || open();
        b.items.push(...g);
        b.racks += need;
    }
    // Within a batch: colorways, then Color Lab tests, tray last.
    return batches.map((b) => {
        const ordered = [...b.items.filter((p) => p.type !== 'colorLab'), ...b.items.filter((p) => p.type === 'colorLab')];
        return b.tray ? [...ordered, b.tray] : ordered;
    });
}

export interface RestockOptions {
    capacity?: number;                                   // grams per pan (studio standard: 300)
    fill?: boolean;                                      // top pans up to capacity
    mix?: (colorway: string) => { base: string; hankSize: number; share: number }[]; // colorway's sales mix
    globalMix?: { base: string; hankSize: number; share: number }[];                  // shop-wide mix (tie-breaks)
    sizesFor?: (base: string) => number[];                                             // catalog sizes of a base
    stock?: Map<string, number>;                         // (unused; kept for callers)
    isSpecialty?: (base: string) => boolean;             // bases never used automatically
}

/**
 * Build pans for a restock: each colorway as a pair of pans (see above), its
 * skeins balanced across the pair. With `fill`, each pan's gap is topped up to
 * capacity with that colorway's best-selling base/sizes, using only spare
 * undyed stock — every real pan in the studio is a full 300g. Same-colorway
 * pans stay adjacent (the Queue groups them).
 */
export function buildRestockPans(
    picks: { colorway: string; recipeId?: number; base: string; hankSize: number; qty: number }[],
    recipes: Recipe[],
    opts: RestockOptions = {}
) {
    const capacity = opts.capacity || PAN_GRAMS;
    const special = opts.isSpecialty || (() => false);
    const pans: any[] = [];
    let topUps = 0;
    const byColor = new Map<string, typeof picks>();
    for (const p of picks) {
        if (!byColor.has(p.colorway)) byColor.set(p.colorway, []);
        byColor.get(p.colorway)!.push(p);
    }
    let seq = 0;
    byColor.forEach((items, colorway) => {
        const recipe = recipes.find((r) => r.name === colorway) || recipes.find((r) => Number(r.id) === Number(items[0].recipeId));
        // Skeins sales call for, per base/size — raised to the size's minimum
        // and capped at its maximum (SIZE_BOUNDS).
        const need = new Map<string, { base: string; hankSize: number; need: number }>();
        for (const it of items) {
            if (!it.base || !it.hankSize || it.qty <= 0 || special(it.base)) continue;
            const k = `${it.base}||${it.hankSize}`;
            const v = need.get(k) || { base: it.base, hankSize: it.hankSize, need: 0 };
            v.need += it.qty;
            need.set(k, v);
        }
        // One PAIR per color per batch: clamp each need to the pair, and if the
        // raised needs don't fit, keep the most urgent (picks arrive sorted by
        // urgency) and leave the rest for a later batch (still in Dye next).
        const pairGrams = 2 * capacity;
        need.forEach((v) => {
            const b = sizeBounds(v.hankSize);
            v.need = Math.min(b.max, Math.max(b.min, v.need), Math.floor(pairGrams / v.hankSize));
        });
        const deferred: string[] = [];
        let used = 0;
        for (const [k, v] of [...need.entries()]) {
            if (used + v.need * v.hankSize > pairGrams) { need.delete(k); deferred.push(`${v.base} ${v.hankSize}g`); continue; }
            used += v.need * v.hankSize;
        }
        const needGrams = used;

        let counts: Map<string, number> | null = null;
        let split: { key: string; base: string; hankSize: number; n: number }[][] | null = null;
        if (opts.fill) {
            // Candidates: what this color sells (default bases only), plus the
            // other catalog sizes of those bases. A color that only sells on a
            // specialty base is planned in the shop's overall default-base mix.
            const clean = (m: { base: string; hankSize: number; share: number }[]) =>
                m.filter((x) => x.hankSize > MICRO_GRAMS && x.share > 0 && !special(x.base));
            let mix = clean(opts.mix ? opts.mix(colorway) : []);
            if (!mix.length) mix = clean(opts.globalMix || []);
            mix = mix.slice(0, 4);
            const cand = new Map<string, { key: string; base: string; hankSize: number; share: number; need: number; global: number }>();
            const globalShare = new Map((opts.globalMix || []).map((m) => [`${m.base}||${m.hankSize}`, m.share]));
            const add = (base: string, hankSize: number, share: number) => {
                const key = `${base}||${hankSize}`;
                if (!cand.has(key)) cand.set(key, { key, base, hankSize, share, need: need.get(key)?.need || 0, global: globalShare.get(key) || 0 });
            };
            need.forEach((v) => add(v.base, v.hankSize, 0));
            mix.forEach((m) => { const c = cand.get(`${m.base}||${m.hankSize}`); if (c) c.share = m.share; else add(m.base, m.hankSize, m.share); });
            for (const b of new Set([...cand.values()].map((c) => c.base))) {
                for (const h of opts.sizesFor ? opts.sizesFor(b) : []) if (h > MICRO_GRAMS) add(b, h, 0);
            }
            const options = [...cand.values()];
            // Try with every kept need; if no combination fits, drop the least
            // urgent need and try again.
            let opts2 = options;
            for (;;) {
                const solved = solvePairCounts(opts2, 2, capacity);
                if (solved) { counts = solved.counts; split = solved.split; break; }
                const needed = opts2.filter((o) => o.need > 0);
                if (!needed.length) break;
                const drop = needed[needed.length - 1];
                deferred.push(`${drop.base} ${drop.hankSize}g`);
                need.delete(drop.key);
                opts2 = opts2.map((o) => (o.key === drop.key ? { ...o, need: 0 } : o));
            }
        }
        if (!split) {
            // No fill (or no combination fits the bounds): just the needed
            // skeins, balanced across a pair.
            const skeins = [...need.values()].flatMap((v) => Array.from({ length: v.need }, () => v)).sort((a, b) => b.hankSize - a.hankSize);
            const nPans = 2;
            const bins = Array.from({ length: nPans }, () => ({ grams: 0, list: new Map<string, { key: string; base: string; hankSize: number; n: number }>() }));
            for (const sk of skeins) {
                const bin = bins.filter((b) => b.grams + sk.hankSize <= capacity).sort((a, b) => a.grams - b.grams)[0] || bins.sort((a, b) => a.grams - b.grams)[0];
                const k = `${sk.base}||${sk.hankSize}`;
                const e = bin.list.get(k) || { key: k, base: sk.base, hankSize: sk.hankSize, n: 0 };
                e.n++; bin.list.set(k, e); bin.grams += sk.hankSize;
            }
            split = bins.map((b) => [...b.list.values()]);
            counts = new Map([...need.values()].map((v) => [`${v.base}||${v.hankSize}`, v.need]));
        }
        // Extra skeins beyond what sales called for (pan notes).
        const extraLeft = new Map<string, number>();
        counts!.forEach((c, k) => {
            const raw = items.filter((i) => `${i.base}||${i.hankSize}` === k).reduce((t, i) => t + i.qty, 0);
            const e = Math.max(0, c - raw);
            if (e > 0) extraLeft.set(k, e);
            topUps += e;
        });
        for (const pan of split) {
            const yarns = pan.filter((y) => y.n > 0).map((y) => ({ base: y.base, hankSize: y.hankSize, quantity: y.n }));
            const extra: string[] = [];
            for (const y of yarns) {
                const k = `${y.base}||${y.hankSize}`;
                const e = Math.min(extraLeft.get(k) || 0, y.quantity);
                if (e > 0) { extra.push(`+${e}× ${y.base} ${y.hankSize}g`); extraLeft.set(k, (extraLeft.get(k) || 0) - e); }
            }
            pans.push({
                id: Date.now() + seq++ / 1000,
                type: 'pan',
                colorway,
                recipeId: recipe?.id || '',
                recipe: recipe || null,
                capacity,
                yarns,
                totalWeight: yarns.reduce((t, y) => t + y.hankSize * y.quantity, 0),
                notes: [
                    extra.length ? `Topped up to fill the pan (extra stock): ${extra.join(', ')}` : '',
                    deferred.length ? `Not this batch (one pair per color): ${deferred.join(', ')}` : '',
                ].filter(Boolean).join(' · '),
            });
        }
    });
    return { pans, topUps };
}

/**
 * Choose skein counts for one colorway's pans: every base/size either 0 or
 * within SIZE_BOUNDS (needs already raised to the minimum are kept), totalling
 * exactly nPans × capacity, splittable into nPans exact pans, and as close as
 * possible to the color's sales mix (by grams; sizes it doesn't sell cost
 * extra, and fewer distinct base/sizes is slightly preferred).
 */
export function solvePairCounts(
    options: { key: string; base: string; hankSize: number; share: number; need: number; global?: number }[],
    nPans: number,
    capacity: number
): { counts: Map<string, number>; split: { key: string; base: string; hankSize: number; n: number }[][] } | null {
    const total = nPans * capacity;
    const opts = [...options].sort((a, b) => b.need - a.need || b.share - a.share || b.hankSize - a.hankSize);
    const values = opts.map((o) => {
        const { min, max } = sizeBounds(o.hankSize);
        const out: number[] = [];
        if (o.need > 0) { for (let c = Math.min(max, Math.max(min, o.need)); c <= max; c++) out.push(c); }
        else { out.push(0); for (let c = min; c <= max; c++) out.push(c); }
        return out;
    });
    const suffixMax: number[] = [];
    for (let i = opts.length - 1; i >= 0; i--) suffixMax[i] = (suffixMax[i + 1] || 0) + Math.max(...values[i]) * opts[i].hankSize;
    const wsum = opts.reduce((t, o) => t + o.share * o.hankSize, 0);
    const target = opts.map((o) => (wsum > 0 ? (total * o.share * o.hankSize) / wsum : 0));
    let best: { score: number; counts: number[]; split: any } | null = null;
    const c: number[] = new Array(opts.length).fill(0);
    const dfs = (i: number, sum: number) => {
        if (sum > total) return;
        if (i === opts.length) {
            if (sum !== total) return;
            let score = 0;
            opts.forEach((o, k) => {
                score += Math.abs(c[k] * o.hankSize - target[k]);
                // Sizes this color doesn't sell cost extra — double if nobody
                // buys that base/size at all (e.g. Nova Fingering 50g).
                if (o.share === 0 && o.need === 0) score += (o.global ? 0.5 : 1) * c[k] * o.hankSize;
                if (c[k] > 0) score += 5;
            });
            if (best && score >= best.score) return;
            const split = splitIntoPans(opts.map((o, k) => ({ key: o.key, base: o.base, hankSize: o.hankSize, n: c[k] })), nPans, capacity);
            if (split) best = { score, counts: [...c], split };
            return;
        }
        if (sum + suffixMax[i] < total) return;
        for (const v of values[i]) { c[i] = v; dfs(i + 1, sum + v * opts[i].hankSize); }
        c[i] = 0;
    };
    dfs(0, 0);
    if (!best) return null;
    const b = best as { score: number; counts: number[]; split: any };
    return { counts: new Map(opts.map((o, k) => [o.key, b.counts[k]])), split: b.split };
}

/** Split skeins into `nPans` pans of exactly `capacity` grams (whole combos per pan first). */
function splitIntoPans(
    items: { key: string; base: string; hankSize: number; n: number }[],
    nPans: number,
    capacity: number
): { key: string; base: string; hankSize: number; n: number }[][] | null {
    const live = items.filter((x) => x.n > 0);
    if (nPans === 1) return live.reduce((t, x) => t + x.n * x.hankSize, 0) === capacity ? [live] : null;
    const x: number[] = new Array(live.length).fill(0);
    let found: number[] | null = null;
    const dfs = (i: number, sum: number) => {
        if (found || sum > capacity) return;
        if (i === live.length) { if (sum === capacity) found = [...x]; return; }
        const n = live[i].n;
        const order = [n, 0, ...Array.from({ length: Math.max(0, n - 1) }, (_, j) => n - 1 - j).filter((v) => v > 0)];
        for (const v of order) { x[i] = v; dfs(i + 1, sum + v * live[i].hankSize); if (found) return; }
        x[i] = 0;
    };
    dfs(0, 0);
    if (!found) return null;
    const f = found as number[];
    const first = live.map((it, i) => ({ ...it, n: f[i] })).filter((it) => it.n > 0);
    const rest = splitIntoPans(live.map((it, i) => ({ ...it, n: it.n - f[i] })), nPans - 1, capacity);
    return rest ? [first, ...rest] : null;
}


// ---------- Restock plan (what the Demand tab previews and drafts) ----------

export interface RestockPlanInput {
    suggestions: Suggestion[];      // dye-next rows (all of them; no manual picking)
    removed?: Set<string>;          // colorways the user took out of the plan
    added?: string[];               // colorways the user put in (dyed purely by sales mix)
    fill: boolean;                  // top pans to 300g + fill a short last batch
    recipes: Recipe[];
    inventory: any[];
    sessions: any[];
    gradients: any[];
    ctx: DemandContext;
    plannedByBaseSize: Map<string, number>;
    inWindow: Unit[];
    units: Unit[];
    supply?: Supply;                // on hand + coming (Pipeline incl. Ready for Labels, planned sessions)
    windowDays?: number;
    labTests?: any[];               // Color Lab sketches to test (each as a pair of colorLab pans)
    forceBatch?: boolean;           // plan a batch even if nothing is running low
}

/**
 * Build the whole restock plan: every dye-next colorway as pan pairs, batched
 * 9 racks at a time with a gradient tray while dyes still need one, the short
 * last batch topped up with the next best sellers.
 */
export function planRestock(input: RestockPlanInput) {
    const { recipes, ctx } = input;
    const removed = input.removed || new Set<string>();
    // Colorways already in an upcoming session: don't start new pairs for
    // them — suggest adding the skeins to that session instead.
    const upcoming = (input.sessions || [])
        .filter((s) => !s?.archived && (s.pans || []).length)
        // Dated sessions first (earliest), undated drafts last.
        .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || '').localeCompare(String(b.date || '')));
    const sessionFor = (c: string) => upcoming.find((s) => (s.pans || []).some((p: any) => {
        const r = p.recipeId ? recipes.find((x) => String(x.id) === String(p.recipeId)) : undefined;
        return (r?.name || p.colorway) === c;
    }));
    const adjust: { colorway: string; sessionName: string; date: string; base: string; hankSize: number; qty: number; soldOut?: boolean }[] = [];
    const chosen = input.suggestions
        .filter((s) => s.colorway && !removed.has(s.colorway))
        .filter((s) => {
            const sess = sessionFor(s.colorway!);
            if (!sess) return true;
            if (isSpecialtyBase(s.base!, ctx.catalog)) return false; // never auto-plan specialty yarn
            adjust.push({ colorway: s.colorway!, sessionName: sess.name, date: sess.date, base: s.base!, hankSize: s.hankSize!, qty: s.suggest, soldOut: s.soldOut });
            return false;
        })
        // Demand on a specialty base still says "dye this color", but on the
        // default bases (qty 0 = planned purely by mix).
        .map((s) => isSpecialtyBase(s.base!, ctx.catalog)
            ? { colorway: s.colorway!, recipeId: s.recipeId, base: '', hankSize: 0, qty: 0 }
            : { colorway: s.colorway!, recipeId: s.recipeId, base: s.base!, hankSize: s.hankSize!, qty: s.suggest });
    const manual = (input.added || []).filter((c) => !removed.has(c) && !chosen.some((x) => x.colorway === c));
    const asEmpty = (c: string) => ({ colorway: c, recipeId: recipes.find((r) => r.name === c)?.id, base: '', hankSize: 0, qty: 0 });
    // Color Lab tests: a pair per sketch — one Nova Fingering pan, one Luna DK
    // pan, each 5 minis + 50s or fulls (whichever that base sells more of).
    const labByName = new Map<string, any>();
    for (const k of input.labTests || []) {
        const name = String(k.customName || k.colorId || 'Color Lab test');
        if (!chosen.some((c) => c.colorway === name) && !manual.includes(name)) labByName.set(name, k);
    }
    const labPans = [...labByName.entries()].flatMap(([name, sk]) => labTestPans(name, sk, ctx, input.units));
    const base = [...chosen, ...manual.map(asEmpty)];

    const gradientDyes = dyesNeedingGradient(input.inventory, input.gradients, input.sessions);
    const trayYarn = gradientTrayYarn(input.sessions, ctx);
    // Spare undyed yarn (for odd gaps) = Inventory − minimums − planned − picks − trays.
    const free = undyedStock(input.inventory, ctx, true);
    const take = (k: string, q: number) => free.set(k, (free.get(k) || 0) - q);
    input.plannedByBaseSize.forEach((q, k) => take(k, q));
    chosen.forEach((c) => take(`${c.base}||${c.hankSize}`, c.qty));
    take(`${trayYarn.base}||${trayYarn.hankSize}`, Math.min(gradientDyes.length, Math.ceil(new Set(base.map((c) => c.colorway)).size / 8)) * 10);

    const build = (list: typeof base) => {
        const built = buildRestockPans(list, recipes, {
            capacity: PAN_GRAMS,
            fill: input.fill,
            mix: (cw) => salesMix(cw, input.inWindow, input.units),
            globalMix: salesMix('', input.inWindow, input.units),
            sizesFor: (b) => (ctx.catalog.find((x) => x.myName === b)?.sizes || []).map((z) => Number(z.amount)).filter((n) => n > 0),
            isSpecialty: (b) => isSpecialtyBase(b, ctx.catalog),
            stock: free,
        });
        const pans = [...built.pans, ...labPans];
        return { ...built, pans, batches: planBatches(pans, gradientDyes, trayYarn) };
    };
    let result = build(base);
    let extras: string[] = [];
    if (input.fill && (result.batches.length || input.forceBatch)) {
        // Free racks across ALL batches (an empty forced batch still gets its tray).
        const isPan = (p: any) => p.type === 'pan' || p.type === 'colorLab';
        const usedIn = (b: any[]) => Math.ceil(b.filter(isPan).length / 2) + b.filter((p) => p.type === 'gradientTray').length;
        const freeRacks = result.batches.length
            ? result.batches.reduce((t, b) => t + RACKS_PER_BATCH - usedIn(b), 0)
            : RACKS_PER_BATCH - (gradientDyes.length ? 1 : 0);
        if (freeRacks > 0) {
            // Skip colorways already in this plan or in an upcoming session.
            const taken = new Set([...base.map((c) => c.colorway), ...labByName.keys()]);
            for (const sess of input.sessions || []) {
                if (sess?.archived) continue;
                for (const p of sess.pans || []) {
                    const r = p.recipeId ? recipes.find((x) => String(x.id) === String(p.recipeId)) : undefined;
                    if (r?.name || p.colorway) taken.add(r?.name || p.colorway);
                }
            }
            // Best sellers with the FEWEST weeks of stock first — skeins on
            // hand, in the Pipeline (incl. Ready for Labels) or planned all
            // count, so a color waiting on labels goes to the back of the line.
            const weeks = Math.max(1, (input.windowDays || 90) / 7);
            const sold = new Map(byColorway(input.inWindow).map((a) => [a.colorway!, a.units]));
            const have = new Map<string, number>();
            const addHave = (m?: Map<string, number>) => m?.forEach((q, k) => {
                const cw = k.split('||')[0];
                have.set(cw, (have.get(cw) || 0) + q);
            });
            addHave(input.supply?.onHand);
            addHave(input.supply?.coming);
            const cover = (c: string) => {
                const perWeek = (sold.get(c) || 0) / weeks;
                return perWeek > 0 ? (have.get(c) || 0) / perWeek : Infinity;
            };
            const allTime = new Map(byColorway(input.units).map((a) => [a.colorway!, a.units]));
            extras = [...new Set([...byColorway(input.inWindow), ...byColorway(input.units)].map((a) => a.colorway!))]
                .filter((c) => c && !taken.has(c) && !removed.has(c) && recipes.some((r) => r.name === c))
                .sort((a, b) => cover(a) - cover(b) || (sold.get(b) || 0) - (sold.get(a) || 0) || (allTime.get(b) || 0) - (allTime.get(a) || 0))
                .slice(0, freeRacks);
            if (extras.length) result = build([...base, ...extras.map(asEmpty)]);
        }
    }
    return { ...result, extras, manual, gradientDyes, labTests: [...labByName.keys()], adjust };
}


// ---------- Stock-up horizon ----------

/**
 * How often the studio dyes: batches per month from the average gap between
 * the last year's session dates (excluding planned/unfinished ones).
 * Falls back to 1.5/month with too little history.
 */
export function dyeCadence(sessions: any[], today: string): number {
    const since = daysAgo(today, 365);
    const dates = [...new Set((sessions || []).filter((s) => s?.archived && s.date && s.date >= since).map((s) => String(s.date).slice(0, 10)))].sort();
    if (dates.length < 3) return 1.5;
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000);
    const avg = gaps.reduce((t, g) => t + g, 0) / gaps.length;
    return Math.round((30.4 / Math.max(1, avg)) * 10) / 10;
}

/**
 * Undyed yarn a typical future batch uses: its colorway pans (8 pairs with a
 * gradient tray, else 9) × 300g split by the shop's overall sales mix, plus the
 * tray's 10 micro skeins. Rounded up per base/size.
 */
export function projectedBatchYarn(count: number, withTrays: number, mix: { base: string; hankSize: number; share: number }[], trayYarn: { base: string; hankSize: number }) {
    const out = new Map<string, number>();
    if (count <= 0) return out;
    const sold = mix.filter((m) => m.hankSize > MICRO_GRAMS && m.share > 0);
    const avgGrams = sold.reduce((t, m) => t + m.share * m.hankSize, 0);
    for (let b = 0; b < count; b++) {
        const tray = b < withTrays;
        const grams = (tray ? RACKS_PER_BATCH - 1 : RACKS_PER_BATCH) * 2 * PAN_GRAMS;
        if (avgGrams > 0) {
            const skeins = grams / avgGrams;
            for (const m of sold) {
                const k = `${m.base}||${m.hankSize}`;
                out.set(k, (out.get(k) || 0) + m.share * skeins);
            }
        }
        if (tray) {
            const k = `${trayYarn.base}||${trayYarn.hankSize}`;
            out.set(k, (out.get(k) || 0) + 10);
        }
    }
    out.forEach((v, k) => out.set(k, Math.ceil(v)));
    return out;
}

// ---------- Color Lab tests ----------

/**
 * Color Lab sketches worth testing, best first: not archived, not already a
 * recipe, never dyed in a session — then ones already tested (oldest first).
 */
export function labTestCandidates(sketches: any[], sessions: any[], recipes: Recipe[]) {
    const tested = new Set<string>();
    (sessions || []).forEach((s) => (s.pans || []).forEach((p: any) => p.type === 'colorLab' && p.colorSketchId && tested.add(String(p.colorSketchId))));
    const recipeNames = new Set(recipes.map((r) => normText(r.name)));
    return (sketches || [])
        .filter((k) => !k.archived && !recipeNames.has(normText(k.customName || k.colorId)))
        .map((k) => ({ sketch: k, name: String(k.customName || k.colorId || 'Color Lab test'), tested: tested.has(String(k.id)) }))
        .sort((a, b) => Number(a.tested) - Number(b.tested) || Number(a.sketch.id) - Number(b.sketch.id));
}


/**
 * The studio's Color Lab test pair (fixed recipe): each pan mixes both test
 * bases — minis of one, the larger size of the other — so every test shows the
 * color on Nova Fingering AND Luna DK in both pans.
 *   Pan 1: 5 × Nova Fingering 20g + 4 × Luna DK 50g
 *   Pan 2: 5 × Luna DK 20g + 2 × Nova Fingering 100g
 */
export const LAB_TEST_PANS: { base: string; hankSize: number; quantity: number }[][] = [
    [{ base: 'Nova Fingering', hankSize: 20, quantity: 5 }, { base: 'Luna DK', hankSize: 50, quantity: 4 }],
    [{ base: 'Luna DK', hankSize: 20, quantity: 5 }, { base: 'Nova Fingering', hankSize: 100, quantity: 2 }],
];

/** A Color Lab test pair for a sketch (see LAB_TEST_PANS). */
export function labTestPans(name: string, sketch: any, ctx: DemandContext, _units?: Unit[]) {
    // Use the catalog's spelling of the base names when present.
    const baseName = (b: string) => ctx.catalog.find((x) => normText(x.myName) === normText(b))?.myName || b;
    return LAB_TEST_PANS.map((recipe, i) => {
        const yarns = recipe.map((y) => ({ ...y, base: baseName(y.base) }));
        return {
            id: Date.now() + Math.random(),
            type: 'colorLab',
            colorway: name,
            recipeId: '',
            recipe: null,
            colorSketchId: String(sketch.id),
            colorSketch: sketch,
            capacity: PAN_GRAMS,
            yarns,
            totalWeight: yarns.reduce((t, y) => t + y.hankSize * y.quantity, 0),
            notes: `Color Lab test (pan ${i + 1} of 2)`,
        };
    });
}
