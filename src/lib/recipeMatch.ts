// Colorways get renamed and retired. Anything that refers to a color by NAME
// (Shopify order lines, the Shopify stock upload, kit colors) must still find
// it under an old name. Recipes keep their old names in `aliases` (recorded
// automatically on rename in the Recipes form).

const norm = (s: any): string => String(s ?? '').trim().toLowerCase();

/** Current name + every old name of a recipe. */
export function recipeNameList(r: any): string[] {
    return [r?.name, ...(Array.isArray(r?.aliases) ? r.aliases : [])].filter(Boolean).map(String);
}

/** Find a recipe by its current name OR any old name (case-insensitive). */
export function findRecipeByName(recipes: any[], name: any): any {
    const n = norm(name);
    if (!n) return undefined;
    return (recipes || []).find((r) => norm(r?.name) === n)
        || (recipes || []).find((r) => recipeNameList(r).some((x) => norm(x) === n));
}

/** Retired colors keep their history but are never planned. */
export const isRetired = (r: any): boolean => !!r?.retired;

/**
 * Aliases to save when a recipe is renamed: existing aliases + the old name
 * (unless it's the new name again), de-duplicated.
 */
export function aliasesAfterRename(oldName: any, newName: any, aliases: string[] = []): string[] {
    const out = [...aliases];
    if (oldName && norm(oldName) !== norm(newName)) out.push(String(oldName));
    const seen = new Set<string>();
    return out
        .map((a) => String(a).trim())
        .filter((a) => a && norm(a) !== norm(newName) && !seen.has(norm(a)) && (seen.add(norm(a)), true));
}

/** A pan's LIVE recipe (by id), falling back to the copy embedded when the pan was made. */
export function liveRecipe(pan: any, recipes: any[]): any {
    const id = pan?.recipeId;
    const r = id != null && id !== '' ? (recipes || []).find((x) => String(x.id) === String(id)) : undefined;
    return r || pan?.recipe || null;
}

/**
 * The name to SHOW for a pan or batch: its recipe's current name (or Color Lab
 * sketch's current name), so renames show everywhere. A custom name typed on
 * the pan (one that isn't the recipe's current or any old name) is kept.
 */
export function currentColorName(item: any, recipes: any[], sketches?: any[]): string {
    const stored = String(item?.colorway || item?.recipeName || '');
    const id = item?.recipeId;
    const r = id != null && id !== '' ? (recipes || []).find((x) => String(x.id) === String(id)) : undefined;
    if (r?.name) {
        const known = new Set([...recipeNameList(r), item?.recipe?.name].filter(Boolean).map(norm));
        return !stored || known.has(norm(stored)) ? r.name : stored;
    }
    const skId = item?.colorSketchId || item?.colorSketch?.id;
    if (skId && sketches?.length) {
        const k = sketches.find((s) => String(s.id) === String(skId));
        const live = k?.customName || k?.colorId;
        const snap = item?.colorSketch?.customName || item?.colorSketch?.colorId;
        if (live && (!stored || norm(stored) === norm(snap))) return live;
    }
    return stored;
}
