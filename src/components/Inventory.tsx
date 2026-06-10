import { useState, useEffect, useRef } from 'react';
import { useFormGuard } from '../lib/useFormGuard';
import { confirmDialog } from '../lib/dialog';
import { sizeName } from '../lib/sizes';
import { perSkeinPrice, sizeLength } from '../lib/yarnBaseCalc';
import { dyeCostPerGram, dyeDisplayName } from '../lib/dyeCalc';
import { yarnBaseRef } from '../lib/yarnMatch';
import { isLowStock as isItemLowStock, lowStockLabel, DYE_LOW_STOCK_GRAMS } from '../lib/lowStock';
import type { InventoryItem } from '../types';

// Grams per unit, for converting on-hand amounts between units.
const UNIT_TO_GRAM: Record<string, number> = { g: 1, oz: 28.3495, lb: 453.592, kg: 1000, ml: 1, L: 1000, tsp: 5, tbsp: 15 };
const OZ_IN_GRAMS = 28.3495;
// Convert a quantity in `unit` to ounces (how dyes are bought/tracked).
function toOunces(qty: any, unit: string): number {
    const g = (parseFloat(String(qty)) || 0) * (UNIT_TO_GRAM[unit] || 1);
    return g / OZ_IN_GRAMS;
}

// Sensible ± step for the quantity stepper, by unit.
function stepFor(unit: string): number {
    if (unit === 'g') return 10;
    if (unit === 'kg' || unit === 'L') return 0.5;
    return 1;
}

// Quantity cell with its own local state so typing doesn't write to the
// database on every keystroke — it commits on blur / Enter. The ± buttons
// commit immediately (discrete actions), and local state re-syncs from props.
// Dyes are bought and tracked in OUNCES, so a dye's amount is always shown and
// edited in oz here even if it was stored in grams (legacy) — editing migrates
// it to oz. This is display/inventory only; dye cost is per-gram (see below).
function QuantityCell({ item, isLowStock, onAdjust, onCommit }: any) {
    const isDye = item.category === 'dye';
    const displayUnit = isDye ? 'oz' : (item.unit || 'g');
    const toDisplay = () => (isDye ? Number(toOunces(item.quantity, item.unit || 'g').toFixed(2)) : (parseFloat(String(item.quantity)) || 0));
    const [val, setVal] = useState(String(toDisplay()));
    useEffect(() => { setVal(String(toDisplay())); }, [item.quantity, item.unit]);
    const step = isDye ? 0.5 : stepFor(item.unit || 'g');
    const commit = () => {
        const n = parseFloat(val) || 0;
        if (isDye) {
            if (n !== toDisplay()) onCommit(item.id, n, 'oz');
        } else if (n !== parseFloat(String(item.quantity))) {
            onCommit(item.id, n);
        }
    };
    return (
        <div className="flex items-center gap-2">
            <button type="button" onClick={() => onAdjust(item.id, -step, isDye ? 'oz' : undefined)} className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded">-</button>
            <input
                type="number"
                step="0.1"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.currentTarget as HTMLInputElement).blur(); } }}
                className={`w-20 px-2 py-1 text-center border rounded font-medium ${isLowStock ? 'text-red-600 border-red-300' : 'border-gray-300'}`}
            />
            <span className="text-sm text-gray-600">{displayUnit}</span>
            <button type="button" onClick={() => onAdjust(item.id, step, isDye ? 'oz' : undefined)} className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded">+</button>
        </div>
    );
}

export function Inventory({ inventory, saveInventory, settings }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    // "Fill from Yarn Base catalog" picker (UI only — fills existing fields).
    const yarnBases = settings?.yarnBases || [];
    const [pickBaseId, setPickBaseId] = useState('');
    const [pickSize, setPickSize] = useState('');
    const pickedBase = yarnBases.find((b) => String(b.id) === String(pickBaseId));
    const dyeCatalog = settings?.dyeCatalog || [];
    const [pickDyeId, setPickDyeId] = useState('');
    const [pickDyeSize, setPickDyeSize] = useState('');
    const pickedDye = dyeCatalog.find((d) => String(d.id) === String(pickDyeId));
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const [formData, setFormData] = useState<Partial<InventoryItem>>({
        name: '',
        category: 'dye',
        quantity: '',
        unit: 'oz',
        hankSize: '',
        lowStockThreshold: '',
        cost: '',
        typicalPrice: '',
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

    // Categories are derived from settings, but we retire the vague "other"
    // catch-all and guarantee a dedicated "label" category (for colorway labels
    // / stickers). Done in code so no settings migration is required.
    const rawCategories = settings.inventoryCategories || ['dye', 'yarn base', 'chemical', 'tool', 'ball band', 'label'];
    const categories = Array.from(new Set([...rawCategories.filter((c) => c !== 'other'), 'label']));

    // When an item is renamed, remember its previous name(s) as aliases so that
    // recipes/pans/ball bands referencing the old name keep resolving. This makes
    // any naming-convention change self-healing for everything that points at it.
    const withRenameAliases = (next, prev) => {
        if (!prev) return next;
        const norm = (s) => String(s ?? '').trim().toLowerCase();
        const aliases = Array.isArray(next.aliases) ? [...next.aliases] : [...(prev.aliases || [])];
        const remember = (oldVal, newVal) => {
            const o = String(oldVal ?? '').trim();
            if (o && norm(o) !== norm(newVal) && !aliases.some((a) => norm(a) === norm(o))) aliases.push(o);
        };
        remember(prev.name, next.name);
        remember(prev.myYarnName, next.myYarnName);
        return { ...next, aliases };
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            const prev = inventory.find(i => i.id === editingId);
            const updated = withRenameAliases({ ...formData, id: editingId }, prev);
            saveInventory(inventory.map(i => i.id === editingId ? updated : i));
        } else {
            saveInventory([...inventory, { ...formData, id: Date.now() }]);
        }
        resetForm();
    };

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

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
        setPickBaseId('');
        setPickSize('');
        setPickDyeId('');
        setPickDyeSize('');
    };

    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const editItem = (item) => {
        // Dyes are tracked in ounces — present a legacy gram-stored dye in oz.
        if (item.category === 'dye' && (item.unit || 'g') !== 'oz' && item.quantity !== '' && item.quantity != null) {
            setFormData({ ...item, unit: 'oz', quantity: String(Number(toOunces(item.quantity, item.unit || 'g').toFixed(2))) });
        } else {
            setFormData(item);
        }
        setEditingId(item.id);
        setShowForm(true);
        setPickBaseId('');
        setPickSize('');
        setPickDyeId('');
        setPickDyeSize('');
    };

    // Fill base-level specs from a catalog base (keeps existing values if blank).
    const applyBase = (base) => {
        if (!base) return;
        setFormData((prev) => ({
            ...prev,
            myYarnName: base.myName || prev.myYarnName,
            supplier: base.supplier || prev.supplier,
            fiberContent: base.fiberContent || prev.fiberContent,
            needleSize: base.needleSize || prev.needleSize,
            gauge: base.gauge || prev.gauge,
            wpi: base.wpi || prev.wpi,
            plies: base.plies || prev.plies,
            weight: base.weight || prev.weight,
        }));
    };

    // Generate an item name not already used by another inventory item.
    const uniqueItemName = (desired) => {
        const taken = new Set(
            inventory.filter((i) => i.id !== editingId).map((i) => String(i.name || '').trim().toLowerCase())
        );
        if (!taken.has(desired.trim().toLowerCase())) return desired;
        let n = 2;
        while (taken.has(`${desired} (${n})`.trim().toLowerCase())) n++;
        return `${desired} (${n})`;
    };

    // Fill size-level fields + generate a unique Item Name and a Presentation.
    const applySize = (base, size) => {
        if (!base || !size) return;
        const len = sizeLength(base, size);
        const each = perSkeinPrice(size);
        const wu = base.weightUnit || 'g';
        const packQty = parseFloat(String(size.packSize));
        const presentation = !isNaN(packQty) && packQty > 1
            ? `${packQty} x ${size.amount}${wu} skeins`
            : `${size.amount}${wu} skein`;
        const itemName = uniqueItemName(`${base.myName || 'Yarn'} ${size.amount}${wu}`.trim());
        setFormData((prev) => ({
            ...prev,
            name: itemName,
            hankSize: size.amount != null ? String(size.amount) : prev.hankSize,
            yardage: len ? String(len.value) : prev.yardage,
            cost: each != null ? each.toFixed(2) : prev.cost,
            presentation,
        }));
    };

    // Fill name/color/supplier from a catalog dye.
    const applyDye = (dye) => {
        if (!dye) return;
        setFormData((prev) => ({
            ...prev,
            name: uniqueItemName(dyeDisplayName(dye)),
            color: dye.color || prev.color,
            supplier: dye.supplier || prev.supplier,
        }));
    };

    // Fill purchase price/ounces + cost-per-gram from a catalog dye size.
    const applyDyeSize = (size) => {
        if (!size) return;
        const perG = dyeCostPerGram(size);
        setFormData((prev) => ({
            ...prev,
            purchasePrice: size.price != null && size.price !== '' ? String(size.price) : prev.purchasePrice,
            purchaseOunces: size.ounces != null ? String(size.ounces) : prev.purchaseOunces,
            cost: perG != null ? perG.toFixed(4) : prev.cost,
        }));
    };

    const deleteItem = async (id) => {
        if (await confirmDialog({ message: 'Delete this item?', confirmText: 'Delete', danger: true })) {
            saveInventory(inventory.filter(i => i.id !== id));
        }
    };

    // Compress a chosen/taken photo to an 800px JPEG data URL → formData.image.
    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const MAX = 800;
                    let w = img.width, h = img.height;
                    if (w > h) { if (w > MAX) { h = Math.round((h * MAX) / w); w = MAX; } }
                    else { if (h > MAX) { w = Math.round((w * MAX) / h); h = MAX; } }
                    canvas.width = w; canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);
                    setFormData((prev) => ({ ...prev, image: canvas.toDataURL('image/jpeg', 0.7) }));
                };
                img.src = reader.result as string;
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    };

    const adjustQuantity = (id, delta, asUnit?) => {
        saveInventory(inventory.map(i => {
            if (i.id !== id) return i;
            if (asUnit === 'oz') {
                // Step in ounces and normalise the stored amount to oz.
                const nextOz = Math.max(0, Number((toOunces(i.quantity, i.unit || 'g') + delta).toFixed(2)));
                return { ...i, quantity: nextOz, unit: 'oz' };
            }
            return { ...i, quantity: Math.max(0, (parseFloat(String(i.quantity)) || 0) + delta) };
        }));
    };

    const commitQuantity = (id, qty, unit?) => {
        saveInventory(inventory.map(i => (i.id === id ? { ...i, quantity: qty, ...(unit ? { unit } : {}) } : i)));
    };

    // Update purchase price / ounces and recompute dye cost-per-gram in one pass.
    const updatePurchase = (patch) => {
        setFormData((prev) => {
            const next = { ...prev, ...patch };
            const price = parseFloat(String(next.purchasePrice));
            const oz = parseFloat(String(next.purchaseOunces));
            if (!isNaN(price) && !isNaN(oz) && oz > 0) {
                next.cost = (price / oz / 28.3495).toFixed(4);
            }
            return next;
        });
    };

    // Chemical cost calculator: "paid $X for Y <unit>" → cost per the item's unit
    // (stored in `cost`). getCostPerGram converts that to per-gram for batches.
    const updateChemPurchase = (patch) => {
        setFormData((prev) => {
            const next = { ...prev, ...patch };
            const price = parseFloat(String(next.purchasePrice));
            const amt = parseFloat(String(next.purchaseOunces));
            if (!isNaN(price) && !isNaN(amt) && amt > 0) {
                next.cost = (price / amt).toFixed(4);
            }
            return next;
        });
    };

    const q = searchTerm.trim().toLowerCase();
    const filteredInventory = inventory
        .filter(i => filterCategory === 'all' || i.category === filterCategory)
        .filter(i => !q || [i.name, i.myYarnName, i.supplier, i.notes, i.fiberContent, i.weight]
            .some(v => String(v || '').toLowerCase().includes(q)))
        .sort((a, b) => {
            // For yarn bases, sort by myYarnName if it exists, otherwise by name
            const aName = a.category === 'yarn base' && a.myYarnName ? a.myYarnName : a.name;
            const bName = b.category === 'yarn base' && b.myYarnName ? b.myYarnName : b.name;
            return String(aName || '').localeCompare(String(bName || ''));
        });

    const lowStockItems = inventory.filter(isItemLowStock);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Inventory Management</h2>
                <button
                    onClick={() => showForm ? closeForm() : setShowForm(true)}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
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

            {/* Search */}
            <div className="relative">
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="🔍 Search by name, my-name, supplier, fiber…"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                />
                {searchTerm && (
                    <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent text-lg"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Category Filter */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                <button
                    onClick={() => setFilterCategory('all')}
                    className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                        filterCategory === 'all' 
                            ? 'bg-teal-600 text-white' 
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
                                ? 'bg-teal-600 text-white' 
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        {cat} ({inventory.filter(i => i.category === cat).length})
                    </button>
                ))}
            </div>

            {/* Form Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                    <div className="bg-white rounded-lg card-shadow max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
                            <h3 className="text-xl font-semibold">{editingId ? 'Edit Item' : 'New Item'}</h3>
                            <button
                                onClick={closeForm}
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
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                        } else if (newCategory === 'tool' || newCategory === 'label') {
                                            defaultUnit = 'units';
                                        }
                                        
                                        setFormData({ ...formData, category: newCategory, unit: defaultUnit });
                                    }}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                >
                                    {[...categories].sort((a, b) => a.localeCompare(b)).map(cat => (
                                        <option key={cat} value={cat} className="capitalize">{cat}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {formData.category === 'dye' && dyeCatalog.length > 0 && (
                            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
                                <label className="block text-sm font-medium text-teal-800 mb-1">Fill from Dye catalog (optional)</label>
                                <div className="grid md:grid-cols-2 gap-2">
                                    <select
                                        value={pickDyeId}
                                        onChange={(e) => {
                                            setPickDyeId(e.target.value);
                                            setPickDyeSize('');
                                            applyDye(dyeCatalog.find((d) => String(d.id) === e.target.value));
                                        }}
                                        className="px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                                    >
                                        <option value="">— manual entry —</option>
                                        {dyeCatalog.map((d) => <option key={d.id} value={d.id}>{dyeDisplayName(d)}</option>)}
                                    </select>
                                    {pickedDye && (pickedDye.sizes || []).length > 0 && (
                                        <select
                                            value={pickDyeSize}
                                            onChange={(e) => {
                                                setPickDyeSize(e.target.value);
                                                applyDyeSize((pickedDye.sizes || []).find((s) => String(s.ounces) === e.target.value));
                                            }}
                                            className="px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                                        >
                                            <option value="">Select size for cost…</option>
                                            {(pickedDye.sizes || []).map((s, i) => {
                                                const pg = dyeCostPerGram(s);
                                                return (
                                                    <option key={i} value={s.ounces}>
                                                        {s.ounces}oz{s.price !== '' && s.price != null ? ` · $${Number(s.price).toFixed(2)}` : ''}{pg != null ? ` · $${pg.toFixed(3)}/g` : ''}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    )}
                                </div>
                                <p className="text-xs text-teal-700 mt-1">Fills name, color, supplier + cost-per-gram from the size. You can still edit anything.</p>
                            </div>
                        )}

                        {formData.category === 'yarn base' && (
                            <>
                                {yarnBases.length > 0 && (
                                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
                                        <label className="block text-sm font-medium text-teal-800 mb-1">Fill from Yarn Base catalog (optional)</label>
                                        <div className="grid md:grid-cols-2 gap-2">
                                            <select
                                                value={pickBaseId}
                                                onChange={(e) => {
                                                    setPickBaseId(e.target.value);
                                                    setPickSize('');
                                                    applyBase(yarnBases.find((b) => String(b.id) === e.target.value));
                                                }}
                                                className="px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                                            >
                                                <option value="">— manual entry —</option>
                                                {yarnBases.map((b) => <option key={b.id} value={b.id}>{b.myName}</option>)}
                                            </select>
                                            {pickedBase && (pickedBase.sizes || []).length > 0 && (
                                                <select
                                                    value={pickSize}
                                                    onChange={(e) => {
                                                        setPickSize(e.target.value);
                                                        applySize(pickedBase, (pickedBase.sizes || []).find((s) => String(s.amount) === e.target.value));
                                                    }}
                                                    className="px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                                                >
                                                    <option value="">Select size to fill…</option>
                                                    {(pickedBase.sizes || []).map((s, i) => {
                                                        const each = perSkeinPrice(s);
                                                        return (
                                                            <option key={i} value={s.amount}>
                                                                {s.amount}{pickedBase.weightUnit || 'g'}{each != null ? ` · $${each.toFixed(2)}/skein` : ''}
                                                            </option>
                                                        );
                                                    })}
                                                </select>
                                            )}
                                        </div>
                                        <p className="text-xs text-teal-700 mt-1">Auto-fills the specs below + per-skein cost. You can still edit anything.</p>
                                    </div>
                                )}
                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">My Name for Yarn</label>
                                        <input
                                            type="text"
                                            value={formData.myYarnName}
                                            onChange={(e) => setFormData({ ...formData, myYarnName: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        placeholder="e.g., 20, 50, 100"
                                    />
                                    {sizeName(formData.hankSize, settings) && (
                                        <p className="text-xs text-teal-600 mt-1">= {sizeName(formData.hankSize, settings)}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Typical Sale Price (per skein)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.typicalPrice}
                                        onChange={(e) => setFormData({ ...formData, typicalPrice: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 100% Superwash Merino Wool"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Yardage</label>
                                        <input
                                            type="text"
                                            value={formData.yardage}
                                            onChange={(e) => setFormData({ ...formData, yardage: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 10 x 100g skeins"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Weight Category</label>
                                        <input
                                            type="text"
                                            value={formData.weight}
                                            onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="#9"
                                        />
                                    </div>
                                    <div className="col-span-6">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Gauge</label>
                                        <input
                                            type="text"
                                            value={formData.gauge}
                                            onChange={(e) => setFormData({ ...formData, gauge: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="14 sts & 24 rows"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">WPI</label>
                                        <input
                                            type="text"
                                            value={formData.wpi}
                                            onChange={(e) => setFormData({ ...formData, wpi: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="10"
                                            maxLength={2}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Plies</label>
                                        <input
                                            type="text"
                                            value={formData.plies}
                                            onChange={(e) => setFormData({ ...formData, plies: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="3"
                                            maxLength={2}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Image</label>
                                    <div className="flex gap-2 mb-2">
                                        <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex-1 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">📷 Take Photo</button>
                                        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium">🖼️ Upload</button>
                                    </div>
                                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
                                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                    <input
                                        type="text"
                                        value={formData.image?.startsWith('data:') ? '' : formData.image}
                                        onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        placeholder="…or paste an image URL"
                                    />
                                    {formData.image && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <img
                                                src={formData.image}
                                                alt="Yarn preview"
                                                className="h-16 w-16 object-cover border rounded"
                                                onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
                                            />
                                            <button type="button" onClick={() => setFormData({ ...formData, image: '' })} className="text-xs text-red-600 hover:text-red-800 bg-transparent">Remove</button>
                                        </div>
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
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        >
                                            <option value="">Select yarn base...</option>
                                            {formData.forYarnBase && !inventory.some(i => i.category === 'yarn base' && yarnBaseRef(i) === formData.forYarnBase) && (
                                                <option value={formData.forYarnBase}>{formData.forYarnBase}</option>
                                            )}
                                            {([...new Set(inventory.filter(i => i.category === 'yarn base').map((i) => yarnBaseRef(i)))] as string[])
                                                .sort((a, b) => a.localeCompare(b))
                                                .map(ref => (
                                                <option key={ref} value={ref}>{ref}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Hank Size (g) *</label>
                                        <input
                                            type="number"
                                            value={formData.hankSize || ''}
                                            onChange={(e) => setFormData({ ...formData, hankSize: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 20, 50, 100"
                                        />
                                        {sizeName(formData.hankSize, settings) && (
                                            <p className="text-xs text-teal-600 mt-1">= {sizeName(formData.hankSize, settings)}</p>
                                        )}
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
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                            const qty = parseFloat(String(formData.quantity));
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
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                {formData.category === 'dye' ? (
                                    <div className="px-3 py-2 border rounded-lg bg-gray-50 text-sm text-gray-600">
                                        Auto: alerts below {DYE_LOW_STOCK_GRAMS} g of powder
                                    </div>
                                ) : (
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.lowStockThreshold}
                                        onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        placeholder="Min qty"
                                    />
                                )}
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
                                            onChange={(e) => updatePurchase({ purchasePrice: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 67.05"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Ounces Purchased</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.purchaseOunces}
                                            onChange={(e) => updatePurchase({ purchaseOunces: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 16"
                                        />
                                        {formData.purchasePrice && formData.purchaseOunces && (
                                            <div className="text-xs text-green-600 mt-1">
                                                Cost per gram: ${formData.cost}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : formData.category === 'chemical' ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount Purchased ({formData.unit || 'g'})</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.purchaseOunces}
                                            onChange={(e) => updateChemPurchase({ purchaseOunces: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 25"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Total Paid ($)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.purchasePrice}
                                            onChange={(e) => updateChemPurchase({ purchasePrice: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., 81.95"
                                        />
                                        {formData.cost ? (
                                            <div className="text-xs text-green-600 mt-1">
                                                ${parseFloat(String(formData.cost)).toFixed(4)}/{formData.unit || 'g'}
                                                {' '}(${(parseFloat(String(formData.cost)) / (UNIT_TO_GRAM[formData.unit || 'g'] || 1)).toFixed(4)}/g)
                                            </div>
                                        ) : null}
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {formData.category === 'tool' || formData.category === 'label' ? 'Cost per item' : 'Cost per Unit'}
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.cost}
                                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                        placeholder="$"
                                    />
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                <select
                                    value={formData.supplier}
                                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                >
                                    <option value="">Select supplier...</option>
                                    {[...(settings.suppliers || ['Dharma', 'Wool2Dye4', 'Amazon'])]
                                        .sort((a, b) => a.localeCompare(b))
                                        .map(supplier => (
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
                                        className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
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
                                rows={2}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                            >
                                {editingId ? 'Update Item' : 'Add Item'}
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
                                const isLowStock = isItemLowStock(item);
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
                                                        className="w-12 h-12 object-cover rounded border flex-shrink-0"
                                                        onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
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
                                                        <div className="text-sm text-teal-600">
                                                            {item.hankSize}g hanks{sizeName(item.hankSize, settings) ? ` · ${sizeName(item.hankSize, settings)}` : ''}
                                                        </div>
                                                    )}
                                                    {item.category === 'yarn base' && (
                                                        <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                                            {item.fiberContent && <span>📦 {item.fiberContent}</span>}
                                                            {item.weight && <span>⚖️ {item.weight}</span>}
                                                            {item.yardage && <span>📏 {item.yardage}</span>}
                                                            {item.presentation && <span>🎁 {item.presentation}</span>}
                                                            {item.needleSize && <span>🪡 {item.needleSize}</span>}
                                                            {item.gauge && <span>📐 {item.gauge}</span>}
                                                            {item.wpi && <span>🧵 WPI {item.wpi}</span>}
                                                            {item.plies && <span>🔗 {item.plies}-ply</span>}
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
                                            <QuantityCell item={item} isLowStock={isLowStock} onAdjust={adjustQuantity} onCommit={commitQuantity} />
                                            {isLowStock && (
                                                <div className="text-xs text-red-600 mt-1">
                                                    ⚠️ Below {lowStockLabel(item)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            {item.cost ? (() => {
                                                const cost = parseFloat(item.cost);
                                                const unit = item.unit || 'g';
                                                
                                                // Dyes store cost as cost-per-GRAM (from purchase
                                                // price ÷ ounces). Show $/oz (how it's bought) with
                                                // the per-gram cost beneath — independent of the
                                                // on-hand unit.
                                                if (item.category === 'dye') {
                                                    return (
                                                        <div>
                                                            <div>${(cost * OZ_IN_GRAMS).toFixed(2)}/oz</div>
                                                            <div className="text-xs text-gray-500">(${cost.toFixed(4)}/g)</div>
                                                        </div>
                                                    );
                                                }

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
