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
        for (const row of snapshot.rows) {
            if (!isOwnBrand(row.vendor, row.name)) continue;
            const r = resolveName(row.name, ctx);
            if (r.kind !== 'colorway' || !r.colorway) continue; // kits are made from stock
            const k = comboKey(r.colorway, r.base || '', r.hankSize || 0);
            onHand.set(k, (onHand.get(k) || 0) + row.available);
        }
        return { onHand, coming, source: 'shopify' };
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
    ctx: DemandContext
): YarnOrderRow[] {
    const need = new Map<string, { dye: number; planned: number }>();
    const bump = (k: string, f: 'dye' | 'planned', q: number) => {
        const v = need.get(k) || { dye: 0, planned: 0 };
        v[f] += q; need.set(k, v);
    };
    for (const s of suggestions) if (s.base && s.hankSize) bump(`${s.base}||${s.hankSize}`, 'dye', s.suggest);
    plannedByBaseSize.forEach((q, k) => bump(k, 'planned', q));

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
        const short = Math.max(0, Math.ceil(v.dye + v.planned + keep - have));
        const packs = Math.ceil(short / packSize);
        rows.push({
            base, hankSize, forDyeNext: v.dye, forPlanned: v.planned, keep, have, short,
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
}

export function dyeNext(windowAgg: Agg[], windowDays: number, supply: Supply, targetWeeks: number): Suggestion[] {
    const weeks = Math.max(1, windowDays / 7);
    return windowAgg
        .filter((a) => a.colorway && a.base && a.hankSize)
        .map((a) => {
            const perWeek = a.units / weeks;
            const onHand = supply.onHand.get(a.key) || 0;
            const coming = supply.coming.get(a.key) || 0;
            const have = onHand + coming;
            const weeksLeft = perWeek > 0 ? have / perWeek : Infinity;
            const suggest = Math.max(0, Math.ceil(perWeek * targetWeeks - have));
            return { ...a, perWeek, onHand, coming, weeksLeft, suggest };
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
export function planBatches(pans: any[], gradientDyes: string[], trayYarn: { base: string; hankSize: number }) {
    const groups: any[][] = [];
    for (const p of pans) {
        const g = groups[groups.length - 1];
        if (g && g[0].colorway === p.colorway) g.push(p); else groups.push([p]);
    }
    const dyes = [...gradientDyes];
    const batches: any[][] = [];
    let cur: any[] = [];
    let racks = 0;
    let trayAdded = false;
    const open = () => {
        cur = []; racks = 0; trayAdded = false;
        if (dyes.length) {
            cur.push({
                id: Date.now() + batches.length / 100 + 0.5,
                type: 'gradientTray',
                gradientDye: dyes.shift(),
                gradientYarnBase: trayYarn.base,
                gradientHankSize: trayYarn.hankSize,
                depths: GRADIENT_DEPTHS,
            });
            racks = 1; trayAdded = true;
        }
        batches.push(cur);
    };
    for (const g of groups) {
        const need = Math.ceil(g.length / 2);
        if (!batches.length || racks + need > RACKS_PER_BATCH) open();
        // Colorways first, tray last (it's the "extra" rack in the oven).
        cur.splice(trayAdded ? cur.length - 1 : cur.length, 0, ...g);
        racks += need;
    }
    return batches;
}

export interface RestockOptions {
    capacity?: number;                                   // grams per pan (studio standard: 300)
    fill?: boolean;                                      // top pans up to capacity
    mix?: (colorway: string) => { base: string; hankSize: number; share: number }[]; // colorway's sales mix
    stock?: Map<string, number>;                         // spare undyed skeins (only for odd gaps no sold size fits)
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
    const capacity = opts.capacity || 300;
    const stock = new Map(opts.stock || []);
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
        type Y = { base: string; hankSize: number; quantity: number };
        const bins: { yarns: Y[]; grams: number; extra: Y[] }[] = [];
        const put = (list: Y[], base: string, hankSize: number) => {
            const y = list.find((x) => x.base === base && x.hankSize === hankSize);
            if (y) y.quantity++; else list.push({ base, hankSize, quantity: 1 });
        };
        // Every colorway is dyed as a PAIR of pans (two pairs if it needs more
        // than 2 × capacity). Spread skeins largest-first into the lightest pan
        // so the pair is balanced.
        const skeins = items.flatMap((it) => Array.from({ length: it.qty }, () => ({ base: it.base, hankSize: it.hankSize })))
            .sort((a, b) => b.hankSize - a.hankSize);
        const grams = skeins.reduce((t, k) => t + k.hankSize, 0);
        const nPans = 2 * Math.max(1, Math.ceil(grams / (2 * capacity)));
        for (let i = 0; i < nPans; i++) bins.push({ yarns: [], grams: 0, extra: [] });
        for (const sk of skeins) {
            const fits = bins.filter((b) => b.grams + sk.hankSize <= capacity);
            let bin = (fits.length ? fits : []).sort((a, b) => a.grams - b.grams)[0];
            if (!bin) { bin = { yarns: [], grams: 0, extra: [] }; bins.push(bin); }
            put(bin.yarns, sk.base, sk.hankSize);
            bin.grams += sk.hankSize;
        }
        if (opts.fill) {
            // Top up to match how this colorway sells: each added skein goes to
            // the base/size furthest below its sales share (largest-remainder
            // apportionment across the whole pair). Yarn not on hand shows up
            // on Yarn to order once the draft is saved.
            const mix = (opts.mix ? opts.mix(colorway) : []).filter((m) => m.hankSize > 0 && m.share > 0);
            const counts = new Map<string, number>();
            bins.forEach((b) => b.yarns.forEach((y) => counts.set(`${y.base}||${y.hankSize}`, (counts.get(`${y.base}||${y.hankSize}`) || 0) + y.quantity)));
            const total = () => [...counts.values()].reduce((t, n) => t + n, 0);
            const addTo = (bin: (typeof bins)[number], base: string, hankSize: number) => {
                put(bin.yarns, base, hankSize);
                put(bin.extra, base, hankSize);
                bin.grams += hankSize;
                const k = `${base}||${hankSize}`;
                counts.set(k, (counts.get(k) || 0) + 1);
                if (stock.has(k)) stock.set(k, (stock.get(k) || 0) - 1);
                topUps++;
            };
            for (;;) {
                const bin = bins.filter((b) => b.grams < capacity).sort((a, b) => a.grams - b.grams)[0];
                if (!bin) break;
                const gap = capacity - bin.grams;
                const n = total() + 1;
                // Look ahead: only pick a size that leaves a gap the colorway's
                // sold sizes can still fill exactly (no stray micro skeins).
                const sizes = [...new Set(mix.map((m) => m.hankSize))];
                const exact = new Array(gap + 1).fill(false);
                exact[0] = true;
                for (let g = 1; g <= gap; g++) exact[g] = sizes.some((z) => z <= g && exact[g - z]);
                const next = mix
                    .filter((m) => m.hankSize <= gap && exact[gap - m.hankSize])
                    .map((m) => ({ ...m, deficit: m.share * n - (counts.get(`${m.base}||${m.hankSize}`) || 0) }))
                    .sort((a, b) => b.deficit - a.deficit || b.hankSize - a.hankSize)[0];
                if (next) { addTo(bin, next.base, next.hankSize); continue; }
                // Gap no sold size fits: any spare undyed (non-micro) size that
                // fits — a base already in the pan first, then the largest.
                const inPan = new Set(bin.yarns.map((y) => y.base));
                const spare = [...stock.entries()]
                    .map(([k, q]) => { const [base, h] = k.split('||'); return { base, hankSize: Number(h), q }; })
                    .filter((o) => o.q > 0 && o.hankSize > MICRO_GRAMS && o.hankSize <= gap)
                    .sort((a, b) => Number(inPan.has(b.base)) - Number(inPan.has(a.base)) || b.hankSize - a.hankSize)[0];
                if (!spare) { bin.grams = capacity; break; } // can't fill exactly; leave it
                addTo(bin, spare.base, spare.hankSize);
            }
            bins.forEach((b) => { b.grams = b.yarns.reduce((t, y) => t + y.hankSize * y.quantity, 0); });
        }
        for (const bin of bins) {
            pans.push({
                id: Date.now() + seq++ / 1000,
                type: 'pan',
                colorway,
                recipeId: recipe?.id || '',
                recipe: recipe || null,
                capacity,
                yarns: bin.yarns,
                totalWeight: bin.grams,
                notes: bin.extra.length
                    ? `Topped up to fill the pan (extra stock): ${bin.extra.map((y) => `+${y.quantity}× ${y.base} ${y.hankSize}g`).join(', ')}`
                    : '',
            });
        }
    });
    return { pans, topUps };
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
}

/**
 * Build the whole restock plan: every dye-next colorway as pan pairs, batched
 * 9 racks at a time with a gradient tray while dyes still need one, the short
 * last batch topped up with the next best sellers.
 */
export function planRestock(input: RestockPlanInput) {
    const { recipes, ctx } = input;
    const removed = input.removed || new Set<string>();
    const chosen = input.suggestions
        .filter((s) => s.colorway && !removed.has(s.colorway))
        .map((s) => ({ colorway: s.colorway!, recipeId: s.recipeId, base: s.base!, hankSize: s.hankSize!, qty: s.suggest }));
    const manual = (input.added || []).filter((c) => !removed.has(c) && !chosen.some((x) => x.colorway === c));
    const asEmpty = (c: string) => ({ colorway: c, recipeId: recipes.find((r) => r.name === c)?.id, base: '', hankSize: 0, qty: 0 });
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
            stock: free,
        });
        return { ...built, batches: planBatches(built.pans, gradientDyes, trayYarn) };
    };
    let result = build(base);
    let extras: string[] = [];
    if (input.fill && result.batches.length) {
        const last = result.batches[result.batches.length - 1];
        const used = last.filter((p) => p.type === 'pan').length / 2 + last.filter((p) => p.type === 'gradientTray').length;
        const freeRacks = RACKS_PER_BATCH - Math.ceil(used);
        if (freeRacks > 0) {
            // Skip colorways already in this plan or in an upcoming session.
            const taken = new Set(base.map((c) => c.colorway));
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
    return { ...result, extras, manual, gradientDyes };
}
