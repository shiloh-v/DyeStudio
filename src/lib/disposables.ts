// Disposables: supplies a pan uses up — lids (gradient trays, one per depth of
// shade) and zip ties (one per skein). Each is an inventory item (category
// `tool`, unit `units`, cost = cost per item), so its price, on-hand count and
// low-stock warning all live in Inventory. Settings → Disposables only holds how
// many each pan uses and, optionally, which inventory item plays the role.

export type DisposableRole = 'lid' | 'zipTie';

export const DISPOSABLE_ROLES: DisposableRole[] = ['lid', 'zipTie'];

// Starting item created by Settings → "Add to inventory" (prices as paid).
export const DISPOSABLE_NEW_ITEM: Record<DisposableRole, { name: string; packPrice: number; packCount: number; lowStockThreshold: number }> = {
    lid: { name: 'Gradient pan lids', packPrice: 22, packCount: 72, lowStockThreshold: 20 },
    zipTie: { name: 'Zip ties', packPrice: 28.5, packCount: 1200, lowStockThreshold: 200 },
};

export const DISPOSABLE_LABEL: Record<DisposableRole, string> = { lid: 'Lids', zipTie: 'Zip ties' };

// Name fallback when no item is pinned in Settings.
const NAME_MATCH: Record<DisposableRole, RegExp> = {
    lid: /\blids?\b/i,
    zipTie: /\bzip[\s-]?ties?\b/i,
};

export const DISPOSABLE_USAGE_DEFAULTS = {
    lidsPerGradientTray: 10,
    zipTiesPerSkein: 1,
};

function num(v: any, d: number): number {
    const n = parseFloat(String(v));
    return isNaN(n) ? d : n;
}

export function disposableUsage(settings: any) {
    const d = settings?.disposables || {};
    return {
        lidsPerGradientTray: num(d.lidsPerGradientTray, DISPOSABLE_USAGE_DEFAULTS.lidsPerGradientTray),
        zipTiesPerSkein: num(d.zipTiesPerSkein, DISPOSABLE_USAGE_DEFAULTS.zipTiesPerSkein),
    };
}

// The inventory item playing a disposable role: the item pinned in Settings
// (by id, rename-proof), else a non-dye item whose name matches.
export function findDisposableItem(inventory: any[], settings: any, role: DisposableRole): any {
    const inv = inventory || [];
    const id = settings?.disposables?.[role + 'ItemId'];
    if (id != null && id !== '') {
        const byId = inv.find((i) => String(i.id) === String(id));
        if (byId) return byId;
    }
    return inv.find((i) => i.category !== 'dye' && i.category !== 'yarn base' && NAME_MATCH[role].test(String(i.name || '')));
}

// How many of each disposable a pan uses up.
export function panDisposableCounts(pan: any, skeins: number, settings: any): Record<DisposableRole, number> {
    const u = disposableUsage(settings);
    return {
        lid: pan?.type === 'gradientTray' ? u.lidsPerGradientTray : 0,
        zipTie: Math.max(0, skeins || 0) * u.zipTiesPerSkein,
    };
}

// Skeins a pan produces (trays are fixed sizes).
export function panSkeinCount(pan: any): number {
    if (pan?.type === 'gradientTray') return 10;
    if (pan?.type === 'dyeSquareTray') return 25;
    return (pan?.yarns || []).reduce((s: number, y: any) => s + (parseInt(y.quantity) || 0), 0);
}

const itemCost = (item: any) => num(item?.cost, 0);

// Disposables cost of one pan, priced from the inventory items (0 if an item
// isn't in inventory yet).
export function panDisposablesCost(pan: any, skeins: number, settings: any, inventory: any[]): number {
    const counts = panDisposableCounts(pan, skeins, settings);
    return DISPOSABLE_ROLES.reduce(
        (t, role) => t + counts[role] * itemCost(findDisposableItem(inventory, settings, role)),
        0,
    );
}
