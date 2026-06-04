import { useState } from 'react';

export function Kits({ kits, saveKits, recipes, inventory }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        bundleType: '6-color DK set',
        colors: [{ colorwayName: '', quantity: 1 }],
        notes: ''
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            saveKits(kits.map(k => k.id === editingId ? { ...formData, id: editingId } : k));
        } else {
            // Auto-generate bundle ID
            const getNextBundleId = () => {
                const existingBundleIds = kits
                    .map(k => k.bundleId || k.bundle_id)
                    .filter(id => id && id.startsWith('BN-'))
                    .map(id => parseInt(id.substring(3)))
                    .filter(n => !isNaN(n));
                
                const maxNum = existingBundleIds.length > 0 ? Math.max(...existingBundleIds) : 0;
                return `BN-${String(maxNum + 1).padStart(3, '0')}`;
            };

            const bundleId = getNextBundleId();
            saveKits([...kits, { ...formData, id: Date.now(), bundleId: bundleId, created: new Date().toISOString() }]);
        }
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            bundleType: '6-color DK set',
            colors: [{ colorwayName: '', quantity: 1 }],
            notes: ''
        });
        setShowForm(false);
        setEditingId(null);
    };

    const editKit = (kit) => {
        // Strip any legacy baseYarn fields from colors
        const updatedKit = {
            ...kit,
            colors: kit.colors.map(({ baseYarn, ...rest }) => rest)
        };
        setFormData(updatedKit);
        setEditingId(kit.id);
        setShowForm(true);
    };

    const deleteKit = (id) => {
        if (confirm('Delete this kit?')) {
            saveKits(kits.filter(k => k.id !== id));
        }
    };

    const addColor = () => {
        setFormData({
            ...formData,
            colors: [...formData.colors, { colorwayName: '', quantity: 1 }]
        });
    };

    const updateColor = (index, field, value) => {
        const newColors = [...formData.colors];
        newColors[index][field] = value;
        setFormData({ ...formData, colors: newColors });
    };

    const removeColor = (index) => {
        setFormData({
            ...formData,
            colors: formData.colors.filter((_, i) => i !== index)
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Yarn Kits</h2>
                    <p className="text-sm text-gray-600 mt-1">{kits.length} kit{kits.length !== 1 ? 's' : ''} total</p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Kit'}
                </button>
            </div>

            {/* Form */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={resetForm}>
                <div className="bg-white rounded-lg card-shadow p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold">{editingId ? 'Edit Kit' : 'New Kit'}</h3>
                        <button type="button" onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Kit Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    placeholder="e.g., Autumn Kit"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    placeholder="e.g., Fall-themed colorways"
                                />
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Bundle Type *</label>
                                <select
                                    required
                                    value={formData.bundleType || '6-color DK set'}
                                    onChange={(e) => setFormData({ ...formData, bundleType: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                >
                                    <option value="6-color DK set">6-color DK set</option>
                                    <option value="sock set">Sock set</option>
                                    <option value="2-color DK set">2-color DK set</option>
                                    <option value="6-color miniskein set">6-color miniskein set</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Colors in Kit</label>
                            {formData.colors.map((color, idx) => (
                                <div key={idx} className="grid grid-cols-12 gap-2 mb-2">
                                    <div className="col-span-9">
                                        <input
                                            type="text"
                                            placeholder="Colorway name"
                                            value={color.colorwayName}
                                            onChange={(e) => updateColor(idx, 'colorwayName', e.target.value)}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            list={`colorway-list-${idx}`}
                                        />
                                        <datalist id={`colorway-list-${idx}`}>
                                            {recipes.map(r => (
                                                <option key={r.id} value={r.name} />
                                            ))}
                                        </datalist>
                                    </div>
                                    <div className="col-span-2">
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="Qty"
                                            value={color.quantity}
                                            onChange={(e) => updateColor(idx, 'quantity', e.target.value)}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        />
                                    </div>
                                    {formData.colors.length > 1 && (
                                        <div className="col-span-1">
                                            <button
                                                type="button"
                                                onClick={() => removeColor(idx)}
                                                className="w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addColor}
                                className="text-teal-600 hover:text-teal-700 text-sm font-medium"
                            >
                                + Add Color
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={2}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Any additional notes about this kit..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update Kit' : 'Save Kit'}
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
                </div>
            )}

            {/* Kits List */}
            <div className="grid md:grid-cols-2 gap-6">
                {kits.map(kit => (
                    <div key={kit.id} className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-xl font-semibold text-gray-900">{kit.name}</h3>
                                {kit.bundleId && (
                                    <p className="text-sm text-gray-500 mt-1">ID: {kit.bundleId}</p>
                                )}
                                {kit.description && (
                                    <p className="text-gray-600 text-sm mt-1">{kit.description}</p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => editKit(kit)}
                                    className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded"
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => deleteKit(kit.id)}
                                    className="text-red-600 hover:bg-red-50 px-3 py-1 rounded"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>

                        <div>
                            <h4 className="font-medium text-sm text-gray-700 mb-2">Colors in Kit:</h4>
                            <div className="grid grid-cols-2 gap-3" style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)'}}>
                                {kit.colors.flatMap((color, colorIdx) => {
                                    const qty = parseInt(color.quantity || 1);
                                    const recipe = recipes.find(r => r.name === color.colorwayName);
                                    return Array.from({ length: qty }, (_, i) => (
                                        <div key={`${colorIdx}-${i}`} className="p-2 bg-teal-50 rounded border">
                                            <div className="flex items-center gap-2">
                                                {recipe && recipe.photo && (
                                                    <img 
                                                        src={recipe.photo} 
                                                        alt={color.colorwayName}
                                                        className="w-12 h-12 object-cover rounded border flex-shrink-0"
                                                    />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium text-gray-900 truncate">
                                                        {color.colorwayName}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ));
                                })}
                            </div>
                            
                            {kit.notes && (
                                <div className="pt-2 border-t mt-3">
                                    <p className="text-sm text-gray-600"><strong>Notes:</strong> {kit.notes}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {kits.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🎁</p>
                    <p>No kits yet. Create your first kit!</p>
                </div>
            )}
        </div>
    );
}

// Dye Sessions Component
