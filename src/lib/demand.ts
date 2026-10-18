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
    forDyeNext: number;   // skeins the dye-next suggestions need
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
 * Build pans for a restock session: one colorway per pan, its skeins packed
 * up to the pan capacity (grams), overflow spilling into another pan.
 */
export function buildRestockPans(picks: { colorway: string; recipeId?: number; base: string; hankSize: number; qty: number }[], recipes: Recipe[], capacity = 300) {
    const pans: any[] = [];
    const byColor = new Map<string, typeof picks>();
    for (const p of picks) {
        if (!byColor.has(p.colorway)) byColor.set(p.colorway, []);
        byColor.get(p.colorway)!.push(p);
    }
    let seq = 0;
    byColor.forEach((items, colorway) => {
        const recipe = recipes.find((r) => r.name === colorway) || recipes.find((r) => Number(r.id) === Number(items[0].recipeId));
        let yarns: { base: string; hankSize: number; quantity: number }[] = [];
        let grams = 0;
        const flush = () => {
            if (!yarns.length) return;
            pans.push({
                id: Date.now() + seq++ / 1000,
                type: 'pan',
                colorway,
                recipeId: recipe?.id || '',
                recipe: recipe || null,
                capacity,
                yarns,
                totalWeight: grams,
            });
            yarns = [];
            grams = 0;
        };
        for (const it of items) {
            for (let i = 0; i < it.qty; i++) {
                if (grams + it.hankSize > capacity && grams > 0) flush();
                const last = yarns[yarns.length - 1];
                if (last && last.base === it.base && last.hankSize === it.hankSize) last.quantity++;
                else yarns.push({ base: it.base, hankSize: it.hankSize, quantity: 1 });
                grams += it.hankSize;
            }
        }
        flush();
    });
    return pans;
}
