// Estimate a recipe's dye cost from inventory dye prices (cost-per-gram).
// Mirrors the gram-conversion logic used when sessions become batches, so the
// recipe estimate and the batch total agree.

import { findDyeItem } from './dyeMatch';

// Cost per gram of an inventory dye item. A dye's `cost` is ALWAYS stored as
// cost-per-gram (purchase price ÷ ounces ÷ 28.35), independent of the on-hand
// quantity unit (which is ounces) — so it's used directly, no conversion.
function costPerGram(item: any): number {
    if (!item || !item.cost) return 0;
    const c = parseFloat(String(item.cost));
    if (isNaN(c)) return 0;
    return c;
}

// Grams of dye powder from a recipe amount + unit. Stock solution: 1% → 1 g per
// 100 ml, so ml ÷ 100. tsp/tbsp are rough powder measures.
function gramsOfDye(amount: any, unit: string): number {
    const a = parseFloat(String(amount)) || 0;
    if (unit === 'ml') return a / 100;
    if (unit === 'tsp') return a * 5;
    if (unit === 'tbsp') return a * 15;
    return a; // grams
}

/**
 * Estimated dye cost to make one batch of this recipe (at the recipe's own
 * yarn weight). Sums tonal/speckled `ingredients` and variegated
 * `colorSolutions[].dyes`, matching each dye name to an inventory dye.
 * Returns 0 if nothing matches.
 */
export function recipeDyeCost(recipe: any, inventory: any[]): number {
    if (!recipe) return 0;

    let total = 0;
    const add = (name: string, amount: any, unit: string) => {
        const item = findDyeItem(inventory, name);
        if (!item) return;
        total += gramsOfDye(amount, unit) * costPerGram(item);
    };

    (recipe.ingredients || []).forEach((ing: any) => add(ing.name, ing.amount, ing.unit || 'g'));
    (recipe.colorSolutions || []).forEach((cs: any) =>
        (cs.dyes || []).forEach((dy: any) => add(dy.name, dy.amount, dy.unit || 'g'))
    );
    return total;
}
