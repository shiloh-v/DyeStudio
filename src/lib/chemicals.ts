// Chemical (acid) usage model for finishing a dye session.
//
// Each pan needs an acid to set the dye. Most yarn takes CITRIC ACID; bases that
// contain Stellina (sparkle) take VINEGAR instead. Amounts are per-pan defaults
// from Settings, multiplied for deep/dark shades and padded with a safety buffer
// so inventory trends low and you reorder before truly running out.

import { findYarnBaseItem } from './yarnMatch';

export const CHEM_DEFAULTS = {
    citricAcidPerPanG: 20, // ≈ 1 heaping tbsp
    vinegarPerPanMl: 30, // ≈ 2 tbsp
    deepShadeMultiplier: 1.5,
    paddingPct: 20,
};

function num(v: any, d: number): number {
    const n = parseFloat(String(v));
    return isNaN(n) ? d : n;
}

export interface ChemSettings {
    citricAcidPerPanG: number;
    vinegarPerPanMl: number;
    deepShadeMultiplier: number;
    paddingPct: number;
}

export function chemSettings(settings: any): ChemSettings {
    const c = settings?.chemicals || {};
    return {
        citricAcidPerPanG: num(c.citricAcidPerPanG, CHEM_DEFAULTS.citricAcidPerPanG),
        vinegarPerPanMl: num(c.vinegarPerPanMl, CHEM_DEFAULTS.vinegarPerPanMl),
        deepShadeMultiplier: num(c.deepShadeMultiplier, CHEM_DEFAULTS.deepShadeMultiplier),
        paddingPct: num(c.paddingPct, CHEM_DEFAULTS.paddingPct),
    };
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
    const deep = pan?.deepShade ? s.deepShadeMultiplier : 1;
    if (panUsesVinegar(pan, inventory)) {
        return { type: 'vinegar', ml: s.vinegarPerPanMl * deep * pad };
    }
    return { type: 'citric', grams: s.citricAcidPerPanG * deep * pad };
}
