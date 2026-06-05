import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { StorageManager } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';

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
const BackupRestore = named(() => import('./BackupRestore'), 'BackupRestore');
const YarnBases = named(() => import('./YarnBases'), 'YarnBases');
const DyeCatalog = named(() => import('./DyeCatalog'), 'DyeCatalog');

const VALID_TABS = [
    'dashboard', 'calendar', 'recipes', 'gradients', 'kits', 'colorlab',
    'sessions', 'queue', 'bases', 'dyes', 'inventory', 'pipeline', 'sales', 'settings',
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
    const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
    const toggleDark = () => {
        const next = !darkMode;
        setDarkMode(next);
        document.documentElement.classList.toggle('dark', next);
        localStorage.setItem('theme', next ? 'dark' : 'light');
    };
    const [settings, setSettings] = useState({
        colorTypes: ['tonal', 'variegated', 'speckled'],
        inventoryCategories: ['dye', 'yarn base', 'chemical', 'tool', 'ball band', 'other'],
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
            if (!(await confirmDialog({ title: 'Clear all inventory?', message: 'You are about to clear all inventory. Are you sure?', confirmText: 'Clear', danger: true }))) {
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

    // Apply a restored backup: update in-memory state, persist every collection
    // to the database (StorageManager handles the upsert/delete), then reload.
    const applyRestore = async (data) => {
        setRecipes(data.recipes || []);
        setInventory(data.inventory || []);
        setBatches(data.batches || []);
        setSales(data.sales || []);
        setDyeSessions(data.dyeSessions || []);
        setKits(data.kits || []);
        setColorSketches(data.colorSketches || []);
        setGradients(data.gradients || []);
        if (data.settings) setSettings(data.settings);

        await Promise.all([
            StorageManager.set('recipes', data.recipes || []),
            StorageManager.set('inventory', data.inventory || []),
            StorageManager.set('batches', data.batches || []),
            StorageManager.set('sales', data.sales || []),
            StorageManager.set('dye_sessions', data.dyeSessions || []),
            StorageManager.set('kits', data.kits || []),
            StorageManager.set('color_sketches', data.colorSketches || []),
            StorageManager.set('gradients', data.gradients || []),
            StorageManager.set('settings', data.settings || settings),
        ]);

        toast('Backup restored! Reloading…', 'success');
        setTimeout(() => window.location.reload(), 600);
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
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4"></div>
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
                            <p className="text-teal-100 mt-1">Professional dyeing business management</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { supabase.auth.signOut(); }}
                                className="bg-white text-teal-700 px-4 py-2 rounded-lg hover:bg-teal-50 transition-colors font-medium border border-teal-200"
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
                            { id: 'bases', label: '🧵 Yarn Bases' },
                            { id: 'dyes', label: '🎨 Dyes' },
                            { id: 'inventory', label: '📦 Inventory' },
                            { id: 'pipeline', label: '🔄 Pipeline' },
                            { id: 'sales', label: '🏷️ Stock' },
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
                                    className={`px-4 py-2.5 my-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                                        isGroupActive
                                            ? 'bg-teal-600 text-white'
                                            : 'text-gray-600 hover:bg-gray-100'
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
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto"></div>
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
                        gradients={gradients}
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
                {activeTab === 'bases' && (
                    <YarnBases settings={settings} saveSettings={saveSettings} />
                )}
                {activeTab === 'dyes' && (
                    <DyeCatalog settings={settings} saveSettings={saveSettings} inventory={inventory} />
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
                    <div className="space-y-6">
                        <BackupRestore
                            collections={{ recipes, inventory, batches, sales, dyeSessions, kits, colorSketches, gradients, settings }}
                            applyRestore={applyRestore}
                        />
                        <Settings
                            settings={settings}
                            saveSettings={saveSettings}
                            inventory={inventory}
                            darkMode={darkMode}
                            toggleDark={toggleDark}
                        />
                    </div>
                )}
                </Suspense>
            </main>
        </div>
    );
}

// Dashboard Component
