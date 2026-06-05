// Translate a supplier's yarn-base name to the dyer's own product name using the
// Yarn Bases catalog (settings.yarnBases) — e.g. "W2D4 SW DK" → "Luna DK".

export function myYarnName(supplierName: any, settings: any): string | null {
    if (!supplierName) return null;
    const key = String(supplierName).trim().toLowerCase();
    const match = (settings?.yarnBases || []).find(
        (b: any) => b.supplierName && String(b.supplierName).trim().toLowerCase() === key
    );
    return match?.myName || null;
}

// The dyer's name if a mapping exists, otherwise the supplier name unchanged.
export function yarnDisplayName(supplierName: any, settings: any): string {
    return myYarnName(supplierName, settings) || String(supplierName || '');
}
