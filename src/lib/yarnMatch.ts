// Yarn bases are referenced by a name string in pans, ball bands and recipes.
// Matching on the raw display name is fragile — renaming a yarn base item (e.g.
// the catalog "fill" generates "Luna DK 100g") breaks every reference to the old
// name. These helpers match on a STABLE identity instead: the dyer's name
// (myYarnName) OR the display name, plus hank size. New references store the
// stable `yarnBaseRef(item)` so they survive renames.
//
// They also heal HISTORICAL references to a base's old supplier name. The Yarn
// Bases catalog (settings.yarnBases) maps `supplierName` -> `myName`, so a pan
// that still says "W2D4 Merino DK SW 50s" resolves to the current "Luna DK".

const norm = (s: any): string => String(s ?? '').trim().toLowerCase();

// The stable reference value to store for a yarn base item.
export function yarnBaseRef(item: any): string {
    return String(item?.myYarnName || item?.name || '');
}

// Resolve a (possibly old) reference to the current "my name" using the catalog.
// Matches a catalog entry's supplierName exactly OR as a prefix, so size-variant
// suffixes ("W2D4 Merino DK SW 50s", "Platinum Sock Mini") still resolve. Refs
// that aren't an old supplier name are returned unchanged.
export function canonicalYarnRef(ref: any, catalog?: any[]): string {
    const r = norm(ref);
    if (!r || !catalog || !catalog.length) return String(ref ?? '');
    for (const entry of catalog) {
        const sup = norm(entry?.supplierName);
        if (sup && (r === sup || r.startsWith(sup + ' '))) return String(entry.myName ?? ref);
    }
    return String(ref ?? '');
}

// Previous names recorded on an item when it was renamed (see Inventory). Lets
// any reference to an old name keep resolving after a rename — generically, for
// any naming-convention change, not just the catalog supplier→my-name one.
function aliasesOf(item: any): string[] {
    return Array.isArray(item?.aliases) ? item.aliases.map(norm) : [];
}

// Does this yarn base item match a stored reference (by myYarnName, name, or a
// recorded alias)? Resolves the ref through the catalog first so old supplier
// names still match even before any alias was recorded.
export function matchesYarnBase(item: any, ref: any, catalog?: any[]): boolean {
    if (!item || ref == null || ref === '') return false;
    const raw = norm(ref);
    const canon = norm(canonicalYarnRef(ref, catalog));
    const candidates = [norm(item.myYarnName), norm(item.name), ...aliasesOf(item)];
    return candidates.includes(raw) || candidates.includes(canon);
}

// Find a yarn base inventory item for a reference + hank size. Prefers an exact
// hank-size match; falls back to the first name/my-name match.
export function findYarnBaseItem(inventory: any[], ref: any, hankSize?: any, catalog?: any[]): any {
    const matches = (inventory || []).filter(
        (i) => i.category === 'yarn base' && matchesYarnBase(i, ref, catalog)
    );
    if (matches.length === 0) return undefined;
    if (hankSize == null || hankSize === '') return matches[0];
    const h = parseFloat(String(hankSize));
    return matches.find((i) => parseFloat(String(i.hankSize)) === h) || matches[0];
}

// Find the ball band for a yarn base reference + hank size (ball bands store the
// reference in `forYarnBase`). Resolves BOTH the lookup ref and the stored
// `forYarnBase` through the catalog/aliases, so a ball band saved under an old
// supplier name still matches a base referenced by its current name.
export function findBallBand(inventory: any[], ref: any, hankSize?: any, catalog?: any[]): any {
    if (ref == null || ref === '') return undefined;
    const raw = norm(ref);
    const canon = norm(canonicalYarnRef(ref, catalog));
    const h = hankSize == null || hankSize === '' ? null : parseFloat(String(hankSize));
    return (inventory || []).find((i) => {
        if (i.category !== 'ball band') return false;
        const candidates = [norm(i.forYarnBase), norm(canonicalYarnRef(i.forYarnBase, catalog)), ...aliasesOf(i)];
        const refMatch = candidates.includes(raw) || candidates.includes(canon);
        return refMatch && (h == null || parseFloat(String(i.hankSize)) === h);
    });
}
