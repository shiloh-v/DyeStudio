// Shared derivations for Yarn Base sizes, used by the catalog (YarnBases) and by
// Inventory's "fill from base" picker.

// Per-skein price from pack price / pack size (pack size defaults to 1).
export function perSkeinPrice(size: any): number | null {
    const pp = parseFloat(String(size?.packPrice));
    if (isNaN(pp)) return null;
    const ps = parseFloat(String(size?.packSize));
    const qty = !isNaN(ps) && ps > 0 ? ps : 1;
    return pp / qty;
}

export function deriveLength(lengthPer100: any, amount: any): number | null {
    const per = parseFloat(String(lengthPer100));
    const a = parseFloat(String(amount));
    if (isNaN(per) || isNaN(a)) return null;
    return Math.round((per * a) / 100);
}

// A size's length: explicit override wins, else derived from length-per-100.
export function sizeLength(base: any, size: any): { value: number; derived: boolean } | null {
    const override = parseFloat(String(size?.length));
    if (!isNaN(override)) return { value: override, derived: false };
    const d = deriveLength(base?.lengthPer100, size?.amount);
    return d == null ? null : { value: d, derived: true };
}
