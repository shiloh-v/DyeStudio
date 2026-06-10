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

// Does this yarn base item match a stored reference (by myYarnName or name)?
// Resolves the ref through the catalog first so old supplier names still match.
export function matchesYarnBase(item: any, ref: any, catalog?: any[]): boolean {
    if (!item || ref == null || ref === '') return false;
    const raw = norm(ref);
    const canon = norm(canonicalYarnRef(ref, catalog));
    const myName = norm(item.myYarnName);
    const name = norm(item.name);
    return myName === raw || name === raw || myName === canon || name === canon;
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
// reference in `forYarnBase`). Catalog-aware so old supplier names still match.
export function findBallBand(inventory: any[], ref: any, hankSize?: any, catalog?: any[]): any {
    if (ref == null || ref === '') return undefined;
    const raw = norm(ref);
    const canon = norm(canonicalYarnRef(ref, catalog));
    const h = hankSize == null || hankSize === '' ? null : parseFloat(String(hankSize));
    return (inventory || []).find((i) => {
        if (i.category !== 'ball band') return false;
        const fyb = norm(i.forYarnBase);
        return (fyb === raw || fyb === canon) && (h == null || parseFloat(String(i.hankSize)) === h);
    });
}
