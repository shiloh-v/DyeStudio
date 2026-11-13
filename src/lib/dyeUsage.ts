// How much dye a session's pans use. Shared by finishing a session (which
// deducts the powder from inventory) and the pull list (which shows the stock
// solution to pull and checks the powder against the shelf), so they agree.
//
// Recipes measure dye as 1% stock solution (ml) or as dry powder (g / tsp /
// tbsp). 100 ml of solution holds 1 g of powder.

import { scaleIngredients } from './dyeScale';
import { liveRecipe } from './recipeMatch';
import { findDyeItem } from './dyeMatch';
import { toGrams, DYE_LOW_STOCK_GRAMS } from './lowStock';

// Recipe amount → grams of dye powder (stock solution: 1% → ml ÷ 100).
export function gramsFromAmount(amount: any, unit: string): number {
    const a = parseFloat(String(amount)) || 0;
    if (unit === 'ml') return a / 100;
    if (unit === 'tsp') return a * 5;
    if (unit === 'tbsp') return a * 15;
    return a;
}

export interface DyeAmount { name: string; ml: number; dryG: number }

/** Each dye one pan uses, keyed by lowercased name: ml of stock solution and grams of dry powder. */
export function dyeAmountsForPan(pan: any, recipe: any): Map<string, DyeAmount> {
    const out = new Map<string, DyeAmount>();
    const add = (name: any, amount: any, unit: string) => {
        const a = parseFloat(String(amount)) || 0;
        if (!name || !(a > 0)) return;
        const shown = String(name).trim().replace(/\s*\((base|speckle)\)$/i, '');
        const k = String(name).toLowerCase().trim();
        const e = out.get(k) || { name: shown, ml: 0, dryG: 0 };
        if (unit === 'ml') e.ml += a; else e.dryG += gramsFromAmount(a, unit);
        out.set(k, e);
    };
    if (pan.type === 'gradientTray') {
        const totalGramsYarn = (parseFloat(pan.gradientHankSize) || 0) * 10;
        const totalDepth = (pan.depths || []).reduce((s: number, d: any) => s + (parseFloat(d) || 0), 0);
        add(pan.gradientDye, totalGramsYarn * totalDepth, 'ml'); // (yarn × depth% / 100) g of powder = ×100 ml
    } else if (pan.type === 'dyeSquareTray') {
        const totalMlEach = [1.25, 2.5, 5, 7.5, 10].reduce((s, a) => s + a, 0) * 5;
        add(pan.squareColorA, totalMlEach, 'ml');
        add(pan.squareColorB, totalMlEach, 'ml');
    } else {
        // Recipe pan, or a Color Lab pan whose dyes live in its color sketch.
        const colorSketch = pan.type === 'colorLab' ? pan.colorSketch : null;
        if (recipe || colorSketch) {
            const totalWeight = pan.totalWeight || (pan.yarns || []).reduce((s: number, y: any) =>
                s + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0);
            const scaled: any[] = scaleIngredients(recipe, totalWeight, colorSketch);
            const isVar = recipe ? recipe.colorType === 'variegated' : colorSketch?.type === 'variegated';
            if (isVar) scaled.forEach((sol) => (sol.dyes || []).forEach((d: any) => add(d.name, d.scaledAmount, d.unit || 'g')));
            else scaled.forEach((ing) => add(ing.name, ing.scaledAmount, ing.unit || 'g'));
        }
    }
    return out;
}

/** Grams of powder each dye in one pan uses, keyed by lowercased name. */
export function dyeGramsForPan(pan: any, recipe: any): Record<string, number> {
    const out: Record<string, number> = {};
    dyeAmountsForPan(pan, recipe).forEach((a, k) => { out[k] = a.ml / 100 + a.dryG; });
    return out;
}

/**
 * Inventory is reserved chronologically: does `s` get its supplies before
 * `target`? Earlier date first; same date → earlier id (creation) first;
 * undated drafts go last. Finished (archived) sessions reserve nothing.
 */
export function reservesBefore(s: any, target: { date?: any; id?: any }): boolean {
    if (s.archived) return false;
    const ts = (d: any) => { if (!d) return Number.MAX_SAFE_INTEGER; const t = new Date(d).getTime(); return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER; };
    const st = ts(s.date), tt = ts(target?.date);
    if (st !== tt) return st < tt;
    return Number(s.id) < Number(target?.id ?? Number.MAX_SAFE_INTEGER);
}

export interface DyeNeed {
    name: string;
    ml: number;             // stock solution to pull
    dryG: number;           // dry powder measured straight from the jar
    grams: number;          // total powder this session uses (ml ÷ 100 + dry)
    onHand: number | null;  // grams on the shelf; null when the dye isn't in inventory
    reserved: number;       // grams earlier planned sessions will use first
    available: number;      // onHand − reserved (can go negative)
    short: number;          // grams missing for this session (0 when there's enough)
    lowAfter: boolean;      // enough, but under the low-stock line once used
    pans: number[];
}

const itemKey = (item: any, nameLc: string) => item ? `id:${item.id ?? item.name}` : `name:${nameLc}`;

/** Dye a session needs, per dye, checked against what's on hand after earlier sessions take theirs. */
export function sessionDyeNeeds(session: any, recipes: any[], inventory: any[], sessions: any[] = []): DyeNeed[] {
    const map = new Map<string, { item: any; name: string; ml: number; dryG: number; pans: number[] }>();
    (session?.pans || []).forEach((pan: any, idx: number) => {
        dyeAmountsForPan(pan, liveRecipe(pan, recipes)).forEach((a, nameLc) => {
            const item = findDyeItem(inventory, nameLc);
            const key = itemKey(item, a.name.toLowerCase());
            const e = map.get(key) || { item, name: item?.name || a.name, ml: 0, dryG: 0, pans: [] };
            e.ml += a.ml; e.dryG += a.dryG;
            if (!e.pans.includes(idx + 1)) e.pans.push(idx + 1);
            map.set(key, e);
        });
    });

    const reserved = new Map<string, number>();
    sessions.forEach((s) => {
        if (s === session || String(s.id) === String(session?.id) || !reservesBefore(s, session)) return;
        (s.pans || []).forEach((pan: any) => Object.entries(dyeGramsForPan(pan, liveRecipe(pan, recipes))).forEach(([nameLc, g]) => {
            const key = itemKey(findDyeItem(inventory, nameLc), nameLc);
            reserved.set(key, (reserved.get(key) || 0) + g);
        }));
    });

    return [...map.entries()].map(([key, { item, name, ml, dryG, pans }]) => {
        const grams = ml / 100 + dryG;
        const onHand = item ? toGrams(item.quantity, item.unit || 'g') : null;
        const r = reserved.get(key) || 0;
        const available = (onHand ?? 0) - r;
        const short = onHand == null ? 0 : Math.max(0, grams - Math.max(0, available));
        return { name, ml, dryG, grams, onHand, reserved: r, available, short, pans,
            lowAfter: onHand != null && !short && available - grams < DYE_LOW_STOCK_GRAMS };
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
