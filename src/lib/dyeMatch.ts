// Recipes, pans and gradients reference dyes by NAME (e.g. "484 Platinum"), so a
// rename or naming-convention change would orphan every reference. These helpers
// resolve a dye reference resiliently:
//   1. exact name,
//   2. a recorded alias (a previous name, see Inventory rename capture),
//   3. the dye NUMBER — the stable Dharma id, taken from item.number or the
//      leading number of the name ("484 Platinum" -> "484"). So as long as the
//      number is kept, the descriptive part can change freely.

const norm = (s: any): string => String(s ?? '').trim().toLowerCase();

// Leading dye number, e.g. "484 Platinum" -> "484"; "" if none.
export function dyeNumber(s: any): string {
    const m = String(s ?? '').trim().match(/^(\d+)\b/);
    return m ? m[1] : '';
}

function itemNumber(item: any): string {
    return String(item?.number ?? '').trim() || dyeNumber(item?.name);
}

export function matchesDye(item: any, ref: any): boolean {
    if (!item || item.category !== 'dye' || ref == null || ref === '') return false;
    const r = norm(ref);
    if (norm(item.name) === r) return true;
    if (Array.isArray(item.aliases) && item.aliases.some((a: any) => norm(a) === r)) return true;
    const rn = dyeNumber(ref);
    return !!rn && rn === itemNumber(item);
}

// Find the inventory dye for a reference (name / alias / number).
export function findDyeItem(inventory: any[], ref: any): any {
    return (inventory || []).find((i) => matchesDye(i, ref));
}
