import { useState } from 'react';

export function Inventory({ inventory, saveInventory, settings }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [filterCategory, setFilterCategory] = useState('all');
    const [formData, setFormData] = useState({
        name: '',
        category: 'dye',
        quantity: '',
        unit: 'oz',
        hankSize: '',
        lowStockThreshold: '',
        cost: '',
        purchasePrice: '',
        purchaseOunces: '',
        supplier: '',
        color: '',
        image: '',
        notes: '',
        // Yarn base specific fields
        myYarnName: '',
        fiberContent: '',
        yardage: '',
        presentation: '',
        needleSize: '',
        gauge: '',
        wpi: '',
        plies: '',
        weight: ''
    });

    const categories = settings.inventoryCategories || ['dye', 'yarn base', 'chemical', 'tool', 'other'];

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            saveInventory(inventory.map(i => i.id === editingId ? { ...formData, id: editingId } : i));
        } else {
            saveInventory([...inventory, { ...formData, id: Date.now() }]);
        }
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            name: '',
            category: 'dye',
            quantity: '',
            unit: 'oz',
            lowStockThreshold: '',
            cost: '',
            purchasePrice: '',
            purchaseOunces: '',
            supplier: '',
            color: '',
            image: '',
            notes: '',
            myYarnName: '',
            fiberContent: '',
            yardage: '',
            presentation: '',
            needleSize: '',
            gauge: '',
            wpi: '',
            plies: '',
            weight: ''
        });
        setShowForm(false);
        setEditingId(null);
    };

    const editItem = (item) => {
        setFormData(item);
        setEditingId(item.id);
        setShowForm(true);
    };

    const deleteItem = (id) => {
        if (confirm('Delete this item?')) {
            saveInventory(inventory.filter(i => i.id !== id));
        }
    };

    const adjustQuantity = (id, delta) => {
        saveInventory(inventory.map(i => 
            i.id === id ? { ...i, quantity: Math.max(0, parseFloat(i.quantity) + delta) } : i
        ));
    };

    const filteredInventory = (filterCategory === 'all' 
        ? inventory 
        : inventory.filter(i => i.category === filterCategory)
    ).sort((a, b) => {
        // For yarn bases, sort by myYarnName if it exists, otherwise by name
        const aName = a.category === 'yarn base' && a.myYarnName ? a.myYarnName : a.name;
        const bName = b.category === 'yarn base' && b.myYarnName ? b.myYarnName : b.name;
        return aName.localeCompare(bName);
    });

    const lowStockItems = inventory.filter(i => 
        i.lowStockThreshold != null && 
        i.lowStockThreshold !== '' && 
        i.quantity <= i.lowStockThreshold
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Inventory Management</h2>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ Add Item'}
                </button>
            </div>

            {/* Low Stock Alert */}
            {lowStockItems.length > 0 && !showForm && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                    <p className="font-semibold text-red-800">⚠️ {lowStockItems.length} item(s) running low!</p>
                </div>
            )}

            {/* Category Filter */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                <button
                    onClick={() => setFilterCategory('all')}
                    className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                        filterCategory === 'all' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    All ({inventory.length})
                </button>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setFilterCategory(cat)}
                        className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap capitalize ${
                            filterCategory === cat 
                                ? 'bg-purple-600 text-white' 
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        {cat} ({inventory.filter(i => i.category === cat).length})
                    </button>
                ))}
            </div>

            {/* Form Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={resetForm}>
                    <div className="bg-white rounded-lg card-shadow max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
                            <h3 className="text-xl font-semibold">{editingId ? 'Edit Item' : 'New Item'}</h3>
                            <button
                                onClick={resetForm}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="e.g., Acid Blue 113 or Luna DK"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                                <select
                                    required
                                    value={formData.category}
                                    onChange={(e) => {
                                        const newCategory = e.target.value;
                                        let defaultUnit = formData.unit;
                                        
                                        // Set default units based on category
                                        if (newCategory === 'yarn base') {
                                            defaultUnit = 'skeins';
                                        } else if (newCategory === 'dye') {
                                            defaultUnit = 'oz';
                                        }
                                        
                                        setFormData({ ...formData, category: newCategory, unit: defaultUnit });
                                    }}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                >
                                    {categories.map(cat => (
                                        <option key={cat} value={cat} className="capitalize">{cat}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {formData.category === 'yarn base' && (
                            <>
                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., W2D4 Merino DK SW"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">My Name for Yarn</label>
                                        <input
                                            type="text"
                                            value={formData.myYarnName}
                                            onChange={(e) => setFormData({ ...formData, myYarnName: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., Luna DK"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Hank/Skein Size (g)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={formData.hankSize}
                                        onChange={(e) => setFormData({ ...formData, hankSize: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        placeholder="e.g., 20, 50, 100"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Typical Sale Price (per skein)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.typicalPrice}
                                        onChange={(e) => setFormData({ ...formData, typicalPrice: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        placeholder="e.g., 25.00"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Default selling price for this yarn/size combination</p>
                                </div>

                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Fiber Content</label>
                                        <input
                                            type="text"
                                            value={formData.fiberContent}
                                            onChange={(e) => setFormData({ ...formData, fiberContent: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 100% Superwash Merino Wool"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Yardage</label>
                                        <input
                                            type="text"
                                            value={formData.yardage}
                                            onChange={(e) => setFormData({ ...formData, yardage: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 109yds per skein"
                                        />
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Presentation</label>
                                        <input
                                            type="text"
                                            value={formData.presentation}
                                            onChange={(e) => setFormData({ ...formData, presentation: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 10 x 100g skeins"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Weight Category</label>
                                        <input
                                            type="text"
                                            value={formData.weight}
                                            onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., Bulky, DK, Fingering"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-12 gap-2">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Needle Size</label>
                                        <input
                                            type="text"
                                            value={formData.needleSize}
                                            onChange={(e) => setFormData({ ...formData, needleSize: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="#9"
                                        />
                                    </div>
                                    <div className="col-span-6">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Gauge</label>
                                        <input
                                            type="text"
                                            value={formData.gauge}
                                            onChange={(e) => setFormData({ ...formData, gauge: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="14 sts & 24 rows"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">WPI</label>
                                        <input
                                            type="text"
                                            value={formData.wpi}
                                            onChange={(e) => setFormData({ ...formData, wpi: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="10"
                                            maxLength="2"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Plies</label>
                                        <input
                                            type="text"
                                            value={formData.plies}
                                            onChange={(e) => setFormData({ ...formData, plies: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="3"
                                            maxLength="2"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Image (URL)</label>
                                    <input
                                        type="text"
                                        value={formData.image}
                                        onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        placeholder="https://example.com/yarn-image.jpg"
                                    />
                                    {formData.image && (
                                        <img 
                                            src={formData.image} 
                                            alt="Yarn preview" 
                                            className="mt-2 h-6 w-auto border rounded"
                                            onError={(e) => e.target.style.display = 'none'}
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        {formData.category === 'ball band' && (
                            <>
                                <div className="grid md:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">For Yarn Base *</label>
                                        <select
                                            value={formData.forYarnBase || ''}
                                            onChange={(e) => setFormData({ ...formData, forYarnBase: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        >
                                            <option value="">Select yarn base...</option>
                                            {inventory.filter(i => i.category === 'yarn base').map(yarn => (
                                                <option key={yarn.id} value={yarn.name}>{yarn.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Hank Size (g) *</label>
                                        <input
                                            type="number"
                                            value={formData.hankSize || ''}
                                            onChange={(e) => setFormData({ ...formData, hankSize: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 20, 50, 100"
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="grid md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    required
                                    value={formData.quantity}
                                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                                <select
                                    value={formData.unit}
                                    onChange={(e) => {
                                        const newUnit = e.target.value;
                                        let newQuantity = formData.quantity;
                                        
                                        // Convert between oz/lb/g for dyes
                                        if (formData.category === 'dye' && formData.quantity) {
                                            const qty = parseFloat(formData.quantity);
                                            const oldUnit = formData.unit;
                                            
                                            // Convert to grams first
                                            let grams = qty;
                                            if (oldUnit === 'oz') grams = qty * 28.3495;
                                            else if (oldUnit === 'lb') grams = qty * 453.592;
                                            
                                            // Convert from grams to new unit
                                            if (newUnit === 'g') newQuantity = grams.toFixed(2);
                                            else if (newUnit === 'oz') newQuantity = (grams / 28.3495).toFixed(2);
                                            else if (newUnit === 'lb') newQuantity = (grams / 453.592).toFixed(4);
                                        }
                                        
                                        setFormData({ ...formData, unit: newUnit, quantity: newQuantity });
                                    }}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="g">grams (g)</option>
                                    <option value="oz">ounces (oz)</option>
                                    <option value="lb">pounds (lb)</option>
                                    <option value="kg">kilograms (kg)</option>
                                    <option value="ml">milliliters (ml)</option>
                                    <option value="L">liters (L)</option>
                                    <option value="skeins">skeins</option>
                                    <option value="units">units</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Alert</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.lowStockThreshold}
                                    onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="Min qty"
                                />
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            {formData.category === 'dye' ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price ($)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.purchasePrice}
                                            onChange={(e) => {
                                                const price = e.target.value;
                                                setFormData({ ...formData, purchasePrice: price });
                                                // Auto-calculate cost per gram if both fields are filled
                                                if (price && formData.purchaseOunces) {
                                                    const costPerOz = parseFloat(price) / parseFloat(formData.purchaseOunces);
                                                    const costPerGram = costPerOz / 28.3495;
                                                    setFormData({ 
                                                        ...formData, 
                                                        purchasePrice: price,
                                                        cost: costPerGram.toFixed(4)
                                                    });
                                                }
                                            }}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 67.05"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Ounces Purchased</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.purchaseOunces}
                                            onChange={(e) => {
                                                const ounces = e.target.value;
                                                setFormData({ ...formData, purchaseOunces: ounces });
                                                // Auto-calculate cost per gram if both fields are filled
                                                if (formData.purchasePrice && ounces) {
                                                    const costPerOz = parseFloat(formData.purchasePrice) / parseFloat(ounces);
                                                    const costPerGram = costPerOz / 28.3495;
                                                    setFormData({ 
                                                        ...formData, 
                                                        purchaseOunces: ounces,
                                                        cost: costPerGram.toFixed(4)
                                                    });
                                                }
                                            }}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                            placeholder="e.g., 16"
                                        />
                                        {formData.purchasePrice && formData.purchaseOunces && (
                                            <div className="text-xs text-green-600 mt-1">
                                                Cost per gram: ${formData.cost}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Unit</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.cost}
                                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        placeholder="$"
                                    />
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                <select
                                    value={formData.supplier}
                                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="">Select supplier...</option>
                                    {(settings.suppliers || ['Dharma', 'Wool2Dye4', 'Amazon']).map(supplier => (
                                        <option key={supplier} value={supplier}>{supplier}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {formData.category === 'dye' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Dye Color (Hex Code)
                                    <span className="text-xs text-gray-500 ml-2">e.g., #FF5733 or #3B82F6</span>
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={formData.color}
                                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                        className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                        placeholder="#FF5733"
                                        pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                                    />
                                    <input
                                        type="color"
                                        value={formData.color || '#000000'}
                                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                        className="w-16 h-10 border rounded-lg cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows="2"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update Item' : 'Add Item'}
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
                </div>
            )}

            {/* Inventory Table */}
            <div className="bg-white rounded-lg card-shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {filteredInventory.map(item => {
                                const isLowStock = item.lowStockThreshold != null && 
                                                  item.lowStockThreshold !== '' && 
                                                  item.quantity <= item.lowStockThreshold;
                                return (
                                    <tr key={item.id} className={isLowStock ? 'bg-red-50' : 'hover:bg-gray-50'}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {item.category === 'dye' && item.color && (
                                                    <div 
                                                        className="w-6 h-6 rounded-full border-2 border-gray-300 flex-shrink-0"
                                                        style={{ backgroundColor: item.color }}
                                                        title={`Color: ${item.color}`}
                                                    ></div>
                                                )}
                                                {item.category === 'yarn base' && item.image && (
                                                    <img 
                                                        src={item.image} 
                                                        alt={item.name}
                                                        style={{ 
                                                            width: '125px !important', 
                                                            height: '125px !important', 
                                                            minWidth: '125px', 
                                                            minHeight: '125px',
                                                            maxWidth: '125px',
                                                            maxHeight: '125px',
                                                            objectFit: 'cover',
                                                            borderRadius: '4px',
                                                            border: '1px solid #d1d5db',
                                                            flexShrink: 0
                                                        }}
                                                        onError={(e) => e.target.style.display = 'none'}
                                                    />
                                                )}
                                                <div>
                                                    <div className="font-medium text-gray-900">
                                                        {item.category === 'yarn base' && item.myYarnName 
                                                            ? item.myYarnName 
                                                            : item.name
                                                        }
                                                    </div>
                                                    {item.category === 'yarn base' && item.myYarnName && (
                                                        <div className="text-xs text-gray-500">({item.name})</div>
                                                    )}
                                                    {item.hankSize && (
                                                        <div className="text-sm text-purple-600">{item.hankSize}g hanks</div>
                                                    )}
                                                    {item.category === 'yarn base' && (
                                                        <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                                                            {item.fiberContent && <div>📦 {item.fiberContent}</div>}
                                                            {item.weight && <div>⚖️ {item.weight}</div>}
                                                            {item.yardage && <div>📏 {item.yardage}</div>}
                                                            {item.presentation && <div>🎁 {item.presentation}</div>}
                                                            {item.needleSize && <div>🪡 Needle: {item.needleSize}</div>}
                                                            {item.gauge && <div>📐 Gauge: {item.gauge}</div>}
                                                            {item.wpi && <div>🧵 WPI: {item.wpi}</div>}
                                                            {item.plies && <div>🔗 Plies: {item.plies}</div>}
                                                        </div>
                                                    )}
                                                    {item.notes && (
                                                        <div className="text-sm text-gray-500">{item.notes}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm capitalize">{item.category}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => adjustQuantity(item.id, -1)}
                                                    className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded"
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={item.quantity}
                                                    onChange={(e) => {
                                                        const newQty = parseFloat(e.target.value) || 0;
                                                        const updatedInventory = inventory.map(i =>
                                                            i.id === item.id ? { ...i, quantity: newQty } : i
                                                        );
                                                        saveInventory(updatedInventory);
                                                    }}
                                                    className={`w-20 px-2 py-1 text-center border rounded font-medium ${isLowStock ? 'text-red-600 border-red-300' : 'border-gray-300'}`}
                                                />
                                                <span className="text-sm text-gray-600">
                                                    {item.unit === 'oz' ? 'oz' : item.unit}
                                                </span>
                                                <button
                                                    onClick={() => adjustQuantity(item.id, 1)}
                                                    className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded"
                                                >
                                                    +
                                                </button>
                                            </div>
                                            {isLowStock && (
                                                <div className="text-xs text-red-600 mt-1">
                                                    ⚠️ Below {item.unit === 'oz' 
                                                        ? `${(parseFloat(item.lowStockThreshold) * 28.3495).toFixed(2)} g`
                                                        : `${item.lowStockThreshold} ${item.unit}`
                                                    }
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            {item.cost ? (() => {
                                                const cost = parseFloat(item.cost);
                                                const unit = item.unit || 'g';
                                                
                                                // For yarn bases, show per-skein cost
                                                if (item.category === 'yarn base') {
                                                    return `$${cost.toFixed(2)}/skein`;
                                                }
                                                
                                                // For ball bands and items with "units", show per-unit cost
                                                if (item.category === 'ball band' || unit === 'units') {
                                                    return `$${cost.toFixed(2)}/unit`;
                                                }
                                                
                                                // For skeins (non-yarn base), show per-skein cost
                                                if (unit === 'skeins') {
                                                    return `$${cost.toFixed(2)}/skein`;
                                                }
                                                
                                                // For weight/volume units, show entered unit and calculate per gram
                                                let costPerGram = cost;
                                                
                                                // Convert to cost per gram
                                                if (unit === 'oz') {
                                                    costPerGram = cost / 28.3495;
                                                } else if (unit === 'lb') {
                                                    costPerGram = cost / 453.592;
                                                } else if (unit === 'kg') {
                                                    costPerGram = cost / 1000;
                                                } else if (unit === 'ml' || unit === 'L') {
                                                    // Liquids: assume 1ml = 1g
                                                    if (unit === 'L') {
                                                        costPerGram = cost / 1000;
                                                    } else {
                                                        costPerGram = cost;
                                                    }
                                                }
                                                // g, tsp, tbsp stay as entered
                                                
                                                // Show both entered cost and per-gram cost (for weight/volume units only)
                                                if (unit !== 'g' && unit !== 'ml' && unit !== 'tsp' && unit !== 'tbsp') {
                                                    return (
                                                        <div>
                                                            <div>${cost.toFixed(2)}/{unit}</div>
                                                            <div className="text-xs text-gray-500">(${costPerGram.toFixed(4)}/g)</div>
                                                        </div>
                                                    );
                                                }
                                                
                                                return `$${cost.toFixed(4)}/${unit}`;
                                            })() : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm">{item.supplier || '-'}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => editItem(item)}
                                                className="text-blue-600 hover:text-blue-800 mr-3"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                onClick={() => deleteItem(item.id)}
                                                className="text-red-600 hover:text-red-800"
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredInventory.length === 0 && (
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-xl mb-2">📦</p>
                        <p>No items in this category yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// Pipeline Component
