import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { StorageManager } from '../lib/storage';
import { supabase } from '../lib/supabase';

// Code-split each tab — its JS loads on demand instead of in the initial bundle.
const named = (p, name) => lazy(() => p().then((m) => ({ default: m[name] })));
const Dashboard = named(() => import('./Dashboard'), 'Dashboard');
const Calendar = named(() => import('./Calendar'), 'Calendar');
const Recipes = named(() => import('./Recipes'), 'Recipes');
const ColorLab = named(() => import('./ColorLab'), 'ColorLab');
const Kits = named(() => import('./Kits'), 'Kits');
const DyeSessions = named(() => import('./DyeSessions'), 'DyeSessions');
const UpNext = named(() => import('./UpNext'), 'UpNext');
const Inventory = named(() => import('./Inventory'), 'Inventory');
const Pipeline = named(() => import('./Pipeline'), 'Pipeline');
const Sales = named(() => import('./Sales'), 'Sales');
const Gradients = named(() => import('./Gradients'), 'Gradients');
const Settings = named(() => import('./Settings'), 'Settings');

const VALID_TABS = [
    'dashboard', 'calendar', 'recipes', 'gradients', 'kits', 'colorlab',
    'sessions', 'queue', 'inventory', 'pipeline', 'sales', 'settings',
];

export function YarnDyeManager() {
    // Active tab is backed by the URL (e.g. /recipes) so refresh stays put,
    // tabs are bookmarkable, and back/forward work.
    const navigate = useNavigate();
    const location = useLocation();
    const rawTab = location.pathname.slice(1);
    const activeTab = VALID_TABS.includes(rawTab) ? rawTab : 'dashboard';
    const setActiveTab = (tab) => navigate('/' + tab);
    const [recipes, setRecipes] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [batches, setBatches] = useState([]);
    const [sales, setSales] = useState([]);
    const [dyeSessions, setDyeSessions] = useState([]);
    const [kits, setKits] = useState([]);
    const [colorSketches, setColorSketches] = useState([]);
    const [gradients, setGradients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState({
        colorTypes: ['tonal', 'variegated', 'speckled'],
        inventoryCategories: ['dye', 'yarn base', 'chemical', 'tool', 'ball band', 'other'],
        units: ['ml', 'g', 'oz', 'lb', 'tsp', 'tbsp'],
        suppliers: ['Dharma', 'Wool2Dye4', 'Amazon'],
        yarnBaseMappings: [
            { supplierName: 'W2D4 Merino Bulky SW', myName: 'Luna Bulky' },
            { supplierName: 'W2D4 SW DK', myName: 'Luna DK' }
        ],
        sizeMappings: [
            { grams: 100, name: 'Full skein' },
            { grams: 50, name: 'Half skein' },
            { grams: 20, name: 'Mini skein' },
            { grams: 10, name: 'Micro skein' }
        ]
    });

    // Load data on mount
    useEffect(() => {
        loadAllData();
    }, []);

    const loadAllData = async () => {
        setLoading(true);
        try {
            console.log('Loading data from Supabase...');
            const recipesData = await StorageManager.get('recipes');
            const inventoryData = await StorageManager.get('inventory');
            const batchesData = await StorageManager.get('batches');
            const salesData = await StorageManager.get('sales');
            const dyeSessionsData = await StorageManager.get('dye_sessions');
            const kitsData = await StorageManager.get('kits');
            const colorSketchesData = await StorageManager.get('color_sketches');
            const gradientsData = await StorageManager.get('gradients');
            const settingsData = await StorageManager.get('settings');
            
            console.log('Loaded recipes:', recipesData);
            console.log('Loaded inventory:', inventoryData);
            console.log('Loaded batches:', batchesData);
            
            setRecipes(recipesData || []);
            setInventory(inventoryData || []);
            setBatches(batchesData || []);
            setSales(salesData || []);
            setDyeSessions(dyeSessionsData || []);
            setKits(kitsData || []);
            setColorSketches(colorSketchesData || []);
            setGradients(gradientsData || []);
            setSettings(settingsData || {
                colorTypes: ['tonal', 'variegated', 'speckled'],
                inventoryCategories: ['dye', 'yarn base', 'chemical', 'tool', 'ball band', 'other'],
                units: ['ml', 'g', 'oz', 'lb', 'tsp', 'tbsp'],
                suppliers: ['Dharma', 'Wool2Dye4', 'Amazon'],
                yarnBaseMappings: [
                    { supplierName: 'W2D4 Merino Bulky SW', myName: 'Luna Bulky' },
                    { supplierName: 'W2D4 SW DK', myName: 'Luna DK' }
                ],
                sizeMappings: [
                    { grams: 100, name: 'Full skein' },
                    { grams: 50, name: 'Half skein' },
                    { grams: 20, name: 'Mini skein' },
                    { grams: 10, name: 'Micro skein' }
                ]
            });
            console.log('Data loaded successfully!');
        } catch (error) {
            console.error('Error loading data:', error);
        }
        setLoading(false);
    };

    const saveRecipes = async (newRecipes) => {
        setRecipes(newRecipes);
        await StorageManager.set('recipes', newRecipes);
    };

    const saveInventory = async (newInventory) => {
        // Safety check - don't save if inventory is empty and we previously had items
        if ((!newInventory || newInventory.length === 0) && inventory.length > 0) {
            console.warn('Prevented saving empty inventory - this might be an error');
            if (!confirm('Warning: You are about to clear all inventory. Are you sure?')) {
                return;
            }
        }
        setInventory(newInventory);
        await StorageManager.set('inventory', newInventory);
    };

    const saveBatches = async (newBatches) => {
        if (newBatches.length === 0 && batches.length > 0) {
            console.warn('Attempting to save empty batches when batches exist - this will be blocked by StorageManager');
        }
        setBatches(newBatches);
        await StorageManager.set('batches', newBatches);
    };

    const saveSales = async (newSales) => {
        setSales(newSales);
        await StorageManager.set('sales', newSales);
    };

    const saveDyeSessions = async (newSessions) => {
        setDyeSessions(newSessions);
        await StorageManager.set('dye_sessions', newSessions);
    };

    const saveKits = async (newKits) => {
        setKits(newKits);
        await StorageManager.set('kits', newKits);
    };

    const saveColorSketches = async (newSketches) => {
        setColorSketches(newSketches);
        await StorageManager.set('color_sketches', newSketches);
    };

    const saveGradients = async (newGradients) => {
        setGradients(newGradients);
        await StorageManager.set('gradients', newGradients);
    };

    const saveSettings = async (newSettings) => {
        setSettings(newSettings);
        await StorageManager.set('settings', newSettings);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading your studio...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="gradient-bg text-white shadow-lg">
                <div className="container mx-auto px-4 py-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold">🧶 Celestial Dyeworks Studio Manager</h1>
                            <p className="text-purple-100 mt-1">Professional dyeing business management</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    const data = {
                                        recipes,
                                        inventory,
                                        batches,
                                        sales,
                                        dyeSessions,
                                        kits,
                                        colorSketches,
                                        gradients,
                                        settings,
                                        exportDate: new Date().toISOString()
                                    };
                                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `celestial-dyeworks-backup-${new Date().toISOString().split('T')[0]}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
                            >
                                💾 Export Backup
                            </button>
                            <button
                                onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = '.json';
                                    input.onchange = async (e) => {
                                        const file = (e.target as HTMLInputElement).files[0];
                                        if (file) {
                                            try {
                                                const text = await file.text();
                                                const data = JSON.parse(text);
                                                
                                                // Count current items
                                                const currentCounts = {
                                                    recipes: recipes.length,
                                                    inventory: inventory.length,
                                                    batches: batches.length,
                                                    sales: sales.length,
                                                    dyeSessions: dyeSessions.length,
                                                    kits: kits.length,
                                                    colorSketches: colorSketches.length,
                                                    gradients: gradients.length
                                                };
                                                
                                                const backupCounts = {
                                                    recipes: data.recipes?.length || 0,
                                                    inventory: data.inventory?.length || 0,
                                                    batches: data.batches?.length || 0,
                                                    sales: data.sales?.length || 0,
                                                    dyeSessions: data.dyeSessions?.length || 0,
                                                    kits: data.kits?.length || 0,
                                                    colorSketches: data.colorSketches?.length || 0,
                                                    gradients: data.gradients?.length || 0
                                                };
                                                
                                                const confirmMessage = `⚠️ RESTORE BACKUP FROM ${data.exportDate || 'unknown date'}?\n\n` +
                                                    `This will REPLACE your current data:\n\n` +
                                                    `Recipes: ${currentCounts.recipes} → ${backupCounts.recipes}\n` +
                                                    `Inventory: ${currentCounts.inventory} → ${backupCounts.inventory}\n` +
                                                    `Batches (Pipeline): ${currentCounts.batches} → ${backupCounts.batches}\n` +
                                                    `Sales: ${currentCounts.sales} → ${backupCounts.sales}\n` +
                                                    `Dye Sessions: ${currentCounts.dyeSessions} → ${backupCounts.dyeSessions}\n` +
                                                    `Kits: ${currentCounts.kits} → ${backupCounts.kits}\n` +
                                                    `Color Sketches: ${currentCounts.colorSketches} → ${backupCounts.colorSketches}\n` +
                                                    `Gradients: ${currentCounts.gradients} → ${backupCounts.gradients}\n\n` +
                                                    `Are you sure? This cannot be undone!`;
                                                
                                                if (!confirm(confirmMessage)) return;
                                                
                                                // First update state
                                                setRecipes(data.recipes || []);
                                                setInventory(data.inventory || []);
                                                setBatches(data.batches || []);
                                                setSales(data.sales || []);
                                                setDyeSessions(data.dyeSessions || []);
                                                setKits(data.kits || []);
                                                setColorSketches(data.colorSketches || []);
                                                setGradients(data.gradients || []);
                                                if (data.settings) setSettings(data.settings);
                                                
                                                // Save to database - StorageManager will handle delete+insert
                                                console.log('Saving backup data to database...');
                                                await Promise.all([
                                                    StorageManager.set('recipes', data.recipes || []),
                                                    StorageManager.set('inventory', data.inventory || []),
                                                    StorageManager.set('batches', data.batches || []),
                                                    StorageManager.set('sales', data.sales || []),
                                                    StorageManager.set('dye_sessions', data.dyeSessions || []),
                                                    StorageManager.set('kits', data.kits || []),
                                                    StorageManager.set('color_sketches', data.colorSketches || []),
                                                    StorageManager.set('gradients', data.gradients || []),
                                                    StorageManager.set('settings', data.settings || settings)
                                                ]);
                                                
                                                console.log('All data saved successfully!');
                                                alert('Backup restored successfully! Page will reload.');
                                                
                                                // Wait a bit more to ensure database commits
                                                setTimeout(() => {
                                                    window.location.reload();
                                                }, 500);
                                            } catch (error) {
                                                console.error('Import error:', error);
                                                alert('Error reading backup file: ' + error.message);
                                            }
                                        }
                                    };
                                    input.click();
                                }}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                            >
                                📥 Import Backup
                            </button>
                            <button
                                onClick={async () => {
                                    if (!confirm('Restore batches directly from Supabase?\n\nThis will reload batch data from the database without importing a file.')) return;
                                    
                                    try {
                                        const batchesData = await StorageManager.get('batches');
                                        console.log('Loaded batches from database:', batchesData);
                                        setBatches(batchesData || []);
                                        alert(`Restored ${batchesData?.length || 0} batches from database`);
                                    } catch (error) {
                                        alert('Error loading batches: ' + error.message);
                                    }
                                }}
                                className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors font-medium text-sm"
                            >
                                🔄 Reload Batches
                            </button>
                            <button
                                onClick={() => { supabase.auth.signOut(); }}
                                className="bg-white text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-50 transition-colors font-medium border border-purple-200"
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Navigation */}
            <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
                <div className="container mx-auto px-4">
                    <div className="flex space-x-1 overflow-x-auto">
                        {[
                            { id: 'dashboard', label: '📊 Dashboard' },
                            { id: 'calendar', label: '📅 Calendar' },
                            { id: 'colorways', label: '🧶 Colorways', group: ['recipes', 'gradients', 'kits'] },
                            { id: 'studio', label: '🧪 Studio', group: ['colorlab', 'sessions', 'queue'] },
                            { id: 'inventory', label: '📦 Inventory' },
                            { id: 'pipeline', label: '🔄 Pipeline' },
                            { id: 'sales', label: '💰 Sales' },
                            { id: 'settings', label: '⚙️ Settings' }
                        ].map(tab => {
                            const isGroupActive = tab.group 
                                ? tab.group.includes(activeTab) 
                                : activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => {
                                        if (tab.group) {
                                            // If clicking a group tab, go to first sub-tab (or stay if already in group)
                                            if (!tab.group.includes(activeTab)) {
                                                setActiveTab(tab.group[0]);
                                            }
                                        } else {
                                            setActiveTab(tab.id);
                                        }
                                    }}
                                    className={`px-6 py-4 font-medium whitespace-nowrap transition-colors ${
                                        isGroupActive 
                                            ? 'tab-active' 
                                            : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                {/* Sub-tabs for Colorways */}
                {['recipes', 'gradients', 'kits'].includes(activeTab) && (
                    <div className="container mx-auto px-4 border-t border-gray-100">
                        <div className="flex space-x-1 py-1">
                            {[
                                { id: 'recipes', label: '📝 Recipes' },
                                { id: 'gradients', label: '🌈 Gradients' },
                                { id: 'kits', label: '🎁 Kits' }
                            ].map(sub => (
                                <button
                                    key={sub.id}
                                    onClick={() => setActiveTab(sub.id)}
                                    className={`px-4 py-2 text-sm whitespace-nowrap transition-colors ${
                                        activeTab === sub.id 
                                            ? 'subtab-active' 
                                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg'
                                    }`}
                                >
                                    {sub.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {/* Sub-tabs for Studio */}
                {['colorlab', 'sessions', 'queue'].includes(activeTab) && (
                    <div className="container mx-auto px-4 border-t border-gray-100">
                        <div className="flex space-x-1 py-1">
                            {[
                                { id: 'colorlab', label: '🎨 Color Lab' },
                                { id: 'sessions', label: '📋 Dye Sessions' },
                                { id: 'queue', label: '▶️ Queue' }
                            ].map(sub => (
                                <button
                                    key={sub.id}
                                    onClick={() => setActiveTab(sub.id)}
                                    className={`px-4 py-2 text-sm whitespace-nowrap transition-colors ${
                                        activeTab === sub.id 
                                            ? 'subtab-active' 
                                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg'
                                    }`}
                                >
                                    {sub.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </nav>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-8">
                <Suspense fallback={
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto"></div>
                    </div>
                }>
                {activeTab === 'dashboard' && (
                    <Dashboard 
                        recipes={recipes} 
                        inventory={inventory} 
                        batches={batches} 
                        sales={sales} 
                    />
                )}
                {activeTab === 'calendar' && (
                    <Calendar 
                        dyeSessions={dyeSessions}
                        setActiveTab={setActiveTab}
                    />
                )}
                {activeTab === 'recipes' && (
                    <Recipes recipes={recipes} saveRecipes={saveRecipes} settings={settings} inventory={inventory} />
                )}
                {activeTab === 'colorlab' && (
                    <ColorLab colorSketches={colorSketches} saveColorSketches={saveColorSketches} settings={settings} inventory={inventory} recipes={recipes} saveRecipes={saveRecipes} />
                )}
                {activeTab === 'gradients' && (
                    <Gradients gradients={gradients} saveGradients={saveGradients} inventory={inventory} />
                )}
                {activeTab === 'kits' && (
                    <Kits kits={kits} saveKits={saveKits} recipes={recipes} inventory={inventory} />
                )}
                {activeTab === 'sessions' && (
                    <DyeSessions 
                        dyeSessions={dyeSessions} 
                        saveDyeSessions={saveDyeSessions}
                        recipes={recipes}
                        inventory={inventory}
                        settings={settings}
                        kits={kits}
                        colorSketches={colorSketches}
                    />
                )}
                {activeTab === 'queue' && (
                    <UpNext 
                        dyeSessions={dyeSessions}
                        saveDyeSessions={saveDyeSessions}
                        batches={batches}
                        saveBatches={saveBatches}
                        inventory={inventory}
                        saveInventory={saveInventory}
                        recipes={recipes}
                        settings={settings}
                        colorSketches={colorSketches}
                        saveColorSketches={saveColorSketches}
                    />
                )}
                {activeTab === 'inventory' && (
                    <Inventory inventory={inventory} saveInventory={saveInventory} settings={settings} />
                )}
                {activeTab === 'pipeline' && (
                    <Pipeline 
                        batches={batches} 
                        saveBatches={saveBatches} 
                        recipes={recipes}
                        inventory={inventory}
                        saveInventory={saveInventory}
                        settings={settings}
                    />
                )}
                {activeTab === 'sales' && (
                    <Sales 
                        sales={sales} 
                        saveSales={saveSales} 
                        batches={batches}
                        saveBatches={saveBatches}
                    />
                )}
                {activeTab === 'settings' && (
                    <Settings
                        settings={settings}
                        saveSettings={saveSettings}
                        inventory={inventory}
                    />
                )}
                </Suspense>
            </main>
        </div>
    );
}

// Dashboard Component
