import React, { useState, useEffect } from 'react';
import { DateUtils } from '../lib/dates';

export function UpNext({ dyeSessions, saveDyeSessions, batches, saveBatches, inventory, saveInventory, recipes, settings, colorSketches, saveColorSketches }) {
    const [selectedSessionId, setSelectedSessionId] = useState(() => localStorage.getItem('queue_session') || '');
    const [currentPanIndex, setCurrentPanIndex] = useState(() => Number(localStorage.getItem('queue_pan')) || 0);
    // Pan indices marked "dyed" this session (fills the progress dots).
    const [completedPans, setCompletedPans] = useState(() => new Set<number>());

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

    // Get all non-archived sessions with pans
    const upcomingSessions = dyeSessions
        .filter(s => !s.archived && s.pans.length > 0)
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

    // Mark the current pan dyed (fills its dot) and advance to the next.
    const completePan = () => {
        const next = new Set(completedPans);
        next.add(currentPanIndex);
        setCompletedPans(next);
        saveCompleted(next);
        if (currentPanIndex < selectedSession.pans.length - 1) setCurrentPanIndex(currentPanIndex + 1);
    };

    // Undo "dyed" for a pan (no navigation).
    const unmarkPan = (idx) => {
        const next = new Set(completedPans);
        next.delete(idx);
        setCompletedPans(next);
        saveCompleted(next);
    };

    // Shared pan navigation (Back / Skip / Mark Dyed + jump dots + unmark),
    // used by every pan type. Returns elements (closes over current state).
    const panNav = () => (
        <>
            <div className="flex gap-2 w-full">
                <button
                    onClick={goToPreviousPan}
                    disabled={currentPanIndex === 0}
                    className="px-5 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    ← Back
                </button>
                <button
                    onClick={() => currentPanIndex < selectedSession.pans.length - 1 && setCurrentPanIndex(currentPanIndex + 1)}
                    disabled={currentPanIndex >= selectedSession.pans.length - 1}
                    title="Skip for now — come back via the pan numbers below"
                    className="px-5 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Skip ⏭
                </button>
                <button
                    onClick={completePan}
                    className="flex-1 px-6 py-3 rounded-lg font-semibold text-lg shadow-md transition-colors bg-teal-600 text-white hover:bg-teal-700"
                >
                    {completedPans.has(currentPanIndex) ? 'Next Pan →' : '✓ Mark Dyed'}
                </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto mt-3 px-1 py-2">
                {selectedSession.pans.map((p, i) => (
                    <button
                        key={i}
                        onClick={() => setCurrentPanIndex(i)}
                        title={`Pan ${i + 1}${completedPans.has(i) ? ' — dyed' : ''}`}
                        className={`flex-shrink-0 w-9 h-9 rounded-full text-sm font-semibold transition-colors ${
                            completedPans.has(i)
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        } ${i === currentPanIndex ? 'ring-2 ring-teal-400' : ''}`}
                    >
                        {i + 1}
                    </button>
                ))}
            </div>
            {completedPans.has(currentPanIndex) && (
                <button
                    onClick={() => unmarkPan(currentPanIndex)}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700 underline bg-transparent"
                >
                    ↩ Unmark this pan as dyed
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
        const citricAcid = inventory.find(i => 
            i.category === 'chemical' && 
            i.name.toLowerCase().includes('citric')
        );
        if (citricAcid) {
            const costPerGram = getCostPerGram(citricAcid);
            costs.chemicals = costPerGram * 20; // 20g per pan
        }

        if (pan.type === 'gradientTray') {
            // Gradient tray costs - all skeins are identical
            costs.skeins = 10;
            
            const yarnItem = inventory.find(i => 
                i.category === 'yarn base' && 
                i.name === pan.gradientYarnBase && 
                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
            );
            
            const totalGramsYarn = parseFloat(pan.gradientHankSize) * 10;
            
            // Dye cost
            const dye = inventory.find(i => i.category === 'dye' && i.name === pan.gradientDye);
            if (dye) {
                const totalDepth = pan.depths.reduce((sum, d) => sum + d, 0);
                const dyeNeeded = (totalGramsYarn * totalDepth) / 100;
                const costPerGram = getCostPerGram(dye);
                costs.dye = dyeNeeded * costPerGram;
            }

            // Ball band - match both yarn base AND hank size
            const ballBand = inventory.find(i => 
                i.category === 'ball band' && 
                i.forYarnBase === pan.gradientYarnBase &&
                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
            );
            
            // Label - check both 'other' and 'ball band' categories
            const labelItem = inventory.find(i => 
                (i.category === 'other' || i.category === 'ball band') && 
                i.name?.toLowerCase().includes('label')
            );
            
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
            
            const yarnItem = inventory.find(i => 
                i.category === 'yarn base' && 
                i.name === pan.gradientYarnBase && 
                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
            );
            
            // Dye costs for both colors
            const amounts = [1.25, 2.5, 5, 7.5, 10];
            const dyeA = inventory.find(i => i.category === 'dye' && i.name === pan.squareColorA);
            const dyeB = inventory.find(i => i.category === 'dye' && i.name === pan.squareColorB);
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
            const ballBand = inventory.find(i => 
                i.category === 'ball band' && 
                i.forYarnBase === pan.gradientYarnBase &&
                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
            );
            
            const labelItem = inventory.find(i => 
                (i.category === 'other' || i.category === 'ball band') && 
                i.name?.toLowerCase().includes('label')
            );
            
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
            
            // Dye and additional chemical costs from recipe
            if (recipe) {
                const scaledIngredients = scaleIngredients(recipe, totalWeight);
                console.log('🎨 DYE COST DEBUG:', { 
                    recipeName: recipe.name,
                    colorType: recipe.colorType,
                    totalWeight,
                    scaledIngredients 
                });
                
                if (recipe.colorType === 'variegated') {
                    // For variegated: each solution contains dyes
                    // When you use the solution, you use ALL the dyes that went into making it
                    scaledIngredients.forEach(solution => {
                        console.log('  Solution:', solution.scaledTargetMl + 'ml');
                        solution.dyes.forEach(dye => {
                            const amount = parseFloat(dye.scaledAmount || 0);
                            const unit = dye.unit || 'g';
                            
                            // Convert to grams
                            let gramsOfDye = amount;
                            if (unit === 'ml') {
                                // For stock solutions: ml of stock / 100 = grams of dye powder
                                gramsOfDye = amount / 100;
                            }
                            // else already in grams
                            
                            const dyeItem = inventory.find(i => i.category === 'dye' && i.name === dye.name);
                            if (dyeItem) {
                                const costPerGram = getCostPerGram(dyeItem);
                                const dyeCost = gramsOfDye * costPerGram;
                                console.log('    -', dye.name, ':', gramsOfDye + 'g', '(from ' + amount + unit + ') ×', '$' + costPerGram.toFixed(4) + '/g', '=', '$' + dyeCost.toFixed(4));
                                costs.dye += dyeCost;
                            } else {
                                console.log('    -', dye.name, ': NOT FOUND IN INVENTORY');
                            }
                        });
                    });
                } else {
                    // Tonal/Speckled: ingredients have units (ml, g, tsp, tbsp)
                    scaledIngredients.forEach(ing => {
                        const item = inventory.find(i => i.name === ing.name);
                        if (item && item.category === 'dye') {
                            const amount = parseFloat(ing.scaledAmount || 0);
                            const unit = ing.unit || 'g';
                            
                            // Convert amount to grams based on unit
                            let gramsOfDye = amount;
                            if (unit === 'ml') {
                                // For stock solutions: 1% = 1g dye per 100ml
                                // So 450ml of stock solution = 450/100 = 4.5g of dye powder
                                gramsOfDye = amount / 100;
                            } else if (unit === 'tsp') {
                                gramsOfDye = amount * 5; // 1 tsp ≈ 5g
                            } else if (unit === 'tbsp') {
                                gramsOfDye = amount * 15; // 1 tbsp ≈ 15g
                            }
                            // else unit is already 'g'
                            
                            const costPerGram = getCostPerGram(item);
                            const dyeCost = gramsOfDye * costPerGram;
                            console.log('  -', ing.name, ':', gramsOfDye + 'g', '(from ' + amount + unit + ') ×', '$' + costPerGram.toFixed(4) + '/g', '=', '$' + dyeCost.toFixed(4));
                            costs.dye += dyeCost;
                        } else if (item) {
                            console.log('  -', ing.name, ': not a dye (category:', item.category + ')');
                        }
                    });
                }
            }
            
            // Calculate cost for each individual skein based on weight ratio
            pan.yarns.forEach(yarnGroup => {
                const yarnItem = inventory.find(i => 
                    i.category === 'yarn base' && 
                    i.name === yarnGroup.base && 
                    parseFloat(i.hankSize) === parseFloat(yarnGroup.hankSize)
                );
                
                // Ball band - match both yarn base AND hank size
                const ballBand = inventory.find(i => 
                    i.category === 'ball band' && 
                    i.forYarnBase === yarnGroup.base &&
                    parseFloat(i.hankSize) === parseFloat(yarnGroup.hankSize)
                );
                
                const labelItem = inventory.find(i => 
                    (i.category === 'other' || i.category === 'ball band') && 
                    i.name?.toLowerCase().includes('label')
                );
                
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

    const markPanComplete = () => {
        if (currentPanIndex < selectedSession.pans.length - 1) {
            setCurrentPanIndex(currentPanIndex + 1);
        } else {
            if (confirm('All pans in this session are complete! Mark session as finished?')) {
                finishSession();
            }
        }
    };

    const finishSession = () => {
        if (!selectedSession) return;

        const confirmMessage = `Finish session "${selectedSession.name}"?\n\nThis will:\n- Create batches in Pipeline for each pan\n- Deduct yarn from inventory\n- Remove this session from Dye Sessions`;
        
        if (!confirm(confirmMessage)) return;

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
                    costPerSkein: costs.perSkein
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
                    costPerSkein: costs.perSkein
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
                    costPerSkein: costs.perSkein
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
                    costPerSkein: costs.perSkein
                };
            }
        });

        saveBatches([...batches, ...newBatches]);

        // Deduct yarn from inventory
        const updatedInventory = [...inventory];
        selectedSession.pans.forEach(pan => {
            if (pan.type === 'gradientTray') {
                // Deduct 10 skeins for gradient tray
                const inventoryItem = updatedInventory.find(
                    item => item.category === 'yarn base' && 
                            item.name === pan.gradientYarnBase && 
                            parseFloat(item.hankSize) === parseFloat(pan.gradientHankSize)
                );
                if (inventoryItem) {
                    inventoryItem.quantity = Math.max(0, parseFloat(inventoryItem.quantity) - 10);
                }
            } else if (pan.type === 'dyeSquareTray') {
                // Deduct 25 skeins for dye square tray
                const inventoryItem = updatedInventory.find(
                    item => item.category === 'yarn base' && 
                            item.name === pan.gradientYarnBase && 
                            parseFloat(item.hankSize) === parseFloat(pan.gradientHankSize)
                );
                if (inventoryItem) {
                    inventoryItem.quantity = Math.max(0, parseFloat(inventoryItem.quantity) - 25);
                }
            } else {
                // Deduct regular pan yarns
                pan.yarns.forEach(yarnInPan => {
                    const inventoryItem = updatedInventory.find(
                        item => item.category === 'yarn base' && 
                                item.name === yarnInPan.base && 
                                parseFloat(item.hankSize) === parseFloat(yarnInPan.hankSize)
                    );
                    
                    if (inventoryItem) {
                        const quantityToDeduct = parseInt(yarnInPan.quantity || 0);
                        inventoryItem.quantity = Math.max(0, parseFloat(inventoryItem.quantity) - quantityToDeduct);
                    }
                });
            }
        });
        saveInventory(updatedInventory);

        // Archive session (don't delete it)
        const updatedSessions = dyeSessions.map(s => 
            s.id === selectedSession.id ? { ...s, archived: true } : s
        );
        saveDyeSessions(updatedSessions);

        // Reset selection
        setCurrentPanIndex(0);
        setSelectedSessionId('');

        alert('Session completed! Batches added to Pipeline, inventory updated, and session archived.');
    };

    const goToPreviousPan = () => {
        if (currentPanIndex > 0) {
            setCurrentPanIndex(currentPanIndex - 1);
        }
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
                                            {session.name} - {DateUtils.formatDate(session.date)} ({session.pans.length} pans)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={finishSession}
                                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium whitespace-nowrap"
                            >
                                🏁 Finish Session
                            </button>
                        </div>
                    </div>

                    {selectedSession && currentPan && (
                        <>
                            {/* Progress Bar */}
                            <div className="bg-white rounded-lg card-shadow p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-medium text-gray-700">
                                        Pan {currentPanIndex + 1} of {selectedSession.pans.length}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        {completedPans.size} of {selectedSession.pans.length} dyed ({Math.round((completedPans.size / selectedSession.pans.length) * 100)}%)
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
                                                            const dye = inventory.find(i => i.name === currentPan.gradientDye);
                                                            return dye?.color || '#0d9488';
                                                        })()}15, ${(() => {
                                                            const dye = inventory.find(i => i.name === currentPan.gradientDye);
                                                            return dye?.color || '#0d9488';
                                                        })()}60, ${(() => {
                                                            const dye = inventory.find(i => i.name === currentPan.gradientDye);
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
                                                            const dye = inventory.find(i => i.name === currentPan.squareColorA);
                                                            return dye?.color || '#3b82f6';
                                                        })()}80, ${(() => {
                                                            const dye = inventory.find(i => i.name === currentPan.squareColorB);
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

                                                {/* Prominent Dyeing Notes */}
                                                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-4">
                                                    <h4 className="font-semibold text-amber-900 mb-2">🎲 Dyeing Notes</h4>
                                                    <textarea
                                                        value={currentPan.experimentNotes || ''}
                                                        onChange={(e) => updateAdHocPan({ experimentNotes: e.target.value })}
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 resize-y bg-white"
                                                        rows={5}
                                                        placeholder="What did you do? Capture it now so you can recreate it (or avoid it) later.
Examples:
- Dyes used and approximate amounts
- Technique (low water immersion, hand-painted, etc.)
- Results vs. what you expected
- What to change next time"
                                                    />
                                                    <p className="text-xs text-amber-700 mt-2">
                                                        💡 These notes flow through to the batch in Pipeline so you'll have a record.
                                                    </p>
                                                </div>

                                                {panNav()}
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
                                                    Pan #{currentPanIndex + 1} • {currentPan.totalWeight}g total
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

                                {/* Recipe & Scaled Ingredients (scaled dye amounts — the
                                    primary thing while dyeing, kept right under the nav) */}
                                {(currentRecipe || currentColorSketch) ? (
                                    <div className="bg-white rounded-lg p-4">
                                        <h4 className="font-semibold text-gray-900 mb-3">
                                            {currentColorSketch ? (
                                                <>
                                                    🧪 Color Lab: {currentColorSketch.colorId}{currentColorSketch.customName ? ' - ' + currentColorSketch.customName : ''}
                                                    <span className="text-sm text-gray-500 ml-2">
                                                        (scaled from {currentColorSketch.yarnWeight}g to {currentPan.totalWeight}g)
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    Recipe: {currentRecipe.name}
                                                    <span className="text-sm text-gray-500 ml-2">
                                                        (scaled from {currentRecipe.yarnWeight}g to {currentPan.totalWeight}g)
                                                    </span>
                                                </>
                                            )}
                                        </h4>
                                        <div className="space-y-2">
                                            {(currentColorSketch?.type === 'variegated' || currentRecipe?.colorType === 'variegated') ? (
                                                // Display scaled color solutions or variegated sections
                                                scaleIngredients(currentRecipe, currentPan.totalWeight, currentColorSketch).map((solution, idx) => (
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
                                                scaleIngredients(currentRecipe, currentPan.totalWeight, currentColorSketch).map((ing, idx) => (
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

                                {/* Yarns in Pan */}
                                <div className="bg-white rounded-lg p-4 mb-4 mt-4">
                                    <h4 className="font-semibold text-gray-900 mb-3">Yarns in This Pan:</h4>
                                    <div className="space-y-2">
                                        {currentPan.yarns.map((yarn, idx) => (
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

                                {/* Instructions */}
                                {currentRecipe?.instructions && (
                                    <div className="bg-white rounded-lg p-4 mb-4">
                                        <h4 className="font-semibold text-gray-900 mb-2">Instructions:</h4>
                                        <p className="text-gray-700 whitespace-pre-line">{currentRecipe.instructions}</p>
                                    </div>
                                )}

                                {/* Editable Notes Section for Color Lab */}
                                {currentColorSketch && (
                                    <div className="bg-teal-50 border-2 border-teal-300 rounded-lg p-4 mt-4">
                                        <h4 className="font-semibold text-teal-900 mb-2">📝 Experiment Notes</h4>
                                        <textarea
                                            value={currentPan.experimentNotes || ''}
                                            onChange={(e) => {
                                                const newNotes = e.target.value;
                                                
                                                // Update the pan in the dye session
                                                const updatedSessions = dyeSessions.map(session => {
                                                    if (session.id === selectedSession.id) {
                                                        return {
                                                            ...session,
                                                            pans: session.pans.map((pan, idx) => 
                                                                idx === currentPanIndex 
                                                                    ? { ...pan, experimentNotes: newNotes }
                                                                    : pan
                                                            )
                                                        };
                                                    }
                                                    return session;
                                                });
                                                saveDyeSessions(updatedSessions);
                                                
                                                // Also update the original color sketch
                                                if (currentPan.colorSketchId) {
                                                    const updatedSketches = colorSketches.map(sketch =>
                                                        sketch.id === currentPan.colorSketchId
                                                            ? { ...sketch, experimentNotes: newNotes }
                                                            : sketch
                                                    );
                                                    saveColorSketches(updatedSketches);
                                                }
                                            }}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 resize-y"
                                            rows={4}
                                            placeholder="Add notes about this color experiment...
Examples:
- Dye absorption observations
- Color results vs. expected
- Adjustments made during dyeing
- Ideas for next iteration"
                                        />
                                        <p className="text-xs text-teal-600 mt-2">
                                            💡 Use this to track what works and what doesn't for future reference
                                        </p>
                                    </div>
                                )}
                                </>
                                )}

                            </div>

                            {/* Upcoming Pans Preview */}
                            {currentPanIndex < selectedSession.pans.length - 1 && (
                                <div className="bg-white rounded-lg card-shadow p-4">
                                    <h4 className="font-semibold text-gray-700 mb-3">Coming Up Next:</h4>
                                    <div className="space-y-2">
                                        {selectedSession.pans.slice(currentPanIndex + 1, currentPanIndex + 4).map((pan, idx) => (
                                            <div key={pan.id} className="flex justify-between items-center p-3 bg-gray-50 rounded border">
                                                <div>
                                                    <span className="font-medium text-gray-900">
                                                        Pan #{currentPanIndex + idx + 2}: {pan.colorway}
                                                    </span>
                                                    <span className="text-sm text-gray-500 ml-2">
                                                        ({pan.totalWeight}g)
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Cost Breakdown */}
                            {(() => {
                                const costs = calculatePanCosts(currentPan, currentRecipe);
                                return (
                                    <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4 mt-4">
                                        <h4 className="font-semibold text-green-900 mb-3">💰 Cost Breakdown</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                            <div className="flex justify-between">
                                                <span className="text-gray-700">Yarn:</span>
                                                <span className="font-medium">${costs.yarn.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-700">Dye:</span>
                                                <span className="font-medium">${costs.dye.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-700">Chemicals:</span>
                                                <span className="font-medium">${costs.chemicals.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-700">Ball Bands:</span>
                                                <span className="font-medium">${costs.ballBands.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-700">Labels:</span>
                                                <span className="font-medium">${costs.labels.toFixed(2)}</span>
                                            </div>
                                        </div>
                                        <div className="border-t-2 border-green-400 pt-2">
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-green-900">Total Cost:</span>
                                                <span className="font-bold text-xl text-green-900">${costs.total.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-sm text-gray-700">Average ({costs.skeins} skeins):</span>
                                                <span className="font-semibold text-green-800">${costs.perSkein.toFixed(2)}/skein</span>
                                            </div>
                                            
                                            {/* Per-skein details grouped by base+size */}
                                            {costs.skeinDetails && costs.skeinDetails.length > 0 && (() => {
                                                // Group by base+hankSize
                                                const grouped = costs.skeinDetails.reduce<Record<string, { count: number; cost: number }>>((acc, skein) => {
                                                    const key = `${skein.base} ${skein.hankSize}g`;
                                                    if (!acc[key]) {
                                                        acc[key] = { count: 0, cost: skein.cost };
                                                    }
                                                    acc[key].count++;
                                                    return acc;
                                                }, {});
                                                
                                                return (
                                                    <div className="mt-3 pt-2 border-t border-green-300">
                                                        <div className="text-xs font-semibold text-green-900 mb-1">Cost per skein type:</div>
                                                        {Object.entries(grouped).map(([key, {count, cost}]) => (
                                                            <div key={key} className="flex justify-between text-xs text-gray-700">
                                                                <span>{count}x {key}:</span>
                                                                <span className="font-medium">${cost.toFixed(2)} each</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// Inventory Component
