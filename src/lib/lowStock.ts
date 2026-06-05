// Single source of truth for "is this inventory item running low?"
//
// Dye powder is special: regardless of the unit it's tracked in (ounces) or any
// per-item threshold, a dye is "low" only once less than a fixed amount of
// actual powder remains. Everything else uses its own lowStockThreshold.

const UNIT_TO_GRAM: Record<string, number> = {
    g: 1, oz: 28.3495, lb: 453.592, kg: 1000, ml: 1, L: 1000, tsp: 5, tbsp: 15,
};

// Fixed low-stock trigger for dye powder, in grams.
export const DYE_LOW_STOCK_GRAMS = 20;

// Convert an on-hand quantity in `unit` to grams.
export function toGrams(qty: any, unit: string): number {
    return (parseFloat(String(qty)) || 0) * (UNIT_TO_GRAM[unit] || 1);
}

// Is the item below its low-stock trigger?
export function isLowStock(item: any): boolean {
    if (!item) return false;
    // Dyes: low only when under 20 g of powder remains.
    if (item.category === 'dye') {
        return toGrams(item.quantity, item.unit || 'g') < DYE_LOW_STOCK_GRAMS;
    }
    const t = item.lowStockThreshold;
    if (t == null || t === '') return false;
    return (parseFloat(String(item.quantity)) || 0) <= (parseFloat(String(t)) || 0);
}

// Human-readable description of an item's low-stock trigger (for the UI).
export function lowStockLabel(item: any): string {
    if (item?.category === 'dye') return `${DYE_LOW_STOCK_GRAMS} g`;
    return `${item?.lowStockThreshold} ${item?.unit || ''}`.trim();
}
