// Yarn bases are referenced by a name string in pans, ball bands and recipes.
// Matching on the raw display name is fragile — renaming a yarn base item (e.g.
// the catalog "fill" generates "Luna DK 100g") breaks every reference to the old
// name. These helpers match on a STABLE identity instead: the dyer's name
// (myYarnName) OR the display name, plus hank size. New references store the
// stable `yarnBaseRef(item)` so they survive renames.

// The stable reference value to store for a yarn base item.
export function yarnBaseRef(item: any): string {
    return String(item?.myYarnName || item?.name || '');
}

// Does this yarn base item match a stored reference (by myYarnName or name)?
export function matchesYarnBase(item: any, ref: any): boolean {
    if (!item || ref == null || ref === '') return false;
    const r = String(ref).trim().toLowerCase();
    return (
        String(item.myYarnName || '').trim().toLowerCase() === r ||
        String(item.name || '').trim().toLowerCase() === r
    );
}

// Find a yarn base inventory item for a reference + hank size. Prefers an exact
// hank-size match; falls back to the first name/my-name match.
export function findYarnBaseItem(inventory: any[], ref: any, hankSize?: any): any {
    const matches = (inventory || []).filter(
        (i) => i.category === 'yarn base' && matchesYarnBase(i, ref)
    );
    if (matches.length === 0) return undefined;
    if (hankSize == null || hankSize === '') return matches[0];
    const h = parseFloat(String(hankSize));
    return matches.find((i) => parseFloat(String(i.hankSize)) === h) || matches[0];
}

// Find the ball band for a yarn base reference + hank size (ball bands store the
// reference in `forYarnBase`).
export function findBallBand(inventory: any[], ref: any, hankSize?: any): any {
    if (ref == null || ref === '') return undefined;
    const r = String(ref).trim().toLowerCase();
    const h = hankSize == null || hankSize === '' ? null : parseFloat(String(hankSize));
    return (inventory || []).find(
        (i) =>
            i.category === 'ball band' &&
            String(i.forYarnBase || '').trim().toLowerCase() === r &&
            (h == null || parseFloat(String(i.hankSize)) === h)
    );
}
