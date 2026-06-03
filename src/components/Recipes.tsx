import React, { useState, useRef } from 'react';

export function Recipes({ recipes, saveRecipes, settings, inventory }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterColorType, setFilterColorType] = useState('all');
    const [sortBy, setSortBy] = useState('name');
    const fileInputRef = React.useRef(null);
    const [formData, setFormData] = useState({
        recipeId: '',
        name: '',
        yarnWeight: '',
        colorType: 'tonal',
        ingredients: [{ name: '', amount: '', unit: 'ml' }],
        // Variegated specific fields
        colorSolutions: [{ 
            name: '', 
            dyes: [{ name: '', amount: '', unit: 'g' }], 
            targetMl: '' 
        }],
        totalMl: '2400',
        stockSolutionPercent: '1',
        citricAcidPerBatch: '1',
        instructions: '',
        photos: [],
        notes: '',
        created: new Date().toISOString()
    });

    const PHOTO_LABELS = ['Pan Photo', 'Dry Skeins', 'Final Product', 'Detail Shot', 'Skein Close-up', 'Work in Progress', 'Other'];

    // Get list of dyes from inventory
    const availableDyes = inventory
        .filter(item => item.category === 'dye')
        .map(item => item.name)
        .sort();

    // Generate next Recipe ID based on colorType
    const generateRecipeId = (colorType) => {
        const prefix = colorType === 'tonal' ? 'R-T' : colorType === 'variegated' ? 'R-V' : 'R-S';
        const existingIds = recipes
            .filter(r => r.recipeId?.startsWith(prefix))
            .map(r => {
                const num = r.recipeId?.substring(prefix.length);
                return num ? parseInt(num) : 0;
            })
            .filter(n => !isNaN(n));
        
        const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
        return `${prefix}${String(nextNum).padStart(3, '0')}`;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            saveRecipes(recipes.map(r => r.id === editingId ? { ...formData, id: editingId } : r));
        } else {
            // Generate recipeId for new recipe
            const recipeId = generateRecipeId(formData.colorType);
            saveRecipes([...recipes, { ...formData, recipeId, id: Date.now() }]);
        }
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            recipeId: '',
            name: '',
            yarnWeight: '',
            colorType: 'tonal',
            ingredients: [{ name: '', amount: '', unit: 'ml' }],
            colorSolutions: [{ 
                name: '', 
                dyes: [{ name: '', amount: '', unit: 'g' }], 
                targetMl: '' 
            }],
            totalMl: '2400',
            stockSolutionPercent: '1',
            citricAcidPerBatch: '1',
            instructions: '',
            photo: '',
            photos: [],
            notes: '',
            created: new Date().toISOString()
        });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        setShowForm(false);
        setEditingId(null);
    };

    const editRecipe = (recipe) => {
        // Convert legacy single photo to photos array
        let recipeData = { ...recipe };
        if (!recipeData.photos || !Array.isArray(recipeData.photos)) {
            recipeData.photos = [];
            if (recipeData.photo) {
                recipeData.photos = [{ id: Date.now(), data: recipeData.photo, label: 'Photo' }];
            }
        }
        setFormData(recipeData);
        setEditingId(recipe.id);
        setShowForm(true);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const deleteRecipe = (id) => {
        if (confirm('Delete this recipe?')) {
            saveRecipes(recipes.filter(r => r.id !== id));
        }
    };

    const addIngredient = () => {
        setFormData({
            ...formData,
            ingredients: [...formData.ingredients, { name: '', amount: '', unit: 'ml' }]
        });
    };

    const updateIngredient = (index, field, value) => {
        const newIngredients = [...formData.ingredients];
        newIngredients[index][field] = value;
        setFormData({ ...formData, ingredients: newIngredients });
    };

    const removeIngredient = (index) => {
        setFormData({
            ...formData,
            ingredients: formData.ingredients.filter((_, i) => i !== index)
        });
    };

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;
                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height = Math.round((height * MAX_WIDTH) / width);
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width = Math.round((width * MAX_HEIGHT) / height);
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    
                    const newPhoto = {
                        id: Date.now(),
                        data: compressedDataUrl,
                        label: PHOTO_LABELS[formData.photos?.length || 0] || 'Photo'
                    };
                    const currentPhotos = formData.photos || [];
                    setFormData({ ...formData, photos: [...currentPhotos, newPhoto], photo: currentPhotos.length === 0 ? compressedDataUrl : formData.photo });
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        }
        // Reset file input so same file can be re-selected
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const removePhoto = (photoId) => {
        const updatedPhotos = (formData.photos || []).filter(p => p.id !== photoId);
        setFormData({ ...formData, photos: updatedPhotos, photo: updatedPhotos.length > 0 ? updatedPhotos[0].data : '' });
    };

    const updatePhotoLabel = (photoId, newLabel) => {
        const updatedPhotos = (formData.photos || []).map(p => 
            p.id === photoId ? { ...p, label: newLabel } : p
        );
        setFormData({ ...formData, photos: updatedPhotos });
    };

    const movePhoto = (index, direction) => {
        const photos = [...(formData.photos || [])];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= photos.length) return;
        [photos[index], photos[newIndex]] = [photos[newIndex], photos[index]];
        setFormData({ ...formData, photos, photo: photos.length > 0 ? photos[0].data : '' });
    };

    const filteredRecipes = recipes
        .filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .filter(r => filterColorType === 'all' || r.colorType === filterColorType)
        .sort((a, b) => {
            if (sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else if (sortBy === 'colorType') {
                return a.colorType.localeCompare(b.colorType);
            }
            return 0;
        });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Dye Recipes</h2>
                    <p className="text-sm text-gray-600 mt-1">{recipes.length} recipe{recipes.length !== 1 ? 's' : ''} total</p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Recipe'}
                </button>
            </div>

            {/* Search */}
            <input
                type="text"
                placeholder="🔍 Search recipes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />

            {/* Filter and Sort */}
            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Color Type</label>
                    <select
                        value={filterColorType}
                        onChange={(e) => setFilterColorType(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                        <option value="all">All Color Types</option>
                        {(settings.colorTypes || ['tonal', 'variegated', 'speckled']).map(type => (
                            <option key={type} value={type} className="capitalize">{type}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                        <option value="name">Colorway Name</option>
                        <option value="colorType">Color Type</option>
                    </select>
                </div>
            </div>

            {/* Form */}
            {showForm && (
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Recipe' : 'New Recipe'}</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Colorway Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="e.g., Deep Ocean Blue"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Weight (grams) *</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    required
                                    value={formData.yarnWeight}
                                    onChange={(e) => setFormData({ ...formData, yarnWeight: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="e.g., 100"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Color Type *</label>
                            <select
                                required
                                value={formData.colorType}
                                onChange={(e) => setFormData({ ...formData, colorType: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                            >
                                {(settings.colorTypes || ['tonal', 'variegated', 'speckled']).map(type => (
                                    <option key={type} value={type} className="capitalize">{type}</option>
                                ))}
                            </select>
                        </div>

                        {/* Tonal/Speckled Ingredients */}
                        {formData.colorType !== 'variegated' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Ingredients</label>
                                {formData.ingredients.map((ing, idx) => (
                                    <div key={idx} className="flex gap-2 mb-2">
                                        <div className="flex-1">
                                            <input
                                                type="text"
                                                placeholder="Dye/ingredient name"
                                                value={ing.name}
                                                onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                                list={`dye-list-${idx}`}
                                            />
                                            <datalist id={`dye-list-${idx}`}>
                                                {availableDyes.map((dye, i) => (
                                                    <option key={i} value={dye} />
                                                ))}
                                            </datalist>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.01"
                                            placeholder="Amount"
                                            value={ing.amount}
                                            onChange={(e) => updateIngredient(idx, 'amount', e.target.value)}
                                            className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        />
                                        <select
                                            value={ing.unit}
                                            onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                                            className="w-20 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        >
                                            <option value="ml">ml</option>
                                            <option value="g">g</option>
                                            <option value="tsp">tsp</option>
                                            <option value="tbsp">tbsp</option>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => removeIngredient(idx)}
                                            className="text-red-600 hover:text-red-800 px-2"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addIngredient}
                                    className="text-purple-600 hover:text-purple-700 text-sm font-medium"
                                >
                                    + Add Ingredient
                                </button>
                            </div>
                        )}

                        {/* Variegated Color Solutions */}
                        {formData.colorType === 'variegated' && (
                            <div className="space-y-4">
                                <div className="grid md:grid-cols-3 gap-4 bg-purple-50 p-4 rounded-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Total ml Needed</label>
                                        <input
                                            type="number"
                                            value={formData.totalMl}
                                            onChange={(e) => setFormData({ ...formData, totalMl: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="2400"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Stock Solution %</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={formData.stockSolutionPercent}
                                            onChange={(e) => setFormData({ ...formData, stockSolutionPercent: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="1"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">1g powder per 100ml water</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Citric Acid (tbsp)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={formData.citricAcidPerBatch}
                                            onChange={(e) => setFormData({ ...formData, citricAcidPerBatch: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="1"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">Per 300g yarn</p>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Color Solutions</label>
                                    {formData.colorSolutions.map((solution, sIdx) => (
                                        <div key={sIdx} className="border-2 border-purple-200 rounded-lg p-4 mb-4">
                                            <div className="flex justify-between items-center mb-3">
                                                <h4 className="font-medium text-gray-900">Solution {sIdx + 1}</h4>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newSolutions = formData.colorSolutions.filter((_, i) => i !== sIdx);
                                                        setFormData({ ...formData, colorSolutions: newSolutions });
                                                    }}
                                                    className="text-red-600 hover:text-red-800"
                                                >
                                                    Remove Solution
                                                </button>
                                            </div>
                                            
                                            <div className="grid md:grid-cols-2 gap-3 mb-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-1">Solution Name</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g., Purple Mix"
                                                        value={solution.name}
                                                        onChange={(e) => {
                                                            const newSolutions = [...formData.colorSolutions];
                                                            newSolutions[sIdx].name = e.target.value;
                                                            setFormData({ ...formData, colorSolutions: newSolutions });
                                                        }}
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-1">Target ml</label>
                                                    <input
                                                        type="number"
                                                        placeholder="800"
                                                        value={solution.targetMl}
                                                        onChange={(e) => {
                                                            const newSolutions = [...formData.colorSolutions];
                                                            newSolutions[sIdx].targetMl = e.target.value;
                                                            setFormData({ ...formData, colorSolutions: newSolutions });
                                                        }}
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                                    />
                                                </div>
                                            </div>

                                            <label className="block text-xs font-medium text-gray-700 mb-1">Dye Ingredients</label>
                                            {solution.dyes.map((dye, dIdx) => (
                                                <div key={dIdx} className="flex gap-2 mb-2">
                                                    <div className="flex-1">
                                                        <input
                                                            type="text"
                                                            placeholder="Dye name"
                                                            value={dye.name}
                                                            onChange={(e) => {
                                                                const newSolutions = [...formData.colorSolutions];
                                                                newSolutions[sIdx].dyes[dIdx].name = e.target.value;
                                                                setFormData({ ...formData, colorSolutions: newSolutions });
                                                            }}
                                                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-purple-500 text-sm"
                                                            list={`var-dye-list-${sIdx}-${dIdx}`}
                                                        />
                                                        <datalist id={`var-dye-list-${sIdx}-${dIdx}`}>
                                                            {availableDyes.map((d, i) => (
                                                                <option key={i} value={d} />
                                                            ))}
                                                        </datalist>
                                                    </div>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="Amount"
                                                        value={dye.amount}
                                                        onChange={(e) => {
                                                            const newSolutions = [...formData.colorSolutions];
                                                            newSolutions[sIdx].dyes[dIdx].amount = e.target.value;
                                                            setFormData({ ...formData, colorSolutions: newSolutions });
                                                        }}
                                                        className="w-20 px-2 py-1 border rounded focus:ring-2 focus:ring-purple-500 text-sm"
                                                    />
                                                    <select
                                                        value={dye.unit}
                                                        onChange={(e) => {
                                                            const newSolutions = [...formData.colorSolutions];
                                                            newSolutions[sIdx].dyes[dIdx].unit = e.target.value;
                                                            setFormData({ ...formData, colorSolutions: newSolutions });
                                                        }}
                                                        className="w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-purple-500 text-sm"
                                                    >
                                                        <option value="g">g</option>
                                                        <option value="ml">ml</option>
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newSolutions = [...formData.colorSolutions];
                                                            newSolutions[sIdx].dyes = newSolutions[sIdx].dyes.filter((_, i) => i !== dIdx);
                                                            setFormData({ ...formData, colorSolutions: newSolutions });
                                                        }}
                                                        className="text-red-600 hover:text-red-800 px-1 text-sm"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newSolutions = [...formData.colorSolutions];
                                                    newSolutions[sIdx].dyes.push({ name: '', amount: '', unit: 'g' });
                                                    setFormData({ ...formData, colorSolutions: newSolutions });
                                                }}
                                                className="text-purple-600 hover:text-purple-700 text-xs font-medium"
                                            >
                                                + Add Dye
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFormData({
                                                ...formData,
                                                colorSolutions: [
                                                    ...formData.colorSolutions,
                                                    { name: '', dyes: [{ name: '', amount: '', unit: 'g' }], targetMl: '' }
                                                ]
                                            });
                                        }}
                                        className="text-purple-600 hover:text-purple-700 text-sm font-medium"
                                    >
                                        + Add Color Solution
                                    </button>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                            <textarea
                                value={formData.instructions}
                                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                                rows="4"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                placeholder="Step-by-step dyeing process..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Photos {formData.photos?.length > 0 && <span className="text-purple-600">({formData.photos.length})</span>}
                            </label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoUpload}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">Add multiple photos — pan shots, dry skeins, finished product, etc.</p>
                            
                            {formData.photos && formData.photos.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {formData.photos.map((photo, index) => (
                                        <div key={photo.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 border">
                                            <img src={photo.data} alt={photo.label} className="rounded" style={{width: '60px', height: '60px', objectFit: 'cover', flexShrink: 0}} />
                                            <div className="flex-1 min-w-0">
                                                <select
                                                    value={photo.label}
                                                    onChange={(e) => updatePhotoLabel(photo.id, e.target.value)}
                                                    className="w-full text-sm px-2 py-1 border rounded focus:ring-1 focus:ring-purple-500"
                                                >
                                                    {PHOTO_LABELS.map(label => (
                                                        <option key={label} value={label}>{label}</option>
                                                    ))}
                                                </select>
                                                <p className="text-xs text-gray-400 mt-1">#{index + 1} of {formData.photos.length}</p>
                                            </div>
                                            <div className="flex flex-col gap-1 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => movePhoto(index, -1)}
                                                    disabled={index === 0}
                                                    className={`text-xs px-1.5 py-0.5 rounded ${index === 0 ? 'text-gray-300' : 'text-purple-600 hover:bg-purple-50'}`}
                                                >
                                                    ▲
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => movePhoto(index, 1)}
                                                    disabled={index === formData.photos.length - 1}
                                                    className={`text-xs px-1.5 py-0.5 rounded ${index === formData.photos.length - 1 ? 'text-gray-300' : 'text-purple-600 hover:bg-purple-50'}`}
                                                >
                                                    ▼
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removePhoto(photo.id)}
                                                className="text-red-500 hover:text-red-700 text-sm flex-shrink-0 px-1"
                                                title="Remove photo"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows="3"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                placeholder="Any tips, variations, or notes about this colorway..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update Recipe' : 'Save Recipe'}
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

            {/* Recipe List */}
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredRecipes.map(recipe => {
                    const [expanded, setExpanded] = React.useState(false);
                    const [photoIndex, setPhotoIndex] = React.useState(0);
                    
                    // Build photos array from legacy or new format
                    const photos = recipe.photos && recipe.photos.length > 0 
                        ? recipe.photos 
                        : recipe.photo 
                            ? [{ id: 1, data: recipe.photo, label: 'Photo' }]
                            : [];
                    const currentIdx = Math.min(photoIndex, photos.length - 1);
                    
                    return (
                    <div key={recipe.id} className="bg-white rounded-lg card-shadow p-4">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex-1">
                                {recipe.recipeId && (
                                    <p className="text-xs font-semibold text-purple-600 mb-1">{recipe.recipeId}</p>
                                )}
                                <h3 className="text-lg font-semibold text-gray-900">{recipe.name}</h3>
                                <div className="flex gap-2 items-center mt-1">
                                    <p className="text-xs text-purple-600 font-medium">{recipe.yarnWeight}g</p>
                                    <span className="text-gray-400">•</span>
                                    <p className="text-xs text-gray-600 capitalize">{recipe.colorType}</p>
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    onClick={() => editRecipe(recipe)}
                                    className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-sm"
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => deleteRecipe(recipe.id)}
                                    className="text-red-600 hover:bg-red-50 px-2 py-1 rounded text-sm"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>

                        {/* Photo Gallery */}
                        {photos.length > 0 && (
                            <div className="mb-3">
                                <div className="relative">
                                    <img 
                                        src={photos[currentIdx].data} 
                                        alt={photos[currentIdx].label || recipe.name} 
                                        className="rounded-lg w-full" 
                                        style={{maxHeight: '200px', objectFit: 'cover'}} 
                                    />
                                    {photos.length > 1 && (
                                        <React.Fragment>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setPhotoIndex(currentIdx > 0 ? currentIdx - 1 : photos.length - 1); }}
                                                className="absolute left-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-opacity-70"
                                            >◀</button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setPhotoIndex(currentIdx < photos.length - 1 ? currentIdx + 1 : 0); }}
                                                className="absolute right-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-opacity-70"
                                            >▶</button>
                                        </React.Fragment>
                                    )}
                                </div>
                                <div className="flex items-center justify-center gap-1 mt-1.5">
                                    {photos.length > 1 && photos.map((p, i) => (
                                        <button
                                            key={p.id || i}
                                            onClick={() => setPhotoIndex(i)}
                                            className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentIdx ? 'bg-purple-600' : 'bg-gray-300 hover:bg-gray-400'}`}
                                        />
                                    ))}
                                </div>
                                {photos[currentIdx].label && photos[currentIdx].label !== 'Photo' && (
                                    <p className="text-xs text-center text-gray-500 mt-0.5">{photos[currentIdx].label}</p>
                                )}
                            </div>
                        )}

                        {/* Collapsible Ingredients & Instructions */}
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="w-full text-left text-sm text-purple-600 hover:text-purple-700 font-medium mt-2 mb-2"
                        >
                            {expanded ? '▼' : '▶'} {expanded ? 'Hide' : 'Show'} Details
                        </button>

                        {expanded && (
                            <div className="space-y-3 text-xs">
                                {recipe.colorType === 'variegated' && recipe.colorSolutions ? (
                                    <div>
                                        <h4 className="font-medium text-gray-700 mb-1">Color Solutions:</h4>
                                        {recipe.colorSolutions.map((solution, idx) => (
                                            <div key={idx} className="mb-2 pl-2 border-l-2 border-purple-300">
                                                <div className="font-medium text-purple-700">{solution.name || `Solution ${idx + 1}`}</div>
                                                <div className="text-gray-600">Target: {solution.targetMl}ml</div>
                                                <ul className="space-y-1 mt-1">
                                                    {solution.dyes.map((dye, dIdx) => (
                                                        <li key={dIdx} className="text-gray-600">
                                                            {dye.name}: {dye.amount}{dye.unit}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                        {recipe.totalMl && <div className="text-gray-600 mt-2">Total: {recipe.totalMl}ml</div>}
                                    </div>
                                ) : recipe.ingredients && (
                                    <div>
                                        <h4 className="font-medium text-gray-700 mb-1">Ingredients:</h4>
                                        <ul className="space-y-1">
                                            {recipe.ingredients.map((ing, idx) => (
                                                <li key={idx} className="text-gray-600">
                                                    {ing.name}: {ing.amount}{ing.unit}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {recipe.instructions && (
                                    <div>
                                        <h4 className="font-medium text-gray-700 mb-1">Instructions:</h4>
                                        <p className="text-gray-600 whitespace-pre-line">{recipe.instructions}</p>
                                    </div>
                                )}

                                {recipe.notes && (
                                    <div>
                                        <h4 className="font-medium text-gray-700 mb-1">Notes:</h4>
                                        <p className="text-gray-600">{recipe.notes}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <p className="text-xs text-gray-400 pt-2">
                            Created: {new Date(recipe.created).toLocaleDateString()}
                        </p>
                    </div>
                    );
                })}
            </div>

            {filteredRecipes.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">📝</p>
                    <p>No recipes yet. Create your first dye recipe!</p>
                </div>
            )}
        </div>
    );
}

// Kits Component
// Color Lab Component - Phase 1 (Enhanced)
