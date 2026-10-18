// Shopify CSV import — turns Shopify admin exports into rows the app can analyze.
//
//   * Orders export (Orders → Export → CSV): one row per LINE ITEM. Order-level
//     fields (Financial Status, Created at, Cancelled at…) are only filled on the
//     first line of each order, so they're carried forward by order Name.
//   * Inventory / Products export (optional): current on-hand per variant, so
//     the Demand tab can say how many weeks of stock are left.
//
// Privacy: only product/quantity/price/date fields are read. Customer names,
// emails and addresses in the export are never stored.

import { supabase } from './supabase';

// ---------- CSV ----------

/** RFC 4180 CSV → array of rows (handles quotes, "" escapes, embedded newlines). */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const s = text.replace(/^﻿/, ''); // strip BOM
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((f) => f !== '')) rows.push(row);
            row = [];
        } else field += ch;
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
}

/** Rows → objects keyed by lower-cased header. */
function toRecords(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
    const headers = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const records = rows.slice(1).map((r) => {
        const o: Record<string, string> = {};
        headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
        return o;
    });
    return { headers, records };
}

const num = (v: any): number => {
    const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : 0;
};

// ---------- Orders ----------

export interface SaleLine {
    id: number;
    lineKey: string;        // stable dedupe key across re-imports
    orderName: string;      // "#1042"
    orderDate: string;      // YYYY-MM-DD (store's local date)
    productTitle: string;
    variantTitle: string;
    lineName: string;       // "Blue Hour - Luna DK / 50g"
    sku: string;
    quantity: number;
    unitPrice: number;
    discount: number;       // total discount on this line
    financialStatus: string;
    vendor?: string;        // Shopify line-item vendor (brand), e.g. "Celestial Dyeworks"
    cancelled: boolean;
    importedAt?: string;
    [key: string]: any;
}

/** Split Shopify's "Product - Variant" line name on the LAST " - ". */
export function splitLineName(name: string): { product: string; variant: string } {
    const i = name.lastIndexOf(' - ');
    if (i < 0) return { product: name, variant: '' };
    return { product: name.slice(0, i), variant: name.slice(i + 3) };
}

export class ImportError extends Error {}

/** Parse a Shopify Orders CSV into sale lines (ids/importedAt filled by mergeSales). */
export function parseOrdersCsv(text: string): Omit<SaleLine, 'id'>[] {
    const { headers, records } = toRecords(parseCsv(text));
    const need = ['name', 'lineitem name', 'lineitem quantity', 'lineitem price'];
    const missing = need.filter((h) => !headers.includes(h));
    if (missing.length) {
        throw new ImportError(
            `This doesn't look like a Shopify Orders export (missing: ${missing.join(', ')}). ` +
            'In Shopify admin go to Orders → Export → "Plain CSV file".'
        );
    }

    const orderInfo: Record<string, { date: string; status: string; cancelled: boolean }> = {};
    const seen: Record<string, number> = {};
    const lines: Omit<SaleLine, 'id'>[] = [];

    for (const r of records) {
        const orderName = r['name'];
        const lineName = r['lineitem name'];
        if (!orderName || !lineName) continue;

        // Order-level fields only appear on an order's first row — carry forward.
        const created = r['created at'] || r['paid at'] || '';
        if (!orderInfo[orderName] || created) {
            const prev = orderInfo[orderName];
            orderInfo[orderName] = {
                date: created ? created.slice(0, 10) : prev?.date || '',
                status: (r['financial status'] || prev?.status || '').toLowerCase(),
                cancelled: !!r['cancelled at'] || !!prev?.cancelled,
            };
        }
        const info = orderInfo[orderName];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(info.date)) continue;

        const sku = r['lineitem sku'] || '';
        const base = `${orderName}|${lineName}|${sku}`;
        seen[base] = (seen[base] || 0) + 1;
        const { product, variant } = splitLineName(lineName);

        lines.push({
            lineKey: `${base}|${seen[base]}`,
            orderName,
            orderDate: info.date,
            productTitle: product,
            variantTitle: variant,
            lineName,
            sku,
            quantity: Math.round(num(r['lineitem quantity'])),
            unitPrice: num(r['lineitem price']),
            discount: num(r['lineitem discount']),
            financialStatus: info.status,
            vendor: r['vendor'] || '',
            cancelled: info.cancelled,
        });
    }
    if (!lines.length) throw new ImportError('No order lines found in that file.');
    return lines;
}

/**
 * Merge freshly parsed lines into the existing sales. Re-importing an
 * overlapping export updates matching lines in place (same id) instead of
 * duplicating them, so you can export "last 90 days" every so often.
 */
export function mergeSales(existing: SaleLine[], incoming: Omit<SaleLine, 'id'>[]) {
    const byKey = new Map(existing.map((s) => [s.lineKey, s]));
    const importedAt = new Date().toISOString();
    let added = 0;
    let updated = 0;
    // Date.now()*1000 keeps ids unique, inside the safe-integer range, and clear
    // of every other table's Date.now() ids.
    let nextId = Date.now() * 1000;
    for (const line of incoming) {
        const prev = byKey.get(line.lineKey);
        if (prev) {
            byKey.set(line.lineKey, { ...prev, ...line, importedAt });
            updated++;
        } else {
            byKey.set(line.lineKey, { ...line, id: nextId++, importedAt } as SaleLine);
            added++;
        }
    }
    return { sales: [...byKey.values()], added, updated };
}

/** True when a line is real, kept revenue (not cancelled/refunded/voided/test). */
export function isCountable(line: SaleLine): boolean {
    if (line.cancelled) return false;
    const st = String(line.financialStatus || '').toLowerCase();
    return !['refunded', 'voided', 'expired'].includes(st) && (line.quantity || 0) > 0;
}

export const lineRevenue = (l: SaleLine) =>
    Math.max(0, (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0) - (Number(l.discount) || 0));

/**
 * The sales table needs the columns from sql/shopify-sales.sql. Without them the
 * storage layer strips every field on save, so check before importing.
 */
export async function salesSchemaReady(): Promise<boolean> {
    const { error } = await supabase.from('sales').select('lineKey,orderDate,unitPrice,vendor').limit(1);
    return !error;
}

// ---------- Inventory snapshot ----------

export interface InventorySnapshot {
    importedAt: string;
    rows: { name: string; sku: string; available: number; vendor?: string }[];
}

/**
 * Parse a Shopify Inventory export ("Available"/"On hand" per location) or a
 * Products export ("Variant Inventory Qty"). Builds the same "Title - Opt1 / Opt2"
 * name Shopify uses for order line items so one matcher handles both. Multiple
 * locations for the same variant are summed.
 */
export function parseInventoryCsv(text: string): InventorySnapshot {
    const { headers, records } = toRecords(parseCsv(text));
    const qtyCol = ['available', 'on hand', 'variant inventory qty'].find((h) => headers.includes(h));
    if (!headers.includes('title') && !headers.includes('handle')) {
        throw new ImportError("This doesn't look like a Shopify Inventory or Products export (no Title column).");
    }
    if (!qtyCol) {
        throw new ImportError(
            'No stock column found. Use Products → Inventory → Export (has "Available"), ' +
            'or Products → Export (has "Variant Inventory Qty").'
        );
    }

    const titleByHandle: Record<string, string> = {};
    const vendorByHandle: Record<string, string> = {};
    const totals = new Map<string, { name: string; sku: string; available: number; vendor?: string }>();
    for (const r of records) {
        const handle = r['handle'] || '';
        if (r['title']) titleByHandle[handle] = r['title'];
        if (r['vendor']) vendorByHandle[handle] = r['vendor'];
        const title = r['title'] || titleByHandle[handle];
        if (!title) continue;
        const opts = ['option1 value', 'option2 value', 'option3 value']
            .map((h) => r[h])
            .filter((v) => v && v !== 'Default Title');
        // Products export rows with no variant data (image-only rows) have no qty.
        if (r[qtyCol] === '' || r[qtyCol] == null) continue;
        const name = opts.length ? `${title} - ${opts.join(' / ')}` : title;
        const sku = r['sku'] || r['variant sku'] || '';
        const key = `${name}|${sku}`;
        const prev = totals.get(key);
        const qty = Math.max(0, Math.round(num(r[qtyCol])));
        if (prev) prev.available += qty;
        else totals.set(key, { name, sku, available: qty, vendor: r['vendor'] || vendorByHandle[handle] || '' });
    }
    if (!totals.size) throw new ImportError('No variants with stock counts found in that file.');
    return { importedAt: new Date().toISOString(), rows: [...totals.values()] };
}
