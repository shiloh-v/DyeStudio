import { useState, useEffect } from 'react';
import { DateUtils } from '../lib/dates';
import { useFormGuard } from '../lib/useFormGuard';
import { isStocked } from '../lib/batches';
import { confirmDialog, promptDialog } from '../lib/dialog';
import { toast } from '../lib/toast';

export function Pipeline({ batches, saveBatches, recipes, inventory, saveInventory, settings }) {
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        recipeId: '',
        customColorway: '',
        skeins: '',
        status: 'dyeing',
        startDate: new Date().toISOString().split('T')[0],
        notes: ''
    });

    const guard = useFormGuard();
    useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const recipe = recipes.find(r => r.id === parseInt(formData.recipeId));
        const newBatch = {
            ...formData,
            id: Date.now(),
            recipeName: recipe?.name || 'Custom',
            colorway: formData.customColorway || recipe?.name || 'Custom Colorway'
        };
        saveBatches([...batches, newBatch]);
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            recipeId: '',
            customColorway: '',
            skeins: '',
            status: 'dyeing',
            startDate: new Date().toISOString().split('T')[0],
            notes: ''
        });
        setShowForm(false);
    };

    const closeForm = () => { if (guard.canClose(formData)) resetForm(); };

    const updateStatus = async (id, newStatus, oldStatus) => {
        const batch = batches.find(b => b.id === id);
        
        // If stocking, prompt for the expected list price so we can keep projected
        // profit/margin (this is finished inventory, not a realized sale).
        if (newStatus === 'stocked' && batch) {
            // Calculate suggested price from typical yarn prices
            let suggestedPrice = 0;
            if (batch.yarnDetails && batch.yarnDetails.length > 0) {
                batch.yarnDetails.forEach(yarn => {
                    const yarnItem = inventory.find(i => 
                        i.category === 'yarn base' && 
                        i.name === yarn.base && 
                        parseFloat(i.hankSize) === parseFloat(yarn.hankSize)
                    );
                    if (yarnItem?.typicalPrice) {
                        suggestedPrice += parseFloat(yarnItem.typicalPrice) * parseInt(yarn.quantity || 0);
                    }
                });
            }
            
            const promptMessage = suggestedPrice > 0
                ? `Enter expected list price for "${batch.colorway}" (${batch.skeins} skeins):\n\nSuggested price: $${suggestedPrice.toFixed(2)} (based on typical prices)`
                : `Enter expected list price for "${batch.colorway}" (${batch.skeins} skeins):`;

            const salePrice = await promptDialog({ title: 'List price', message: promptMessage, defaultValue: suggestedPrice > 0 ? suggestedPrice.toFixed(2) : '', inputType: 'number', confirmText: 'Stock it' });
            if (salePrice === null) return; // User cancelled

            const price = parseFloat(salePrice);
            if (isNaN(price) || price < 0) {
                toast('Please enter a valid price', 'error');
                return;
            }
            
            const cost = batch.totalCost || 0;
            const profit = price - cost;
            const pricePerSkein = batch.skeins > 0 ? price / batch.skeins : 0;
            
            // Update batch with stock/pricing info
            const updatedBatch = {
                ...batch,
                status: 'stocked',
                salePrice: price,
                pricePerSkein: pricePerSkein,
                profit: profit,
                profitMargin: price > 0 ? ((profit / price) * 100) : 0,
                soldDate: DateUtils.getTodayEST()
            };

            saveBatches(batches.map(b => b.id === id ? updatedBatch : b));

            // Show projected profit summary
            toast(`Stocked! List $${price.toFixed(2)} · Cost $${cost.toFixed(2)} · Projected profit $${profit.toFixed(2)} (${updatedBatch.profitMargin.toFixed(1)}%)`, 'success');
            
            // Deduct ball bands and labels if coming from ready
            if (oldStatus === 'ready' && batch.yarnDetails && batch.yarnDetails.length > 0) {
                const updatedInventory = [...inventory];
                
                // Calculate total skeins
                const totalSkeins = batch.yarnDetails.reduce((sum, yarn) => 
                    sum + parseInt(yarn.quantity || 0), 0
                );
                
                batch.yarnDetails.forEach(yarn => {
                    const quantity = parseInt(yarn.quantity || 0);
                    const hankSize = parseFloat(yarn.hankSize);
                    const yarnBase = yarn.base;
                    
                    // Find ball band that matches this yarn base AND hank size
                    const ballBand = updatedInventory.find(item => 
                        item.category === 'ball band' && 
                        item.forYarnBase === yarnBase &&
                        parseFloat(item.hankSize) === hankSize
                    );
                    if (ballBand) {
                        ballBand.quantity = Math.max(0, parseFloat(ballBand.quantity) - quantity);
                    }
                });
                
                // Deduct labels (total skeins)
                const labelItem = updatedInventory.find(item => 
                    (item.category === 'other' || item.category === 'ball band') && 
                    item.name?.toLowerCase().includes('label')
                );
                if (labelItem) {
                    labelItem.quantity = Math.max(0, parseFloat(labelItem.quantity) - totalSkeins);
                }
                
                saveInventory(updatedInventory);
            }
            return;
        }
        
        // Regular status update
        saveBatches(batches.map(b => b.id === id ? { ...b, status: newStatus } : b));
    };

    const deleteBatch = async (id) => {
        if (await confirmDialog({ message: 'Delete this batch?', confirmText: 'Delete', danger: true })) {
            saveBatches(batches.filter(b => b.id !== id));
        }
    };

    const moveAllBatches = async (fromStatus, toStatus) => {
        const batchesToMove = batches.filter(b => b.status === fromStatus);

        if (batchesToMove.length === 0) {
            toast('No batches to move', 'error');
            return;
        }
        
        const statusInfo = statusLabels[toStatus];
        
        // Special handling for moving to stocked (capture a list price for projections)
        if (toStatus === 'stocked') {
            const totalBatches = batchesToMove.length;
            const totalSkeins = batchesToMove.reduce((sum, b) => sum + (b.skeins || 0), 0);
            const totalCost = batchesToMove.reduce((sum, b) => sum + (b.totalCost || 0), 0);
            
            // Calculate suggested price from typical prices
            let suggestedPrice = 0;
            batchesToMove.forEach(batch => {
                if (batch.yarnDetails && batch.yarnDetails.length > 0) {
                    batch.yarnDetails.forEach(yarn => {
                        const yarnItem = inventory.find(i => 
                            i.category === 'yarn base' && 
                            i.name === yarn.base && 
                            parseFloat(i.hankSize) === parseFloat(yarn.hankSize)
                        );
                        if (yarnItem?.typicalPrice) {
                            suggestedPrice += parseFloat(yarnItem.typicalPrice) * parseInt(yarn.quantity || 0);
                        }
                    });
                }
            });
            
            const confirmMsg = `Mark ${totalBatches} batches (${totalSkeins} total skeins) as STOCKED?\n\n` +
                `You can either:\n` +
                `1. Set ONE combined list price for all batches\n` +
                `2. Cancel and stock batches individually for different prices\n\n` +
                `Continue with combined list price?`;

            if (!(await confirmDialog({ title: 'Stock all batches', message: confirmMsg, confirmText: 'Continue' }))) return;

            const promptMessage = suggestedPrice > 0
                ? `Enter TOTAL list price for all ${totalBatches} batches (${totalSkeins} skeins):\n\nSuggested: $${suggestedPrice.toFixed(2)}\nTotal Cost: $${totalCost.toFixed(2)}`
                : `Enter TOTAL list price for all ${totalBatches} batches (${totalSkeins} skeins):\n\nTotal Cost: $${totalCost.toFixed(2)}`;

            const salePrice = await promptDialog({ title: 'List price', message: promptMessage, defaultValue: suggestedPrice > 0 ? suggestedPrice.toFixed(2) : '', inputType: 'number', confirmText: 'Stock them' });
            if (salePrice === null) return;

            const price = parseFloat(salePrice);
            if (isNaN(price) || price < 0) {
                toast('Please enter a valid price', 'error');
                return;
            }
            
            const profit = price - totalCost;
            const profitMargin = price > 0 ? ((profit / price) * 100) : 0;
            const pricePerSkein = totalSkeins > 0 ? price / totalSkeins : 0;
            const soldDate = DateUtils.getTodayEST();
            
            // Update all batches with proportional pricing
            const updatedBatches = batches.map(b => {
                if (b.status !== fromStatus) return b;
                
                const batchSkeins = b.skeins || 0;
                const batchCost = b.totalCost || 0;
                const batchPrice = totalSkeins > 0 ? (batchSkeins / totalSkeins) * price : 0;
                const batchProfit = batchPrice - batchCost;
                const batchMargin = batchPrice > 0 ? ((batchProfit / batchPrice) * 100) : 0;
                
                return {
                    ...b,
                    status: 'stocked',
                    salePrice: batchPrice,
                    pricePerSkein: pricePerSkein,
                    profit: batchProfit,
                    profitMargin: batchMargin,
                    soldDate: soldDate
                };
            });
            
            saveBatches(updatedBatches);
            
            // Deduct ball bands and labels if coming from ready
            if (fromStatus === 'ready') {
                const updatedInventory = [...inventory];
                let totalLabelsUsed = 0;
                
                batchesToMove.forEach(batch => {
                    if (batch.yarnDetails && batch.yarnDetails.length > 0) {
                        batch.yarnDetails.forEach(yarn => {
                            const quantity = parseInt(yarn.quantity || 0);
                            totalLabelsUsed += quantity;
                            const hankSize = parseFloat(yarn.hankSize);
                            const yarnBase = yarn.base;
                            
                            // Deduct ball bands
                            const ballBand = updatedInventory.find(item => 
                                item.category === 'ball band' && 
                                item.forYarnBase === yarnBase &&
                                parseFloat(item.hankSize) === hankSize
                            );
                            if (ballBand) {
                                ballBand.quantity = Math.max(0, parseFloat(ballBand.quantity) - quantity);
                            }
                        });
                    }
                });
                
                // Deduct labels (total for all batches)
                const labelItem = updatedInventory.find(item => 
                    (item.category === 'other' || item.category === 'ball band') && 
                    item.name?.toLowerCase().includes('label')
                );
                if (labelItem && totalLabelsUsed > 0) {
                    labelItem.quantity = Math.max(0, parseFloat(labelItem.quantity) - totalLabelsUsed);
                }
                
                saveInventory(updatedInventory);
            }
            
            toast(`${totalBatches} batches stocked! List $${price.toFixed(2)} · Cost $${totalCost.toFixed(2)} · Projected profit $${profit.toFixed(2)} (${profitMargin.toFixed(1)}%)`, 'success');
            return;
        }
        
        // Regular move (non-stocked)
        if (!(await confirmDialog({ message: `Move all ${batchesToMove.length} batches from ${statusLabels[fromStatus].label} to ${statusInfo.label}?`, confirmText: 'Move all' }))) {
            return;
        }
        
        const updatedBatches = batches.map(b => 
            b.status === fromStatus ? { ...b, status: toStatus } : b
        );
        
        saveBatches(updatedBatches);
        toast(`Moved ${batchesToMove.length} batches to ${statusInfo.label}`, 'success');
    };

    const statuses = ['dyeing', 'drying', 'ready', 'stocked'];
    const statusLabels = {
        dyeing: { label: 'Dyeing', color: 'yellow', emoji: '🎨' },
        drying: { label: 'Drying', color: 'blue', emoji: '💨' },
        ready: { label: 'Ready for Labels', color: 'green', emoji: '✓' },
        stocked: { label: 'Stocked', color: 'teal', emoji: '📦' }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Production Pipeline</h2>
                <button
                    onClick={() => showForm ? closeForm() : setShowForm(true)}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    {showForm ? '✕ Cancel' : '+ New Batch'}
                </button>
            </div>

            {/* Form */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={closeForm}>
                <div className="bg-white rounded-lg card-shadow p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold">Start New Batch</h3>
                        <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none bg-transparent">✕</button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Recipe *</label>
                                <select
                                    required
                                    value={formData.recipeId}
                                    onChange={(e) => setFormData({ ...formData, recipeId: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                >
                                    <option value="">Select a recipe...</option>
                                    {Object.entries(
                                        [...recipes]
                                            .sort((a, b) => a.name.localeCompare(b.name))
                                            .reduce<Record<string, any[]>>((acc, r) => {
                                                const type = r.colorType || 'other';
                                                (acc[type] = acc[type] || []).push(r);
                                                return acc;
                                            }, {})
                                    )
                                        .sort(([a], [b]) => a.localeCompare(b))
                                        .flatMap(([type, group]) => [
                                            <option key={`hdr-${type}`} disabled value="" className="font-bold bg-gray-100 text-gray-700">
                                                ── {type.toUpperCase()} ──
                                            </option>,
                                            ...group.map(r => (
                                                <option key={r.id} value={r.id}>{r.name}</option>
                                            )),
                                        ])}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Colorway Name</label>
                                <input
                                    type="text"
                                    value={formData.customColorway}
                                    onChange={(e) => setFormData({ ...formData, customColorway: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    placeholder="Override colorway name (optional)"
                                />
                            </div>
                        </div>

                        <div className="grid md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Number of Skeins *</label>
                                <input
                                    type="number"
                                    required
                                    value={formData.skeins}
                                    onChange={(e) => setFormData({ ...formData, skeins: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Status</label>
                                <select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                >
                                    {statuses.filter(s => s !== 'stocked').map(status => (
                                        <option key={status} value={status} className="capitalize">
                                            {statusLabels[status].label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={formData.startDate}
                                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={2}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Any special notes about this batch..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                            >
                                Start Batch
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

            {/* Pipeline View */}
            <div className="grid md:grid-cols-4 gap-4">
                {statuses.map(status => {
                    // The Stocked column also catches legacy 'sold' batches (pre-migration).
                    const batchesInStatus = status === 'stocked'
                        ? batches.filter(isStocked)
                        : batches.filter(b => b.status === status);
                    const statusInfo = statusLabels[status];
                    
                    return (
                        <div key={status} className="bg-white rounded-lg card-shadow border border-gray-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-gray-900">
                                    {statusInfo.emoji} {statusInfo.label}
                                </h3>
                                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-full text-sm font-medium">
                                    {batchesInStatus.length}
                                </span>
                            </div>
                            
                            {/* Move All button */}
                            {batchesInStatus.length > 0 && (
                                <div className="mb-3">
                                    <select
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                moveAllBatches(status, e.target.value);
                                                e.target.value = ''; // Reset
                                            }
                                        }}
                                        className="w-full text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50"
                                    >
                                        <option value="">Move all to...</option>
                                        {statuses.filter(s => s !== status).map(s => (
                                            <option key={s} value={s}>
                                                {statusLabels[s].emoji} {statusLabels[s].label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            
                            <div className="space-y-3">
                                {batchesInStatus.map(batch => {
                                    // Get recipe image (either saved or look up from recipe)
                                    let recipeImageUrl = batch.recipeImageUrl;
                                    if (!recipeImageUrl && batch.recipeId) {
                                        const recipe = recipes.find(r => r.id === parseInt(batch.recipeId));
                                        recipeImageUrl = recipe?.photo; // Changed from imageUrl to photo
                                    }
                                    
                                    return (
                                    <div key={batch.id} className={`p-3 rounded-lg border-2 status-${status} flex gap-3`}>
                                        {/* Recipe image */}
                                        {recipeImageUrl && (
                                            <img 
                                                src={recipeImageUrl} 
                                                alt={batch.colorway}
                                                className="rounded object-cover flex-shrink-0"
                                                style={{ width: '60px', height: '60px', minWidth: '60px', minHeight: '60px', maxWidth: '60px', maxHeight: '60px' }}
                                                onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
                                            />
                                        )}
                                        
                                        <div className="flex-1">
                                            <div className="font-medium text-sm mb-1">{batch.colorway}</div>
                                            {batch.batchId && (
                                                <div className="text-xs text-gray-500 mb-1">ID: {batch.batchId}</div>
                                            )}
                                            
                                            {/* Skein details */}
                                            {batch.yarnDetails && batch.yarnDetails.length > 0 ? (
                                                <div className="text-xs text-gray-600 mb-2">
                                                    {(() => {
                                                        const grouped = batch.yarnDetails.reduce((acc, yarn) => {
                                                            const key = `${yarn.base} ${yarn.hankSize}g`;
                                                            acc[key] = (acc[key] || 0) + parseInt(yarn.quantity || 1);
                                                            return acc;
                                                        }, {});
                                                        return Object.entries(grouped).map(([key, qty]) => `${qty}x ${key}`).join(', ');
                                                    })()} • {DateUtils.formatDate(batch.startDate)}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-gray-600 mb-2">
                                                    {batch.skeins} skeins • {DateUtils.formatDate(batch.startDate)}
                                                </div>
                                            )}
                                            
                                        {batch.notes && (
                                            <div className="text-xs text-gray-500 mb-2">📋 {batch.notes}</div>
                                        )}
                                        
                                        {batch.experimentNotes && (
                                            <div className="text-xs text-teal-600 mb-2 italic">
                                                🧪 Experiment: {batch.experimentNotes}
                                            </div>
                                        )}
                                        
                                        {/* Editable Batch Notes */}
                                        <div className="mb-2">
                                            <button
                                                onClick={async () => {
                                                    const currentNotes = batch.batchNotes || '';
                                                    const newNotes = await promptDialog({ title: 'Batch notes', message: 'Observations during dyeing/drying:', defaultValue: currentNotes });
                                                    if (newNotes !== null && newNotes !== currentNotes) {
                                                        saveBatches(batches.map(b =>
                                                            b.id === batch.id ? { ...b, batchNotes: newNotes } : b
                                                        ));
                                                    }
                                                }}
                                                className="text-xs px-2 py-1 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 text-blue-700"
                                                title="Add/edit notes about this batch"
                                            >
                                                {batch.batchNotes ? '📝 Edit Notes' : '📝 Add Notes'}
                                            </button>
                                            {batch.batchNotes && (
                                                <div className="text-xs text-blue-700 mt-1 pl-2 border-l-2 border-blue-300">
                                                    {batch.batchNotes}
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="flex gap-1 mt-2">
                                            {statuses.map(s => {
                                                if (s === batch.status) return null;
                                                const targetStatus = statusLabels[s];
                                                return (
                                                    <button
                                                        key={s}
                                                        onClick={() => updateStatus(batch.id, s, batch.status)}
                                                        className="text-xs px-2 py-1 bg-white border border-gray-300 shadow-sm rounded hover:bg-gray-50"
                                                        title={`Move to ${targetStatus.label}`}
                                                    >
                                                        {targetStatus.emoji}
                                                    </button>
                                                );
                                            })}
                                            <button
                                                onClick={() => deleteBatch(batch.id)}
                                                className="text-xs px-2 py-1 bg-white border border-gray-300 shadow-sm rounded hover:bg-red-50 ml-auto"
                                                title="Delete batch"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                        </div>
                                    </div>
                                    );
                                })}
                                
                                {batchesInStatus.length === 0 && (
                                    <div className="text-center py-8 text-gray-300 text-sm">
                                        No batches
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {batches.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-xl mb-2">🔄</p>
                    <p>No batches in production yet. Start your first batch!</p>
                </div>
            )}
        </div>
    );
}

// Sales Component
