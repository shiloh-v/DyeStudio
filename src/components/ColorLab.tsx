import { useState, useEffect } from 'react';
import { useFormGuard } from '../lib/useFormGuard';

export function ColorLab({ colorSketches, saveColorSketches, settings, inventory, recipes, saveRecipes }) {
    const [showForm, setShowForm] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        colorId: '',
        customName: '',
        type: 'tonal',
        yarnWeight: '100',
        dyes: [{ color: '', amount: '', unit: 'ml' }], // For tonal
        sections: [{ name: 'Section 1', dyes: [{ color: '', amount: '', unit: 'ml' }] }], // For variegated
        baseColors: [{ color: '', amount: '', unit: 'ml' }], // For speckled base (stock solution)
        speckles: [{ color: '', amount: '', unit: 'g' }], // For speckled (dry powder)
        notes: '',
        photo: '',
        archived: false
    });

    // Get available dye colors from inventory
    const availableDyes = inventory
        .filter(item => item.category === 'dye')
        .map(item => item.name)
        .sort();

    // Generate next Color ID based on type
    const generateColorId = (type) => {
        const prefix = type === 'tonal' ? 'CL-T' : type === 'variegated' ? 'CL-V' : 'CL-S';
        const existingIds = colorSketches
            .filter(s => s.colorId?.startsWith(prefix))
            .map(s => {
                const num = s.colorId?.substring(prefix.length);
                return num ? parseInt(num) : 0;
            })
            .filter(n => !isNaN(n));
        
        const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
        return `${prefix}${String(nextNum).padStart(3, '0')}`;
    };

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

    const resetForm = () => {
        setFormData({
            colorId: '',
            customName: '',
            type: 'tonal',
            yarnWeight: '100',
            dyes: [{ color: '', amount: '', unit: 'ml' }],
            sections: [{ name: 'Section 1', dyes: [{ color: '', amount: '', unit: 'ml' }] }],
            baseColors: [{ color: '', amount: '', unit: 'ml' }],
            speckles: [{ color: '', amount: '', unit: 'g' }],
            notes: '',
            photo: '',
            archived: false
        });
        setShowForm(false);
        setEditingId(null);
    };

    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            // Update existing sketch
            saveColorSketches(colorSketches.map(s => s.id === editingId ? { ...formData, id: editingId } : s));
        } else {
            // Create new sketch with auto-generated colorId
            const colorId = generateColorId(formData.type);
            saveColorSketches([...colorSketches, { ...formData, colorId, id: Date.now() }]);
        }
        resetForm();
    };

    const editSketch = (sketch) => {
        setFormData(sketch);
        setEditingId(sketch.id);
        setShowForm(true);
    };

    const deleteSketch = (id) => {
        if (confirm('Delete this color sketch?')) {
            saveColorSketches(colorSketches.filter(s => s.id !== id));
        }
    };

    const promoteToRecipe = (sketch) => {
        if (confirm(`Promote ${sketch.colorId}${sketch.customName ? ' - ' + sketch.customName : ''} to a permanent recipe?\n\nThis will:\n- Create a new recipe with this formula\n- Copy the sketch notes to recipe instructions\n- Keep the original color sketch for reference\n\nNote: Experiment notes from dye sessions stay with those sessions.`)) {
            // Generate recipe ID
            const prefix = sketch.type === 'tonal' ? 'R-T' : sketch.type === 'variegated' ? 'R-V' : 'R-S';
            const existingIds = recipes
                .filter(r => r.recipeId?.startsWith(prefix))
                .map(r => {
                    const num = r.recipeId?.substring(prefix.length);
                    return num ? parseInt(num) : 0;
                })
                .filter(n => !isNaN(n));
            const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
            const recipeId = `${prefix}${String(nextNum).padStart(3, '0')}`;

            // Convert color sketch to recipe format
            const newRecipe = {
                id: Date.now(),
                recipeId: recipeId,
                name: sketch.customName || sketch.colorId,
                yarnWeight: sketch.yarnWeight || 100,
                colorType: sketch.type,
                ingredients: sketch.type === 'tonal' ? (sketch.dyes || []).map(d => ({
                    name: d.color,
                    amount: d.amount,
                    unit: d.unit || 'ml'
                })) : sketch.type === 'speckled' ? (() => {
                    // Combine base colors and speckles for speckled type
                    const ingredients = [];
                    if (sketch.baseColors) {
                        sketch.baseColors.forEach(base => {
                            if (base.color) {
                                ingredients.push({
                                    name: base.color + ' (base)',
                                    amount: base.amount,
                                    unit: base.unit || 'ml'
                                });
                            }
                        });
                    }
                    if (sketch.speckles) {
                        sketch.speckles.forEach(speckle => {
                            if (speckle.color) {
                                ingredients.push({
                                    name: speckle.color + ' (speckle)',
                                    amount: speckle.amount,
                                    unit: speckle.unit || 'g'
                                });
                            }
                        });
                    }
                    return ingredients;
                })() : [],
                colorSolutions: sketch.type === 'variegated' ? (sketch.sections || []).map(section => ({
                    name: section.name,
                    dyes: section.dyes.map(d => ({
                        name: d.color,
                        amount: d.amount,
                        unit: d.unit || 'g'
                    })),
                    targetMl: '' // User can fill this in later
                })) : [],
                totalMl: '2400',
                stockSolutionPercent: '1',
                citricAcidPerBatch: '1',
                instructions: sketch.notes || '',
                photo: sketch.photo || '',
                photos: sketch.photo ? [{ id: Date.now(), data: sketch.photo, label: 'Photo' }] : [],
                notes: `Promoted from Color Lab: ${sketch.colorId}${sketch.experimentNotes ? '\n\n🧪 Experiment Notes:\n' + sketch.experimentNotes : ''}${sketch.notes ? '\n\nOriginal Sketch Notes:\n' + sketch.notes : ''}`,
                created: new Date().toISOString()
            };

            // Add to recipes
            saveRecipes([...recipes, newRecipe]);
            
            // Archive the original sketch
            saveColorSketches(colorSketches.map(s => 
                s.id === sketch.id ? { ...s, archived: true } : s
            ));
            
            alert(`✅ Created recipe ${recipeId} - ${newRecipe.name}!\n\nThe color sketch has been archived.`);
        }
    };

    const archiveSketch = (id) => {
        const sketch = colorSketches.find(s => s.id === id);
        const action = sketch?.archived ? 'unarchive' : 'archive';
        if (confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this color sketch?`)) {
            saveColorSketches(colorSketches.map(s => 
                s.id === id ? { ...s, archived: !s.archived } : s
            ));
        }
    };

    const duplicateSketch = (sketch) => {
        if (confirm(`Duplicate ${sketch.colorId}${sketch.customName ? ' - ' + sketch.customName : ''}?`)) {
            // Generate new color ID
            const prefix = sketch.type === 'tonal' ? 'CL-T' : sketch.type === 'variegated' ? 'CL-V' : 'CL-S';
            const existingIds = colorSketches
                .filter(s => s.colorId?.startsWith(prefix))
                .map(s => {
                    const num = s.colorId?.substring(prefix.length);
                    return num ? parseInt(num) : 0;
                })
                .filter(n => !isNaN(n));
            const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
            const newColorId = `${prefix}${String(nextNum).padStart(3, '0')}`;

            // Create duplicate with new ID and timestamp
            const duplicate = {
                ...sketch,
                id: Date.now(),
                colorId: newColorId,
                customName: sketch.customName ? `${sketch.customName} (Copy)` : '',
                archived: false
            };
            
            saveColorSketches([...colorSketches, duplicate]);
            alert(`✅ Created duplicate: ${newColorId}`);
        }
    };

    // Tonal dye management
    const addDye = () => {
        setFormData({
            ...formData,
            dyes: [...formData.dyes, { color: '', amount: '', unit: 'ml' }]
        });
    };

    const updateDye = (idx, field, value) => {
        const newDyes = [...formData.dyes];
        newDyes[idx][field] = value;
        setFormData({ ...formData, dyes: newDyes });
    };

    const removeDye = (idx) => {
        setFormData({
            ...formData,
            dyes: formData.dyes.filter((_, i) => i !== idx)
        });
    };

    // Speckled base color management (stock solution)
    const addBaseColor = () => {
        setFormData({
            ...formData,
            baseColors: [...formData.baseColors, { color: '', amount: '', unit: 'ml' }]
        });
    };

    const updateBaseColor = (idx, field, value) => {
        const newBaseColors = [...formData.baseColors];
        newBaseColors[idx][field] = value;
        setFormData({ ...formData, baseColors: newBaseColors });
    };

    const removeBaseColor = (idx) => {
        setFormData({
            ...formData,
            baseColors: formData.baseColors.filter((_, i) => i !== idx)
        });
    };

    // Speckled speckle management (dry powder)
    const addSpeckle = () => {
        setFormData({
            ...formData,
            speckles: [...formData.speckles, { color: '', amount: '', unit: 'g' }]
        });
    };

    const updateSpeckle = (idx, field, value) => {
        const newSpeckles = [...formData.speckles];
        newSpeckles[idx][field] = value;
        setFormData({ ...formData, speckles: newSpeckles });
    };

    const removeSpeckle = (idx) => {
        setFormData({
            ...formData,
            speckles: formData.speckles.filter((_, i) => i !== idx)
        });
    };

    // Variegated section management
    const addSection = () => {
        setFormData({
            ...formData,
            sections: [...formData.sections, { name: `Section ${formData.sections.length + 1}`, dyes: [{ color: '', amount: '', unit: 'ml' }] }]
        });
    };

    const updateSectionName = (sectionIdx, name) => {
        const newSections = [...formData.sections];
        newSections[sectionIdx].name = name;
        setFormData({ ...formData, sections: newSections });
    };

    const removeSection = (sectionIdx) => {
        setFormData({
            ...formData,
            sections: formData.sections.filter((_, i) => i !== sectionIdx)
        });
    };

    const addSectionDye = (sectionIdx) => {
        const newSections = [...formData.sections];
        newSections[sectionIdx].dyes.push({ color: '', amount: '', unit: 'ml' });
        setFormData({ ...formData, sections: newSections });
    };

    const updateSectionDye = (sectionIdx, dyeIdx, field, value) => {
        const newSections = [...formData.sections];
        newSections[sectionIdx].dyes[dyeIdx][field] = value;
        setFormData({ ...formData, sections: newSections });
    };

    const removeSectionDye = (sectionIdx, dyeIdx) => {
        const newSections = [...formData.sections];
        newSections[sectionIdx].dyes = newSections[sectionIdx].dyes.filter((_, i) => i !== dyeIdx);
        setFormData({ ...formData, sections: newSections });
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">🧪 Color Lab</h2>
                    <p className="text-gray-600 text-sm mt-1">Experiment with color ideas before committing to recipes</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            showArchived 
                                ? 'bg-gray-600 text-white hover:bg-gray-700' 
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        {showArchived ? '📂 Hide Archived' : '📦 Show Archived'}
                    </button>
                    <button
                        onClick={() => showForm ? closeForm() : setShowForm(true)}
                        className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                    >
                        {showForm ? '✕ Cancel' : '+ New Color Sketch'}
                    </button>
                </div>
            </div>

            {/* Form */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                <div className="bg-white rounded-lg card-shadow p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold">{editingId ? 'Edit' : 'New'} Color Sketch</h3>
                        <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                >
                                    <option value="speckled">Speckled</option>
                                    <option value="tonal">Tonal</option>
                                    <option value="variegated">Variegated</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Weight (grams) *</label>
                                <input
                                    type="number"
                                    required
                                    value={formData.yarnWeight}
                                    onChange={(e) => setFormData({ ...formData, yarnWeight: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    placeholder="100"
                                />
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Custom Name (Optional)</label>
                            <input
                                type="text"
                                value={formData.customName}
                                onChange={(e) => setFormData({ ...formData, customName: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="e.g., Ocean Waves, Sunset Dreams"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Your own name for this color (ID will be auto-generated)
                            </p>
                        </div>

                        {/* Tonal: Dye list */}
                        {formData.type === 'tonal' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Dye Colors (Stock Solution)</label>
                                {formData.dyes.map((dye, idx) => (
                                    <div key={idx} className="flex gap-2 mb-2">
                                        <input
                                            list={`dye-list-${idx}`}
                                            value={dye.color}
                                            onChange={(e) => updateDye(idx, 'color', e.target.value)}
                                            placeholder="Type or select dye..."
                                            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        />
                                        <datalist id={`dye-list-${idx}`}>
                                            {availableDyes.map(dyeName => (
                                                <option key={dyeName} value={dyeName} />
                                            ))}
                                        </datalist>
                                        <input
                                            type="number"
                                            step="0.1"
                                            placeholder="Amount"
                                            value={dye.amount}
                                            onChange={(e) => updateDye(idx, 'amount', e.target.value)}
                                            className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        />
                                        <select
                                            value={dye.unit}
                                            onChange={(e) => updateDye(idx, 'unit', e.target.value)}
                                            className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                        >
                                            <option value="ml">ml</option>
                                            <option value="g">g</option>
                                        </select>
                                        {formData.dyes.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeDye(idx)}
                                                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addDye}
                                    className="text-sm text-teal-600 hover:text-teal-800"
                                >
                                    + Add Another Dye
                                </button>
                            </div>
                        )}

                        {/* Speckled: Base colors + Speckles */}
                        {formData.type === 'speckled' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Base Colors (Stock Solution - Optional)</label>
                                    {formData.baseColors.map((base, idx) => (
                                        <div key={idx} className="flex gap-2 mb-2">
                                            <input
                                                list={`base-list-${idx}`}
                                                value={base.color}
                                                onChange={(e) => updateBaseColor(idx, 'color', e.target.value)}
                                                placeholder="Type or select dye..."
                                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            />
                                            <datalist id={`base-list-${idx}`}>
                                                {availableDyes.map(dyeName => (
                                                    <option key={dyeName} value={dyeName} />
                                                ))}
                                            </datalist>
                                            <input
                                                type="number"
                                                step="0.1"
                                                placeholder="Amount"
                                                value={base.amount}
                                                onChange={(e) => updateBaseColor(idx, 'amount', e.target.value)}
                                                className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            />
                                            <select
                                                value={base.unit}
                                                onChange={(e) => updateBaseColor(idx, 'unit', e.target.value)}
                                                className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="ml">ml</option>
                                            </select>
                                            {formData.baseColors.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeBaseColor(idx)}
                                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={addBaseColor}
                                        className="text-sm text-teal-600 hover:text-teal-800"
                                    >
                                        + Add Base Color
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Speckles (Dry Powder)</label>
                                    {formData.speckles.map((speckle, idx) => (
                                        <div key={idx} className="flex gap-2 mb-2">
                                            <input
                                                list={`speckle-list-${idx}`}
                                                value={speckle.color}
                                                onChange={(e) => updateSpeckle(idx, 'color', e.target.value)}
                                                placeholder="Type or select dye..."
                                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            />
                                            <datalist id={`speckle-list-${idx}`}>
                                                {availableDyes.map(dyeName => (
                                                    <option key={dyeName} value={dyeName} />
                                                ))}
                                            </datalist>
                                            <input
                                                type="number"
                                                step="0.01"
                                                placeholder="Amount"
                                                value={speckle.amount}
                                                onChange={(e) => updateSpeckle(idx, 'amount', e.target.value)}
                                                className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            />
                                            <select
                                                value={speckle.unit}
                                                onChange={(e) => updateSpeckle(idx, 'unit', e.target.value)}
                                                className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                            >
                                                <option value="g">g</option>
                                                <option value="tsp">tsp</option>
                                            </select>
                                            {formData.speckles.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeSpeckle(idx)}
                                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={addSpeckle}
                                        className="text-sm text-teal-600 hover:text-teal-800"
                                    >
                                        + Add Speckle
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Variegated: Sections with dyes */}
                        {formData.type === 'variegated' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Color Sections</label>
                                {formData.sections.map((section, sectionIdx) => (
                                    <div key={sectionIdx} className="mb-4 p-4 border rounded-lg bg-gray-50">
                                        <div className="flex justify-between items-center mb-2">
                                            <input
                                                type="text"
                                                value={section.name}
                                                onChange={(e) => updateSectionName(sectionIdx, e.target.value)}
                                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 font-medium"
                                                placeholder="Section name"
                                            />
                                            {formData.sections.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeSection(sectionIdx)}
                                                    className="ml-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                >
                                                    ✕ Remove Section
                                                </button>
                                            )}
                                        </div>
                                        {section.dyes.map((dye, dyeIdx) => (
                                            <div key={dyeIdx} className="flex gap-2 mb-2">
                                                <input
                                                    list={`section-dye-list-${sectionIdx}-${dyeIdx}`}
                                                    value={dye.color}
                                                    onChange={(e) => updateSectionDye(sectionIdx, dyeIdx, 'color', e.target.value)}
                                                    placeholder="Type or select dye..."
                                                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                                />
                                                <datalist id={`section-dye-list-${sectionIdx}-${dyeIdx}`}>
                                                    {availableDyes.map(dyeName => (
                                                        <option key={dyeName} value={dyeName} />
                                                    ))}
                                                </datalist>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="Amount"
                                                    value={dye.amount}
                                                    onChange={(e) => updateSectionDye(sectionIdx, dyeIdx, 'amount', e.target.value)}
                                                    className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                                />
                                                <select
                                                    value={dye.unit}
                                                    onChange={(e) => updateSectionDye(sectionIdx, dyeIdx, 'unit', e.target.value)}
                                                    className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                                                >
                                                    <option value="ml">ml</option>
                                                    <option value="g">g</option>
                                                </select>
                                                {section.dyes.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeSectionDye(sectionIdx, dyeIdx)}
                                                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => addSectionDye(sectionIdx)}
                                            className="text-sm text-teal-600 hover:text-teal-800"
                                        >
                                            + Add Dye to Section
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addSection}
                                    className="text-sm text-teal-600 hover:text-teal-800 font-medium"
                                >
                                    + Add Section
                                </button>
                            </div>
                        )}

                        {/* Notes */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={3}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Ideas, inspiration, adjustments..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update' : 'Save'} Sketch
                            </button>
                            <button
                                type="button"
                                onClick={closeForm}
                                className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
                </div>
            )}

            {/* Color Sketches List */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {colorSketches.filter(s => showArchived ? s.archived : !s.archived).map(sketch => (
                    <div key={sketch.id} className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">
                                    {sketch.colorId || 'No ID'}
                                    {sketch.customName && ` - ${sketch.customName}`}
                                </h3>
                                <div className="mt-1 flex gap-2">
                                    <span className="inline-block px-2 py-1 bg-teal-100 text-teal-700 text-xs rounded">
                                        {sketch.type}
                                    </span>
                                    {sketch.yarnWeight && (
                                        <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                            {sketch.yarnWeight}g
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => promoteToRecipe(sketch)}
                                    className="text-green-600 hover:bg-green-50 px-2 py-1 rounded"
                                    title="Promote to Recipe"
                                >
                                    ⬆️
                                </button>
                                <button
                                    onClick={() => duplicateSketch(sketch)}
                                    className="text-teal-600 hover:bg-teal-50 px-2 py-1 rounded"
                                    title="Duplicate"
                                >
                                    📑
                                </button>
                                <button
                                    onClick={() => archiveSketch(sketch.id)}
                                    className="text-gray-600 hover:bg-gray-100 px-2 py-1 rounded"
                                    title={sketch.archived ? "Unarchive" : "Archive"}
                                >
                                    {sketch.archived ? '📂' : '📦'}
                                </button>
                                <button
                                    onClick={() => editSketch(sketch)}
                                    className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded"
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => deleteSketch(sketch.id)}
                                    className="text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {sketch.type === 'variegated' ? (
                                <>
                                    <h4 className="text-sm font-medium text-gray-700">Sections:</h4>
                                    {sketch.sections?.map((section, idx) => (
                                        <div key={idx} className="pl-2 border-l-2 border-teal-300">
                                            <div className="text-sm font-medium text-gray-700">{section.name}</div>
                                            {section.dyes.map((dye, dyeIdx) => (
                                                <div key={dyeIdx} className="text-sm text-gray-600 flex justify-between pl-2">
                                                    <span>{dye.color}</span>
                                                    <span className="font-mono">{dye.amount}{dye.unit}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </>
                            ) : sketch.type === 'speckled' ? (
                                <>
                                    {sketch.baseColors && sketch.baseColors.length > 0 && sketch.baseColors[0].color && (
                                        <>
                                            <h4 className="text-sm font-medium text-gray-700">Base Colors:</h4>
                                            {sketch.baseColors.map((base, idx) => (
                                                <div key={idx} className="text-sm text-gray-600 flex justify-between">
                                                    <span>{base.color}</span>
                                                    <span className="font-mono">{base.amount}{base.unit}</span>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {sketch.speckles && sketch.speckles.length > 0 && (
                                        <>
                                            <h4 className="text-sm font-medium text-gray-700 mt-2">Speckles:</h4>
                                            {sketch.speckles.map((speckle, idx) => (
                                                <div key={idx} className="text-sm text-gray-600 flex justify-between">
                                                    <span>{speckle.color}</span>
                                                    <span className="font-mono">{speckle.amount}{speckle.unit}</span>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <h4 className="text-sm font-medium text-gray-700">Dye Formula:</h4>
                                    {sketch.dyes?.map((dye, idx) => (
                                        <div key={idx} className="text-sm text-gray-600 flex justify-between">
                                            <span>{dye.color}</span>
                                            <span className="font-mono">{dye.amount}{dye.unit}</span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        {sketch.notes && (
                            <div className="mt-3 pt-3 border-t">
                                <p className="text-sm text-gray-600 italic">{sketch.notes}</p>
                            </div>
                        )}
                        
                        {sketch.experimentNotes && (
                            <div className="mt-3 pt-3 border-t border-teal-200 bg-teal-50 rounded p-2">
                                <h4 className="text-xs font-semibold text-teal-900 mb-1">🧪 Experiment Notes:</h4>
                                <p className="text-sm text-teal-700 whitespace-pre-line">{sketch.experimentNotes}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {colorSketches.length === 0 && !showForm && (
                <div className="text-center py-12 bg-white rounded-lg card-shadow">
                    <p className="text-xl mb-2">🧪</p>
                    <p className="text-gray-500">No color sketches yet. Create your first experiment!</p>
                </div>
            )}
        </div>
    );
}
