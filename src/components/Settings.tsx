import { useState } from 'react';
import { StorageManager } from '../lib/storage';

export function Settings({ settings, saveSettings, inventory }) {
    const [activeSection, setActiveSection] = useState('colorTypes');
    const [newItem, setNewItem] = useState('');
    const [newMapping, setNewMapping] = useState({ supplierName: '', myName: '' });
    const [newSizeMapping, setNewSizeMapping] = useState({ grams: '', name: '' });

    const sections = {
        colorTypes: { label: 'Color Types', key: 'colorTypes' },
        inventoryCategories: { label: 'Inventory Categories', key: 'inventoryCategories' },
        units: { label: 'Measurement Units', key: 'units' },
        suppliers: { label: 'Suppliers', key: 'suppliers' },
        yarnBaseMappings: { label: 'Yarn Base Mappings', key: 'yarnBaseMappings' },
        sizeMappings: { label: 'Size Mappings', key: 'sizeMappings' }
    };

    const addItem = () => {
        if (!newItem.trim()) return;
        const currentList = settings[activeSection] || [];
        if (!currentList.includes(newItem.toLowerCase())) {
            saveSettings({
                ...settings,
                [activeSection]: [...currentList, newItem.toLowerCase()]
            });
        }
        setNewItem('');
    };

    const removeItem = (item) => {
        if (confirm(`Remove "${item}"?`)) {
            saveSettings({
                ...settings,
                [activeSection]: settings[activeSection].filter(i => i !== item)
            });
        }
    };

    const addYarnBaseMapping = () => {
        if (!newMapping.supplierName || !newMapping.myName) {
            alert('Please fill in both supplier name and your name');
            return;
        }
        const currentMappings = settings.yarnBaseMappings || [];
        saveSettings({
            ...settings,
            yarnBaseMappings: [...currentMappings, { ...newMapping }]
        });
        setNewMapping({ supplierName: '', myName: '' });
    };

    const removeYarnBaseMapping = (index) => {
        if (confirm('Remove this yarn base mapping?')) {
            saveSettings({
                ...settings,
                yarnBaseMappings: settings.yarnBaseMappings.filter((_, i) => i !== index)
            });
        }
    };


    const addSizeMapping = () => {
        if (!newSizeMapping.grams || !newSizeMapping.name) {
            alert('Please fill in both grams and name');
            return;
        }
        const currentMappings = settings.sizeMappings || [];
        saveSettings({
            ...settings,
            sizeMappings: [...currentMappings, { grams: parseFloat(newSizeMapping.grams), name: newSizeMapping.name }]
        });
        setNewSizeMapping({ grams: '', name: '' });
    };

    const removeSizeMapping = (index) => {
        if (confirm('Remove this size mapping?')) {
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
                                onKeyPress={(e) => e.key === 'Enter' && addItem()}
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

                {/* Yarn Base Mapping Form */}
                {activeSection === 'yarnBaseMappings' && (
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add Yarn Base Mapping
                        </label>
                        <div className="grid md:grid-cols-2 gap-2 mb-2">
                            <input
                                type="text"
                                value={newMapping.supplierName}
                                onChange={(e) => setNewMapping({ ...newMapping, supplierName: e.target.value })}
                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Supplier name (e.g., W2D4 SW DK)"
                            />
                            <input
                                type="text"
                                value={newMapping.myName}
                                onChange={(e) => setNewMapping({ ...newMapping, myName: e.target.value })}
                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Your name (e.g., Luna DK)"
                            />
                        </div>
                        <button
                            onClick={addYarnBaseMapping}
                            className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                        >
                            Add Mapping
                        </button>
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
                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                                placeholder="Size in grams (e.g., 100)"
                            />
                            <input
                                type="text"
                                value={newSizeMapping.name}
                                onChange={(e) => setNewSizeMapping({ ...newSizeMapping, name: e.target.value })}
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
                                    <span className="capitalize text-sm">{item}</span>
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

                {/* Yarn Base Mappings List */}
                {activeSection === 'yarnBaseMappings' && (
                    <div>
                        <h4 className="font-medium text-gray-700 mb-3">Current Yarn Base Mappings</h4>
                        <div className="space-y-2">
                            {(settings.yarnBaseMappings || []).map((mapping, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                                    <div className="flex-1">
                                        <span className="font-medium">{mapping.supplierName}</span>
                                        <span className="mx-2">→</span>
                                        <span className="text-teal-600">{mapping.myName}</span>
                                    </div>
                                    <button
                                        onClick={() => removeYarnBaseMapping(idx)}
                                        className="text-red-600 hover:text-red-800 ml-2"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        {(settings.yarnBaseMappings || []).length === 0 && (
                            <p className="text-gray-400 text-center py-8">No mappings yet</p>
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

            {/* Export/Import Data */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Data Management</h3>
                <div className="space-y-3">
                    <button
                        onClick={() => {
                            const data = {
                                recipes: StorageManager.get('recipes'),
                                inventory: StorageManager.get('inventory'),
                                batches: StorageManager.get('batches'),
                                sales: StorageManager.get('sales'),
                                dyeSessions: StorageManager.get('dye_sessions'),
                                kits: StorageManager.get('kits'),
                                settings: StorageManager.get('settings')
                            };
                            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `yarn-dye-backup-${new Date().toISOString().split('T')[0]}.json`;
                            a.click();
                        }}
                        className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                        📥 Export All Data (Backup)
                    </button>
                    <p className="text-sm text-gray-500">
                        Download all your recipes, inventory, batches, and sales data as a backup file.
                    </p>
                </div>
            </div>
        </div>
    );
}
