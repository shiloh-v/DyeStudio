import { useState, useEffect } from 'react';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import { useFormGuard } from '../lib/useFormGuard';
import { dyeCostPerGram, dyeDisplayName } from '../lib/dyeCalc';

const DYE_TYPES = ['Leveling', 'Milling', 'Pre-metalized'];

const emptyForm = () => ({
    number: '',
    name: '',
    color: '',
    supplier: '',
    dyeType: '',
    needs4pct: false,
    sizes: [{ ounces: '', price: '' }],
    notes: '',
});

export function DyeCatalog({ settings, saveSettings }) {
    const dyes = settings?.dyeCatalog || [];
    const suppliers = settings?.suppliers || [];

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState(emptyForm());
    const [search, setSearch] = useState('');

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

    const saveDyes = (next) => saveSettings({ ...settings, dyeCatalog: next });

    const resetForm = () => {
        setFormData(emptyForm());
        setShowForm(false);
        setEditingId(null);
    };
    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            toast('Please enter a dye name', 'error');
            return;
        }
        const cleanSizes = (formData.sizes || [])
            .filter((s) => String(s.ounces).trim() !== '')
            .map((s) => ({
                ounces: parseFloat(String(s.ounces)) || 0,
                price: String(s.price).trim() === '' ? '' : parseFloat(String(s.price)),
            }));
        const record = { ...formData, name: formData.name.trim(), sizes: cleanSizes };
        if (editingId) {
            saveDyes(dyes.map((d) => (d.id === editingId ? { ...record, id: editingId } : d)));
        } else {
            saveDyes([...dyes, { ...record, id: Date.now() }]);
        }
        toast(editingId ? 'Dye updated' : 'Dye added', 'success');
        resetForm();
    };

    const editDye = (d) => {
        setFormData({ ...emptyForm(), ...d, sizes: d.sizes && d.sizes.length ? d.sizes : [{ ounces: '', price: '' }] });
        setEditingId(d.id);
        setShowForm(true);
    };

    const deleteDye = async (id) => {
        if (await confirmDialog({ message: 'Delete this dye?', confirmText: 'Delete', danger: true })) {
            saveDyes(dyes.filter((d) => d.id !== id));
        }
    };

    const addSize = () => setFormData({ ...formData, sizes: [...(formData.sizes || []), { ounces: '', price: '' }] });
    const updateSize = (i, field, val) => {
        const next = [...(formData.sizes || [])];
        next[i] = { ...next[i], [field]: val };
        setFormData({ ...formData, sizes: next });
    };
    const removeSize = (i) => setFormData({ ...formData, sizes: (formData.sizes || []).filter((_, idx) => idx !== i) });

    const inputCls = 'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500';

    const q = search.trim().toLowerCase();
    const shown = dyes
        .filter((d) => !q || [d.number, d.name, d.supplier, d.dyeType].some((v) => String(v || '').toLowerCase().includes(q)))
        .sort((a, b) => dyeDisplayName(a).localeCompare(dyeDisplayName(b)));

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Dye Catalog</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        {dyes.length} dye{dyes.length !== 1 ? 's' : ''} — pick from these when stocking dyes in Inventory
                    </p>
                </div>
                <button
                    onClick={() => (showForm ? closeForm() : setShowForm(true))}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Dye'}
                </button>
            </div>

            {dyes.length > 0 && (
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="🔍 Search by number, name, supplier…"
                    className={inputCls}
                />
            )}

            {/* Form modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                    <div className="bg-white rounded-lg card-shadow p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold">{editingId ? 'Edit Dye' : 'New Dye'}</h3>
                            <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-12 gap-4">
                                <div className="col-span-3">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Number</label>
                                    <input type="text" value={formData.number} onChange={(e) => setFormData({ ...formData, number: e.target.value })} className={inputCls} placeholder="401" />
                                </div>
                                <div className="col-span-9">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                                    <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={inputCls} placeholder="Brilliant Yellow" />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                                    <div className="flex gap-2">
                                        <input type="text" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} className={`${inputCls} flex-1`} placeholder="#FFD700" pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$" />
                                        <input type="color" value={formData.color || '#000000'} onChange={(e) => setFormData({ ...formData, color: e.target.value })} className="w-12 h-10 border rounded-lg cursor-pointer" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                    <select value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="">Select supplier…</option>
                                        {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4 items-end">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Dye Type <span className="text-xs text-gray-400">(optional)</span></label>
                                    <select value={formData.dyeType} onChange={(e) => setFormData({ ...formData, dyeType: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="">Select type…</option>
                                        {DYE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <label className="flex items-center gap-2 px-3 py-2">
                                    <input type="checkbox" checked={!!formData.needs4pct} onChange={(e) => setFormData({ ...formData, needs4pct: e.target.checked })} className="w-4 h-4" />
                                    <span className="text-sm text-gray-700">Needs 4% dye (vs 1.5–2%)</span>
                                </label>
                            </div>

                            {/* Sizes */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Sizes &amp; prices</label>
                                <div className="space-y-2">
                                    {(formData.sizes || []).map((s, idx) => {
                                        const perG = dyeCostPerGram(s);
                                        return (
                                            <div key={idx} className="flex flex-wrap items-center gap-2">
                                                <div className="flex items-center gap-1">
                                                    <input type="number" step="0.01" value={s.ounces} onChange={(e) => updateSize(idx, 'ounces', e.target.value)} className="w-20 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="oz" />
                                                    <span className="text-sm text-gray-500">oz</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-sm text-gray-500">$</span>
                                                    <input type="number" step="0.01" value={s.price} onChange={(e) => updateSize(idx, 'price', e.target.value)} className="w-24 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="price" />
                                                </div>
                                                <span className="text-xs text-teal-600 flex-1">{perG != null ? `$${perG.toFixed(4)}/g` : ''}</span>
                                                {(formData.sizes || []).length > 1 && (
                                                    <button type="button" onClick={() => removeSize(idx)} className="text-red-600 hover:bg-red-50 px-2 py-1 rounded">✕</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <button type="button" onClick={addSize} className="text-teal-600 hover:text-teal-700 text-sm font-medium mt-2">+ Add Size</button>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className={inputCls} placeholder="Mixing notes, lightfastness, etc." />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="submit" className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                                    {editingId ? 'Update Dye' : 'Save Dye'}
                                </button>
                                <button type="button" onClick={closeForm} className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Dye list */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shown.map((d) => (
                    <div key={d.id} className="bg-white rounded-lg card-shadow p-4">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="w-8 h-8 rounded-full border-2 border-gray-300 flex-shrink-0" style={{ backgroundColor: d.color || '#e5e7eb' }} title={d.color} />
                                <h3 className="font-semibold text-gray-900 truncate">{dyeDisplayName(d)}</h3>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button onClick={() => editDye(d)} className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">✏️</button>
                                <button onClick={() => deleteDye(d.id)} className="text-red-600 hover:bg-red-50 px-2 py-1 rounded">🗑️</button>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 text-xs mb-2">
                            {d.supplier && <span className="px-2 py-0.5 bg-gray-50 text-gray-700 rounded border">{d.supplier}</span>}
                            {d.dyeType && <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded border">{d.dyeType}</span>}
                            {d.needs4pct && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded border">needs 4%</span>}
                        </div>

                        {d.sizes && d.sizes.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {d.sizes.map((s, i) => {
                                    const perG = dyeCostPerGram(s);
                                    return (
                                        <span key={i} className="px-2 py-1 bg-gray-50 rounded border text-xs text-gray-700">
                                            {s.ounces}oz{s.price !== '' && s.price != null ? ` · $${Number(s.price).toFixed(2)}` : ''}{perG != null ? ` · $${perG.toFixed(3)}/g` : ''}
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        {d.notes && <p className="text-xs text-gray-600 mt-2 pt-2 border-t">{d.notes}</p>}
                    </div>
                ))}
            </div>

            {dyes.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🎨</p>
                    <p>No dyes yet. Add your first dye to build the catalog!</p>
                </div>
            )}
        </div>
    );
}
