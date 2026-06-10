// Some inventory items play a ROLE rather than being referenced by name: the
// colorway labels, the citric acid, the vinegar. Matching them by a hardcoded
// name substring ("label", "citric") breaks the moment you rename them. These
// resolvers key off something stable instead — the dedicated category, or an
// item you designate in Settings — with the old name-keyword only as a fallback.

const norm = (s: any): string => String(s ?? '').trim().toLowerCase();

// All colorway-label items. Primary: the dedicated `label` category (rename-
// proof). Legacy fallback: an item named "…label…" left in other/ball band.
export function labelItems(inventory: any[]): any[] {
    const inv = inventory || [];
    const byCat = inv.filter((i) => i.category === 'label');
    if (byCat.length) return byCat;
    return inv.filter((i) => (i.category === 'other' || i.category === 'ball band') && norm(i.name).includes('label'));
}

// The single label item to price against (first label item).
export function findLabelItem(inventory: any[]): any {
    return labelItems(inventory)[0];
}

// A chemical playing a role ('citric' | 'vinegar'). Prefers the item the user
// designated in Settings → Chemical Usage (by id, rename-proof); otherwise falls
// back to a name keyword within the `chemical` category.
export function findChemicalByRole(inventory: any[], settings: any, role: 'citric' | 'vinegar'): any {
    const inv = inventory || [];
    const id = settings?.chemicals?.[role + 'ItemId'];
    if (id != null && id !== '') {
        const byId = inv.find((i) => String(i.id) === String(id));
        if (byId) return byId;
    }
    return inv.find((i) => i.category === 'chemical' && norm(i.name).includes(role));
}
