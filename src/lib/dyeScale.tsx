// Shared dye-amount scaling + display, used by the Queue (dye day) and the
// Pipeline (so a finished batch can show the amounts you used when you go back
// to add notes). Kept here so the two stay in lockstep.

// Scale a recipe (or Color Lab sketch) to a target yarn weight. Returns either a
// flat ingredient list (tonal/speckled) or an array of color solutions/sections
// (variegated). Pure — safe to call from anywhere.
export const scaleIngredients = (recipe, targetWeight, colorSketch = null) => {
    // Use color sketch if available, otherwise use recipe
    const source = colorSketch || recipe;
    if (!source) return [];

    const baseWeight = colorSketch ? parseFloat(colorSketch.yarnWeight || 100) : parseFloat(recipe.yarnWeight || 100);
    const scaleFactor = targetWeight / baseWeight;

    // Handle Color Lab sketch
    if (colorSketch) {
        if (colorSketch.type === 'tonal' && colorSketch.dyes) {
            return colorSketch.dyes.map(dye => ({
                name: dye.color,
                amount: dye.amount,
                unit: dye.unit || 'ml',
                scaledAmount: (parseFloat(dye.amount || 0) * scaleFactor).toFixed(2)
            }));
        } else if (colorSketch.type === 'variegated' && colorSketch.sections) {
            return colorSketch.sections.map(section => ({
                name: section.name,
                dyes: section.dyes.map(dye => ({
                    name: dye.color,
                    amount: dye.amount,
                    unit: dye.unit || 'ml',
                    scaledAmount: (parseFloat(dye.amount || 0) * scaleFactor).toFixed(2)
                }))
            }));
        } else if (colorSketch.type === 'speckled') {
            const ingredients = [];
            if (colorSketch.baseColors) {
                colorSketch.baseColors.forEach(base => {
                    if (base.color) {
                        ingredients.push({
                            name: base.color + ' (base)',
                            amount: base.amount,
                            unit: base.unit || 'ml',
                            scaledAmount: (parseFloat(base.amount || 0) * scaleFactor).toFixed(2)
                        });
                    }
                });
            }
            if (colorSketch.speckles) {
                colorSketch.speckles.forEach(speckle => {
                    if (speckle.color) {
                        ingredients.push({
                            name: speckle.color + ' (speckle)',
                            amount: speckle.amount,
                            unit: speckle.unit || 'g',
                            scaledAmount: (parseFloat(speckle.amount || 0) * scaleFactor).toFixed(2)
                        });
                    }
                });
            }
            return ingredients;
        }
        return [];
    }

    // Handle regular recipe
    if (recipe.colorType === 'variegated' && recipe.colorSolutions) {
        // Scale color solutions
        return recipe.colorSolutions.map(solution => ({
            ...solution,
            scaledTargetMl: solution.targetMl ? (parseFloat(solution.targetMl) * scaleFactor).toFixed(1) : '',
            dyes: solution.dyes.map(dye => ({
                ...dye,
                scaledAmount: (parseFloat(dye.amount || 0) * scaleFactor).toFixed(2)
            }))
        }));
    } else if (recipe.ingredients) {
        // Scale regular ingredients
        return recipe.ingredients.map(ing => ({
            ...ing,
            scaledAmount: (parseFloat(ing.amount) * scaleFactor).toFixed(2)
        }));
    }
    return [];
};

// Render scaled dye amounts for ONE pan/batch at the given weight. Used per-pan
// in the Queue and per-batch in the Pipeline.
export function ScaledAmounts({ recipe, colorSketch = null, weight }) {
    const isVar = colorSketch?.type === 'variegated' || recipe?.colorType === 'variegated';
    return (
        <div className="space-y-2">
            {isVar
                ? scaleIngredients(recipe, weight, colorSketch).map((solution, idx) => (
                    <div key={idx} className="border-2 border-teal-200 rounded-lg p-3 bg-teal-50">
                        <div className="font-semibold text-teal-900 mb-2">
                            {solution.name || `Solution ${idx + 1}`}
                            {solution.scaledTargetMl && (
                                <span className="text-sm font-normal text-gray-600 ml-2">
                                    → Add water to {solution.scaledTargetMl}ml
                                </span>
                            )}
                        </div>
                        <div className="space-y-1 pl-3">
                            {solution.dyes.map((dye, dIdx) => (
                                <div key={dIdx} className="flex justify-between items-center">
                                    <span className="text-sm text-gray-700">• {dye.name}</span>
                                    <span className="text-blue-700 font-bold">
                                        {dye.scaledAmount}{dye.unit}
                                        <span className="text-xs text-gray-500 ml-1">
                                            (orig: {dye.amount}{dye.unit})
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
                : scaleIngredients(recipe, weight, colorSketch).map((ing, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-blue-50 rounded">
                        <span className="font-medium text-gray-900">{ing.name}</span>
                        <div className="text-right">
                            <span className="text-blue-700 font-bold text-lg">
                                {ing.scaledAmount}{ing.unit}
                            </span>
                            <span className="text-xs text-gray-500 ml-2">
                                (original: {ing.amount}{ing.unit})
                            </span>
                        </div>
                    </div>
                ))
            }
        </div>
    );
}
