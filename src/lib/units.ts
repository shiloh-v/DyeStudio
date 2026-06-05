// The fixed set of measurement units the dye-measurement dropdowns offer
// (Recipes / Color Lab). Units are no longer user-configurable; conversions are
// handled in code where needed (e.g. Inventory's quantity unit switch).

export const DEFAULT_UNITS = ['ml', 'g', 'oz', 'lb', 'tsp', 'tbsp'];

export function unitList(): string[] {
    return DEFAULT_UNITS;
}
