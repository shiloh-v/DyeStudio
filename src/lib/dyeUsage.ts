// Grams of dye powder a session's pans use. Shared by finishing a session (which
// deducts it from inventory) and the pull list (which checks it against what's
// on the shelf beforehand), so the two always agree.

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

/** Grams of each dye one pan uses, keyed by the dye name (lowercased) as the pan/recipe writes it. */
export function dyeGramsForPan(pan: any, recipe: any, names?: Map<string, string>): Record<string, number> {
    const out: Record<string, number> = {};
    const add = (name: any, g: number) => {
        if (!name || !(g > 0)) return;
        const k = String(name).toLowerCase().trim();
        if (names && !names.has(k)) names.set(k, String(name).trim().replace(/\s*\((base|speckle)\)$/i, ''));
        out[k] = (out[k] || 0) + g;
    };
    if (pan.type === 'gradientTray') {
        const totalGramsYarn = (parseFloat(pan.gradientHankSize) || 0) * 10;
        const totalDepth = (pan.depths || []).reduce((s: number, d: any) => s + (parseFloat(d) || 0), 0);
        add(pan.gradientDye, (totalGramsYarn * totalDepth) / 100);
    } else if (pan.type === 'dyeSquareTray') {
        const totalMlEach = [1.25, 2.5, 5, 7.5, 10].reduce((s, a) => s + a, 0) * 5;
        add(pan.squareColorA, totalMlEach / 100);
        add(pan.squareColorB, totalMlEach / 100);
    } else {
        // Recipe pan, or a Color Lab pan whose dyes live in its color sketch.
        const colorSketch = pan.type === 'colorLab' ? pan.colorSketch : null;
        if (recipe || colorSketch) {
            const totalWeight = pan.totalWeight || (pan.yarns || []).reduce((s: number, y: any) =>
                s + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0);
            const scaled: any[] = scaleIngredients(recipe, totalWeight, colorSketch);
            const isVar = recipe ? recipe.colorType === 'variegated' : colorSketch?.type === 'variegated';
            if (isVar) {
                scaled.forEach((sol) => (sol.dyes || []).forEach((d: any) => add(d.name, gramsFromAmount(d.scaledAmount, d.unit || 'g'))));
            } else {
                scaled.forEach((ing) => add(ing.name, gramsFromAmount(ing.scaledAmount, ing.unit || 'g')));
            }
        }
    }
    return out;
}

export interface DyeNeed {
    name: string;
    grams: number;          // needed for this session
    onHand: number | null;  // grams on the shelf; null when the dye isn't in inventory
    short: number;          // grams missing (0 when there's enough)
    lowAfter: boolean;      // enough, but under the low-stock line once used
    pans: number[];
}

/** Total dye a session needs, per inventory dye, checked against what's on hand. */
export function sessionDyeNeeds(session: any, recipes: any[], inventory: any[]): DyeNeed[] {
    const map = new Map<string, { item: any; name: string; grams: number; pans: number[] }>();
    const names = new Map<string, string>();
    (session?.pans || []).forEach((pan: any, idx: number) => {
        Object.entries(dyeGramsForPan(pan, liveRecipe(pan, recipes), names)).forEach(([nameLc, grams]) => {
            const item = findDyeItem(inventory, nameLc);
            const shown = names.get(nameLc) || nameLc;
            const key = item ? `id:${item.id ?? item.name}` : `name:${shown.toLowerCase()}`;
            const e = map.get(key) || { item, name: item?.name || shown, grams: 0, pans: [] };
            e.grams += grams;
            if (!e.pans.includes(idx + 1)) e.pans.push(idx + 1);
            map.set(key, e);
        });
    });
    return [...map.values()].map(({ item, name, grams, pans }) => {
        const onHand = item ? toGrams(item.quantity, item.unit || 'g') : null;
        const short = onHand == null ? 0 : Math.max(0, grams - onHand);
        return { name, grams, onHand, short, lowAfter: onHand != null && !short && onHand - grams < DYE_LOW_STOCK_GRAMS, pans };
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
