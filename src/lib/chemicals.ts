// Chemical (acid) usage model for finishing a dye session.
//
// Each pan needs an acid to set the dye. Most yarn takes CITRIC ACID; bases that
// contain Stellina (sparkle) take VINEGAR instead.
//
// Citric acid is mixed as one solution per oven load (300 g for a full 18-space
// oven), so each pan's share is perOven ÷ 18 × the oven spaces it takes (pan 1,
// gradient tray 2, dye-square tray 4). Deep shades don't change it — every pan
// gets the same solution. Vinegar is still per pan, × deep-shade multiplier.
// Inventory deductions add a safety padding so stock trends low and you reorder
// before truly running out; cost estimates use the unpadded amount.

import { findYarnBaseItem } from './yarnMatch';

export const CHEM_DEFAULTS = {
    citricAcidPerOvenG: 300, // one solution for a full oven
    vinegarPerPanMl: 30, // ≈ 2 tbsp
    deepShadeMultiplier: 1.5,
    paddingPct: 20,
};

function num(v: any, d: number): number {
    const n = parseFloat(String(v));
    return isNaN(n) ? d : n;
}

export interface ChemSettings {
    citricAcidPerOvenG: number;
    vinegarPerPanMl: number;
    deepShadeMultiplier: number;
    paddingPct: number;
}

export function chemSettings(settings: any): ChemSettings {
    const c = settings?.chemicals || {};
    return {
        citricAcidPerOvenG: num(c.citricAcidPerOvenG, CHEM_DEFAULTS.citricAcidPerOvenG),
        vinegarPerPanMl: num(c.vinegarPerPanMl, CHEM_DEFAULTS.vinegarPerPanMl),
        deepShadeMultiplier: num(c.deepShadeMultiplier, CHEM_DEFAULTS.deepShadeMultiplier),
        paddingPct: num(c.paddingPct, CHEM_DEFAULTS.paddingPct),
    };
}

// A full oven: 9 racks × 2 pans.
export const OVEN_SPACES = 18;

// Oven spaces a pan takes: gradient tray 2, dye-square tray 4, anything else 1.
export function panOvenSpaces(pan: any): number {
    if (pan?.type === 'dyeSquareTray') return 4;
    if (pan?.type === 'gradientTray') return 2;
    return 1;
}

// Grams of citric acid one pan's share of the oven solution uses (no padding).
export function panCitricGrams(pan: any, settings: any): number {
    return (chemSettings(settings).citricAcidPerOvenG / OVEN_SPACES) * panOvenSpaces(pan);
}

// The yarn-base references a pan dyes onto (handles all pan types).
function panBaseRefs(pan: any): string[] {
    if (pan?.type === 'gradientTray' || pan?.type === 'dyeSquareTray') {
        return [pan.gradientYarnBase].filter(Boolean);
    }
    return (pan?.yarns || []).map((y: any) => y.base).filter(Boolean);
}

// Does any of a pan's yarn bases contain Stellina (→ vinegar, not citric acid)?
export function panUsesVinegar(pan: any, inventory: any[]): boolean {
    return panBaseRefs(pan).some((ref) => {
        const item = findYarnBaseItem(inventory, ref);
        const hay = `${item?.name || ''} ${item?.fiberContent || ''} ${ref || ''}`.toLowerCase();
        return hay.includes('stellina');
    });
}

// Acid a single pan consumes, including deep-shade multiplier and padding.
// Returns grams of citric acid OR ml of vinegar.
export function panAcidUsage(
    pan: any,
    settings: any,
    inventory: any[],
): { type: 'citric'; grams: number } | { type: 'vinegar'; ml: number } {
    const s = chemSettings(settings);
    const pad = 1 + s.paddingPct / 100;
    if (panUsesVinegar(pan, inventory)) {
        const deep = pan?.deepShade ? s.deepShadeMultiplier : 1;
        return { type: 'vinegar', ml: s.vinegarPerPanMl * deep * pad };
    }
    return { type: 'citric', grams: panCitricGrams(pan, settings) * pad };
}

