// How dark a colorway dyes up, so each color type in a batch can be dyed
// lightest → darkest (a pale color dyed after a dark one picks up whatever
// the pot/tools carry over).
//
// Estimate: each dye's swatch color (Inventory "color") is its look at about
// REF_DOS % depth of shade. Depth = dye per gram of yarn — stock solution is
// 1%, so ml of stock per g of yarn = % DOS; powder is ×100 that. Dyes stack
// like filters (absorbance adds per RGB channel), and the result's luminance
// is the lightness. Variegated sections each cover their share of the yarn;
// speckles are a sprinkle, so they count for little.
import type { Recipe } from '../types';

const normText = (s: any): string =>
    String(s ?? '').toLowerCase().replace(/[’'"“”()]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const REF_DOS = 2;          // % DOS a swatch hex represents
const SPECKLE_WEIGHT = 0.25; // speckles barely change how dark the skein reads
const ML_PER_G_POWDER = 100; // 1 g powder ≈ 100 ml of 1% stock
const G_PER_TSP = 2.5;       // dye powder, roughly

type Dose = { name: string; hex?: string; amount: number; unit?: string };

const toLin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const hexRgb = (hex: string): [number, number, number] | null => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Dye name → swatch hex from Inventory (matched by name, or by its number like "469"). */
export function dyeColorLookup(inventory: any[]): (name: string) => string | undefined {
    const dyes = (inventory || []).filter((i) => i?.category === 'dye' && i.name && i.color);
    const code = (s: string) => /^\s*(\d{3,})\b/.exec(s)?.[1];
    return (name: string) => {
        if (!name) return undefined;
        if (hexRgb(name)) return name;
        const n = normText(name);
        const exact = dyes.find((d) => normText(d.name) === n) || dyes.find((d) => n.includes(normText(d.name)));
        if (exact) return exact.color;
        const c = code(name);
        return c ? dyes.find((d) => code(String(d.name)) === c)?.color : undefined;
    };
}

/** % DOS for a dye amount on `yarnGrams` of yarn. */
function dos(d: Dose, yarnGrams: number): number {
    const u = String(d.unit || 'ml').toLowerCase();
    const ml = u === 'g' ? d.amount * ML_PER_G_POWDER : u === 'tsp' ? d.amount * G_PER_TSP * ML_PER_G_POWDER : d.amount;
    return yarnGrams > 0 ? ml / yarnGrams : 0;
}

/** Luminance 0 (black) … 1 (undyed) of doses on yarnGrams, or null if no dye has a known color. */
function lightnessOf(doses: Dose[], yarnGrams: number, colorOf: (n: string) => string | undefined): number | null {
    const A = [0, 0, 0];
    let known = false;
    for (const d of doses) {
        const rgb = hexRgb(d.hex || colorOf(d.name) || '');
        if (!rgb || !(d.amount > 0)) continue;
        known = true;
        const k = dos(d, yarnGrams) / REF_DOS;
        rgb.forEach((c, i) => { A[i] += k * -Math.log10(Math.max(0.005, toLin(c))); });
    }
    if (!known) return null;
    const [r, g, b] = A.map((a) => 10 ** -a);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const doses = (list: any[] | undefined, weight = 1): Dose[] =>
    (list || [])
        .map((d) => ({ name: String(d?.name || d?.color || ''), hex: hexRgb(d?.color) ? d.color : undefined, amount: (parseFloat(d?.amount) || 0) * weight, unit: d?.unit }))
        .filter((d) => d.name && d.amount > 0);

/**
 * Lightness (0 black … 1 undyed) of a recipe or Color Lab sketch; null when
 * its dyes have no known colors. Variegated = average of its sections.
 */
export function colorLightness(src: Recipe | any, colorOf: (n: string) => string | undefined): number | null {
    if (!src) return null;
    const grams = parseFloat(src.yarnWeight ?? src.yarn_weight) || 100;
    const isSpeckle = (d: any) => /speckle/i.test(String(d?.name || d?.color || ''));
    const main = [
        ...doses((src.ingredients || []).filter((d: any) => !isSpeckle(d))),
        ...doses((src.ingredients || []).filter(isSpeckle), SPECKLE_WEIGHT),
        ...doses(src.dyes),
        ...doses(src.baseColors ?? src.base_colors),
        ...doses(src.speckles, SPECKLE_WEIGHT),
    ];
    const sections = [...(src.colorSolutions || []), ...(src.sections || [])]
        .map((s: any) => doses(s?.dyes))
        .filter((s) => s.length);
    if (sections.length) {
        // Each section dyes its share of the yarn; any overall dyes go on all of it.
        const ls = sections
            .map((s) => lightnessOf([...s, ...main.map((d) => ({ ...d, amount: d.amount / sections.length }))], grams / sections.length, colorOf))
            .filter((l): l is number => l != null);
        if (ls.length) return ls.reduce((t, l) => t + l, 0) / ls.length;
    }
    return lightnessOf(main, grams, colorOf);
}

/** Lightness of a session pan (colorway recipe or Color Lab sketch); null if unknown. */
export function panLightness(pan: any, recipes: Recipe[], colorOf: (n: string) => string | undefined, sketches: any[] = []): number | null {
    if (pan?.type === 'colorLab') return colorLightness(pan.colorSketch || sketches.find((k) => String(k.id) === String(pan.colorSketchId)), colorOf);
    const r = (pan?.recipeId && recipes.find((x) => String(x.id) === String(pan.recipeId))) || pan?.recipe;
    return colorLightness(r, colorOf);
}

/** A pan's color type (recipe colorType or Color Lab sketch type), lowercased; '' if unknown. */
function panColorType(pan: any, recipes: Recipe[], sketches: any[]): string {
    if (pan?.type === 'colorLab') {
        const k = pan.colorSketch || sketches.find((x) => String(x.id) === String(pan.colorSketchId));
        return String(k?.type || '').toLowerCase();
    }
    const r = (pan?.recipeId && recipes.find((x) => String(x.id) === String(pan.recipeId))) || pan?.recipe;
    return String(r?.colorType ?? r?.color_type ?? '').toLowerCase();
}

/** Dye order by color type: speckled, then variegated, then tonal (and anything else). */
const TYPE_RANK: Record<string, number> = { speckled: 0, variegated: 1 };
const typeRank = (t: string) => TYPE_RANK[t] ?? 2;

/**
 * Pans in dye order: speckled first, then variegated, then tonals; within
 * each type, lightest → darkest. Each colorway's pans stay together, colors
 * with unknown dyes go after the known ones of their type (in their old
 * order), and trays (gradient / dye-square) stay last.
 */
export function sortPansInDyeOrder<T extends { type?: string; colorway?: string; recipeId?: any }>(pans: T[], recipes: Recipe[], inventory: any[], sketches: any[] = []): T[] {
    const colorOf = dyeColorLookup(inventory);
    const groups: T[][] = [];
    const trays: T[] = [];
    for (const p of pans) {
        if (/tray/i.test(String(p.type || ''))) { trays.push(p); continue; }
        const key = `${p.type}|${p.colorway || ''}|${p.recipeId || ''}`;
        const g = groups.find((x) => `${x[0].type}|${x[0].colorway || ''}|${x[0].recipeId || ''}` === key);
        if (g) g.push(p); else groups.push([p]);
    }
    const lit = groups.map((g, i) => ({ g, i, t: typeRank(panColorType(g[0], recipes, sketches)), l: panLightness(g[0], recipes, colorOf, sketches) }));
    lit.sort((a, b) => a.t - b.t || (a.l == null ? 1 : 0) - (b.l == null ? 1 : 0) || (b.l ?? 0) - (a.l ?? 0) || a.i - b.i);
    return [...lit.flatMap((x) => x.g), ...trays];
}
