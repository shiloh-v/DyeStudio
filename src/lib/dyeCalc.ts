// Cost helpers for the dye catalog.

const OZ_TO_G = 28.3495;

// Cost per gram from a size's price and ounces.
export function dyeCostPerGram(size: any): number | null {
    const price = parseFloat(String(size?.price));
    const oz = parseFloat(String(size?.ounces));
    if (isNaN(price) || isNaN(oz) || oz <= 0) return null;
    return price / (oz * OZ_TO_G);
}

// "401 Brilliant Yellow" (number optional).
export function dyeDisplayName(dye: any): string {
    return [dye?.number, dye?.name].filter(Boolean).join(' ').trim() || 'Dye';
}
