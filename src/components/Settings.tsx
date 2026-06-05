import { useState } from 'react';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';

export function Settings({ settings, saveSettings, inventory }) {
    const [activeSection, setActiveSection] = useState('colorTypes');
    const [newItem, setNewItem] = useState('');
    const [newSizeMapping, setNewSizeMapping] = useState({ grams: '', name: '' });

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
                                className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
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
                            className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
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
