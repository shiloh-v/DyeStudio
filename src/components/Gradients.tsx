import React, { useState, useRef, useEffect } from 'react';
import { GradientCard } from './GradientCard';
import { useFormGuard } from '../lib/useFormGuard';
import { confirmDialog } from '../lib/dialog';
import type { Gradient } from '../types';

export function Gradients({ gradients, saveGradients, inventory }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [filterType, setFilterType] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const fileInputRef = React.useRef(null);
    const cameraInputRef = React.useRef(null);

    const DOS_LEVELS = [0.0625, 0.125, 0.25, 0.50, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0];
    const SQUARE_AMOUNTS = [1.25, 2.5, 5, 7.5, 10];

    // Dynamic photo labels based on gradient type
    const getPhotoLabels = (type) => {
        const general = ['Full Set', 'Detail Shot', 'Other'];
        if (type === 'dos') {
            const shadeLabels = DOS_LEVELS.map((dos, i) => `Shade ${i + 1} (${dos}%)`);
            return [...shadeLabels, ...general];
        } else {
            let squareLabels = [];
            let num = 1;
            SQUARE_AMOUNTS.forEach(a => {
                SQUARE_AMOUNTS.forEach(b => {
                    squareLabels.push(`Square #${num} (A:${a} B:${b})`);
                    num++;
                });
            });
            return [...squareLabels, 'Grid Layout', ...general];
        }
    };

    const emptyForm = {
        name: '',
        type: 'dos',
        dyeColor: '',
        colorA: '',
        colorB: '',
        yarnBase: '',
        skeinWeight: 10,
        photos: [],
        photo: '',
        notes: '',
        created: new Date().toISOString()
    };

    const [formData, setFormData] = useState<Partial<Gradient>>(emptyForm);

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

    const availableDyes = inventory
        .filter(item => item.category === 'dye')
        .map(item => item.name)
        .sort();

    const availableYarnBases = inventory
        .filter(item => item.category === 'yarn base')
        .map(item => item.name)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();

    const generateGradientId = () => {
        const existingIds = gradients
            .filter(g => g.gradientId?.startsWith('G-'))
            .map(g => {
                const num = g.gradientId?.substring(2);
                return num ? parseInt(num) : 0;
            })
            .filter(n => !isNaN(n));
        const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
        return `G-${String(nextNum).padStart(3, '0')}`;
    };

    const calculateDosML = (dosPercent, skeinWeight) => {
        return dosPercent * skeinWeight;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        let gradientData = { ...formData };
        
        // Build shades/squares data
        if (formData.type === 'dos') {
            gradientData.shades = DOS_LEVELS.map(dos => ({
                dos,
                ml: calculateDosML(dos, formData.skeinWeight)
            }));
        } else {
            gradientData.squares = [];
            let squareNum = 1;
            const sw = Number(formData.skeinWeight) || 10;
            SQUARE_AMOUNTS.forEach(colorA_ml => {
                SQUARE_AMOUNTS.forEach(colorB_ml => {
                    gradientData.squares.push({
                        square: squareNum++,
                        colorA_ml,
                        colorB_ml,
                        dos: (colorA_ml + colorB_ml) / sw
                    });
                });
            });
        }

        if (editingId) {
            saveGradients(gradients.map(g => g.id === editingId ? { ...gradientData, id: editingId } : g));
        } else {
            const gradientId = generateGradientId();
            saveGradients([...gradients, { ...gradientData, gradientId, id: Date.now() }]);
        }
        resetForm();
    };

    const resetForm = () => {
        setFormData(emptyForm);
        setShowForm(false);
        setEditingId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const editGradient = (gradient) => {
        let data = { ...gradient };
        if (!data.photos || !Array.isArray(data.photos)) {
            data.photos = [];
            if (data.photo) {
                data.photos = [{ id: Date.now(), data: data.photo, label: 'Photo' }];
            }
        }
        setFormData(data);
        setEditingId(gradient.id);
        setShowForm(true);
    };

    const deleteGradient = async (id) => {
        if (await confirmDialog({ message: 'Delete this gradient?', confirmText: 'Delete', danger: true })) {
            saveGradients(gradients.filter(g => g.id !== id));
        }
    };

    // Photo management (same pattern as Recipes)
    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const MAX = 800;
                    let w = img.width, h = img.height;
                    if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
                    else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
                    canvas.width = w; canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);
                    const compressed = canvas.toDataURL('image/jpeg', 0.7);
                    const labels = getPhotoLabels(formData.type);
                    const newPhoto = { id: Date.now(), data: compressed, label: labels[formData.photos?.length || 0] || 'Full Set' };
                    const current = formData.photos || [];
                    setFormData({ ...formData, photos: [...current, newPhoto], photo: current.length === 0 ? compressed : formData.photo });
                };
                img.src = reader.result as string;
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    };

    const removePhoto = (photoId) => {
        const updated = (formData.photos || []).filter(p => p.id !== photoId);
        setFormData({ ...formData, photos: updated, photo: updated.length > 0 ? updated[0].data : '' });
    };

    const updatePhotoLabel = (photoId, newLabel) => {
        setFormData({ ...formData, photos: (formData.photos || []).map(p => p.id === photoId ? { ...p, label: newLabel } : p) });
    };

    const movePhoto = (index, direction) => {
        const photos = [...(formData.photos || [])];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= photos.length) return;
        [photos[index], photos[newIndex]] = [photos[newIndex], photos[index]];
        setFormData({ ...formData, photos, photo: photos.length > 0 ? photos[0].data : '' });
    };

    const filteredGradients = gradients
        .filter(g => filterType === 'all' || g.type === filterType)
        .filter(g => {
            const term = searchTerm.toLowerCase();
            return g.name?.toLowerCase().includes(term) || 
                   g.dyeColor?.toLowerCase().includes(term) ||
                   g.colorA?.toLowerCase().includes(term) ||
                   g.colorB?.toLowerCase().includes(term) ||
                   g.gradientId?.toLowerCase().includes(term);
        })
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Gradients</h2>
                    <p className="text-sm text-gray-600 mt-1">{gradients.length} gradient{gradients.length !== 1 ? 's' : ''} total</p>
                </div>
                <button
                    onClick={() => showForm ? closeForm() : setShowForm(true)}
                    className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Gradient'}
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="🔍 Search gradients..."
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 flex-1 min-w-0"
                    style={{maxWidth: '300px'}}
                />
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                    <option value="all">All Types</option>
                    <option value="dos">DOS Gradients</option>
                    <option value="dyeSquare">Dye Squares</option>
                </select>
            </div>

            {/* Form */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                <div className="bg-white rounded-lg card-shadow p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold">{editingId ? 'Edit Gradient' : 'New Gradient'}</h3>
                        <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Type Toggle */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Gradient Type</label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type: 'dos' })}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                        formData.type === 'dos' 
                                            ? 'bg-teal-600 text-white' 
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    🎨 DOS Gradient (10 shades)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type: 'dyeSquare' })}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                        formData.type === 'dyeSquare' 
                                            ? 'bg-teal-600 text-white' 
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    🔲 Dye Square (5×5 grid)
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder={formData.type === 'dos' ? 'e.g. Teal DOS Gradient' : 'e.g. Black × Blue Dye Square'}
                                required
                            />
                        </div>

                        {/* Dye Colors */}
                        {formData.type === 'dos' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Dye Color</label>
                                <select
                                    value={formData.dyeColor}
                                    onChange={(e) => setFormData({ ...formData, dyeColor: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    required
                                >
                                    <option value="">Select dye color...</option>
                                    {availableDyes.map(dye => (
                                        <option key={dye} value={dye}>{dye}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Color A</label>
                                    <select
                                        value={formData.colorA}
                                        onChange={(e) => setFormData({ ...formData, colorA: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        required
                                    >
                                        <option value="">Select Color A...</option>
                                        {availableDyes.map(dye => (
                                            <option key={dye} value={dye}>{dye}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Color B</label>
                                    <select
                                        value={formData.colorB}
                                        onChange={(e) => setFormData({ ...formData, colorB: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        required
                                    >
                                        <option value="">Select Color B...</option>
                                        {availableDyes.map(dye => (
                                            <option key={dye} value={dye}>{dye}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Yarn Base */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Base</label>
                                <select
                                    value={formData.yarnBase}
                                    onChange={(e) => setFormData({ ...formData, yarnBase: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    required
                                >
                                    <option value="">Select yarn base...</option>
                                    {availableYarnBases.map(yarn => (
                                        <option key={yarn} value={yarn}>{yarn}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Skein Weight (g)</label>
                                <input
                                    type="number"
                                    value={formData.skeinWeight}
                                    onChange={(e) => setFormData({ ...formData, skeinWeight: parseFloat(e.target.value) || 10 })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    min="1"
                                    step="1"
                                />
                            </div>
                        </div>

                        {/* Preview Table */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                {formData.type === 'dos' ? '📊 DOS Shade Reference' : '📊 Dye Square Grid Preview'}
                            </label>
                            {formData.type === 'dos' ? (
                                <div className="bg-teal-50 rounded-lg p-3 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-teal-200">
                                                <th className="text-left py-1 px-2 text-teal-700">Shade</th>
                                                <th className="text-right py-1 px-2 text-teal-700">DOS %</th>
                                                <th className="text-right py-1 px-2 text-teal-700">mL needed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {DOS_LEVELS.map((dos, i) => (
                                                <tr key={dos} className={i % 2 === 0 ? 'bg-teal-50' : 'bg-white'}>
                                                    <td className="py-1 px-2 text-gray-700">Shade {i + 1}</td>
                                                    <td className="py-1 px-2 text-right text-gray-700">{dos}%</td>
                                                    <td className="py-1 px-2 text-right font-medium text-teal-700">{calculateDosML(dos, Number(formData.skeinWeight) || 10)} mL</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="bg-blue-50 rounded-lg p-3 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="py-1 px-1 text-blue-700 text-left" style={{minWidth: '70px'}}>A ↓ / B →</th>
                                                {SQUARE_AMOUNTS.map(b => (
                                                    <th key={b} className="py-1 px-1 text-center text-blue-700">{b} mL</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {SQUARE_AMOUNTS.map((a, ri) => (
                                                <tr key={a} className={ri % 2 === 0 ? 'bg-blue-50' : 'bg-white'}>
                                                    <td className="py-1 px-1 font-medium text-blue-700">{a} mL</td>
                                                    {SQUARE_AMOUNTS.map(b => {
                                                        const dos = ((a + b) / (Number(formData.skeinWeight) || 10)).toFixed(formData.skeinWeight === 10 ? 2 : 4);
                                                        return (
                                                            <td key={b} className="py-1 px-1 text-center text-gray-700">
                                                                {dos}%
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Photos */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Photos {formData.photos?.length > 0 && <span className="text-teal-600">({formData.photos.length})</span>}
                            </label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => cameraInputRef.current?.click()}
                                    className="flex-1 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                                >
                                    📷 Take Photo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                                >
                                    🖼️ Choose File
                                </button>
                            </div>
                            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                            <p className="text-xs text-gray-500 mt-1">Add photos of your gradient skeins</p>
                            {formData.photos && formData.photos.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {formData.photos.map((photo, index) => (
                                        <div key={photo.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 border">
                                            <img src={photo.data} alt={photo.label} className="rounded" style={{width: '60px', height: '60px', objectFit: 'cover', flexShrink: 0}} />
                                            <div className="flex-1 min-w-0">
                                                <select
                                                    value={photo.label}
                                                    onChange={(e) => updatePhotoLabel(photo.id, e.target.value)}
                                                    className="w-full text-sm px-2 py-1 border rounded focus:ring-1 focus:ring-teal-500"
                                                >
                                                    {getPhotoLabels(formData.type).map(label => (
                                                        <option key={label} value={label}>{label}</option>
                                                    ))}
                                                </select>
                                                <p className="text-xs text-gray-400 mt-1">#{index + 1} of {formData.photos.length}</p>
                                            </div>
                                            <div className="flex flex-col gap-1 flex-shrink-0">
                                                <button type="button" onClick={() => movePhoto(index, -1)} disabled={index === 0}
                                                    className={`text-xs px-1.5 py-0.5 rounded ${index === 0 ? 'text-gray-300' : 'text-teal-600 hover:bg-teal-50'}`}>▲</button>
                                                <button type="button" onClick={() => movePhoto(index, 1)} disabled={index === formData.photos.length - 1}
                                                    className={`text-xs px-1.5 py-0.5 rounded ${index === formData.photos.length - 1 ? 'text-gray-300' : 'text-teal-600 hover:bg-teal-50'}`}>▼</button>
                                            </div>
                                            <button type="button" onClick={() => removePhoto(photo.id)}
                                                className="text-red-500 hover:text-red-700 text-sm flex-shrink-0 px-1" title="Remove photo">✕</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={3}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Observations, results, or plans for this gradient..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button type="submit" className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                                {editingId ? 'Update Gradient' : 'Save Gradient'}
                            </button>
                            <button type="button" onClick={closeForm} className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
                </div>
            )}

            {/* Gradient Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredGradients.map(gradient => (
                    <GradientCard 
                        key={gradient.id} 
                        gradient={gradient} 
                        editGradient={editGradient} 
                        deleteGradient={deleteGradient}
                        DOS_LEVELS={DOS_LEVELS}
                        SQUARE_AMOUNTS={SQUARE_AMOUNTS}
                        calculateDosML={calculateDosML}
                    />
                ))}
            </div>

            {filteredGradients.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🌈</p>
                    <p>No gradients yet. Track your first DOS gradient or dye square!</p>
                </div>
            )}
        </div>
    );
}

// Settings Component
