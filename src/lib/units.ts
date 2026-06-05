// Measurement units are configurable in Settings (settings.units). These helpers
// give every unit dropdown the same source of truth, with a sane fallback when
// settings haven't loaded or the list is empty.

export const DEFAULT_UNITS = ['ml', 'g', 'oz', 'lb', 'tsp', 'tbsp'];

export function unitList(settings: any): string[] {
    const units = settings?.units;
    return Array.isArray(units) && units.length > 0 ? units : DEFAULT_UNITS;
}
