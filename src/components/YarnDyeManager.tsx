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
const OnHand = named(() => import('./OnHand'), 'OnHand');
const Gradients = named(() => import('./Gradients'), 'Gradients');
const Settings = named(() => import('./Settings'), 'Settings');
const BackupRestore = named(() => import('./BackupRestore'), 'BackupRestore');
const YarnBases = named(() => import('./YarnBases'), 'YarnBases');
const DyeCatalog = named(() => import('./DyeCatalog'), 'DyeCatalog');
const Demand = named(() => import('./Demand'), 'Demand');

// Top-level nav. Groups list their sub-tabs; the first one opens by default.
// Tab ids are the URL paths, so keep them stable (bookmarks, cross-tab links).
type NavItem = { id: string; icon: string; label: string; group?: [string, string][] };
const NAV: NavItem[] = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'dye', icon: '▶️', label: 'Dye', group: [['queue', '▶️ Queue'], ['sessions', '📋 Sessions'], ['calendar', '📅 Calendar']] },
    { id: 'pipeline', icon: '🔄', label: 'Pipeline' },
    { id: 'colorways', icon: '🧶', label: 'Colorways', group: [['recipes', '📝 Recipes'], ['gradients', '🌈 Gradients'], ['kits', '🎁 Kits'], ['colorlab', '🎨 Color Lab']] },
    { id: 'shop', icon: '📈', label: 'Sales', group: [['demand', '📈 Demand'], ['sales', '📦 On hand']] },
];
// Reference pages you rarely need, tucked under the More menu.
const MORE: [string, string][] = [
    ['bases', '🧵 Yarn Bases'],
    ['dyes', '🎨 Dyes'],
    ['inventory', '📦 Inventory'],
    ['settings', '⚙️ Settings'],
];
const VALID_TABS = [
    ...NAV.flatMap((t) => (t.group ? t.group.map(([id]) => id) : [t.id])),
    ...MORE.map(([id]) => id),
];

export function YarnDyeManager() {
    // Active tab is backed by the URL (e.g. /recipes) so refresh stays put,
    // tabs are bookmarkable, and back/forward work.
    const navigate = useNavigate();
    const location = useLocation();
    const rawTab = location.pathname.slice(1);
    const activeTab = VALID_TABS.includes(rawTab) ? rawTab : 'dashboard';
    const setActiveTab = (tab) => navigate('/' + tab);
    const activeGroup = NAV.find((t) => t.group?.some(([id]) => id === activeTab));
    const activeMore = MORE.find(([id]) => id === activeTab);
    const [moreOpen, setMoreOpen] = useState(false);
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

    const [loadError, setLoadError] = useState('');

    const loadAllData = async () => {
        setLoading(true);
        setLoadError('');
        try {
            // Load in parallel. Any failure aborts the whole load: the app is
            // not shown (so nothing can be saved) until every table loads.
            const [recipesData, inventoryData, batchesData, salesData, dyeSessionsData, kitsData, colorSketchesData, gradientsData, settingsData] = await Promise.all([
                StorageManager.get('recipes'),
                StorageManager.get('inventory'),
                StorageManager.get('batches'),
                StorageManager.get('sales'),
                StorageManager.get('dye_sessions'),
                StorageManager.get('kits'),
                StorageManager.get('color_sketches'),
                StorageManager.get('gradients'),
                StorageManager.get('settings'),
            ]);

            setRecipes(recipesData);
            setInventory(inventoryData);
            setBatches(batchesData);
            setSales(salesData);
            setDyeSessions(dyeSessionsData);
            setKits(kitsData);
            setColorSketches(colorSketchesData);
            setGradients(gradientsData);
            // null only when no settings row exists yet (a brand-new account).
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
        } catch (error) {
            console.error('Error loading data:', error);
            setLoadError(error?.message || String(error));
        }
        setLoading(false);
    };

    // Optimistic save: show the change at once, and if the database write
    // fails, put the previous value back (unless something newer replaced it)
    // and say so — the UI never shows data that would vanish on reload.
    const persist = async (key, label, setState, prev, next) => {
        setState(next);
        const ok = await StorageManager.set(key, next);
        if (!ok) {
            setState((cur) => (cur === next ? prev : cur));
            toast(`Couldn't save ${label} — your last change was undone. Check your connection and try again.`, 'error');
        }
        return ok;
    };

    const saveRecipes = (newRecipes) => persist('recipes', 'recipes', setRecipes, recipes, newRecipes);

    const saveInventory = async (newInventory) => {
        // Safety check - don't save if inventory is empty and we previously had items
        if ((!newInventory || newInventory.length === 0) && inventory.length > 0) {
            console.warn('Prevented saving empty inventory - this might be an error');
            if (!(await confirmDialog({ title: 'Clear all inventory?', message: 'You are about to clear all inventory. Are you sure?', confirmText: 'Clear', danger: true }))) {
                return false;
            }
        }
        return persist('inventory', 'inventory', setInventory, inventory, newInventory);
    };

    const saveBatches = (newBatches) => persist('batches', 'batches', setBatches, batches, newBatches);

    const saveSales = (newSales) => persist('sales', 'sales', setSales, sales, newSales);

    // Apply a restored backup. Only collections present in the backup are
    // written (parseBackup drops missing ones), then the app reloads from the
    // database so the screen shows exactly what was saved.
    const applyRestore = async (data) => {
        const jobs: Array<[string, Promise<boolean>]> = [
            ['Recipes', 'recipes'], ['Inventory', 'inventory'], ['Batches', 'batches'], ['Sales', 'sales'],
            ['Dye Sessions', 'dyeSessions'], ['Kits', 'kits'], ['Color Sketches', 'colorSketches'], ['Gradients', 'gradients'],
        ]
            .filter(([, k]) => Array.isArray(data[k]))
            .map(([label, k]) => [label, StorageManager.set(({ dyeSessions: 'dye_sessions', colorSketches: 'color_sketches' }[k] || k) as any, data[k])]);
        if (data.settings) jobs.push(['Settings', StorageManager.set('settings', data.settings)]);

        const results = await Promise.all(jobs.map(([, p]) => p));
        const failed = jobs.filter((_, i) => !results[i]).map(([label]) => label);
        if (failed.length) {
            await confirmDialog({
                title: 'Restore partly failed',
                message: `These didn't restore: ${failed.join(', ')}.\n\nEverything else was restored. The app will reload to show what's saved now — your pre-restore copy is in your downloads.`,
                confirmText: 'Reload',
            });
            window.location.reload();
            return;
        }
        toast('Backup restored! Reloading…', 'success');
        setTimeout(() => window.location.reload(), 600);
    };

    const saveDyeSessions = (newSessions) => persist('dye_sessions', 'dye sessions', setDyeSessions, dyeSessions, newSessions);

    const saveKits = (newKits) => persist('kits', 'kits', setKits, kits, newKits);

    const saveColorSketches = (newSketches) => persist('color_sketches', 'Color Lab sketches', setColorSketches, colorSketches, newSketches);

    const saveGradients = (newGradients) => persist('gradients', 'gradients', setGradients, gradients, newGradients);

    const saveSettings = (newSettings) => persist('settings', 'settings', setSettings, settings, newSettings);

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

    if (loadError) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4">
                <div className="bg-white rounded-lg card-shadow p-6 max-w-md text-center">
                    <div className="text-4xl mb-2">⚠️</div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Couldn't load your studio</h2>
                    <p className="text-gray-600 mb-1">Nothing was changed. This is usually a dropped connection.</p>
                    <p className="text-xs text-gray-400 mb-4 break-words">{loadError}</p>
                    <div className="flex gap-2 justify-center">
                        <button onClick={loadAllData} className="bg-teal-600 text-white px-5 py-3 rounded-lg font-medium hover:bg-teal-700">Try again</button>
                        <button onClick={() => { supabase.auth.signOut(); }} className="px-5 py-3 rounded-lg font-medium text-gray-600 hover:bg-gray-100">Sign out</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Navigation — the dye-day loop up front; reference pages under More */}
            <nav className="bg-white shadow-sm border-b sticky top-0 z-20">
                <div className="container mx-auto px-4 flex items-center gap-2">
                    <span className="hidden lg:block font-bold text-teal-700 whitespace-nowrap mr-2">🧶 Celestial Dyeworks</span>
                    <div className="flex-1 min-w-0 flex space-x-1 overflow-x-auto [scrollbar-width:none]">
                        {NAV.map(tab => {
                            const ids = tab.group ? tab.group.map(([id]) => id) : [tab.id];
                            const active = ids.includes(activeTab);
                            return (
                                <button
                                    key={tab.id}
                                    // A group opens on its first sub-tab (or stays put if already in it)
                                    onClick={() => { if (!ids.includes(activeTab)) setActiveTab(ids[0]); }}
                                    title={tab.label}
                                    className={`px-2 sm:px-4 py-2.5 my-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                                        active ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {/* Phones show just the icon for tabs you're not on, so all five fit */}
                                    {tab.icon}<span className={active ? ' ml-1.5' : 'hidden sm:inline ml-1.5'}>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    {/* Kept outside the scrolling row so the menu isn't clipped */}
                    <div className="relative shrink-0">
                        <button
                            onClick={() => setMoreOpen(!moreOpen)}
                            className={`px-2 sm:px-4 py-2.5 my-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                                activeMore ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            {activeMore ? activeMore[1] : <>⋯<span className="hidden sm:inline"> More</span></>} ▾
                        </button>
                        {moreOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                                <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg card-shadow border py-1 z-20">
                                    {MORE.map(([id, label]) => (
                                        <button
                                            key={id}
                                            onClick={() => { setActiveTab(id); setMoreOpen(false); }}
                                            className={`block w-full text-left px-4 py-2 text-sm ${
                                                activeTab === id ? 'subtab-active' : 'text-gray-700 hover:bg-gray-100'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                    <div className="border-t my-1" />
                                    <button
                                        onClick={() => { setMoreOpen(false); supabase.auth.signOut(); }}
                                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                    >
                                        ↪ Sign out
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {/* Sub-tabs for the active group */}
                {activeGroup && (
                    <div className="container mx-auto px-4 border-t border-gray-100">
                        <div className="flex space-x-1 py-1 overflow-x-auto [scrollbar-width:none]">
                            {activeGroup.group.map(([id, label]) => (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={`px-3 sm:px-4 py-2 text-sm whitespace-nowrap transition-colors ${
                                        activeTab === id
                                            ? 'subtab-active'
                                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg'
                                    }`}
                                >
                                    {label}
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
                        kits={kits}
                        settings={settings}
                        dyeSessions={dyeSessions}
                        gradients={gradients}
                        colorSketches={colorSketches}
                        setActiveTab={setActiveTab}
                    />
                )}
                {activeTab === 'calendar' && (
                    <Calendar 
                        dyeSessions={dyeSessions}
                        setActiveTab={setActiveTab}
                    />
                )}
                {activeTab === 'recipes' && (
                    <Recipes recipes={recipes} saveRecipes={saveRecipes} settings={settings} inventory={inventory} sales={sales} batches={batches} kits={kits} dyeSessions={dyeSessions} gradients={gradients} />
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
                    <DyeCatalog settings={settings} saveSettings={saveSettings} />
                )}
                {activeTab === 'inventory' && (
                    <Inventory inventory={inventory} saveInventory={saveInventory} settings={settings} sales={sales} batches={batches} recipes={recipes} kits={kits} dyeSessions={dyeSessions} gradients={gradients} colorSketches={colorSketches} setActiveTab={setActiveTab} />
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
                    <OnHand
                        sales={sales}
                        batches={batches}
                        recipes={recipes}
                        kits={kits}
                        settings={settings}
                        inventory={inventory}
                        dyeSessions={dyeSessions}
                        gradients={gradients}
                        colorSketches={colorSketches}
                        setActiveTab={setActiveTab}
                    />
                )}
                {activeTab === 'demand' && (
                    <Demand
                        sales={sales}
                        saveSales={saveSales}
                        batches={batches}
                        recipes={recipes}
                        kits={kits}
                        settings={settings}
                        saveSettings={saveSettings}
                        inventory={inventory}
                        dyeSessions={dyeSessions}
                        saveDyeSessions={saveDyeSessions}
                        gradients={gradients}
                        colorSketches={colorSketches}
                        setActiveTab={setActiveTab}
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
