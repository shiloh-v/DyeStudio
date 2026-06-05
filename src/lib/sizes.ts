// Size mappings (settings.sizeMappings: {grams, name}) give friendly names to
// common hank/skein weights — e.g. 100g → "Full skein", 20g → "Mini skein".

export function sizeName(grams: any, settings: any): string | null {
    const g = parseFloat(String(grams));
    if (isNaN(g)) return null;
    const match = (settings?.sizeMappings || []).find(
        (s: any) => parseFloat(String(s.grams)) === g
    );
    return match?.name || null;
}

// "100g · Full skein" when a mapping exists, otherwise just "100g".
export function sizeLabel(grams: any, settings: any): string {
    const name = sizeName(grams, settings);
    return name ? `${grams}g · ${name}` : `${grams}g`;
}
