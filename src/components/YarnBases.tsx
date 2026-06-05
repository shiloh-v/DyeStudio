import { useState, useEffect } from 'react';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import { useFormGuard } from '../lib/useFormGuard';
import { sizeName } from '../lib/sizes';

const YARN_WEIGHTS = [
    'Lace', 'Light Fingering', 'Fingering', 'Sport', 'DK',
    'Worsted', 'Aran', 'Bulky', 'Super Bulky', 'Jumbo',
];

const emptyForm = () => ({
    myName: '',
    supplier: '',
    supplierName: '',
    weight: '',
    fiberContent: '',
    needleSize: '',
    gauge: '',
    wpi: '',
    plies: '',
    weightUnit: 'g',
    lengthUnit: 'yd',
    lengthPer100: '',
    sizes: [{ amount: '', sku: '', price: '', length: '' }],
    notes: '',
});

// Length for a size: explicit override wins, otherwise derive from length-per-100.
function deriveLength(lengthPer100, amount) {
    const per = parseFloat(String(lengthPer100));
    const a = parseFloat(String(amount));
    if (isNaN(per) || isNaN(a)) return null;
    return Math.round((per * a) / 100);
}
function sizeLength(base, size) {
    const override = parseFloat(String(size.length));
    if (!isNaN(override)) return { value: override, derived: false };
    const d = deriveLength(base.lengthPer100, size.amount);
    return d == null ? null : { value: d, derived: true };
}

export function YarnBases({ settings, saveSettings }) {
    const bases = settings?.yarnBases || [];
    const suppliers = settings?.suppliers || [];

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState(emptyForm());

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

    const saveBases = (next) => saveSettings({ ...settings, yarnBases: next });

    const resetForm = () => {
        setFormData(emptyForm());
        setShowForm(false);
        setEditingId(null);
    };
    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.myName.trim()) {
            toast('Please enter a name for this base', 'error');
            return;
        }
        const cleanSizes = (formData.sizes || [])
            .filter((s) => String(s.amount).trim() !== '')
            .map((s) => ({
                amount: parseFloat(String(s.amount)) || 0,
                sku: (s.sku || '').trim(),
                price: String(s.price).trim() === '' ? '' : parseFloat(String(s.price)),
                length: String(s.length).trim() === '' ? '' : parseFloat(String(s.length)),
            }));
        const record = { ...formData, myName: formData.myName.trim(), sizes: cleanSizes };
        if (editingId) {
            saveBases(bases.map((b) => (b.id === editingId ? { ...record, id: editingId } : b)));
        } else {
            saveBases([...bases, { ...record, id: Date.now() }]);
        }
        toast(editingId ? 'Base updated' : 'Base added', 'success');
        resetForm();
    };

    const editBase = (b) => {
        setFormData({
            ...emptyForm(),
            ...b,
            sizes: b.sizes && b.sizes.length ? b.sizes : [{ amount: '', sku: '', price: '', length: '' }],
        });
        setEditingId(b.id);
        setShowForm(true);
    };

    const deleteBase = async (id) => {
        if (await confirmDialog({ message: 'Delete this yarn base?', confirmText: 'Delete', danger: true })) {
            saveBases(bases.filter((b) => b.id !== id));
        }
    };

    const addSize = () => setFormData({ ...formData, sizes: [...(formData.sizes || []), { amount: '', sku: '', price: '', length: '' }] });
    const updateSize = (i, field, val) => {
        const next = [...(formData.sizes || [])];
        next[i] = { ...next[i], [field]: val };
        setFormData({ ...formData, sizes: next });
    };
    const removeSize = (i) => setFormData({ ...formData, sizes: (formData.sizes || []).filter((_, idx) => idx !== i) });

    const inputCls = 'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500';

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Yarn Bases</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        {bases.length} base{bases.length !== 1 ? 's' : ''} — the catalog Inventory & recipes draw from
                    </p>
                </div>
                <button
                    onClick={() => (showForm ? closeForm() : setShowForm(true))}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Base'}
                </button>
            </div>

            {/* Form modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                    <div className="bg-white rounded-lg card-shadow p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold">{editingId ? 'Edit Yarn Base' : 'New Yarn Base'}</h3>
                            <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">My Name *</label>
                                    <input type="text" required value={formData.myName} onChange={(e) => setFormData({ ...formData, myName: e.target.value })} className={inputCls} placeholder="e.g., Luna DK" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Yarn Weight</label>
                                    <select value={formData.weight} onChange={(e) => setFormData({ ...formData, weight: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="">Select weight…</option>
                                        {YARN_WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                    <select value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="">Select supplier…</option>
                                        {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier's Base Name</label>
                                    <input type="text" value={formData.supplierName} onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })} className={inputCls} placeholder="e.g., W2D4 Merino DK SW" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Fiber Content</label>
                                <input type="text" value={formData.fiberContent} onChange={(e) => setFormData({ ...formData, fiberContent: e.target.value })} className={inputCls} placeholder="e.g., 100% Superwash Merino Wool" />
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Needle Size</label>
                                    <input type="text" value={formData.needleSize} onChange={(e) => setFormData({ ...formData, needleSize: e.target.value })} className={inputCls} placeholder="#5 / 3.75mm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Gauge</label>
                                    <input type="text" value={formData.gauge} onChange={(e) => setFormData({ ...formData, gauge: e.target.value })} className={inputCls} placeholder="20 sts & 36 rows" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">WPI</label>
                                    <input type="text" value={formData.wpi} onChange={(e) => setFormData({ ...formData, wpi: e.target.value })} className={inputCls} placeholder="16" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Plies</label>
                                    <input type="text" value={formData.plies} onChange={(e) => setFormData({ ...formData, plies: e.target.value })} className={inputCls} placeholder="4" />
                                </div>
                            </div>

                            {/* Units + density */}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Weight unit</label>
                                    <select value={formData.weightUnit} onChange={(e) => setFormData({ ...formData, weightUnit: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="g">grams (g)</option>
                                        <option value="oz">ounces (oz)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Length unit</label>
                                    <select value={formData.lengthUnit} onChange={(e) => setFormData({ ...formData, lengthUnit: e.target.value })} className={`${inputCls} bg-white`}>
                                        <option value="yd">yards (yd)</option>
                                        <option value="m">meters (m)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{formData.lengthUnit} per 100{formData.weightUnit}</label>
                                    <input type="number" step="0.1" value={formData.lengthPer100} onChange={(e) => setFormData({ ...formData, lengthPer100: e.target.value })} className={inputCls} placeholder="231" />
                                </div>
                            </div>

                            {/* Sizes */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Sizes it comes in</label>
                                <div className="space-y-2">
                                    {(formData.sizes || []).map((s, idx) => {
                                        const len = sizeLength(formData, s);
                                        const nm = formData.weightUnit === 'g' ? sizeName(s.amount, settings) : null;
                                        return (
                                            <div key={idx} className="border rounded-lg p-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <input type="number" step="0.1" value={s.amount} onChange={(e) => updateSize(idx, 'amount', e.target.value)} className="w-20 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="size" />
                                                        <span className="text-sm text-gray-500 w-6">{formData.weightUnit}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-sm text-gray-500">$</span>
                                                        <input type="number" step="0.01" value={s.price} onChange={(e) => updateSize(idx, 'price', e.target.value)} className="w-20 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="price" />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <input type="number" step="0.1" value={s.length} onChange={(e) => updateSize(idx, 'length', e.target.value)} className="w-24 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder={len?.derived ? String(len.value) : 'length'} />
                                                        <span className="text-sm text-gray-500 w-6">{formData.lengthUnit}</span>
                                                    </div>
                                                    <input type="text" value={s.sku || ''} onChange={(e) => updateSize(idx, 'sku', e.target.value)} className="w-24 px-2 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="SKU" />
                                                    {(formData.sizes || []).length > 1 && (
                                                        <button type="button" onClick={() => removeSize(idx)} className="text-red-600 hover:bg-red-50 px-2 py-1 rounded ml-auto">✕</button>
                                                    )}
                                                </div>
                                                {(nm || (len && len.derived)) && (
                                                    <div className="text-xs text-teal-600 mt-1 pl-1">
                                                        {nm || ''}{nm && len?.derived ? ' · ' : ''}{len?.derived ? `auto ${len.value} ${formData.lengthUnit} (edit to override)` : ''}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <button type="button" onClick={addSize} className="text-teal-600 hover:text-teal-700 text-sm font-medium mt-2">+ Add Size</button>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className={inputCls} placeholder="Anything else about this base…" />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="submit" className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                                    {editingId ? 'Update Base' : 'Save Base'}
                                </button>
                                <button type="button" onClick={closeForm} className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Bases list */}
            <div className="grid md:grid-cols-2 gap-6">
                {bases.map((b) => (
                    <div key={b.id} className="bg-white rounded-lg card-shadow p-6">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="text-xl font-semibold text-gray-900">{b.myName}</h3>
                                {(b.supplier || b.supplierName) && (
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        {b.supplier}{b.supplier && b.supplierName ? ' · ' : ''}{b.supplierName}
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => editBase(b)} className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded">✏️</button>
                                <button onClick={() => deleteBase(b.id)} className="text-red-600 hover:bg-red-50 px-3 py-1 rounded">🗑️</button>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs mb-3">
                            {b.weight && <span className="px-2 py-1 bg-teal-50 text-teal-700 rounded border">{b.weight}</span>}
                            {b.fiberContent && <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded border">{b.fiberContent}</span>}
                        </div>

                        {(b.needleSize || b.gauge || b.wpi || b.plies || b.lengthPer100) && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600 mb-3">
                                {b.needleSize && <div><span className="text-gray-400">Needle:</span> {b.needleSize}</div>}
                                {b.gauge && <div><span className="text-gray-400">Gauge:</span> {b.gauge}</div>}
                                {b.wpi && <div><span className="text-gray-400">WPI:</span> {b.wpi}</div>}
                                {b.plies && <div><span className="text-gray-400">Plies:</span> {b.plies}</div>}
                                {b.lengthPer100 && <div><span className="text-gray-400">Length:</span> {b.lengthPer100} {b.lengthUnit || 'yd'}/100{b.weightUnit || 'g'}</div>}
                            </div>
                        )}

                        {b.sizes && b.sizes.length > 0 && (
                            <div>
                                <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Sizes</h4>
                                <div className="flex flex-wrap gap-2">
                                    {b.sizes.map((s, i) => {
                                        const len = sizeLength(b, s);
                                        const nm = (b.weightUnit || 'g') === 'g' ? sizeName(s.amount, settings) : null;
                                        const wu = b.weightUnit || 'g';
                                        const lu = b.lengthUnit || 'yd';
                                        return (
                                            <span key={i} className="px-2 py-1 bg-gray-50 rounded border text-xs text-gray-700">
                                                {s.amount}{wu}
                                                {nm ? ` · ${nm}` : ''}
                                                {len ? ` · ${len.value}${lu}` : ''}
                                                {s.price !== '' && s.price != null ? ` · $${Number(s.price).toFixed(2)}` : ''}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {b.notes && <p className="text-sm text-gray-600 mt-3 pt-3 border-t">{b.notes}</p>}
                    </div>
                ))}
            </div>

            {bases.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🧵</p>
                    <p>No yarn bases yet. Add your first base to build the catalog!</p>
                </div>
            )}
        </div>
    );
}
