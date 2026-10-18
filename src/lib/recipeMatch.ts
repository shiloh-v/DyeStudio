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
