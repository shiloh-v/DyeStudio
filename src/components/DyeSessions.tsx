import { useState } from 'react';
import { DateUtils } from '../lib/dates';
import type { Pan } from '../types';

export function DyeSessions({ dyeSessions, saveDyeSessions, recipes, inventory, settings, kits, colorSketches }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [expandedSessions, setExpandedSessions] = useState({});
    const [showArchived, setShowArchived] = useState(false);
    const [formData, setFormData] = useState<{ name: string; date: string; pans: Pan[]; notes: string }>({
        name: '',
        date: DateUtils.getTodayEST(),
        pans: [],
        notes: ''
    });
    const [currentPan, setCurrentPan] = useState<Pan>({
        type: 'pan', // 'pan', 'gradientTray', 'dyeSquareTray', 'kit', or 'colorLab'
        colorway: '',
        recipeId: '',
        capacity: 300,
        yarns: [{ base: '', hankSize: '', quantity: 1 }],
        // Gradient tray specific
        gradientDye: '',
        gradientYarnBase: '',
        gradientHankSize: '',
        // Dye square tray specific
        squareColorA: '',
        squareColorB: '',
        // Color Lab specific
        colorSketchId: '',
        // Kit specific
        kitId: '',
        kitName: '',
        kitColors: [],
        kitSelectedColorIds: [],
        kitYarns: [{ base: '', hankSize: '', quantity: 1 }]
    });

    // Calculate oven capacity (pans count as 1, gradient trays count as 2, dye square trays count as 4)
    const calculateOvenLoad = (pans) => {
        return pans.reduce((total, pan) => {
            if (pan.type === 'dyeSquareTray') return total + 4;
            if (pan.type === 'gradientTray') return total + 2;
            return total + 1;
        }, 0);
    };

    const MAX_OVEN_CAPACITY = 18;

    // Calculate what a set of pans needs: yarn, ball bands, dyes.
    // Used both for per-session shortage checks AND for accumulating commitments
    // across multiple planned (non-archived) sessions so we can warn earlier.
    const calculatePanNeeds = (pans) => {
        const yarnNeeded: Record<string, number> = {};
        const ballBandsNeeded: Record<string, number> = {};
        const dyesNeeded: Record<string, boolean> = {};

        (pans || []).forEach(pan => {
            if (pan.type === 'gradientTray') {
                const yKey = `${pan.gradientYarnBase}-${pan.gradientHankSize}`;
                yarnNeeded[yKey] = (yarnNeeded[yKey] || 0) + 10;
                ballBandsNeeded[yKey] = (ballBandsNeeded[yKey] || 0) + 10;
                if (pan.gradientDye) dyesNeeded[pan.gradientDye] = true;
            } else if (pan.type === 'dyeSquareTray') {
                const yKey = `${pan.gradientYarnBase}-${pan.gradientHankSize}`;
                yarnNeeded[yKey] = (yarnNeeded[yKey] || 0) + 25;
                ballBandsNeeded[yKey] = (ballBandsNeeded[yKey] || 0) + 25;
                if (pan.squareColorA) dyesNeeded[pan.squareColorA] = true;
                if (pan.squareColorB) dyesNeeded[pan.squareColorB] = true;
            } else {
                (pan.yarns || []).forEach(yarn => {
                    const yKey = `${yarn.base}-${yarn.hankSize}`;
                    const qty = parseInt(yarn.quantity) || 0;
                    yarnNeeded[yKey] = (yarnNeeded[yKey] || 0) + qty;
                    ballBandsNeeded[yKey] = (ballBandsNeeded[yKey] || 0) + qty;
                });
                if (pan.recipeId) {
                    const recipe = recipes.find(r => r.id === parseInt(pan.recipeId));
                    if (recipe) {
                        if (recipe.colorType === 'variegated' && recipe.colorSolutions) {
                            recipe.colorSolutions.forEach(sol => {
                                sol.dyes.forEach(d => dyesNeeded[d.name] = true);
                            });
                        } else if (recipe.ingredients) {
                            recipe.ingredients.forEach(ing => {
                                const item = inventory.find(i => i.name === ing.name);
                                if (item?.category === 'dye') dyesNeeded[ing.name] = true;
                            });
                        }
                    }
                }
            }
        });

        return { yarnNeeded, ballBandsNeeded, dyesNeeded };
    };

    // Build a map of yarn/ball band commitments from all currently-planned
    // (non-archived) sessions, optionally excluding one session by id.
    // This lets us subtract already-spoken-for yarn from on-hand inventory
    // so a second planned session correctly shows a shortage warning.
    const calculateCommittedNeeds = (excludeSessionId = null) => {
        const committed: { yarnNeeded: Record<string, number>; ballBandsNeeded: Record<string, number> } = { yarnNeeded: {}, ballBandsNeeded: {} };
        dyeSessions.forEach(s => {
            if (s.archived) return;
            if (excludeSessionId != null && s.id === excludeSessionId) return;
            const needs = calculatePanNeeds(s.pans || []);
            Object.entries(needs.yarnNeeded).forEach(([k, v]) => {
                committed.yarnNeeded[k] = (committed.yarnNeeded[k] || 0) + v;
            });
            Object.entries(needs.ballBandsNeeded).forEach(([k, v]) => {
                committed.ballBandsNeeded[k] = (committed.ballBandsNeeded[k] || 0) + v;
            });
        });
        return committed;
    };

    // Get unique yarn bases and their available hank sizes from inventory
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
        return yarnBases[baseName] || [];
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            saveDyeSessions(dyeSessions.map(s => s.id === editingId ? { ...formData, id: editingId } : s));
        } else {
            // Auto-generate session ID
            const getNextSessionId = () => {
                const existingSessionIds = dyeSessions
                    .map(s => s.sessionId || s.session_id)
                    .filter(id => id && id.startsWith('DS-'))
                    .map(id => parseInt(id.substring(3)))
                    .filter(n => !isNaN(n));
                
                const maxNum = existingSessionIds.length > 0 ? Math.max(...existingSessionIds) : 0;
                return `DS-${String(maxNum + 1).padStart(3, '0')}`;
            };

            const sessionId = getNextSessionId();
            saveDyeSessions([...dyeSessions, { ...formData, id: Date.now(), sessionId: sessionId }]);
        }
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            name: '',
            date: DateUtils.getTodayEST(),
            pans: [],
            notes: ''
        });
        setCurrentPan({
            type: 'pan',
            colorway: '',
            recipeId: '',
            capacity: 300,
            yarns: [{ base: '', hankSize: '', quantity: 1 }],
            gradientDye: '',
            gradientYarnBase: '',
            gradientHankSize: ''
        });
        setShowForm(false);
        setEditingId(null);
    };

    const editSession = (session) => {
        setFormData(session);
        setEditingId(session.id);
        setShowForm(true);
    };

    const deleteSession = (id) => {
        if (confirm('Delete this dye session?')) {
            saveDyeSessions(dyeSessions.filter(s => s.id !== id));
        }
    };

    const addYarnToPan = () => {
        setCurrentPan({
            ...currentPan,
            yarns: [...currentPan.yarns, { base: '', hankSize: '', quantity: 1 }]
        });
    };

    const updateYarn = (index, field, value) => {
        const newYarns = [...currentPan.yarns];
        newYarns[index] = { ...newYarns[index], [field]: value };
        setCurrentPan({ ...currentPan, yarns: newYarns });
    };

    const removeYarn = (index) => {
        setCurrentPan({
            ...currentPan,
            yarns: currentPan.yarns.filter((_, i) => i !== index)
        });
    };

    const addPanToSession = () => {
        // Validate based on type
        if (currentPan.type === 'pan') {
            if (!currentPan.colorway) {
                alert('Please enter a colorway for this pan');
                return;
            }
        } else if (currentPan.type === 'gradientTray') {
            if (!currentPan.gradientDye || !currentPan.gradientYarnBase || !currentPan.gradientHankSize) {
                alert('Please fill in all gradient tray fields');
                return;
            }
        } else if (currentPan.type === 'dyeSquareTray') {
            if (!currentPan.squareColorA || !currentPan.squareColorB || !currentPan.gradientYarnBase || !currentPan.gradientHankSize) {
                alert('Please fill in all dye square tray fields');
                return;
            }
        } else if (currentPan.type === 'colorLab') {
            if (!currentPan.colorSketchId) {
                alert('Please select a color experiment');
                return;
            }
            if (!currentPan.yarns[0].base || !currentPan.yarns[0].hankSize) {
                alert('Please select yarn base and size for this experiment');
                return;
            }
        }

        // Check oven capacity
        const currentLoad = calculateOvenLoad(formData.pans);
        const newItemLoad = currentPan.type === 'dyeSquareTray' ? 4 : currentPan.type === 'gradientTray' ? 2 : 1;
        if (currentLoad + newItemLoad > MAX_OVEN_CAPACITY) {
            const itemName = currentPan.type === 'dyeSquareTray' ? 'dye square tray' : currentPan.type === 'gradientTray' ? 'tray' : 'pan';
            alert(`Cannot add this ${itemName}. Oven capacity exceeded!\n\nCurrent: ${currentLoad}/${MAX_OVEN_CAPACITY}\nAttempting to add: ${newItemLoad}\nMax capacity: ${MAX_OVEN_CAPACITY} pans`);
            return;
        }

        // Check inventory availability — accounting for yarn already
        // committed to other planned (non-archived) sessions AND to pans
        // already added to the session currently being built/edited.
        let inventoryWarnings = [];
        const committed = calculateCommittedNeeds(editingId);
        const inProgressNeeds = calculatePanNeeds(formData.pans);

        const getEffectiveAvailable = (base, hankSize) => {
            const inventoryItem = inventory.find(
                item => item.category === 'yarn base' &&
                        item.name === base &&
                        parseFloat(item.hankSize) === parseFloat(hankSize)
            );
            const onHand = inventoryItem ? parseFloat(inventoryItem.quantity) : 0;
            const yKey = `${base}-${hankSize}`;
            const committedElsewhere = committed.yarnNeeded[yKey] || 0;
            const inProgress = inProgressNeeds.yarnNeeded[yKey] || 0;
            return onHand - committedElsewhere - inProgress;
        };

        if (currentPan.type === 'gradientTray') {
            const available = getEffectiveAvailable(currentPan.gradientYarnBase, currentPan.gradientHankSize);
            if (available < 10) {
                inventoryWarnings.push(`${currentPan.gradientYarnBase} (${currentPan.gradientHankSize}g): need 10, have ${available} available after other planned sessions`);
            }
        } else if (currentPan.type === 'dyeSquareTray') {
            const available = getEffectiveAvailable(currentPan.gradientYarnBase, currentPan.gradientHankSize);
            if (available < 25) {
                inventoryWarnings.push(`${currentPan.gradientYarnBase} (${currentPan.gradientHankSize}g): need 25, have ${available} available after other planned sessions`);
            }
        } else {
            currentPan.yarns.forEach(yarn => {
                const available = getEffectiveAvailable(yarn.base, yarn.hankSize);
                const needed = parseInt(String(yarn.quantity));
                if (available < needed) {
                    inventoryWarnings.push(`${yarn.base} (${yarn.hankSize}g): need ${needed}, have ${available} available after other planned sessions`);
                }
            });
        }

        if (inventoryWarnings.length > 0) {
            const proceed = confirm(`⚠️ INVENTORY WARNING:\n\n${inventoryWarnings.join('\n')}\n\nDo you want to add this ${currentPan.type === 'gradientTray' || currentPan.type === 'dyeSquareTray' ? 'tray' : 'pan'} anyway?`);
            if (!proceed) return;
        }

        if (currentPan.type === 'adHoc') {
            setFormData({
                ...formData,
                pans: [...formData.pans, {
                    type: 'adHoc',
                    id: Date.now(),
                    adHocLabel: currentPan.adHocLabel || '',
                    experimentNotes: '',
                    yarns: [],
                    totalWeight: 0,
                    capacity: 0
                }]
            });
        } else if (currentPan.type === 'pan' || currentPan.type === 'colorLab') {
            const totalWeight = currentPan.yarns.reduce((sum, y) => {
                return sum + (parseFloat(String(y.hankSize)) || 0) * (parseInt(String(y.quantity)) || 0);
            }, 0);
            
            const recipe = currentPan.recipeId ? recipes.find(r => r.id === parseInt(currentPan.recipeId)) : null;
            const colorSketch = currentPan.type === 'colorLab' && currentPan.colorSketchId ? 
                colorSketches.find(s => s.id === parseInt(currentPan.colorSketchId)) : null;
            
            setFormData({
                ...formData,
                pans: [...formData.pans, { 
                    ...currentPan, 
                    id: Date.now(), 
                    totalWeight,
                    recipe: recipe ? {
                        id: recipe.id,
                        name: recipe.name,
                        yarnWeight: recipe.yarnWeight,
                        ingredients: recipe.ingredients,
                        photo: recipe.photo,
                        photos: recipe.photos || [],
                        colorType: recipe.colorType,
                        instructions: recipe.instructions,
                        colorSolutions: recipe.colorSolutions
                    } : null,
                    colorSketch: colorSketch ? {
                        id: colorSketch.id,
                        colorId: colorSketch.colorId,
                        customName: colorSketch.customName,
                        type: colorSketch.type,
                        yarnWeight: colorSketch.yarnWeight,
                        dyes: colorSketch.dyes,
                        sections: colorSketch.sections,
                        baseColors: colorSketch.baseColors,
                        speckles: colorSketch.speckles,
                        notes: colorSketch.notes
                    } : null
                }]
            });
        } else if (currentPan.type === 'kit') {
            // Add kit pans using shared yarn config
            if (!currentPan.kitColors || currentPan.kitColors.length === 0) return;
            const selectedColors = currentPan.kitColors.filter((_, idx) =>
                (currentPan.kitSelectedColorIds || []).includes(idx)
            );
            if (selectedColors.length === 0) return;
            const validYarns = (currentPan.kitYarns || []).filter(y => y.base && y.hankSize && y.quantity);
            if (validYarns.length === 0) return;
            const newPans = selectedColors.map(color => {
                const recipe = recipes.find(r => r.name === color.colorwayName);
                return {
                    id: Date.now() + Math.random(),
                    type: 'pan',
                    colorway: color.colorwayName,
                    recipeId: recipe?.id || '',
                    recipe: recipe,
                    yarns: validYarns.map(y => ({ ...y })),
                    fromKit: currentPan.kitName
                };
            });
            setFormData({
                ...formData,
                pans: [...formData.pans, ...newPans]
            });
        } else if (currentPan.type === 'gradientTray') {
            // Gradient tray - create 10 colors with specific depths
            const depths = [0.0625, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2.0, 2.5, 3.0];
            setFormData({
                ...formData,
                pans: [...formData.pans, {
                    type: 'gradientTray',
                    id: Date.now(),
                    gradientDye: currentPan.gradientDye,
                    gradientYarnBase: currentPan.gradientYarnBase,
                    gradientHankSize: currentPan.gradientHankSize,
                    depths: depths
                }]
            });
        } else {
            // Dye square tray - 5x5 grid of two colors
            const amounts = [1.25, 2.5, 5, 7.5, 10];
            setFormData({
                ...formData,
                pans: [...formData.pans, {
                    type: 'dyeSquareTray',
                    id: Date.now(),
                    squareColorA: currentPan.squareColorA,
                    squareColorB: currentPan.squareColorB,
                    gradientYarnBase: currentPan.gradientYarnBase,
                    gradientHankSize: currentPan.gradientHankSize,
                    amounts: amounts
                }]
            });
        }

        // Reset current pan
        setCurrentPan({
            type: 'pan',
            colorway: '',
            recipeId: '',
            capacity: 300,
            yarns: [{ base: '', hankSize: '', quantity: 1 }],
            gradientDye: '',
            gradientYarnBase: '',
            gradientHankSize: '',
            squareColorA: '',
            squareColorB: '',
            colorSketchId: '',
            kitId: '',
            kitName: '',
            kitColors: [],
            kitSelectedColorIds: [],
            kitYarns: [{ base: '', hankSize: '', quantity: 1 }],
            adHocLabel: ''
        });
    };

    const removePan = (panId) => {
        setFormData({
            ...formData,
            pans: formData.pans.filter(p => p.id !== panId)
        });
    };

    const getTotalWeight = (yarns) => {
        return yarns.reduce((sum, y) => sum + (parseFloat(y.hankSize) || 0) * (parseInt(y.quantity) || 0), 0);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-gray-900">Dye Sessions Planning</h2>
                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                            showArchived 
                                ? 'bg-gray-600 text-white' 
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        {showArchived ? '📦 Showing Archived' : '📋 Show Archived'}
                    </button>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ Plan Session'}
                </button>
            </div>

            {/* Form */}
            {showForm && (
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Session' : 'Plan New Dye Session'}</h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Session Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    placeholder="e.g., Weekend Batch #1"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Planned Date *</label>
                                <input
                                    type="date"
                                    required
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                />
                            </div>
                        </div>

                        {/* Current Pan/Tray Builder */}
                        <div className="border-2 border-teal-200 rounded-lg p-4 bg-teal-50">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-semibold text-gray-900">Add to Session</h4>
                                <div className="text-sm text-gray-600">
                                    Oven: {calculateOvenLoad(formData.pans)}/18 pans (or {Math.floor(calculateOvenLoad(formData.pans)/2)}/9 trays)
                                </div>
                            </div>
                            
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                                <select
                                    value={currentPan.type}
                                    onChange={(e) => setCurrentPan({ 
                                        type: e.target.value,
                                        colorway: '',
                                        recipeId: '',
                                        capacity: 300,
                                        yarns: [{ base: '', hankSize: '', quantity: 1 }],
                                        gradientDye: '',
                                        gradientYarnBase: '',
                                        gradientHankSize: '',
                                        squareColorA: '',
                                        squareColorB: '',
                                        kitId: '',
                                        kitName: '',
                                        kitColors: [],
                                        kitSelectedColorIds: [],
                                        kitYarns: [{ base: '', hankSize: '', quantity: 1 }],
                                        colorSketchId: '',
                                        adHocLabel: ''
                                    })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                >
                                    <option value="pan">Pan (1 space)</option>
                                    <option value="gradientTray">DOS Gradient Tray (2 spaces)</option>
                                    <option value="dyeSquareTray">Dye Square Tray (4 spaces)</option>
                                    <option value="kit">Kit (multiple pans)</option>
                                    <option value="colorLab">Color Lab Experiment (1 space)</option>
                                    <option value="adHoc">🎲 Ad Hoc Pan (1 space)</option>
                                </select>
                            </div>

                            {/* Pan Form */}
                            {currentPan.type === 'pan' && (
                                <>
                                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Colorway *</label>
                                            <input
                                                type="text"
                                                value={currentPan.colorway}
                                                onChange={(e) => setCurrentPan({ ...currentPan, colorway: e.target.value })}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                placeholder="e.g., Cranberry Spice"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Recipe (Optional)</label>
                                            <select
                                                value={currentPan.recipeId}
                                                onChange={(e) => {
                                                    const recipe = recipes.find(r => r.id === parseInt(e.target.value));
                                                    setCurrentPan({ 
                                                        ...currentPan, 
                                                        recipeId: e.target.value,
                                                        colorway: recipe ? recipe.name : currentPan.colorway
                                                    });
                                                }}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="">Select recipe...</option>
                                                {recipes.map(r => (
                                                    <option key={r.id} value={r.id}>{r.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Pan Capacity (g)</label>
                                        <input
                                            type="number"
                                            value={currentPan.capacity}
                                            onChange={(e) => setCurrentPan({ ...currentPan, capacity: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                        />
                                    </div>

                                    <div className="mb-3">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Yarns in Pan</label>
                                        {currentPan.yarns.map((yarn, idx) => (
                                            <div key={idx} className="flex gap-2 mb-2">
                                                <select
                                                    value={yarn.base || ''}
                                                    onChange={(e) => {
                                                        const baseName = e.target.value;
                                                        const newYarns = [...currentPan.yarns];
                                                        
                                                        // Auto-populate first available hank size
                                                        let hankSize = '';
                                                        if (baseName) {
                                                            const sizes = getAvailableHankSizes(baseName);
                                                            if (sizes.length > 0) {
                                                                hankSize = sizes[0];
                                                            }
                                                        }
                                                        
                                                        newYarns[idx] = { ...newYarns[idx], base: baseName, hankSize: hankSize };
                                                        setCurrentPan({ ...currentPan, yarns: newYarns });
                                                    }}
                                                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                >
                                                    <option value="">Select yarn base...</option>
                                                    {Object.keys(yarnBases).map(baseName => (
                                                        <option key={baseName} value={baseName}>{baseName}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={yarn.hankSize || ''}
                                                    onChange={(e) => updateYarn(idx, 'hankSize', e.target.value)}
                                                    className="w-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                    disabled={!yarn.base}
                                                >
                                                    <option value="">Size (g)</option>
                                                    {yarn.base && getAvailableHankSizes(yarn.base).map(size => (
                                                        <option key={size} value={size}>{size}g</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="number"
                                                    placeholder="Qty"
                                                    value={yarn.quantity || ''}
                                                    onChange={(e) => updateYarn(idx, 'quantity', e.target.value)}
                                                    className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                />
                                                {currentPan.yarns.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeYarn(idx)}
                                                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={addYarnToPan}
                                            className="text-teal-600 hover:text-teal-700 text-sm font-medium"
                                        >
                                            + Add Yarn
                                        </button>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 border-t">
                                        <div className="text-sm">
                                            <span className="text-gray-600">Total weight: </span>
                                            <span className="font-semibold">{getTotalWeight(currentPan.yarns)}g</span>
                                            <span className="text-gray-600"> / {currentPan.capacity}g capacity</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={addPanToSession}
                                            className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                        >
                                            Add Pan
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Gradient Tray Form */}
                            {currentPan.type === 'gradientTray' && (
                                <>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Dye Color *</label>
                                            <select
                                                value={currentPan.gradientDye}
                                                onChange={(e) => setCurrentPan({ ...currentPan, gradientDye: e.target.value })}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="">Select dye...</option>
                                                {inventory.filter(item => item.category === 'dye').map(dye => (
                                                    <option key={dye.id} value={dye.name}>{dye.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Base *</label>
                                            <select
                                                value={currentPan.gradientYarnBase}
                                                onChange={(e) => {
                                                    const baseName = e.target.value;
                                                    const sizes = baseName ? getAvailableHankSizes(baseName) : [];
                                                    setCurrentPan({ 
                                                        ...currentPan, 
                                                        gradientYarnBase: baseName, 
                                                        gradientHankSize: sizes.length > 0 ? sizes[0] : ''
                                                    });
                                                }}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="">Select yarn base...</option>
                                                {Object.keys(yarnBases).map(baseName => (
                                                    <option key={baseName} value={baseName}>{baseName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Hank Size *</label>
                                            <select
                                                value={currentPan.gradientHankSize}
                                                onChange={(e) => setCurrentPan({ ...currentPan, gradientHankSize: e.target.value })}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                disabled={!currentPan.gradientYarnBase}
                                            >
                                                <option value="">Select size...</option>
                                                {currentPan.gradientYarnBase && getAvailableHankSizes(currentPan.gradientYarnBase).map(size => (
                                                    <option key={size} value={size}>{size}g</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="bg-blue-50 p-3 rounded text-sm text-gray-700">
                                            <p className="font-medium mb-1">10-Color Gradient</p>
                                            <p className="text-xs">Depths: 0.0625%, 0.125%, 0.25%, 0.5%, 0.75%, 1%, 1.5%, 2%, 2.5%, 3%</p>
                                            <p className="text-xs text-gray-600 mt-1">Automatically creates 10 colors from lightest to darkest</p>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-4 border-t mt-4">
                                        <button
                                            type="button"
                                            onClick={addPanToSession}
                                            className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                        >
                                            Add Gradient Tray
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Dye Square Tray Form */}
                            {currentPan.type === 'dyeSquareTray' && (
                                <>
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Color A *</label>
                                                <select
                                                    value={currentPan.squareColorA}
                                                    onChange={(e) => setCurrentPan({ ...currentPan, squareColorA: e.target.value })}
                                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                >
                                                    <option value="">Select dye...</option>
                                                    {inventory.filter(item => item.category === 'dye').map(dye => (
                                                        <option key={dye.id} value={dye.name}>{dye.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Color B *</label>
                                                <select
                                                    value={currentPan.squareColorB}
                                                    onChange={(e) => setCurrentPan({ ...currentPan, squareColorB: e.target.value })}
                                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                >
                                                    <option value="">Select dye...</option>
                                                    {inventory.filter(item => item.category === 'dye').map(dye => (
                                                        <option key={dye.id} value={dye.name}>{dye.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Base *</label>
                                            <select
                                                value={currentPan.gradientYarnBase}
                                                onChange={(e) => {
                                                    const baseName = e.target.value;
                                                    const sizes = baseName ? getAvailableHankSizes(baseName) : [];
                                                    setCurrentPan({ 
                                                        ...currentPan, 
                                                        gradientYarnBase: baseName, 
                                                        gradientHankSize: sizes.length > 0 ? sizes[0] : ''
                                                    });
                                                }}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="">Select yarn base...</option>
                                                {Object.keys(yarnBases).map(baseName => (
                                                    <option key={baseName} value={baseName}>{baseName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Hank Size *</label>
                                            <select
                                                value={currentPan.gradientHankSize}
                                                onChange={(e) => setCurrentPan({ ...currentPan, gradientHankSize: e.target.value })}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                disabled={!currentPan.gradientYarnBase}
                                            >
                                                <option value="">Select size...</option>
                                                {currentPan.gradientYarnBase && getAvailableHankSizes(currentPan.gradientYarnBase).map(size => (
                                                    <option key={size} value={size}>{size}g</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="bg-blue-50 p-3 rounded text-sm text-gray-700">
                                            <p className="font-medium mb-1">5×5 Dye Square (25 skeins)</p>
                                            <p className="text-xs">Each color at: 1.25, 2.5, 5, 7.5, 10 mL</p>
                                            <p className="text-xs text-gray-600 mt-1">Creates a 25-square grid combining two colors at varying ratios</p>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-4 border-t mt-4">
                                        <button
                                            type="button"
                                            onClick={addPanToSession}
                                            className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                        >
                                            Add Dye Square Tray
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Kit Form */}
                            {currentPan.type === 'kit' && (
                                <>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Select Kit *</label>
                                        <select
                                            value={currentPan.kitId || ''}
                                            onChange={(e) => {
                                                const selectedKit = kits.find(k => k.id === parseInt(e.target.value));
                                                if (selectedKit) {
                                                    setCurrentPan({ 
                                                        ...currentPan, 
                                                        kitId: e.target.value,
                                                        kitName: selectedKit.name,
                                                        kitColors: selectedKit.colors,
                                                        kitSelectedColorIds: selectedKit.colors.map((_, idx) => idx),
                                                        kitYarns: [{ base: '', hankSize: '', quantity: 1 }]
                                                    });
                                                } else {
                                                    setCurrentPan({
                                                        ...currentPan,
                                                        kitId: '',
                                                        kitName: '',
                                                        kitColors: [],
                                                        kitSelectedColorIds: [],
                                                        kitYarns: [{ base: '', hankSize: '', quantity: 1 }]
                                                    });
                                                }
                                            }}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                        >
                                            <option value="">Choose a kit...</option>
                                            {kits.map(kit => (
                                                <option key={kit.id} value={kit.id}>{kit.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Selectable colorways + yarn config */}
                                    {currentPan.kitColors && currentPan.kitColors.length > 0 && (
                                        <>
                                            <div className="mb-4 bg-gray-50 rounded-lg p-4 border">
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="font-medium text-gray-900">Select colorways to dye:</h4>
                                                    <div className="flex gap-2 text-xs">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentPan({
                                                                ...currentPan,
                                                                kitSelectedColorIds: currentPan.kitColors.map((_, idx) => idx)
                                                            })}
                                                            className="text-teal-600 hover:text-teal-800"
                                                        >
                                                            Select all
                                                        </button>
                                                        <span className="text-gray-300">|</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentPan({
                                                                ...currentPan,
                                                                kitSelectedColorIds: []
                                                            })}
                                                            className="text-teal-600 hover:text-teal-800"
                                                        >
                                                            Clear
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {currentPan.kitColors.map((color, idx) => {
                                                        const isSelected = (currentPan.kitSelectedColorIds || []).includes(idx);
                                                        return (
                                                            <label
                                                                key={idx}
                                                                className={`flex items-center gap-2 text-sm border rounded px-2 py-1 cursor-pointer transition-colors ${
                                                                    isSelected ? 'bg-teal-50 border-teal-300' : 'bg-white border-gray-200 opacity-60'
                                                                }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => {
                                                                        const current = currentPan.kitSelectedColorIds || [];
                                                                        const next = current.includes(idx)
                                                                            ? current.filter(i => i !== idx)
                                                                            : [...current, idx];
                                                                        setCurrentPan({ ...currentPan, kitSelectedColorIds: next });
                                                                    }}
                                                                    className="rounded"
                                                                />
                                                                <span>🎨 {color.colorwayName}</span>
                                                                {parseInt(color.quantity || 1) > 1 && (
                                                                    <span className="text-gray-500">×{color.quantity}</span>
                                                                )}
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="mb-4">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Yarn Bases (applied to each selected colorway)
                                                </label>
                                                {currentPan.kitYarns.map((yarn, idx) => (
                                                    <div key={idx} className="flex gap-2 mb-2">
                                                        <select
                                                            value={yarn.base || ''}
                                                            onChange={(e) => {
                                                                const baseName = e.target.value;
                                                                const newYarns = [...currentPan.kitYarns];
                                                                // Auto-populate first available hank size
                                                                let hankSize = '';
                                                                if (baseName) {
                                                                    const sizes = getAvailableHankSizes(baseName);
                                                                    if (sizes.length > 0) {
                                                                        hankSize = sizes[0];
                                                                    }
                                                                }
                                                                newYarns[idx] = { ...newYarns[idx], base: baseName, hankSize: hankSize };
                                                                setCurrentPan({ ...currentPan, kitYarns: newYarns });
                                                            }}
                                                            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                        >
                                                            <option value="">Select yarn base...</option>
                                                            {Object.keys(yarnBases).map(baseName => (
                                                                <option key={baseName} value={baseName}>{baseName}</option>
                                                            ))}
                                                        </select>
                                                        <select
                                                            value={yarn.hankSize || ''}
                                                            onChange={(e) => {
                                                                const newYarns = [...currentPan.kitYarns];
                                                                newYarns[idx] = { ...newYarns[idx], hankSize: e.target.value };
                                                                setCurrentPan({ ...currentPan, kitYarns: newYarns });
                                                            }}
                                                            className="w-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                            disabled={!yarn.base}
                                                        >
                                                            <option value="">Size (g)</option>
                                                            {yarn.base && getAvailableHankSizes(yarn.base).map(size => (
                                                                <option key={size} value={size}>{size}g</option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            type="number"
                                                            placeholder="Qty"
                                                            value={yarn.quantity || ''}
                                                            onChange={(e) => {
                                                                const newYarns = [...currentPan.kitYarns];
                                                                newYarns[idx] = { ...newYarns[idx], quantity: e.target.value };
                                                                setCurrentPan({ ...currentPan, kitYarns: newYarns });
                                                            }}
                                                            className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                        />
                                                        {currentPan.kitYarns.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const newYarns = currentPan.kitYarns.filter((_, i) => i !== idx);
                                                                    setCurrentPan({ ...currentPan, kitYarns: newYarns });
                                                                }}
                                                                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                            >
                                                                ✕
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => setCurrentPan({
                                                        ...currentPan,
                                                        kitYarns: [...currentPan.kitYarns, { base: '', hankSize: '', quantity: 1 }]
                                                    })}
                                                    className="text-teal-600 hover:text-teal-700 text-sm font-medium"
                                                >
                                                    + Add Yarn
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    <div className="flex justify-between items-center pt-2 border-t">
                                        <div className="text-sm">
                                            <span className="text-gray-600">Weight per pan: </span>
                                            <span className="font-semibold">{getTotalWeight(currentPan.kitYarns || [])}g</span>
                                            {(currentPan.kitSelectedColorIds || []).length > 0 && (
                                                <span className="text-gray-600">
                                                    {' '}× {currentPan.kitSelectedColorIds.length} pan{currentPan.kitSelectedColorIds.length !== 1 ? 's' : ''}
                                                    {' '}= <span className="font-semibold text-gray-900">{getTotalWeight(currentPan.kitYarns || []) * currentPan.kitSelectedColorIds.length}g</span> total
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!currentPan.kitId) {
                                                    alert('Please select a kit');
                                                    return;
                                                }
                                                const selectedIds = currentPan.kitSelectedColorIds || [];
                                                if (selectedIds.length === 0) {
                                                    alert('Please select at least one colorway to dye');
                                                    return;
                                                }
                                                const validYarns = (currentPan.kitYarns || []).filter(y => y.base && y.hankSize && y.quantity);
                                                if (validYarns.length === 0) {
                                                    alert('Please configure at least one yarn (base, size, qty)');
                                                    return;
                                                }
                                                
                                                const selectedColors = currentPan.kitColors.filter((_, idx) => selectedIds.includes(idx));
                                                
                                                // Create individual pans for each selected colorway, each with the shared yarn list
                                                const newPans = selectedColors.map(color => {
                                                    const recipe = recipes.find(r => r.name === color.colorwayName);
                                                    return {
                                                        id: Date.now() + Math.random(),
                                                        type: 'pan',
                                                        colorway: color.colorwayName,
                                                        recipeId: recipe?.id || '',
                                                        recipe: recipe,
                                                        yarns: validYarns.map(y => ({ ...y })),
                                                        fromKit: currentPan.kitName
                                                    };
                                                });
                                                
                                                setFormData({ ...formData, pans: [...formData.pans, ...newPans] });
                                                setCurrentPan({ 
                                                    type: 'pan', 
                                                    colorway: '', 
                                                    recipeId: '', 
                                                    yarns: [{ base: '', hankSize: '', quantity: '' }],
                                                    kitId: '',
                                                    kitName: '',
                                                    kitColors: [],
                                                    kitSelectedColorIds: [],
                                                    kitYarns: [{ base: '', hankSize: '', quantity: 1 }]
                                                });
                                            }}
                                            className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                        >
                                            Add Kit Pans ({(currentPan.kitSelectedColorIds || []).length} of {currentPan.kitColors?.length || 0})
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Color Lab Form */}
                            {currentPan.type === 'colorLab' && (
                                <>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Select Color Experiment *</label>
                                        <select
                                            value={currentPan.colorSketchId}
                                            onChange={(e) => {
                                                const selectedSketch = colorSketches.find(s => s.id === parseInt(e.target.value));
                                                setCurrentPan({
                                                    ...currentPan,
                                                    colorSketchId: e.target.value,
                                                    colorway: selectedSketch ? (selectedSketch.customName || selectedSketch.colorId) : ''
                                                });
                                            }}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                        >
                                            <option value="">Select experiment...</option>
                                            {colorSketches.map(sketch => (
                                                <option key={sketch.id} value={sketch.id}>
                                                    {sketch.colorId} {sketch.customName ? `- ${sketch.customName}` : ''} ({sketch.type}, {sketch.yarnWeight}g)
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Yarns Configuration */}
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Yarns for this experiment</label>
                                        {currentPan.yarns.map((yarn, idx) => (
                                            <div key={idx} className="flex gap-2 mb-2">
                                                <select
                                                    value={yarn.base || ''}
                                                    onChange={(e) => {
                                                        const baseName = e.target.value;
                                                        const newYarns = [...currentPan.yarns];
                                                        
                                                        // Get selected color sketch to find target yarn weight
                                                        const selectedSketch = colorSketches.find(s => s.id === parseInt(currentPan.colorSketchId));
                                                        const targetWeight = selectedSketch?.yarnWeight || '100';
                                                        
                                                        // Auto-populate hank size closest to sketch's yarn weight
                                                        let hankSize = '';
                                                        if (baseName) {
                                                            const sizes = getAvailableHankSizes(baseName).map(s => parseFloat(s));
                                                            if (sizes.length > 0) {
                                                                // Find size closest to target weight
                                                                hankSize = sizes.reduce((prev, curr) => 
                                                                    Math.abs(curr - parseFloat(targetWeight)) < Math.abs(prev - parseFloat(targetWeight)) ? curr : prev
                                                                ).toString();
                                                            }
                                                        }
                                                        
                                                        newYarns[idx] = { ...newYarns[idx], base: baseName, hankSize: hankSize };
                                                        setCurrentPan({ ...currentPan, yarns: newYarns });
                                                    }}
                                                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                >
                                                    <option value="">Select yarn base...</option>
                                                    {Object.keys(yarnBases).map(baseName => (
                                                        <option key={baseName} value={baseName}>{baseName}</option>
                                                    ))}
                                                </select>

                                                <select
                                                    value={yarn.hankSize || ''}
                                                    onChange={(e) => updateYarn(idx, 'hankSize', e.target.value)}
                                                    className="w-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                    disabled={!yarn.base}
                                                >
                                                    <option value="">Size (g)</option>
                                                    {yarn.base && getAvailableHankSizes(yarn.base).map(size => (
                                                        <option key={size} value={size}>{size}g</option>
                                                    ))}
                                                </select>

                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={yarn.quantity}
                                                    onChange={(e) => updateYarn(idx, 'quantity', e.target.value)}
                                                    className="w-16 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                                    placeholder="Qty"
                                                />

                                                {idx > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeYarn(idx)}
                                                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={addYarnToPan}
                                            className="text-sm text-teal-600 hover:text-teal-800"
                                        >
                                            + Add Another Yarn
                                        </button>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 border-t">
                                        <div className="text-sm">
                                            <span className="text-gray-600">Total weight: </span>
                                            <span className="font-semibold">{getTotalWeight(currentPan.yarns)}g</span>
                                            <span className="text-gray-600"> / 300g capacity</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={addPanToSession}
                                            className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                        >
                                            Add Pan
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Ad Hoc Pan Form */}
                            {currentPan.type === 'adHoc' && (
                                <>
                                    <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 mb-4">
                                        <p className="text-sm text-amber-900 mb-1">
                                            🎲 <span className="font-semibold">Vibe dyeing mode.</span> Reserves 1 oven space — fill in everything else (yarn, dyes, notes) in Queue when you're actually dyeing.
                                        </p>
                                    </div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Working Label (optional)</label>
                                        <input
                                            type="text"
                                            value={currentPan.adHocLabel || ''}
                                            onChange={(e) => setCurrentPan({ ...currentPan, adHocLabel: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., Pink mystery, Leftover dyes experiment"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Leave blank and it'll be saved as "Ad Hoc Experiment"
                                        </p>
                                    </div>
                                    <div className="flex justify-end pt-2 border-t">
                                        <button
                                            type="button"
                                            onClick={addPanToSession}
                                            className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                                        >
                                            Add Ad Hoc Pan
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Pans in Session */}
                        {formData.pans.length > 0 && (
                            <div>
                                <h4 className="font-semibold text-gray-900 mb-3">
                                    Pans/Trays in This Session ({formData.pans.length} items, {calculateOvenLoad(formData.pans)}/18 spaces)
                                </h4>
                                <div className="space-y-2">
                                    {formData.pans.map((pan, idx) => (
                                        <div key={pan.id} className="bg-gray-50 rounded-lg p-4 border flex gap-3">
                                            {/* Reorder buttons */}
                                            <div className="flex flex-col gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (idx > 0) {
                                                            const newPans = [...formData.pans];
                                                            [newPans[idx - 1], newPans[idx]] = [newPans[idx], newPans[idx - 1]];
                                                            setFormData({ ...formData, pans: newPans });
                                                        }
                                                    }}
                                                    disabled={idx === 0}
                                                    className={`px-2 py-1 text-sm ${idx === 0 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'} rounded`}
                                                >
                                                    ▲
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (idx < formData.pans.length - 1) {
                                                            const newPans = [...formData.pans];
                                                            [newPans[idx], newPans[idx + 1]] = [newPans[idx + 1], newPans[idx]];
                                                            setFormData({ ...formData, pans: newPans });
                                                        }
                                                    }}
                                                    disabled={idx === formData.pans.length - 1}
                                                    className={`px-2 py-1 text-sm ${idx === formData.pans.length - 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'} rounded`}
                                                >
                                                    ▼
                                                </button>
                                            </div>

                                            {/* Recipe image or gradient icon */}
                                            {pan.type === 'gradientTray' ? (
                                                (() => {
                                                    const dye = inventory.find(i => i.name === pan.gradientDye);
                                                    const baseColor = dye?.color || '#9333ea';
                                                    return (
                                                        <div 
                                                            className="w-20 h-20 rounded border flex-shrink-0 flex items-center justify-center"
                                                            style={{
                                                                background: `linear-gradient(to right, ${baseColor}15, ${baseColor}60, ${baseColor})`
                                                            }}
                                                        >
                                                            <span className="text-3xl">🎨</span>
                                                        </div>
                                                    );
                                                })()
                                            ) : pan.type === 'dyeSquareTray' ? (
                                                (() => {
                                                    const dyeA = inventory.find(i => i.name === pan.squareColorA);
                                                    const dyeB = inventory.find(i => i.name === pan.squareColorB);
                                                    const colorA = dyeA?.color || '#3b82f6';
                                                    const colorB = dyeB?.color || '#ef4444';
                                                    return (
                                                        <div 
                                                            className="w-20 h-20 rounded border flex-shrink-0 flex items-center justify-center"
                                                            style={{
                                                                background: `linear-gradient(135deg, ${colorA}80, ${colorB}80)`
                                                            }}
                                                        >
                                                            <span className="text-3xl">🔲</span>
                                                        </div>
                                                    );
                                                })()
                                            ) : pan.type === 'adHoc' ? (
                                                <div className="w-20 h-20 rounded border flex-shrink-0 bg-amber-100 flex items-center justify-center">
                                                    <span className="text-3xl">🎲</span>
                                                </div>
                                            ) : pan.recipe && pan.recipe.photo ? (
                                                <img 
                                                    src={pan.recipe.photo} 
                                                    alt={pan.colorway}
                                                    className="w-20 h-20 object-cover rounded border"
                                                />
                                            ) : (
                                                <div className="w-20 h-20 rounded border flex-shrink-0 bg-gray-200 flex items-center justify-center">
                                                    <span className="text-3xl">📝</span>
                                                </div>
                                            )}

                                            {/* Content */}
                                            <div className="flex-1">
                                                {pan.type === 'gradientTray' ? (
                                                    <>
                                                        <div className="font-medium text-gray-900">
                                                            #{idx + 1}: 🎨 Gradient Tray - {pan.gradientDye} (2 spaces)
                                                        </div>
                                                        <div className="text-sm text-gray-600">
                                                            {pan.gradientYarnBase} ({pan.gradientHankSize}g) - 10 colors
                                                        </div>
                                                        <div className="flex gap-1 mt-2">
                                                            {pan.depths.map((depth, i) => (
                                                                <div key={i} className="text-xs bg-white px-2 py-1 rounded border">
                                                                    {depth}%
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </>
                                                ) : pan.type === 'dyeSquareTray' ? (
                                                    <>
                                                        <div className="font-medium text-gray-900">
                                                            #{idx + 1}: 🔲 Dye Square - {pan.squareColorA} × {pan.squareColorB} (4 spaces)
                                                        </div>
                                                        <div className="text-sm text-gray-600">
                                                            {pan.gradientYarnBase} ({pan.gradientHankSize}g) - 25 squares
                                                        </div>
                                                    </>
                                                ) : pan.type === 'adHoc' ? (
                                                    <>
                                                        <div className="font-medium text-gray-900">
                                                            Pan #{idx + 1}: 🎲 {pan.adHocLabel || 'Ad Hoc Experiment'}
                                                            <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">vibe dye</span>
                                                        </div>
                                                        <div className="text-sm text-gray-600 mt-1 italic">
                                                            Fill in yarn + notes in Queue when dyeing
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <div className="font-medium text-gray-900">
                                                                    Pan #{idx + 1}: {pan.colorway}
                                                                    {pan.colorSketch && (
                                                                        <span className={`ml-2 text-xs px-2 py-1 rounded ${
                                                                            pan.colorSketch.type === 'tonal' ? 'bg-blue-100 text-blue-700' :
                                                                            pan.colorSketch.type === 'variegated' ? 'bg-green-100 text-green-700' :
                                                                            'bg-orange-100 text-orange-700'
                                                                        }`}>
                                                                            {pan.colorSketch.type}
                                                                        </span>
                                                                    )}
                                                                    {pan.fromKit && (
                                                                        <span className="ml-2 text-xs bg-teal-100 text-teal-700 px-2 py-1 rounded">
                                                                            from {pan.fromKit}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-sm text-gray-600">{pan.totalWeight}g / {pan.capacity}g capacity</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-sm text-gray-600 mt-1">
                                                            {pan.yarns.map((y, i) => (
                                                                <div key={i}>• {y.quantity}x {y.base} ({y.hankSize}g)</div>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {/* Edit and Remove buttons */}
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        // Remove from the list first
                                                        const updatedPans = formData.pans.filter(p => p.id !== pan.id);
                                                        setFormData({ ...formData, pans: updatedPans });
                                                        
                                                        // Load pan into currentPan for editing based on type
                                                        if (pan.type === 'gradientTray') {
                                                            setCurrentPan({
                                                                type: 'gradientTray',
                                                                colorway: '',
                                                                recipeId: '',
                                                                capacity: 300,
                                                                yarns: [{ base: '', hankSize: '', quantity: 1 }],
                                                                gradientDye: pan.gradientDye,
                                                                gradientYarnBase: pan.gradientYarnBase,
                                                                gradientHankSize: pan.gradientHankSize,
                                                                squareColorA: '',
                                                                squareColorB: ''
                                                            });
                                                        } else if (pan.type === 'dyeSquareTray') {
                                                            setCurrentPan({
                                                                type: 'dyeSquareTray',
                                                                colorway: '',
                                                                recipeId: '',
                                                                capacity: 300,
                                                                yarns: [{ base: '', hankSize: '', quantity: 1 }],
                                                                gradientDye: '',
                                                                gradientYarnBase: pan.gradientYarnBase,
                                                                gradientHankSize: pan.gradientHankSize,
                                                                squareColorA: pan.squareColorA,
                                                                squareColorB: pan.squareColorB
                                                            });
                                                        } else {
                                                            setCurrentPan({
                                                                type: 'pan',
                                                                colorway: pan.colorway,
                                                                recipeId: pan.recipeId || '',
                                                                capacity: pan.capacity,
                                                                yarns: pan.yarns,
                                                                gradientDye: '',
                                                                gradientYarnBase: '',
                                                                gradientHankSize: ''
                                                            });
                                                        }
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newPan = {
                                                            ...pan,
                                                            id: Date.now() + Math.random()
                                                        };
                                                        setFormData({
                                                            ...formData,
                                                            pans: [...formData.pans, newPan]
                                                        });
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800"
                                                    title="Copy pan"
                                                >
                                                    📋
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removePan(pan.id)}
                                                    className="text-red-600 hover:text-red-800"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Session Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={3}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Any notes about this dye session..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update Session' : 'Save Session'}
                            </button>
                            <button
                                type="button"
                                onClick={resetForm}
                                className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Sessions List */}
            <div className="space-y-4">
                {dyeSessions
                    .filter(session => showArchived ? session.archived : !session.archived) // Filter by archive status
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) // Sort by date, earliest first
                    .map(session => (
                    <div key={session.id} className={`bg-white rounded-lg card-shadow p-6 ${session.archived ? 'opacity-75 border-2 border-gray-300' : ''}`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setExpandedSessions({
                                            ...expandedSessions,
                                            [session.id]: !expandedSessions[session.id]
                                        })}
                                        className="text-gray-600 hover:text-gray-900"
                                    >
                                        {expandedSessions[session.id] ? '▼' : '▶'}
                                    </button>
                                    <h3 className="text-xl font-semibold text-gray-900">
                                        {session.name}
                                        {session.archived && <span className="ml-2 text-sm text-gray-500">(Archived)</span>}
                                    </h3>
                                </div>
                                {session.sessionId && (
                                    <p className="text-xs text-gray-500 ml-8">ID: {session.sessionId}</p>
                                )}
                                <p className="text-sm text-gray-500 ml-8">
                                    {session.date} • {session.pans.filter(p => p.type !== 'gradientTray' && p.type !== 'dyeSquareTray').length} pan(s) • {session.pans.filter(p => p.type === 'gradientTray' || p.type === 'dyeSquareTray').length} tray(s)
                                </p>
                                <p className="text-xs text-teal-600 mt-1 ml-8">
                                    Yarn bases needed: {(() => {
                                        const bases = {};
                                        session.pans.forEach(pan => {
                                            if (pan.type === 'gradientTray') {
                                                const key = `${pan.gradientYarnBase} (${pan.gradientHankSize}g)`;
                                                bases[key] = (bases[key] || 0) + 10;
                                            } else if (pan.type === 'dyeSquareTray') {
                                                const key = `${pan.gradientYarnBase} (${pan.gradientHankSize}g)`;
                                                bases[key] = (bases[key] || 0) + 25;
                                            } else {
                                                pan.yarns.forEach(y => {
                                                    const key = `${y.base} (${y.hankSize}g)`;
                                                    bases[key] = (bases[key] || 0) + parseInt(y.quantity);
                                                });
                                            }
                                        });
                                        return Object.entries(bases).map(([base, qty]) => `${qty}x ${base}`).join(', ');
                                    })()}
                                </p>
                                <div className="text-xs text-blue-600 mt-1 ml-8">
                                    <div className="text-xs text-teal-600">
                                        {(() => {
                                            const stockSolutions = new Set();
                                            const dyePowders = new Set();
                                            
                                            session.pans.forEach(pan => {
                                                if (pan.type === 'gradientTray') {
                                                    if (pan.gradientDye) dyePowders.add(pan.gradientDye);
                                                } else if (pan.type === 'dyeSquareTray') {
                                                    if (pan.squareColorA) dyePowders.add(pan.squareColorA);
                                                    if (pan.squareColorB) dyePowders.add(pan.squareColorB);
                                                } else if (pan.type === 'colorLab' && pan.colorSketch) {
                                                    if (pan.colorSketch.type === 'tonal' && pan.colorSketch.dyes) {
                                                        pan.colorSketch.dyes.forEach(d => {
                                                            if (d.color) stockSolutions.add(d.color);
                                                        });
                                                    } else if (pan.colorSketch.type === 'variegated' && pan.colorSketch.sections) {
                                                        pan.colorSketch.sections.forEach(section => {
                                                            section.dyes?.forEach(d => {
                                                                if (d.color) stockSolutions.add(d.color);
                                                            });
                                                        });
                                                    } else if (pan.colorSketch.type === 'speckled') {
                                                        if (pan.colorSketch.baseColors) {
                                                            pan.colorSketch.baseColors.forEach(d => {
                                                                if (d.color) stockSolutions.add(d.color);
                                                            });
                                                        }
                                                        if (pan.colorSketch.speckles) {
                                                            pan.colorSketch.speckles.forEach(d => {
                                                                if (d.color) dyePowders.add(d.color);
                                                            });
                                                        }
                                                    }
                                                } else if (pan.recipeId) {
                                                    const recipe = recipes.find(r => r.id === parseInt(pan.recipeId));
                                                    if (recipe) {
                                                        if (recipe.colorType === 'variegated' && recipe.colorSolutions) {
                                                            recipe.colorSolutions.forEach(sol => {
                                                                sol.dyes.forEach(d => stockSolutions.add(d.name));
                                                            });
                                                        } else if (recipe.ingredients) {
                                                            recipe.ingredients.forEach(ing => {
                                                                const item = inventory.find(i => i.name === ing.name);
                                                                if (item?.category === 'dye') {
                                                                    if (ing.unit === 'g') {
                                                                        dyePowders.add(ing.name);
                                                                    } else {
                                                                        stockSolutions.add(ing.name);
                                                                    }
                                                                }
                                                            });
                                                        }
                                                    }
                                                }
                                            });
                                            
                                            return (
                                                <>
                                                    {stockSolutions.size > 0 && (
                                                        <div>Stock solutions: {Array.from(stockSolutions).sort().join(', ')}</div>
                                                    )}
                                                    {dyePowders.size > 0 && (
                                                        <div>Dye powders: {Array.from(dyePowders).sort().join(', ')}</div>
                                                    )}
                                                    {stockSolutions.size === 0 && dyePowders.size === 0 && (
                                                        <div>No dyes needed</div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                                {/* Comprehensive Inventory shortage warning */}
                                {(() => {
                                    const shortages = {
                                        yarn: [],
                                        ballBands: [],
                                        labels: [],
                                        dyes: []
                                    };
                                    
                                    // Track totals needed for this session
                                    const { yarnNeeded, ballBandsNeeded, dyesNeeded } = calculatePanNeeds(session.pans);

                                    // Track what other planned (non-archived) sessions have already
                                    // committed, so we don't falsely show inventory as available when
                                    // it's already spoken for by another session.
                                    const committed = calculateCommittedNeeds(session.id);

                                    // Check yarn inventory (subtract commitments from other planned sessions)
                                    Object.entries(yarnNeeded).forEach(([key, needed]) => {
                                        const [base, hankSize] = key.split('-');
                                        const item = inventory.find(i => 
                                            i.category === 'yarn base' && 
                                            i.name === base && 
                                            parseFloat(i.hankSize) === parseFloat(hankSize)
                                        );
                                        const onHand = item ? parseFloat(item.quantity) : 0;
                                        const committedElsewhere = committed.yarnNeeded[key] || 0;
                                        const available = onHand - committedElsewhere;
                                        if (available < needed) {
                                            const suffix = committedElsewhere > 0
                                                ? ` (${onHand} on hand − ${committedElsewhere} in other planned sessions)`
                                                : '';
                                            shortages.yarn.push(`${base} ${hankSize}g: need ${needed}, have ${available}${suffix}`);
                                        }
                                    });
                                    
                                    // Check ball bands (skip for micro sizes 10g and under)
                                    Object.entries(ballBandsNeeded).forEach(([key, needed]) => {
                                        const [base, hankSize] = key.split('-');
                                        const size = parseFloat(hankSize);
                                        
                                        // Skip ball band check for micro sizes (10g and under)
                                        if (size <= 10) return;
                                        
                                        const item = inventory.find(i => 
                                            i.category === 'ball band' && 
                                            i.forYarnBase === base && 
                                            parseFloat(i.hankSize) === parseFloat(hankSize)
                                        );
                                        const onHand = item ? parseFloat(item.quantity) : 0;
                                        // Ball band commitments mirror yarn commitments for non-micro sizes
                                        const committedElsewhere = committed.ballBandsNeeded[key] || 0;
                                        const available = onHand - committedElsewhere;
                                        if (available < needed) {
                                            const suffix = committedElsewhere > 0
                                                ? ` (${onHand} on hand − ${committedElsewhere} in other planned sessions)`
                                                : '';
                                            shortages.ballBands.push(`${base} ${hankSize}g: need ${needed}, have ${available}${suffix}`);
                                        }
                                    });
                                    
                                    // Check labels (total skeins) - labels can be in 'ball band' or 'other'
                                    // Also subtract labels committed to other planned sessions.
                                    const totalSkeins = Object.values(yarnNeeded).reduce((sum, qty) => sum + qty, 0);
                                    const labels = inventory.filter(i => 
                                        (i.category === 'ball band' || i.category === 'other') && 
                                        i.name?.toLowerCase().includes('label')
                                    );
                                    const totalLabels = labels.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0);
                                    const labelsCommittedElsewhere = Object.values(committed.yarnNeeded).reduce((sum, qty) => sum + qty, 0);
                                    const labelsAvailable = totalLabels - labelsCommittedElsewhere;
                                    if (labelsAvailable < totalSkeins) {
                                        const suffix = labelsCommittedElsewhere > 0
                                            ? ` (${totalLabels} on hand − ${labelsCommittedElsewhere} in other planned sessions)`
                                            : '';
                                        shortages.labels.push(`Labels: need ${totalSkeins}, have ${labelsAvailable}${suffix}`);
                                    }
                                    
                                    // Check dyes
                                    Object.keys(dyesNeeded).forEach(dyeName => {
                                        const item = inventory.find(i => i.category === 'dye' && i.name === dyeName);
                                        if (!item || parseFloat(item.quantity || 0) <= 0) {
                                            shortages.dyes.push(`${dyeName}: ${item ? 'out of stock' : 'not in inventory'}`);
                                        }
                                    });
                                    
                                    const hasShortages = shortages.yarn.length > 0 || shortages.ballBands.length > 0 || 
                                                        shortages.labels.length > 0 || shortages.dyes.length > 0;
                                    
                                    if (hasShortages) {
                                        return (
                                            <div className="mt-2 bg-red-50 border-2 border-red-400 rounded p-3">
                                                <p className="text-sm font-bold text-red-900 mb-2">⚠️ INVENTORY SHORTAGES</p>
                                                {shortages.yarn.length > 0 && (
                                                    <div className="mb-2">
                                                        <p className="text-xs font-semibold text-red-800">🧶 Yarn:</p>
                                                        <ul className="text-xs text-red-700 ml-4">
                                                            {shortages.yarn.map((s, i) => <li key={i}>{s}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                                {shortages.ballBands.length > 0 && (
                                                    <div className="mb-2">
                                                        <p className="text-xs font-semibold text-red-800">🏷️ Ball Bands:</p>
                                                        <ul className="text-xs text-red-700 ml-4">
                                                            {shortages.ballBands.map((s, i) => <li key={i}>{s}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                                {shortages.labels.length > 0 && (
                                                    <div className="mb-2">
                                                        <p className="text-xs font-semibold text-red-800">📄 Labels:</p>
                                                        <ul className="text-xs text-red-700 ml-4">
                                                            {shortages.labels.map((s, i) => <li key={i}>{s}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                                {shortages.dyes.length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-semibold text-red-800">🎨 Dyes:</p>
                                                        <ul className="text-xs text-red-700 ml-4">
                                                            {shortages.dyes.map((s, i) => <li key={i}>{s}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                                
                                {/* Session Cost Summary */}
                                {settings && (() => {
                                    let totalCost = 0;
                                    let totalSkeins = 0;
                                    
                                    session.pans.forEach(pan => {
                                        if (pan.type === 'gradientTray') {
                                            totalSkeins += 10;
                                            const yarnItem = inventory.find(i => 
                                                i.category === 'yarn base' && 
                                                i.name === pan.gradientYarnBase && 
                                                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
                                            );
                                            if (yarnItem?.cost) {
                                                totalCost += parseFloat(yarnItem.cost) * 10;
                                            }
                                        } else if (pan.type === 'dyeSquareTray') {
                                            totalSkeins += 25;
                                            const yarnItem = inventory.find(i => 
                                                i.category === 'yarn base' && 
                                                i.name === pan.gradientYarnBase && 
                                                parseFloat(i.hankSize) === parseFloat(pan.gradientHankSize)
                                            );
                                            if (yarnItem?.cost) {
                                                totalCost += parseFloat(yarnItem.cost) * 25;
                                            }
                                        } else {
                                            const skeins = pan.yarns.reduce((sum, y) => sum + parseInt(y.quantity || 0), 0);
                                            totalSkeins += skeins;
                                            pan.yarns.forEach(yarn => {
                                                const yarnItem = inventory.find(i => 
                                                    i.category === 'yarn base' && 
                                                    i.name === yarn.base && 
                                                    parseFloat(i.hankSize) === parseFloat(yarn.hankSize)
                                                );
                                                if (yarnItem?.cost) {
                                                    totalCost += parseFloat(yarnItem.cost) * parseInt(yarn.quantity);
                                                }
                                            });
                                        }
                                    });
                                    
                                    const costPerSkein = totalSkeins > 0 ? totalCost / totalSkeins : 0;
                                    
                                    // Calculate expected revenue based on typical prices
                                    let expectedRevenue = 0;
                                    const yarnGroups: Record<string, number> = {};
                                    session.pans.forEach(pan => {
                                        if (pan.type === 'gradientTray') {
                                            const key = `${pan.gradientYarnBase}-${pan.gradientHankSize}`;
                                            yarnGroups[key] = (yarnGroups[key] || 0) + 10;
                                        } else if (pan.type === 'dyeSquareTray') {
                                            const key = `${pan.gradientYarnBase}-${pan.gradientHankSize}`;
                                            yarnGroups[key] = (yarnGroups[key] || 0) + 25;
                                        } else {
                                            pan.yarns.forEach(y => {
                                                const key = `${y.base}-${y.hankSize}`;
                                                yarnGroups[key] = (yarnGroups[key] || 0) + parseInt(y.quantity);
                                            });
                                        }
                                    });
                                    
                                    Object.entries(yarnGroups).forEach(([key, qty]) => {
                                        const [base, hankSize] = key.split('-');
                                        const yarnItem = inventory.find(i => 
                                            i.category === 'yarn base' && 
                                            i.name === base && 
                                            parseFloat(i.hankSize) === parseFloat(hankSize)
                                        );
                                        if (yarnItem?.typicalPrice) {
                                            expectedRevenue += parseFloat(yarnItem.typicalPrice) * qty;
                                        }
                                    });
                                    
                                    const expectedProfit = expectedRevenue - totalCost;
                                    const profitMargin = expectedRevenue > 0 ? (expectedProfit / expectedRevenue) * 100 : 0;
                                    
                                    return (
                                        <div className="mt-2 bg-blue-50 border border-blue-300 rounded p-2">
                                            <p className="text-xs font-semibold text-blue-900">💰 Estimated Cost</p>
                                            <div className="text-xs text-blue-800 mt-1">
                                                <span>Cost: ${totalCost.toFixed(2)}</span>
                                                <span className="mx-2">•</span>
                                                <span>${costPerSkein.toFixed(2)}/skein</span>
                                                <span className="mx-2">•</span>
                                                <span>{totalSkeins} skeins</span>
                                            </div>
                                            {expectedRevenue > 0 && (
                                                <>
                                                    <p className="text-xs font-semibold text-green-900 mt-2">💵 Expected Revenue</p>
                                                    <div className="text-xs text-green-800 mt-1">
                                                        <span>Revenue: ${expectedRevenue.toFixed(2)}</span>
                                                        <span className="mx-2">•</span>
                                                        <span className={expectedProfit >= 0 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                                                            Profit: ${expectedProfit.toFixed(2)} ({profitMargin.toFixed(1)}%)
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        const updatedSessions = dyeSessions.map(s => 
                                            s.id === session.id ? { ...s, archived: !s.archived } : s
                                        );
                                        saveDyeSessions(updatedSessions);
                                    }}
                                    className={`${session.archived ? 'text-green-600 hover:bg-green-50' : 'text-orange-600 hover:bg-orange-50'} px-3 py-1 rounded`}
                                    title={session.archived ? 'Unarchive session' : 'Archive session'}
                                >
                                    {session.archived ? '📂' : '📦'}
                                </button>
                                <button
                                    onClick={() => editSession(session)}
                                    className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded"
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => deleteSession(session.id)}
                                    className="text-red-600 hover:bg-red-50 px-3 py-1 rounded"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>

{expandedSessions[session.id] && (
  <div className="space-y-3">
    {session.pans.map((pan, idx) => (
      <div
key={pan.id}
className="border-l-4 border-teal-500 bg-teal-50 rounded p-3 flex gap-3"
      >
{/* Recipe image or gradient icon */}
{pan.type === "gradientTray" ? (
  (() => {
    const dye = inventory.find(i => i.name === pan.gradientDye);
    const baseColor = dye?.color || "#9333ea";
    return (
      <div
        className="w-12 h-12 rounded border flex-shrink-0 flex items-center justify-center"
        style={{
          background: `linear-gradient(to right, ${baseColor}15, ${baseColor}60, ${baseColor})`,
        }}
      >
        <span className="text-xl">🎨</span>
      </div>
    );
  })()
) : pan.type === "dyeSquareTray" ? (
  (() => {
    const dyeA = inventory.find(i => i.name === pan.squareColorA);
    const dyeB = inventory.find(i => i.name === pan.squareColorB);
    const colorA = dyeA?.color || "#3b82f6";
    const colorB = dyeB?.color || "#ef4444";
    return (
      <div
        className="w-12 h-12 rounded border flex-shrink-0 flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${colorA}80, ${colorB}80)`,
        }}
      >
        <span className="text-xl">🔲</span>
      </div>
    );
  })()
) : pan.recipe && pan.recipe.photo ? (
  <img
    src={pan.recipe.photo}
    alt={pan.colorway}
    className="w-12 h-12 object-cover rounded border flex-shrink-0"
  />
) : (
  <div className="w-12 h-12 rounded border flex-shrink-0 bg-gray-200 flex items-center justify-center">
    <span className="text-xl">📝</span>
  </div>
)}

<div className="flex-1">
  {pan.type === "gradientTray" ? (
    <>
      <div className="font-medium text-gray-900 mb-1">
        🎨 Gradient Tray #{idx + 1}: {pan.gradientDye}
      </div>
      <div className="text-sm text-gray-600 mb-2">
        {pan.gradientYarnBase} ({pan.gradientHankSize}g) - 10 colors
      </div>
      <div className="flex gap-1 flex-wrap">
        {pan.depths.map((depth, i) => (
          <span key={i} className="text-xs bg-white px-2 py-1 rounded border">
            {depth}%
          </span>
        ))}
      </div>
    </>
  ) : pan.type === "dyeSquareTray" ? (
    <>
      <div className="font-medium text-gray-900 mb-1">
        🔲 Dye Square #{idx + 1}: {pan.squareColorA} × {pan.squareColorB}
      </div>
      <div className="text-sm text-gray-600">
        {pan.gradientYarnBase} ({pan.gradientHankSize}g) - 25 squares
      </div>
    </>
  ) : (
    <>
      <div className="font-medium text-gray-900 mb-1">
        Pan #{idx + 1}: {pan.colorway}
      </div>
      <div className="text-sm text-gray-600 mb-2">
        Total: {pan.totalWeight}g / {pan.capacity}g capacity
      </div>
      <div className="text-sm text-gray-700">
        {pan.yarns.map((y, i) => (
          <div key={i}>
            • {y.quantity}x {y.base} ({y.hankSize}g each)
          </div>
        ))}
      </div>
      {pan.experimentNotes && (
        <div className="mt-2 text-xs text-teal-600 italic bg-teal-50 rounded p-2 border border-teal-200">
          🧪 Experiment Notes: {pan.experimentNotes}
        </div>
      )}
    </>
  )}
</div>
      </div>
    ))}
  </div>
)}

                        
                        {session.notes && (
                            <div className="pt-2 border-t mt-2">
                                <p className="text-sm text-gray-600"><strong>Notes:</strong> {session.notes}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {dyeSessions.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🎨</p>
                    <p>No dye sessions planned yet. Plan your first session!</p>
                </div>
            )}
        </div>
    );
}

// Queue Component (formerly Up Next)
