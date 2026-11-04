// What's actually on the shelf: per colorway + base + size, from the same
// supply picture Demand plans with (Shopify stock upload, or the estimate of
// stocked skeins minus sales since). Replaces the old "projected" Stock view,
// which summed every batch ever stocked and never subtracted sales.

import type { DemandSummary } from './demandSummary';
import { byBase, byCombo, comboKey, resolveName, windowUnits, SOLD_OUT_MIN_YEAR_UNITS, type Unit } from './demand';
import { isOwnBrand, type InventorySnapshot } from './shopify';

export interface OnHandRow {
    key: string;
    colorway: string;
    base: string;       // '' when unknown
    hankSize: number;   // 0 when unknown
    onHand: number;
    coming: number;     // in the Pipeline or in planned sessions
    perWeek: number;    // sales pace over the Demand window
    weeksLeft: number;  // on hand only; Infinity when it doesn't sell
    price: number;      // per skein, what it actually sold for (0 = unknown)
    value: number;      // onHand × price
    cost: number;       // onHand × cost per skein
    soldOut: boolean;   // none on hand, but sold over the past year
    lastSale?: string;
}

/** `snapshot` is the Shopify stock upload (settings.shopifyInventory), if any. */
export function onHandSummary(D: DemandSummary, snapshot?: InventorySnapshot | null) {
    const { supply, units, today, windowDays, getCost } = D;
    const weeks = Math.max(1, windowDays / 7);
    const pace = new Map(byCombo(D.inWindow).map((a) => [a.key, a.units / weeks]));

    // Price per skein from the past year of real sales: exact combo first,
    // then the same base + size across colorways (prices follow the base).
    // Kit units carry the kit's price, so they don't count toward it.
    const year = windowUnits(units, today, 365).filter((u) => !u.viaKit);
    const avg = (aggs: { key: string; units: number; revenue: number }[]) =>
        new Map(aggs.filter((a) => a.units > 0 && a.revenue > 0).map((a) => [a.key, a.revenue / a.units]));
    const comboPrice = avg(byCombo(year));
    const basePrice = avg(byBase(year));
    const yearUnits = new Map(byCombo(windowUnits(units, today, 365)).map((a) => [a.key, a.units]));
    const lastSale = new Map<string, string>();
    for (const u of units) {
        const k = comboKey(u.colorway, u.base, u.hankSize);
        if (!lastSale.has(k) || u.date > lastSale.get(k)!) lastSale.set(k, u.date);
    }

    const keys = new Set([...supply.onHand.keys(), ...supply.coming.keys()]);
    // Sold-out rows: nothing left, but it sold over the past year (and is still
    // listed on Shopify, when a stock upload says what's listed).
    yearUnits.forEach((n, k) => {
        if (n < SOLD_OUT_MIN_YEAR_UNITS) return;
        if (supply.source === 'shopify' && supply.listed && !supply.listed.has(k)) return;
        keys.add(k);
    });

    const rows: OnHandRow[] = [...keys].map((key) => {
        const [colorway, base, h] = key.split('||');
        const hankSize = Number(h) || 0;
        const onHand = supply.onHand.get(key) || 0;
        const perWeek = pace.get(key) || 0;
        const price = comboPrice.get(key) ?? basePrice.get(`${base}||${hankSize}`) ?? 0;
        const unit = { colorway, base, hankSize } as Unit;
        return {
            key, colorway, base, hankSize, onHand,
            coming: supply.coming.get(key) || 0,
            perWeek,
            weeksLeft: perWeek > 0 ? onHand / perWeek : Infinity,
            price,
            value: onHand * price,
            cost: onHand * (getCost(unit) || 0),
            soldOut: onHand <= 0 && (yearUnits.get(key) || 0) >= SOLD_OUT_MIN_YEAR_UNITS,
            lastSale: lastSale.get(key),
        };
    }).filter((r) => r.colorway && (r.onHand > 0 || r.coming > 0 || r.soldOut));

    // Stock-upload listings that couldn't be matched to a colorway, so they're
    // missing from the counts (Studio Improv-style "ignore" items and kits are
    // left out on purpose and aren't listed here).
    const unmatched: { name: string; available: number }[] = [];
    if (supply.source === 'shopify') {
        for (const row of snapshot?.rows || []) {
            if (row.available <= 0 || !isOwnBrand(row.vendor, row.name)) continue;
            const r = resolveName(row.name, D.ctx);
            if (r.kind === 'unknown' || (r.kind === 'colorway' && !r.colorway)) unmatched.push({ name: row.name, available: row.available });
        }
    }

    const inStock = rows.filter((r) => r.onHand > 0);
    return {
        rows,
        source: supply.source,
        snapshotDate: supply.source === 'shopify' ? snapshot?.importedAt : undefined,
        unmatched,
        hasSales: units.length > 0,
        skeins: inStock.reduce((s, r) => s + r.onHand, 0),
        value: inStock.reduce((s, r) => s + r.value, 0),
        cost: inStock.reduce((s, r) => s + r.cost, 0),
        unpriced: inStock.filter((r) => !r.price).reduce((s, r) => s + r.onHand, 0),
        colorways: new Set(inStock.map((r) => r.colorway)).size,
        soldOut: rows.filter((r) => r.soldOut).length,
        // Sells out within 4 weeks at the current pace.
        lowSoon: inStock.filter((r) => r.weeksLeft < 4).length,
    };
}

export type OnHandSummary = ReturnType<typeof onHandSummary>;
