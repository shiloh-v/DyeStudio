import { useState } from 'react';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import { chemSettings, OVEN_SPACES } from '../lib/chemicals';
import { disposableUsage, findDisposableItem, DISPOSABLE_ROLES, DISPOSABLE_NEW_ITEM, DISPOSABLE_LABEL } from '../lib/disposables';

export function Settings({ settings, saveSettings, inventory, saveInventory, darkMode, toggleDark }) {
    const [activeSection, setActiveSection] = useState('colorTypes');
    const [newItem, setNewItem] = useState('');
    const [newSizeMapping, setNewSizeMapping] = useState({ grams: '', name: '' });

    const chem = chemSettings(settings);
    const setChem = (field, value) =>
        saveSettings({ ...settings, chemicals: { ...(settings.chemicals || {}), [field]: value } });
    const disp = disposableUsage(settings);
    const setDisp = (field, value) =>
        saveSettings({ ...settings, disposables: { ...(settings.disposables || {}), [field]: value } });

    // Create a disposable as an inventory item (cost per item from the pack
    // price), then pin it so renaming it never breaks costing or deductions.
    const addDisposableItem = async (role) => {
        const d = DISPOSABLE_NEW_ITEM[role];
        const id = Date.now();
        const item = {
            id,
            name: d.name,
            category: 'tool',
            unit: 'units',
            quantity: '0',
            cost: (d.packPrice / d.packCount).toFixed(4),
            lowStockThreshold: String(d.lowStockThreshold),
            notes: `$${d.packPrice.toFixed(2)} for ${d.packCount}`,
        };
        if (await saveInventory([...(inventory || []), item])) {
            setDisp(role + 'ItemId', String(id));
            toast(`Added “${d.name}” to Inventory. Set how many you have on hand there.`, 'success');
        }
    };

    const sections = {
        colorTypes: { label: 'Color Types', key: 'colorTypes' },
        inventoryCategories: { label: 'Inventory Categories', key: 'inventoryCategories' },
        suppliers: { label: 'Suppliers', key: 'suppliers' },
        sizeMappings: { label: 'Size Mappings', key: 'sizeMappings' }
    };

    const addItem = () => {
        const value = newItem.trim();
        if (!value) return;
        // Color types / categories / units are lowercase keys the app matches on;
        // suppliers are display names, so keep their casing.
        const stored = activeSection === 'suppliers' ? value : value.toLowerCase();
        const currentList = settings[activeSection] || [];
        if (currentList.some((i) => String(i).toLowerCase() === stored.toLowerCase())) {
            toast(`"${value}" is already in the list`, 'info');
            return;
        }
        saveSettings({ ...settings, [activeSection]: [...currentList, stored] });
        setNewItem('');
    };

    const removeItem = async (item) => {
        if (await confirmDialog({ message: `Remove "${item}"?`, confirmText: 'Remove', danger: true })) {
            saveSettings({
                ...settings,
                [activeSection]: settings[activeSection].filter(i => i !== item)
            });
        }
    };

    const addSizeMapping = () => {
        if (!newSizeMapping.grams || !newSizeMapping.name) {
            toast('Please fill in both grams and name', 'error');
            return;
        }
        const currentMappings = settings.sizeMappings || [];
        saveSettings({
            ...settings,
            sizeMappings: [...currentMappings, { grams: parseFloat(newSizeMapping.grams), name: newSizeMapping.name }]
        });
        setNewSizeMapping({ grams: '', name: '' });
    };

    const removeSizeMapping = async (index) => {
        if (await confirmDialog({ message: 'Remove this size mapping?', confirmText: 'Remove', danger: true })) {
            saveSettings({
                ...settings,
                sizeMappings: settings.sizeMappings.filter((_, i) => i !== index)
            });
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Settings</h2>

            {/* Appearance */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Appearance</h3>
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-medium text-gray-900">Theme</p>
                        <p className="text-sm text-gray-500">Currently using {darkMode ? 'dark' : 'light'} mode</p>
                    </div>
                    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label="Theme">
                        <button
                            type="button"
                            onClick={() => { if (darkMode) toggleDark?.(); }}
                            aria-pressed={!darkMode}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                !darkMode
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                        >
                            ☀️ Light
                        </button>
                        <button
                            type="button"
                            onClick={() => { if (!darkMode) toggleDark?.(); }}
                            aria-pressed={darkMode}
                            className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-200 ${
                                darkMode
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                        >
                            🌙 Dark
                        </button>
                    </div>
                </div>
            </div>

            {/* Chemical usage (acid per pan) */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-1">Chemical Usage</h3>
                <p className="text-sm text-gray-500 mb-4">
                    How much acid each pan uses when a session is finished. Bases containing
                    “Stellina” use vinegar; everything else uses citric acid.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Citric acid per full oven (g)</label>
                        <input
                            type="number" step="10" min="0"
                            value={chem.citricAcidPerOvenG}
                            onChange={(e) => setChem('citricAcidPerOvenG', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            One solution for all {OVEN_SPACES} spaces ≈ {(chem.citricAcidPerOvenG / OVEN_SPACES).toFixed(1)} g per pan (gradient tray ×2, dye square ×4)
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Vinegar per pan (ml)</label>
                        <input
                            type="number" step="5" min="0"
                            value={chem.vinegarPerPanMl}
                            onChange={(e) => setChem('vinegarPerPanMl', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">For Stellina bases</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Deep-shade multiplier (×)</label>
                        <input
                            type="number" step="0.1" min="1"
                            value={chem.deepShadeMultiplier}
                            onChange={(e) => setChem('deepShadeMultiplier', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">Extra vinegar for pans marked “deep shade”</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Safety padding (%)</label>
                        <input
                            type="number" step="5" min="0"
                            value={chem.paddingPct}
                            onChange={(e) => setChem('paddingPct', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">Deduct a bit extra so you reorder early</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Citric acid item</label>
                        <select
                            value={settings.chemicals?.citricItemId || ''}
                            onChange={(e) => setChem('citricItemId', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Auto-detect (name contains “citric”)</option>
                            {(inventory || []).filter(i => i.category === 'chemical').map(i => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">Pin the exact item so renaming it never breaks deductions</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Vinegar item</label>
                        <select
                            value={settings.chemicals?.vinegarItemId || ''}
                            onChange={(e) => setChem('vinegarItemId', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Auto-detect (name contains “vinegar”)</option>
                            {(inventory || []).filter(i => i.category === 'chemical').map(i => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">For Stellina bases</p>
                    </div>
                </div>
            </div>

            {/* Disposables (lids, zip ties) — inventory items */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-1">Disposables</h3>
                <p className="text-sm text-gray-500 mb-4">
                    Lids and zip ties are inventory items: their cost per item is added to each
                    batch, finishing a session deducts what was used, and they show a low-stock
                    warning like any other supply. Edit price, count and warning level in Inventory.
                </p>
                <div className="space-y-4">
                    {DISPOSABLE_ROLES.map((role) => {
                        const item = findDisposableItem(inventory, settings, role);
                        const usageKey = role === 'lid' ? 'lidsPerGradientTray' : 'zipTiesPerSkein';
                        return (
                            <div key={role} className="grid sm:grid-cols-3 gap-4 items-start border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{DISPOSABLE_LABEL[role]} item</label>
                                    <select
                                        value={settings.disposables?.[role + 'ItemId'] || ''}
                                        onChange={(e) => setDisp(role + 'ItemId', e.target.value)}
                                        className="w-full px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500"
                                    >
                                        <option value="">Auto-detect (name contains “{role === 'lid' ? 'lid' : 'zip tie'}”)</option>
                                        {(inventory || []).filter(i => i.category !== 'dye' && i.category !== 'yarn base').map(i => (
                                            <option key={i.id} value={i.id}>{i.name}</option>
                                        ))}
                                    </select>
                                    {item ? (
                                        <p className="text-xs text-gray-500 mt-1">
                                            Using “{item.name}”: ${(parseFloat(item.cost) || 0).toFixed(3)} each, {parseFloat(item.quantity) || 0} on hand
                                        </p>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2 mt-2">
                                            <span className="text-xs text-amber-700">Not in inventory, so not costed or deducted.</span>
                                            <button
                                                type="button"
                                                onClick={() => addDisposableItem(role)}
                                                className="text-xs bg-teal-600 text-white px-3 py-1 rounded-lg hover:bg-teal-700 font-medium"
                                            >
                                                Add to inventory (${DISPOSABLE_NEW_ITEM[role].packPrice.toFixed(2)} for {DISPOSABLE_NEW_ITEM[role].packCount})
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {role === 'lid' ? 'Lids per gradient tray' : 'Zip ties per skein'}
                                    </label>
                                    <input
                                        type="number" step="1" min="0"
                                        value={disp[usageKey]}
                                        onChange={(e) => setDisp(usageKey, e.target.value)}
                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                    />
                                    {role === 'lid' && <p className="text-xs text-gray-400 mt-1">One per depth of shade</p>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Manage Dropdown Options</h3>
                
                {/* Section Tabs */}
                <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                    {Object.entries(sections).map(([key, section]) => (
                        <button
                            key={key}
                            onClick={() => setActiveSection(key)}
                            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                                activeSection === key 
                                    ? 'bg-teal-600 text-white' 
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            {section.label}
                        </button>
                    ))}
                </div>

                {/* Add New Item */}
                {activeSection !== 'yarnBaseMappings' && activeSection !== 'sizeMappings' && (
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add New {sections[activeSection].label}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newItem}
                                onChange={(e) => setNewItem(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder={`Enter new ${sections[activeSection].label.toLowerCase()}...`}
                            />
                            <button
                                onClick={addItem}
                                className="bg-teal-600 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium whitespace-nowrap"
                            >
                                Add
                            </button>
                        </div>
                    </div>
                )}

                {/* Size Mapping Form */}
                {activeSection === 'sizeMappings' && (
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add Size Mapping
                        </label>
                        <div className="grid md:grid-cols-2 gap-2 mb-2">
                            <input
                                type="number"
                                value={newSizeMapping.grams}
                                onChange={(e) => setNewSizeMapping({ ...newSizeMapping, grams: e.target.value })}
                                onKeyDown={(e) => e.key === 'Enter' && addSizeMapping()}
                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Size in grams (e.g., 100)"
                            />
                            <input
                                type="text"
                                value={newSizeMapping.name}
                                onChange={(e) => setNewSizeMapping({ ...newSizeMapping, name: e.target.value })}
                                onKeyDown={(e) => e.key === 'Enter' && addSizeMapping()}
                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Display name (e.g., Full skein)"
                            />
                        </div>
                        <button
                            onClick={addSizeMapping}
                            className="bg-teal-600 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium whitespace-nowrap"
                        >
                            Add Mapping
                        </button>
                    </div>
                )}

                {/* Current Items */}
                {activeSection !== 'yarnBaseMappings' && activeSection !== 'sizeMappings' && (
                    <div>
                        <h4 className="font-medium text-gray-700 mb-3">
                            Current {sections[activeSection].label}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {(settings[activeSection] || []).map((item, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border"
                                >
                                    <span className={`text-sm ${activeSection === 'suppliers' ? '' : 'capitalize'}`}>{item}</span>
                                    <button
                                        onClick={() => removeItem(item)}
                                        className="text-red-600 hover:text-red-800 ml-2"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        {(settings[activeSection] || []).length === 0 && (
                            <p className="text-gray-400 text-center py-8">No items yet</p>
                        )}
                    </div>
                )}


                {/* Size Mappings List */}
                {activeSection === 'sizeMappings' && (
                    <div>
                        <h4 className="font-medium text-gray-700 mb-3">Current Size Mappings</h4>
                        <div className="space-y-2">
                            {(settings.sizeMappings || []).map((mapping, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                                    <div className="flex-1">
                                        <span className="font-medium">{mapping.grams}g</span>
                                        <span className="mx-2">→</span>
                                        <span className="text-teal-600">{mapping.name}</span>
                                    </div>
                                    <button
                                        onClick={() => removeSizeMapping(idx)}
                                        className="text-red-600 hover:text-red-800 ml-2"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        {(settings.sizeMappings || []).length === 0 && (
                            <p className="text-gray-400 text-center py-8">No mappings yet</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
