import React, { useState, useEffect } from 'react';
import { DateUtils } from '../lib/dates';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import { findYarnBaseItem as _findYarnBaseItem, findBallBand as _findBallBand } from '../lib/yarnMatch';
import { findDyeItem } from '../lib/dyeMatch';
import { findLabelItem, findChemicalByRole } from '../lib/roleMatch';
import { panAcidUsage } from '../lib/chemicals';

export function UpNext({ dyeSessions, saveDyeSessions, batches, saveBatches, inventory, saveInventory, recipes, settings, colorSketches, saveColorSketches }) {
    // Catalog-aware yarn matching so old supplier-name refs still resolve.
    const _yarnCatalog = settings?.yarnBases || [];
    const findYarnBaseItem = (inv, ref, hank?) => _findYarnBaseItem(inv, ref, hank, _yarnCatalog);
    const findBallBand = (inv, ref, hank?) => _findBallBand(inv, ref, hank, _yarnCatalog);
    const [selectedSessionId, setSelectedSessionId] = useState(() => localStorage.getItem('queue_session') || '');
    const [currentPanIndex, setCurrentPanIndex] = useState(() => Number(localStorage.getItem('queue_pan')) || 0);
    // Pan indices marked "dyed" this session (fills the progress dots).
    const [completedPans, setCompletedPans] = useState(() => new Set<number>());
    // In-flight lock so a double-tap on "Finish" can't deduct/create twice.
    const [finishing, setFinishing] = useState(false);

    // Unique yarn bases and their available hank sizes from inventory.
    // (Used by the ad-hoc pan editor; previously referenced but never defined,
    // which threw a ReferenceError when that UI opened. Mirrors DyeSessions.)
    const yarnBases = inventory
        .filter(item => item.category === 'yarn base')
        .reduce((acc, item) => {
            if (!acc[item.name]) {
                acc[item.name] = [];
            }
            if (item.hankSize && !acc[item.name].includes(item.hankSize)) {
                acc[item.name].push(item.hankSize);
            }
            return acc;
        }, {});

    const getAvailableHankSizes = (baseName) => {
        return [...(yarnBases[baseName] || [])].sort((a, b) => parseFloat(a) - parseFloat(b));
    };

    // Non-archived sessions with pans — PLUS the currently-selected session even
    // if it was just finished, so you can keep adding notes after completing it.
    const upcomingSessions = dyeSessions
        .filter(s => (!s.archived || s.id.toString() === selectedSessionId) && s.pans.length > 0)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Restore the saved session if it's still active; otherwise auto-select the
    // first one (or clear if none). Keeps the Queue on the same session when you
    // navigate away and come back.
    React.useEffect(() => {
        const stillActive = upcomingSessions.some(s => s.id.toString() === selectedSessionId);
        if (!stillActive) {
            if (upcomingSessions.length > 0) {
                setSelectedSessionId(upcomingSessions[0].id.toString());
                setCurrentPanIndex(0);
            } else if (selectedSessionId) {
                setSelectedSessionId('');
            }
        }
    }, [upcomingSessions.length, selectedSessionId]);

    const selectedSession = dyeSessions.find(s => s.id === parseInt(selectedSessionId));
    const currentPan = selectedSession?.pans[currentPanIndex];
    // A finished (archived) session is shown read-only for review + note-taking.
    const isFinished = !!selectedSession?.archived;

    // --- Same-color grouping ---------------------------------------------------
    // You dye two pans of the same color together, so consecutive pans that share
    // a recipe + colorway collapse into one "step". Only plain pans group; trays,
    // ad-hoc and color-lab pans always stand alone.
    const groupKeyFor = (pan) => {
        if (!pan || pan.type !== 'pan') return null; // null → never groups
        return `${pan.recipeId || ''}|${(pan.colorway || '').trim().toLowerCase()}`;
    };
    const panGroups = (() => {
        const pans = selectedSession?.pans || [];
        const groups: { indices: number[]; key: string | null }[] = [];
        let i = 0;
        while (i < pans.length) {
            const key = groupKeyFor(pans[i]);
            const indices = [i];
            let j = i + 1;
            while (key !== null && j < pans.length && groupKeyFor(pans[j]) === key) {
                indices.push(j);
                j++;
            }
            groups.push({ indices, key });
            i = j;
        }
        return groups;
    })();
    const currentGroup = panGroups.find(g => g.indices.includes(currentPanIndex)) || panGroups[0];
    const currentGroupPos = currentGroup ? panGroups.indexOf(currentGroup) : 0;
    const groupIsDone = (g) => !!g && g.indices.every(i => completedPans.has(i));
    // Derived view of the current step's pans (used by the regular-pan card so a
    // same-color group shows combined weight + each pan's yarns).
    const groupIndices = currentGroup ? currentGroup.indices : (currentPan ? [currentPanIndex] : []);
    const groupPans = groupIndices.map(i => selectedSession?.pans[i]).filter(Boolean);
    const isMultiPan = groupPans.length > 1;
    const combinedWeight = groupPans.reduce((s, p) => s + (parseFloat(p?.totalWeight) || 0), 0);

    // Display helpers used by the "Coming Up Next" preview (every pan type).
    const panTitle = (pan) =>
        pan.type === 'gradientTray' ? `🎨 ${pan.gradientDye} Gradient`
        : pan.type === 'dyeSquareTray' ? `🔲 ${pan.squareColorA} × ${pan.squareColorB} Dye Square`
        : pan.type === 'adHoc' ? `🎲 ${pan.adHocLabel || 'Ad Hoc Experiment'}`
        : (pan.colorway || 'Pan');
    const panYarns = (pan) => {
        if (pan.type === 'gradientTray') return [{ base: pan.gradientYarnBase, hankSize: pan.gradientHankSize, quantity: 10 }];
        if (pan.type === 'dyeSquareTray') return [{ base: pan.gradientYarnBase, hankSize: pan.gradientHankSize, quantity: 25 }];
        return pan.yarns || [];
    };
    const yarnSummary = (pan) =>
        panYarns(pan).filter(y => y.base).map(y => `${y.quantity}× ${y.base} (${y.hankSize}g)`).join(', ');
    const panWeight = (pan) => {
        if (pan.type === 'gradientTray') return (parseFloat(pan.gradientHankSize) || 0) * 10;
        if (pan.type === 'dyeSquareTray') return (parseFloat(pan.gradientHankSize) || 0) * 25;
        return pan.totalWeight || (pan.yarns || []).reduce((s, y) => s + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0);
    };

    // Read the dye-day note for a step. Live sessions store it on the pan; a
    // finished session reads it back from the batch it created.
    const noteValueFor = (indices) => {
        if (isFinished) {
            const b = batches.find(b =>
                b.sourceSessionId === selectedSession?.id && indices.includes(b.sourcePanIndex));
            return b?.batchNotes || '';
        }
        return selectedSession?.pans[indices[0]]?.experimentNotes || '';
    };

    // Write the dye-day note for every pan in a step. Live → onto the pans (and
    // the linked color sketch, so it survives); finished → onto the batches.
    const updatePanNotes = (indices, text) => {
        const idxSet = new Set(indices);
        if (isFinished) {
            saveBatches(batches.map(b =>
                (b.sourceSessionId === selectedSession?.id && idxSet.has(b.sourcePanIndex))
                    ? { ...b, batchNotes: text } : b));
            return;
        }
        const sketchIds = new Set(
            indices.map(i => selectedSession?.pans[i]?.colorSketchId).filter(Boolean));
        saveDyeSessions(dyeSessions.map(s =>
            s.id === selectedSession?.id
                ? { ...s, pans: s.pans.map((p, i) => idxSet.has(i) ? { ...p, experimentNotes: text } : p) }
                : s));
        if (sketchIds.size > 0) {
            saveColorSketches(colorSketches.map(sketch =>
                sketchIds.has(sketch.id) ? { ...sketch, experimentNotes: text } : sketch));
        }
    };

    // Prominent, always-visible notes box. Placed right under the action buttons
    // for every pan type so you actually see (and use) it on dye day.
    const notesBox = (indices) => (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 mt-4">
            <h4 className="font-semibold text-amber-900 mb-2">📝 Dye-Day Notes{indices.length > 1 ? ' (applies to both pans)' : ''}</h4>
            <textarea
                value={noteValueFor(indices)}
                onChange={(e) => updatePanNotes(indices, e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 resize-y bg-white"
                rows={3}
                placeholder="Anything you changed or noticed — dye tweaks, technique, results vs. expected, what to do differently next time."
            />
            <p className="text-xs text-amber-700 mt-2">
                {isFinished
                    ? '💡 Saved to this batch in Pipeline.'
                    : '💡 Flows through to the batch in Pipeline when you finish the session.'}
            </p>
        </div>
    );

    // Persist the Queue position so it survives navigating away/back.
    useEffect(() => { localStorage.setItem('queue_session', selectedSessionId); }, [selectedSessionId]);
    useEffect(() => { localStorage.setItem('queue_pan', String(currentPanIndex)); }, [currentPanIndex]);
    // Clamp a stale pan index (e.g. a saved index beyond a now-shorter session).
    useEffect(() => {
        if (selectedSession && currentPanIndex >= selectedSession.pans.length) setCurrentPanIndex(0);
    }, [selectedSessionId, selectedSession, currentPanIndex]);

    // Load which pans are marked dyed for this session (persisted per session).
    useEffect(() => {
        try {
            setCompletedPans(new Set(JSON.parse(localStorage.getItem('queue_done_' + selectedSessionId) || '[]')));
        } catch { setCompletedPans(new Set()); }
    }, [selectedSessionId]);

    const saveCompleted = (set) =>
        localStorage.setItem('queue_done_' + selectedSessionId, JSON.stringify([...set]));

    // Mark every pan in the current step dyed (fills its dot) and advance.
    const completeGroup = () => {
        const next = new Set(completedPans);
        (currentGroup?.indices || [currentPanIndex]).forEach(i => next.add(i));
        setCompletedPans(next);
        saveCompleted(next);
        if (currentGroupPos < panGroups.length - 1) {
            setCurrentPanIndex(panGroups[currentGroupPos + 1].indices[0]);
        }
    };

    // Undo "dyed" for the whole current step (no navigation).
    const unmarkGroup = () => {
        const next = new Set(completedPans);
        (currentGroup?.indices || [currentPanIndex]).forEach(i => next.delete(i));
        setCompletedPans(next);
        saveCompleted(next);
    };

    const goToPreviousGroup = () => {
        if (currentGroupPos > 0) setCurrentPanIndex(panGroups[currentGroupPos - 1].indices[0]);
    };
    const goToNextGroup = () => {
        if (currentGroupPos < panGroups.length - 1) setCurrentPanIndex(panGroups[currentGroupPos + 1].indices[0]);
    };

    // Label for a step's dot / heading: "3" for one pan, "3-4" for a group.
    const groupLabel = (g) => g.indices.length > 1
        ? `${g.indices[0] + 1}-${g.indices[g.indices.length - 1] + 1}`
        : `${g.indices[0] + 1}`;

    // Shared step navigation (Back / Skip / Mark Dyed + jump dots + unmark),
    // used by every pan type. Steps over groups, not individual pans. A finished
    // session is read-only, so it shows the jump dots only.
    const panNav = () => (
        <>
            {!isFinished && (
                <div className="flex gap-2 w-full">
                    <button
                        onClick={goToPreviousGroup}
                        disabled={currentGroupPos === 0}
                        className="px-5 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={goToNextGroup}
                        disabled={currentGroupPos >= panGroups.length - 1}
                        title="Skip for now — come back via the step numbers below"
                        className="px-5 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Skip ⏭
                    </button>
                    <button
                        onClick={completeGroup}
                        className="flex-1 px-6 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-teal-600 text-white hover:bg-teal-700"
                    >
                        {groupIsDone(currentGroup)
                            ? 'Next →'
                            : (currentGroup?.indices.length > 1 ? '✓ Mark Both Dyed' : '✓ Mark Dyed')}
                    </button>
                </div>
            )}
            <div className="flex gap-1.5 overflow-x-auto mt-3 px-1 py-2">
                {panGroups.map((g, gi) => (
                    <button
                        key={gi}
                        onClick={() => setCurrentPanIndex(g.indices[0])}
                        title={`${g.indices.length > 1 ? 'Pans' : 'Pan'} ${groupLabel(g)}${groupIsDone(g) ? ' — dyed' : ''}`}
                        className={`flex-shrink-0 min-w-9 h-9 px-2 rounded-full text-sm font-semibold transition-colors ${
                            groupIsDone(g)
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        } ${gi === currentGroupPos ? 'ring-2 ring-teal-400' : ''}`}
                    >
                        {groupLabel(g)}
                    </button>
                ))}
            </div>
            {!isFinished && groupIsDone(currentGroup) && (
                <button
                    onClick={unmarkGroup}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700 underline bg-transparent"
                >
                    ↩ Unmark {currentGroup?.indices.length > 1 ? 'these pans' : 'this pan'} as dyed
                </button>
            )}
        </>
    );
    
    // Get fresh recipe data if pan has a recipe OR color sketch
    const currentRecipe = currentPan?.recipeId 
        ? recipes.find(r => r.id === parseInt(currentPan.recipeId))
        : (currentPan?.recipe || null);
    
    // Get color sketch if this is a Color Lab pan
    const currentColorSketch = currentPan?.type === 'colorLab' && currentPan?.colorSketch 
        ? currentPan.colorSketch 
        : null;

    const scaleIngredients = (recipe, targetWeight, colorSketch = null) => {
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

    // Helper: Convert any cost to cost per gram
    const getCostPerGram = (item) => {
        if (!item || !item.cost) return 0;
        const cost = parseFloat(item.cost);
        const unit = item.unit || 'g';

        // Dyes always store cost as cost-per-GRAM (purchase price ÷ ounces ÷
        // 28.35), independent of the on-hand quantity unit — so don't divide.
        if (item.category === 'dye') return cost;

        // Conversion factors to grams
        const conversions = {
            'g': 1,
            'oz': 28.3495,
            'lb': 453.592,
            'kg': 1000,
            'ml': 1,  // Assume 1ml = 1g for liquids
            'L': 1000,
            'tsp': 5,  // Approximate
            'tbsp': 15  // Approximate
        };
        
        const factor = conversions[unit] || 1;
        return cost / factor;
    };

    // Calculate costs for a pan - returns both total and per-skein breakdown
    const calculatePanCosts = (pan, recipe) => {
        // Safety check
        if (!settings) {
            return {
                yarn: 0, dye: 0, chemicals: 0, ballBands: 0, labels: 0,
                total: 0, perSkein: 0, skeins: 0, skeinDetails: []
            };
        }
        
        let costs = {
            yarn: 0,
            dye: 0,
            chemicals: 0,
            ballBands: 0,
            labels: 0,
            total: 0,
            perSkein: 0,
            skeins: 0,
            skeinDetails: [] // Array of { base, hankSize, cost } for each individual skein
        };

        // Citric acid cost - ~20g per pan
        const citricAcid = findChemicalByRole(inventory, settings, 'citric');
        if (citricAcid) {
            const costPerGram = getCostPerGram(citricAcid);
            costs.chemicals = costPerGram * 20; // 20g per pan
        }

        if (pan.type === 'gradientTray') {
            // Gradient tray costs - all skeins are identical
            costs.skeins = 10;
            
            const yarnItem = findYarnBaseItem(inventory, pan.gradientYarnBase, pan.gradientHankSize);

            const totalGramsYarn = parseFloat(pan.gradientHankSize) * 10;

            // Dye cost
            const dye = findDyeItem(inventory, pan.gradientDye);
            if (dye) {
                const totalDepth = pan.depths.reduce((sum, d) => sum + d, 0);
                const dyeNeeded = (totalGramsYarn * totalDepth) / 100;
                const costPerGram = getCostPerGram(dye);
                costs.dye = dyeNeeded * costPerGram;
            }

            // Ball band - match both yarn base AND hank size
            const ballBand = findBallBand(inventory, pan.gradientYarnBase, pan.gradientHankSize);
            
            // Label - check both 'other' and 'ball band' categories
            const labelItem = findLabelItem(inventory);
            
            // Calculate per-skein cost (all skeins identical)
            const yarnCost = yarnItem?.cost ? parseFloat(yarnItem.cost) : 0;
            const dyeCostPerSkein = costs.dye / 10;
            const chemicalCostPerSkein = costs.chemicals / 10;
            const ballBandCost = ballBand?.cost ? parseFloat(ballBand.cost) : 0;
            const labelCost = labelItem?.cost ? parseFloat(labelItem.cost) : 0;
            
            const costPerSkein = yarnCost + dyeCostPerSkein + chemicalCostPerSkein + ballBandCost + labelCost;
            
            // All 10 skeins have same cost
            for (let i = 0; i < 10; i++) {
                costs.skeinDetails.push({
                    base: pan.gradientYarnBase,
                    hankSize: pan.gradientHankSize,
                    cost: costPerSkein
                });
            }
            
            costs.yarn = yarnCost * 10;
            costs.ballBands = ballBandCost * 10;
            costs.labels = labelCost * 10;

        } else if (pan.type === 'dyeSquareTray') {
            // Dye square tray costs - 25 skeins
            costs.skeins = 25;
            
            const yarnItem = findYarnBaseItem(inventory, pan.gradientYarnBase, pan.gradientHankSize);

            // Dye costs for both colors
            const amounts = [1.25, 2.5, 5, 7.5, 10];
            const dyeA = findDyeItem(inventory, pan.squareColorA);
            const dyeB = findDyeItem(inventory, pan.squareColorB);
            const totalML_each = amounts.reduce((s, a) => s + a, 0) * 5; // each color used 5 times per amount
            if (dyeA) {
                const costPerGram = getCostPerGram(dyeA);
                costs.dye += totalML_each * costPerGram * 0.01; // approximate
            }
            if (dyeB) {
                const costPerGram = getCostPerGram(dyeB);
                costs.dye += totalML_each * costPerGram * 0.01;
            }

            // Ball band
            const ballBand = findBallBand(inventory, pan.gradientYarnBase, pan.gradientHankSize);
            
            const labelItem = findLabelItem(inventory);
            
            const yarnCost = yarnItem?.cost ? parseFloat(yarnItem.cost) : 0;
            const dyeCostPerSkein = costs.dye / 25;
            const chemicalCostPerSkein = costs.chemicals / 25;
            const ballBandCost = ballBand?.cost ? parseFloat(ballBand.cost) : 0;
            const labelCost = labelItem?.cost ? parseFloat(labelItem.cost) : 0;
            
            const costPerSkein = yarnCost + dyeCostPerSkein + chemicalCostPerSkein + ballBandCost + labelCost;
            
            for (let i = 0; i < 25; i++) {
                costs.skeinDetails.push({
                    base: pan.gradientYarnBase,
                    hankSize: pan.gradientHankSize,
                    cost: costPerSkein
                });
            }
            
            costs.yarn = yarnCost * 25;
            costs.ballBands = ballBandCost * 25;
            costs.labels = labelCost * 25;

        } else {
            // Regular pan - calculate based on weight ratios
            const totalWeight = pan.totalWeight || pan.yarns.reduce((sum, y) => 
                sum + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0
            );
            
            costs.skeins = pan.yarns.reduce((sum, y) => sum + parseInt(y.quantity || 0), 0);
            
            // Dye costs from the recipe OR — for Color Lab pans — the color sketch.
            const colorSketch = pan.type === 'colorLab' ? pan.colorSketch : null;
            const dyeSource = recipe || colorSketch;
            if (dyeSource) {
                const scaledIngredients = scaleIngredients(recipe, totalWeight, colorSketch);
                const isVariegated = recipe ? recipe.colorType === 'variegated' : colorSketch?.type === 'variegated';

                if (isVariegated) {
                    // Each solution/section contains the dyes that went into making it.
                    scaledIngredients.forEach(solution => {
                        (solution.dyes || []).forEach(dye => {
                            const amount = parseFloat(dye.scaledAmount || 0);
                            const gramsOfDye = (dye.unit || 'g') === 'ml' ? amount / 100 : amount;
                            const dyeItem = findDyeItem(inventory, dye.name);
                            if (dyeItem) costs.dye += gramsOfDye * getCostPerGram(dyeItem);
                        });
                    });
                } else {
                    // Tonal/Speckled: ingredients have units (ml, g, tsp, tbsp).
                    scaledIngredients.forEach(ing => {
                        const item = findDyeItem(inventory, ing.name);
                        if (item) {
                            const amount = parseFloat(ing.scaledAmount || 0);
                            const unit = ing.unit || 'g';
                            let gramsOfDye = amount;
                            if (unit === 'ml') gramsOfDye = amount / 100;
                            else if (unit === 'tsp') gramsOfDye = amount * 5;
                            else if (unit === 'tbsp') gramsOfDye = amount * 15;
                            costs.dye += gramsOfDye * getCostPerGram(item);
                        }
                    });
                }
            }
            
            // Calculate cost for each individual skein based on weight ratio
            pan.yarns.forEach(yarnGroup => {
                const yarnItem = findYarnBaseItem(inventory, yarnGroup.base, yarnGroup.hankSize);

                // Ball band - match both yarn base AND hank size
                const ballBand = findBallBand(inventory, yarnGroup.base, yarnGroup.hankSize);
                
                const labelItem = findLabelItem(inventory);
                
                const hankSize = parseFloat(yarnGroup.hankSize);
                const quantity = parseInt(yarnGroup.quantity);
                const weightRatio = hankSize / totalWeight; // This skein's proportion of total dye/chemicals
                
                const yarnCost = yarnItem?.cost ? parseFloat(yarnItem.cost) : 0;
                const dyeCostPerSkein = costs.dye * weightRatio;
                const chemicalCostPerSkein = costs.chemicals * weightRatio;
                const ballBandCost = ballBand?.cost ? parseFloat(ballBand.cost) : 0;
                const labelCost = labelItem?.cost ? parseFloat(labelItem.cost) : 0;
                
                const costPerSkein = yarnCost + dyeCostPerSkein + chemicalCostPerSkein + ballBandCost + labelCost;
                
                // Add each individual skein
                for (let i = 0; i < quantity; i++) {
                    costs.skeinDetails.push({
                        base: yarnGroup.base,
                        hankSize: yarnGroup.hankSize,
                        cost: costPerSkein
                    });
                }
                
                costs.yarn += yarnCost * quantity;
                costs.ballBands += ballBandCost * quantity;
                costs.labels += labelCost * quantity;
            });
        }

        costs.total = costs.yarn + costs.dye + costs.chemicals + costs.ballBands + costs.labels;
        costs.perSkein = costs.skeins > 0 ? costs.total / costs.skeins : 0;

        return costs;
    };

    const finishSession = async () => {
        if (!selectedSession) return;
        if (selectedSession.archived) { toast('This session is already finished.', 'error'); return; }
        if (finishing) return;

        const confirmMessage = `Finish session "${selectedSession.name}"?\n\nThis will:\n- Create batches in Pipeline for each pan\n- Deduct yarn, dye and acid from inventory\n- Remove this session from Dye Sessions`;

        if (!(await confirmDialog({ title: 'Finish session', message: confirmMessage, confirmText: 'Finish' }))) return;

        setFinishing(true);

        // Get next batch ID number
        const getNextBatchId = () => {
            const existingBatchIds = batches
                .map(b => b.batchId || b.batch_id)
                .filter(id => id && id.startsWith('B-'))
                .map(id => parseInt(id.substring(2)))
                .filter(n => !isNaN(n));
            
            const maxNum = existingBatchIds.length > 0 ? Math.max(...existingBatchIds) : 0;
            return maxNum + 1;
        };

        let nextBatchNum = getNextBatchId();

        // Create batches for each pan with yarn details and costs
        const movedAt = new Date().toISOString();
        const newBatches = selectedSession.pans.map((pan, idx) => {
            const recipe = pan.recipe || (pan.recipeId ? recipes.find(r => r.id === parseInt(pan.recipeId)) : null);
            const costs = calculatePanCosts(pan, recipe);
            const batchId = `B-${String(nextBatchNum + idx).padStart(3, '0')}`;

            if (pan.type === 'gradientTray') {
                return {
                    id: Date.now() + idx,
                    batchId: batchId,
                    recipeId: '',
                    recipeName: `${pan.gradientDye} Gradient`,
                    colorway: `${pan.gradientDye} Gradient`,
                    customColorway: `${pan.gradientDye} Gradient`,
                    skeins: 10,
                    status: 'dyeing',
                    startDate: selectedSession.date,
                    notes: `Gradient tray from session: ${selectedSession.name}`,
                    yarnDetails: [{ base: pan.gradientYarnBase, hankSize: pan.gradientHankSize, quantity: 10 }],
                    costBreakdown: costs,
                    totalCost: costs.total,
                    costPerSkein: costs.perSkein,
                    lastMovedAt: movedAt,
                    sourceSessionId: selectedSession.id,
                    sourcePanIndex: idx,
                };
            } else if (pan.type === 'dyeSquareTray') {
                return {
                    id: Date.now() + idx,
                    batchId: batchId,
                    recipeId: '',
                    recipeName: `${pan.squareColorA} × ${pan.squareColorB} Dye Square`,
                    colorway: `${pan.squareColorA} × ${pan.squareColorB} Dye Square`,
                    customColorway: `${pan.squareColorA} × ${pan.squareColorB} Dye Square`,
                    skeins: 25,
                    status: 'dyeing',
                    startDate: selectedSession.date,
                    notes: `Dye square tray from session: ${selectedSession.name}`,
                    yarnDetails: [{ base: pan.gradientYarnBase, hankSize: pan.gradientHankSize, quantity: 25 }],
                    costBreakdown: costs,
                    totalCost: costs.total,
                    costPerSkein: costs.perSkein,
                    lastMovedAt: movedAt,
                    sourceSessionId: selectedSession.id,
                    sourcePanIndex: idx,
                };
            } else if (pan.type === 'adHoc') {
                const adHocName = pan.adHocLabel || 'Ad Hoc Experiment';
                const adHocYarns = pan.yarns || [];
                return {
                    id: Date.now() + idx,
                    batchId: batchId,
                    recipeId: '',
                    recipeName: adHocName,
                    colorway: adHocName,
                    customColorway: adHocName,
                    skeins: adHocYarns.reduce((sum, y) => sum + parseInt(y.quantity || 0), 0),
                    status: 'dyeing',
                    startDate: selectedSession.date,
                    notes: `Ad hoc pan from session: ${selectedSession.name}`,
                    experimentNotes: pan.experimentNotes || '',
                    batchNotes: '',
                    yarnDetails: adHocYarns,
                    isAdHoc: true,
                    costBreakdown: costs,
                    totalCost: costs.total,
                    costPerSkein: costs.perSkein,
                    lastMovedAt: movedAt,
                    sourceSessionId: selectedSession.id,
                    sourcePanIndex: idx,
                };
            } else {
                return {
                    id: Date.now() + idx,
                    batchId: batchId,
                    recipeId: pan.recipeId || '',
                    recipeName: pan.recipe?.name || pan.colorway,
                    colorway: pan.colorway,
                    customColorway: pan.colorway,
                    skeins: pan.yarns.reduce((sum, y) => sum + parseInt(y.quantity || 0), 0),
                    status: 'dyeing',
                    startDate: selectedSession.date,
                    notes: `From session: ${selectedSession.name}`,
                    experimentNotes: pan.experimentNotes || '', // Preserve experiment notes from Up Next
                    batchNotes: '', // For notes added during pipeline stages
                    yarnDetails: pan.yarns,
                    colorSketch: pan.colorSketch || null, // Preserve Color Lab data
                    costBreakdown: costs,
                    totalCost: costs.total,
                    costPerSkein: costs.perSkein,
                    lastMovedAt: movedAt,
                    sourceSessionId: selectedSession.id,
                    sourcePanIndex: idx,
                };
            }
        });

        saveBatches([...batches, ...newBatches]);

        // ---- Deduct consumed inventory: yarn + dye + acid ----
        const UNIT_G = { g: 1, oz: 28.3495, lb: 453.592, kg: 1000, ml: 1, L: 1000, tsp: 5, tbsp: 15 };
        const ML_PER = { ml: 1, L: 1000, oz: 29.5735, tsp: 5, tbsp: 15, g: 1 };

        // Recipe amount → grams of dye powder (stock solution: ml ÷ 100).
        const gramsFromAmount = (amount, unit) => {
            const a = parseFloat(amount) || 0;
            if (unit === 'ml') return a / 100;
            if (unit === 'tsp') return a * 5;
            if (unit === 'tbsp') return a * 15;
            return a;
        };
        // Grams of each dye a pan consumes (mirrors the cost breakdown exactly).
        const dyeGramsForPan = (pan, recipe) => {
            const out = {};
            const add = (name, g) => {
                if (!name || !(g > 0)) return;
                const k = String(name).toLowerCase().trim();
                out[k] = (out[k] || 0) + g;
            };
            if (pan.type === 'gradientTray') {
                const totalGramsYarn = (parseFloat(pan.gradientHankSize) || 0) * 10;
                const totalDepth = (pan.depths || []).reduce((s, d) => s + (parseFloat(d) || 0), 0);
                add(pan.gradientDye, (totalGramsYarn * totalDepth) / 100);
            } else if (pan.type === 'dyeSquareTray') {
                const totalMlEach = [1.25, 2.5, 5, 7.5, 10].reduce((s, a) => s + a, 0) * 5;
                add(pan.squareColorA, totalMlEach / 100);
                add(pan.squareColorB, totalMlEach / 100);
            } else {
                // Recipe pan, or a Color Lab pan whose dyes live in its color sketch.
                const colorSketch = pan.type === 'colorLab' ? pan.colorSketch : null;
                if (recipe || colorSketch) {
                    const totalWeight = pan.totalWeight || (pan.yarns || []).reduce((s, y) =>
                        s + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0);
                    const scaled = scaleIngredients(recipe, totalWeight, colorSketch);
                    const isVar = recipe ? recipe.colorType === 'variegated' : colorSketch?.type === 'variegated';
                    if (isVar) {
                        scaled.forEach(sol => (sol.dyes || []).forEach(d => add(d.name, gramsFromAmount(d.scaledAmount, d.unit || 'g'))));
                    } else {
                        scaled.forEach(ing => add(ing.name, gramsFromAmount(ing.scaledAmount, ing.unit || 'g')));
                    }
                }
            }
            return out;
        };

        const updatedInventory = [...inventory];
        let citricGrams = 0, vinegarMl = 0;

        selectedSession.pans.forEach(pan => {
            // --- Yarn ---
            if (pan.type === 'gradientTray') {
                const it = findYarnBaseItem(updatedInventory, pan.gradientYarnBase, pan.gradientHankSize);
                if (it) it.quantity = Math.max(0, parseFloat(it.quantity) - 10);
            } else if (pan.type === 'dyeSquareTray') {
                const it = findYarnBaseItem(updatedInventory, pan.gradientYarnBase, pan.gradientHankSize);
                if (it) it.quantity = Math.max(0, parseFloat(it.quantity) - 25);
            } else {
                (pan.yarns || []).forEach(y => {
                    const it = findYarnBaseItem(updatedInventory, y.base, y.hankSize);
                    if (it) it.quantity = Math.max(0, parseFloat(it.quantity) - (parseInt(y.quantity) || 0));
                });
            }

            // --- Dye powder (recipe grams → ounces, since dyes are stocked in oz) ---
            const recipe = pan.recipe || (pan.recipeId ? recipes.find(r => r.id === parseInt(pan.recipeId)) : null);
            Object.entries(dyeGramsForPan(pan, recipe)).forEach(([nameLc, grams]) => {
                const dyeItem = findDyeItem(updatedInventory, nameLc);
                if (dyeItem) {
                    const curOz = (parseFloat(dyeItem.quantity) || 0) * (UNIT_G[dyeItem.unit || 'g'] || 1) / 28.3495;
                    dyeItem.quantity = Math.max(0, Number((curOz - (grams as number) / 28.3495).toFixed(3)));
                    dyeItem.unit = 'oz';
                }
            });

            // --- Acid (citric or vinegar, with deep-shade + padding) ---
            const acid = panAcidUsage(pan, settings, updatedInventory);
            if (acid.type === 'citric') citricGrams += acid.grams;
            else vinegarMl += acid.ml;
        });

        // Deduct citric acid, keeping its own unit.
        if (citricGrams > 0) {
            const citric = findChemicalByRole(updatedInventory, settings, 'citric');
            if (citric) {
                const per = UNIT_G[citric.unit || 'g'] || 1;
                const curG = (parseFloat(citric.quantity) || 0) * per;
                citric.quantity = Math.max(0, Number(((curG - citricGrams) / per).toFixed(3)));
            }
        }
        // Deduct vinegar if it's tracked as a chemical.
        if (vinegarMl > 0) {
            const vinegar = findChemicalByRole(updatedInventory, settings, 'vinegar');
            if (vinegar) {
                const per = ML_PER[vinegar.unit || 'ml'] || 1;
                const curMl = (parseFloat(vinegar.quantity) || 0) * per;
                vinegar.quantity = Math.max(0, Number(((curMl - vinegarMl) / per).toFixed(3)));
            }
        }

        saveInventory(updatedInventory);

        // Archive session (don't delete it)
        const updatedSessions = dyeSessions.map(s =>
            s.id === selectedSession.id ? { ...s, archived: true } : s
        );
        saveDyeSessions(updatedSessions);

        // Keep the (now archived) session selected so you can still add notes to
        // it — they route to the batches we just created. It drops out of the
        // Queue once you switch to another session.
        localStorage.removeItem('queue_done_' + selectedSession.id);
        setCurrentPanIndex(0);
        setFinishing(false);

        toast('Session finished! Batches added to Pipeline; yarn, dye and acid deducted. You can still add notes here.', 'success');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Queue - Current Dye Session</h2>
            </div>

            {upcomingSessions.length === 0 ? (
                <div className="bg-white rounded-lg card-shadow p-12 text-center">
                    <p className="text-xl text-gray-400 mb-4">📅</p>
                    <p className="text-gray-600 mb-2">No upcoming dye sessions planned</p>
                    <p className="text-sm text-gray-500">Go to Dye Sessions to plan your next session!</p>
                </div>
            ) : (
                <>
                    {/* Session Selector and Finish Button */}
                    <div className="bg-white rounded-lg card-shadow p-4">
                        <div className="flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Active Session</label>
                                <select
                                    value={selectedSessionId}
                                    onChange={(e) => {
                                        setSelectedSessionId(e.target.value);
                                        setCurrentPanIndex(0);
                                    }}
                                    className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-teal-500 text-lg font-medium"
                                >
                                    {upcomingSessions.map(session => (
                                        <option key={session.id} value={session.id}>
                                            {session.archived ? '✓ ' : ''}{session.name} - {DateUtils.formatDate(session.date)} ({session.pans.length} pans){session.archived ? ' — finished' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {isFinished ? (
                                <div className="px-6 py-3 rounded-lg bg-teal-50 border-2 border-teal-300 text-teal-800 font-medium whitespace-nowrap">
                                    ✓ Finished
                                </div>
                            ) : (
                                <button
                                    onClick={finishSession}
                                    disabled={finishing}
                                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {finishing ? 'Finishing…' : '🏁 Finish Session'}
                                </button>
                            )}
                        </div>
                        {isFinished && (
                            <p className="text-sm text-gray-500 mt-2">
                                This session is finished. Notes you add below save straight to its batches in Pipeline.
                            </p>
                        )}
                    </div>

                    {selectedSession && currentPan && (
                        <>
                            {/* Progress Bar */}
                            <div className="bg-white rounded-lg card-shadow p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-medium text-gray-700">
                                        Step {currentGroupPos + 1} of {panGroups.length}
                                        {currentGroup && currentGroup.indices.length > 1
                                            ? ` · Pans ${groupLabel(currentGroup)}`
                                            : ` · Pan ${currentPanIndex + 1}`}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        {completedPans.size} of {selectedSession.pans.length} pans dyed ({Math.round((completedPans.size / selectedSession.pans.length) * 100)}%)
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div
                                        className="bg-teal-600 h-3 rounded-full transition-all"
                                        style={{ width: `${(completedPans.size / selectedSession.pans.length) * 100}%` }}
                                    />
                                </div>
                            </div>

                            {/* Current Pan/Tray Details */}
                            <div className="queue-pan-card bg-gradient-to-br from-teal-50 to-blue-50 rounded-lg card-shadow p-6 border-2 border-teal-300">
                                {currentPan.type === 'gradientTray' ? (
                                    // Gradient Tray Display
                                    <>
                                        <div className="mb-4">
                                            <div className="flex gap-4 items-start">
                                                <div 
                                                    className="w-32 h-32 rounded-lg border-2 flex items-center justify-center flex-shrink-0"
                                                    style={{
                                                        background: `linear-gradient(to right, ${(() => {
                                                            const dye = findDyeItem(inventory, currentPan.gradientDye);
                                                            return dye?.color || '#0d9488';
                                                        })()}15, ${(() => {
                                                            const dye = findDyeItem(inventory, currentPan.gradientDye);
                                                            return dye?.color || '#0d9488';
                                                        })()}60, ${(() => {
                                                            const dye = findDyeItem(inventory, currentPan.gradientDye);
                                                            return dye?.color || '#0d9488';
                                                        })()})`
                                                    }}
                                                >
                                                    <span className="text-5xl">🎨</span>
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                                        🎨 Gradient Tray - {currentPan.gradientDye}
                                                    </h3>
                                                    <p className="text-teal-700 font-medium mb-2">
                                                        Tray #{currentPanIndex + 1} • 10 colors • {currentPan.gradientYarnBase} ({currentPan.gradientHankSize}g)
                                                    </p>
                                                    <div className="flex gap-1 mt-2 flex-wrap">
                                                        {currentPan.depths.map((depth, i) => (
                                                            <div key={i} className="text-xs bg-white px-2 py-1 rounded border font-medium">
                                                                {depth}%
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {panNav()}
                                        {notesBox([currentPanIndex])}
                                    </>
                                ) : currentPan.type === 'dyeSquareTray' ? (
                                    // Dye Square Tray Display
                                    <>
                                        <div className="mb-4">
                                            <div className="flex gap-4 items-start">
                                                <div 
                                                    className="w-32 h-32 rounded-lg border-2 flex items-center justify-center flex-shrink-0"
                                                    style={{
                                                        background: `linear-gradient(135deg, ${(() => {
                                                            const dye = findDyeItem(inventory, currentPan.squareColorA);
                                                            return dye?.color || '#3b82f6';
                                                        })()}80, ${(() => {
                                                            const dye = findDyeItem(inventory, currentPan.squareColorB);
                                                            return dye?.color || '#ef4444';
                                                        })()}80)`
                                                    }}
                                                >
                                                    <span className="text-5xl">🔲</span>
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                                        🔲 Dye Square - {currentPan.squareColorA} × {currentPan.squareColorB}
                                                    </h3>
                                                    <p className="text-teal-700 font-medium mb-2">
                                                        Tray #{currentPanIndex + 1} • 25 squares • {currentPan.gradientYarnBase} ({currentPan.gradientHankSize}g)
                                                    </p>
                                                    <p className="text-sm text-gray-600">
                                                        Each color at: 1.25, 2.5, 5, 7.5, 10 mL
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {panNav()}
                                        {notesBox([currentPanIndex])}
                                    </>
                                ) : currentPan.type === 'adHoc' ? (
                                    // Ad Hoc Pan Display - editable everything
                                    (() => {
                                        const updateAdHocPan = (changes) => {
                                            const updatedSessions = dyeSessions.map(session => {
                                                if (session.id === selectedSession.id) {
                                                    return {
                                                        ...session,
                                                        pans: session.pans.map((pan, idx) =>
                                                            idx === currentPanIndex
                                                                ? { ...pan, ...changes }
                                                                : pan
                                                        )
                                                    };
                                                }
                                                return session;
                                            });
                                            saveDyeSessions(updatedSessions);
                                        };
                                        const adHocYarns = currentPan.yarns || [];
                                        return (
                                            <>
                                                <div className="mb-4">
                                                    <div className="flex gap-4 items-start">
                                                        <div className="w-32 h-32 rounded-lg border-2 border-amber-400 bg-amber-100 flex items-center justify-center flex-shrink-0">
                                                            <span className="text-5xl">🎲</span>
                                                        </div>
                                                        <div className="flex-1">
                                                            <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                                                🎲 {currentPan.adHocLabel || 'Ad Hoc Experiment'}
                                                            </h3>
                                                            <p className="text-amber-700 font-medium mb-2">
                                                                Pan #{currentPanIndex + 1} • Vibe dye mode
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Editable Working Label */}
                                                <div className="bg-white border-2 border-amber-200 rounded-lg p-4 mb-4">
                                                    <label className="block text-sm font-semibold text-gray-900 mb-2">Working Label / Colorway Name</label>
                                                    <input
                                                        type="text"
                                                        value={currentPan.adHocLabel || ''}
                                                        onChange={(e) => updateAdHocPan({ adHocLabel: e.target.value })}
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500"
                                                        placeholder="Name this experiment..."
                                                    />
                                                </div>

                                                {/* Editable Yarns Used */}
                                                <div className="bg-white border-2 border-amber-200 rounded-lg p-4 mb-4">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <label className="text-sm font-semibold text-gray-900">Yarns Used</label>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateAdHocPan({
                                                                yarns: [...adHocYarns, { base: '', hankSize: '', quantity: 1 }]
                                                            })}
                                                            className="text-xs text-amber-700 hover:text-amber-900 font-medium"
                                                        >
                                                            + Add Yarn
                                                        </button>
                                                    </div>
                                                    {adHocYarns.length === 0 ? (
                                                        <p className="text-sm text-gray-500 italic">No yarns logged yet. Add what you actually used so inventory deducts correctly.</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {adHocYarns.map((yarn, idx) => (
                                                                <div key={idx} className="flex gap-2 items-center">
                                                                    <select
                                                                        value={yarn.base || ''}
                                                                        onChange={(e) => {
                                                                            const newYarns = [...adHocYarns];
                                                                            newYarns[idx] = { ...newYarns[idx], base: e.target.value, hankSize: '' };
                                                                            updateAdHocPan({ yarns: newYarns });
                                                                        }}
                                                                        className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 bg-white"
                                                                    >
                                                                        <option value="">Yarn base...</option>
                                                                        {Object.keys(yarnBases).sort((a, b) => a.localeCompare(b)).map(baseName => (
                                                                            <option key={baseName} value={baseName}>{baseName}</option>
                                                                        ))}
                                                                    </select>
                                                                    <select
                                                                        value={yarn.hankSize || ''}
                                                                        onChange={(e) => {
                                                                            const newYarns = [...adHocYarns];
                                                                            newYarns[idx] = { ...newYarns[idx], hankSize: e.target.value };
                                                                            updateAdHocPan({ yarns: newYarns });
                                                                        }}
                                                                        disabled={!yarn.base}
                                                                        className="w-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 bg-white disabled:bg-gray-100"
                                                                    >
                                                                        <option value="">Size...</option>
                                                                        {yarn.base && getAvailableHankSizes(yarn.base).map(size => (
                                                                            <option key={size} value={size}>{size}g</option>
                                                                        ))}
                                                                    </select>
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        value={yarn.quantity || 1}
                                                                        onChange={(e) => {
                                                                            const newYarns = [...adHocYarns];
                                                                            newYarns[idx] = { ...newYarns[idx], quantity: e.target.value };
                                                                            updateAdHocPan({ yarns: newYarns });
                                                                        }}
                                                                        className="w-16 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500"
                                                                        placeholder="Qty"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const newYarns = adHocYarns.filter((_, i) => i !== idx);
                                                                            updateAdHocPan({ yarns: newYarns });
                                                                        }}
                                                                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {panNav()}
                                                {notesBox([currentPanIndex])}
                                            </>
                                        );
                                    })()
                                ) : (
                                    // Regular Pan Display
                                    <>
                                <div className="mb-4">
                                    <div className="flex justify-between items-start gap-4 mb-4">
                                        <div className="flex gap-4 items-start flex-1">
                                            {currentRecipe?.photo && (
                                                <img 
                                                    src={currentRecipe.photo} 
                                                    alt={currentPan.colorway}
                                                    className="rounded-lg border-2 border-teal-300 shadow-md flex-shrink-0"
                                                    style={{width: '120px', height: '120px', objectFit: 'cover'}}
                                                />
                                            )}
                                            <div className="flex-1">
                                                <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                                    🎨 {currentPan.colorway}
                                                </h3>
                                                <p className="text-teal-700 font-medium mb-2">
                                                    {isMultiPan
                                                        ? `Pans ${groupLabel(currentGroup)} — dye together`
                                                        : `Pan #${currentPanIndex + 1}`} • {combinedWeight}g total{isMultiPan ? ` (${groupPans.map(p => `${p.totalWeight}g`).join(' + ')})` : ''}
                                                </p>
                                                {currentRecipe?.colorType && (
                                                    <p className="text-sm text-gray-700">
                                                        <span className="font-medium">Color Type:</span> <span className="capitalize">{currentRecipe.colorType}</span>
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {panNav()}
                                </div>

                                {notesBox(groupIndices)}

                                {/* Recipe & Scaled Ingredients (scaled dye amounts — the
                                    primary thing while dyeing, kept right under the nav) */}
                                {(currentRecipe || currentColorSketch) ? (
                                    <div className="bg-white rounded-lg p-4">
                                        <h4 className="font-semibold text-gray-900 mb-3">
                                            {currentColorSketch ? (
                                                <>
                                                    🧪 Color Lab: {currentColorSketch.colorId}{currentColorSketch.customName ? ' - ' + currentColorSketch.customName : ''}
                                                    <span className="text-sm text-gray-500 ml-2">
                                                        (scaled from {currentColorSketch.yarnWeight}g to {combinedWeight}g)
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    Recipe: {currentRecipe.name}
                                                    <span className="text-sm text-gray-500 ml-2">
                                                        (scaled from {currentRecipe.yarnWeight}g to {combinedWeight}g{isMultiPan ? ` · for all ${groupPans.length} pans` : ''})
                                                    </span>
                                                </>
                                            )}
                                        </h4>
                                        <div className="space-y-2">
                                            {(currentColorSketch?.type === 'variegated' || currentRecipe?.colorType === 'variegated') ? (
                                                // Display scaled color solutions or variegated sections
                                                scaleIngredients(currentRecipe, combinedWeight, currentColorSketch).map((solution, idx) => (
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
                                            ) : (
                                                // Display regular scaled ingredients (tonal or speckled)
                                                scaleIngredients(currentRecipe, combinedWeight, currentColorSketch).map((ing, idx) => (
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
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                                        <p className="text-yellow-800">
                                            ⚠️ No recipe linked to this pan. Ingredients need to be calculated manually.
                                        </p>
                                    </div>
                                )}

                                {/* Yarns in Pan(s) */}
                                <div className="bg-white rounded-lg p-4 mb-4 mt-4">
                                    <h4 className="font-semibold text-gray-900 mb-3">{isMultiPan ? 'Yarns in These Pans:' : 'Yarns in This Pan:'}</h4>
                                    <div className="space-y-3">
                                        {groupPans.map((p, gi) => (
                                            <div key={gi}>
                                                {isMultiPan && (
                                                    <div className="text-sm font-semibold text-gray-600 mb-1">
                                                        Pan #{groupIndices[gi] + 1} • {p.totalWeight}g
                                                    </div>
                                                )}
                                                <div className="space-y-2">
                                                    {(p.yarns || []).map((yarn, idx) => (
                                                        <div key={idx} className="flex justify-between items-center p-3 bg-teal-50 rounded border-l-4 border-teal-500">
                                                            <span className="font-medium">
                                                                {yarn.quantity}x {yarn.base} ({yarn.hankSize}g each)
                                                            </span>
                                                            <span className="text-teal-700 font-semibold">
                                                                {yarn.quantity * parseFloat(yarn.hankSize)}g total
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Instructions */}
                                {currentRecipe?.instructions && (
                                    <div className="bg-white rounded-lg p-4 mb-4">
                                        <h4 className="font-semibold text-gray-900 mb-2">Instructions:</h4>
                                        <p className="text-gray-700 whitespace-pre-line">{currentRecipe.instructions}</p>
                                    </div>
                                )}

                                </>
                                )}

                            </div>

                            {/* Upcoming Steps Preview — color, weight and yarns for each */}
                            {!isFinished && currentGroupPos < panGroups.length - 1 && (
                                <div className="bg-white rounded-lg card-shadow p-4">
                                    <h4 className="font-semibold text-gray-700 mb-3">Coming Up Next:</h4>
                                    <div className="space-y-2">
                                        {panGroups.slice(currentGroupPos + 1, currentGroupPos + 4).map((g, gi) => {
                                            const gp = g.indices.map(i => selectedSession.pans[i]);
                                            const wt = gp.reduce((s, p) => s + panWeight(p), 0);
                                            return (
                                                <div key={gi} className="p-3 bg-gray-50 rounded border">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <span className="font-medium text-gray-900">
                                                            {g.indices.length > 1 ? `Pans ${groupLabel(g)}` : `Pan #${g.indices[0] + 1}`}: {panTitle(gp[0])}
                                                        </span>
                                                        <span className="text-sm text-gray-500 whitespace-nowrap">{wt}g</span>
                                                    </div>
                                                    {gp.map((p, pi) => {
                                                        const summary = yarnSummary(p);
                                                        return summary ? (
                                                            <div key={pi} className="text-xs text-gray-600 mt-1">
                                                                {g.indices.length > 1 ? `Pan #${g.indices[pi] + 1}: ` : ''}{summary}
                                                            </div>
                                                        ) : null;
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// Inventory Component
