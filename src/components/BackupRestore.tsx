import { useState } from 'react';
import { toast } from '../lib/toast';
import { confirmDialog } from '../lib/dialog';
import { fromDbShape, type CollectionKey } from '../lib/storage';

interface Collections {
    recipes: any[];
    inventory: any[];
    batches: any[];
    sales: any[];
    dyeSessions: any[];
    kits: any[];
    colorSketches: any[];
    gradients: any[];
    settings: any;
}

// Collections shown in the restore diff, with friendly labels and table names.
const LABELS: Array<[keyof Collections, string, CollectionKey]> = [
    ['recipes', 'Recipes', 'recipes'],
    ['inventory', 'Inventory', 'inventory'],
    ['batches', 'Batches', 'batches'],
    ['sales', 'Sales', 'sales'],
    ['dyeSessions', 'Dye Sessions', 'dye_sessions'],
    ['kits', 'Kits', 'kits'],
    ['colorSketches', 'Color Sketches', 'color_sketches'],
    ['gradients', 'Gradients', 'gradients'],
];

/**
 * Turn a backup file into { collection: rows } for just the collections it
 * actually contains. Accepts app exports and scripts/backup.mjs files (raw
 * snake_case rows). A collection missing from the file is left out, so the
 * restore keeps that table as-is instead of wiping it. Throws on a damaged
 * file, before anything is changed.
 */
export function parseBackup(data: any): Partial<Collections> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not a backup file.');
    const fromScript = data.source === 'scripts/backup.mjs';
    const out: Partial<Collections> = {};
    for (const [k, label, table] of LABELS) {
        const rows = data[k] ?? data[table];
        if (rows === undefined || rows === null) continue;
        if (!Array.isArray(rows)) {
            throw new Error(`${label} in this backup is damaged${rows.__error ? ` (${rows.__error})` : ''}.`);
        }
        out[k] = fromScript ? fromDbShape(table, rows) : rows;
    }
    if (data.settings && typeof data.settings === 'object') {
        if (data.settings.__error) throw new Error(`Settings in this backup are damaged (${data.settings.__error}).`);
        out.settings = data.settings;
    }
    if (Object.keys(out).length === 0) throw new Error('This file has no studio data in it.');
    return out;
}

function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking right away can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const LAST_BACKUP_KEY = 'last_backup';

export function BackupRestore({
    collections,
    applyRestore,
}: {
    collections: Collections;
    applyRestore: (data: Partial<Collections>) => Promise<void>;
}) {
    const [lastBackup, setLastBackup] = useState<string | null>(() => localStorage.getItem(LAST_BACKUP_KEY));

    const totalRows = LABELS.reduce((n, [k]) => n + ((collections[k] as any[])?.length || 0), 0);
    const daysSince = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86_400_000) : null;
    const stale = daysSince === null || daysSince >= 7;

    const snapshot = () => ({
            recipes: collections.recipes,
            inventory: collections.inventory,
            batches: collections.batches,
            sales: collections.sales,
            dyeSessions: collections.dyeSessions,
            kits: collections.kits,
            colorSketches: collections.colorSketches,
            gradients: collections.gradients,
            settings: collections.settings,
            exportDate: new Date().toISOString(),
    });

    const exportBackup = () => {
        downloadJson(snapshot(), `celestial-dyeworks-backup-${new Date().toISOString().split('T')[0]}.json`);

        const now = new Date().toISOString();
        localStorage.setItem(LAST_BACKUP_KEY, now);
        setLastBackup(now);
        toast(`Backup downloaded · ${totalRows} records`, 'success');
    };

    const importBackup = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const raw = JSON.parse(await file.text());
                const data = parseBackup(raw);
                const lines = LABELS.map(([k, label]) => {
                    const now = (collections[k] as any[])?.length || 0;
                    return data[k] ? `${label}: ${now} → ${(data[k] as any[]).length}` : `${label}: ${now} (not in backup — kept)`;
                }).join('\n');
                const ok = await confirmDialog({
                    title: 'Restore backup?',
                    message:
                        `From ${raw.exportDate ? new Date(raw.exportDate).toLocaleString() : 'an unknown date'}.\n\n` +
                        `This REPLACES your current data:\n\n${lines}\n\n` +
                        `A copy of your current data will download first, so you can undo this.`,
                    confirmText: 'Restore',
                    danger: true,
                });
                if (!ok) return;
                downloadJson(snapshot(), `celestial-dyeworks-before-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
                await applyRestore(data);
            } catch (err: any) {
                toast('Could not restore: ' + (err?.message || err), 'error');
            }
        };
        input.click();
    };

    const lastBackupText = !lastBackup
        ? "You haven't backed up yet — export one to be safe."
        : daysSince === 0
        ? 'Last backup: today.'
        : daysSince === 1
        ? 'Last backup: yesterday.'
        : `Last backup: ${daysSince} days ago.`;

    return (
        <div className="bg-white rounded-lg card-shadow p-6 space-y-4">
            <div>
                <h3 className="text-lg font-semibold">Backup &amp; Restore</h3>
                <p className="text-sm text-gray-600 mt-1">
                    Download a full copy of your studio data, or restore everything from a backup file.
                </p>
            </div>

            <div
                className={`text-sm rounded-lg px-4 py-3 ${
                    stale
                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                        : 'bg-teal-50 border border-teal-200 text-teal-800'
                }`}
            >
                {lastBackupText}
                {lastBackup && stale && ' Consider exporting a fresh one.'}
            </div>

            <div className="flex flex-wrap gap-3">
                <button
                    onClick={exportBackup}
                    className="bg-teal-600 text-white px-5 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                    💾 Export backup
                </button>
                <button
                    onClick={importBackup}
                    className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                    📥 Restore from file
                </button>
            </div>

            <p className="text-xs text-gray-500">
                {totalRows} records across recipes, inventory, batches, sessions, kits, sketches, gradients &amp; sales.
                Restoring replaces all of it, then reloads.
            </p>
        </div>
    );
}
