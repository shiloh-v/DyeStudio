// Client side of the Shopify live sync (server: api/shopify-sync.ts).
//
// The server writes order lines into `sales` and the latest stock levels into
// the `shopify_sync` row. The app reads that row on load and after a sync, and
// uses its stock levels whenever they're newer than the last CSV stock upload.

import { supabase } from './supabase';

export interface SyncStatus {
    lastSyncAt: string | null;
    lastResult: any;
    inventory: { importedAt: string; rows: { name: string; sku: string; available: number }[] } | null;
}

/** The sync status row, or null when the table isn't set up / nothing synced yet. */
export async function loadSyncStatus(): Promise<SyncStatus | null> {
    try {
        const { data, error } = await supabase
            .from('shopify_sync')
            .select('inventory,last_sync_at,last_result')
            .maybeSingle();
        if (error || !data) return null;
        return { lastSyncAt: data.last_sync_at, lastResult: data.last_result, inventory: data.inventory };
    } catch {
        return null;
    }
}

/** Settings with the synced stock levels swapped in when they're the newest. */
export function withSyncedInventory<T>(settings: T, status: SyncStatus | null): T {
    const synced = status?.inventory;
    if (!settings || !synced?.importedAt) return settings;
    const current = (settings as any).shopifyInventory?.importedAt || '';
    return synced.importedAt > current ? { ...settings, shopifyInventory: synced } : settings;
}

/** Ask the server to pull from Shopify now. Throws with a readable message. */
export async function runShopifySync(): Promise<any> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not signed in.');
    let res: Response;
    try {
        res = await fetch('/api/shopify-sync', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
        });
    } catch {
        throw new Error("Couldn't reach the sync server — check your connection.");
    }
    const body = await res.json().catch(() => null);
    if (!body) {
        throw new Error(res.status === 404
            ? 'Sync only works on the deployed app (dye-studio.vercel.app), not the local dev server.'
            : `Sync failed (${res.status}).`);
    }
    if (!res.ok || !body.ok) throw new Error(body.error || `Sync failed (${res.status}).`);
    return body;
}
