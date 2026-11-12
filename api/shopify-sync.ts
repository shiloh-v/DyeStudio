// Shopify live sync (read-only) — Vercel serverless function.
//
// Pulls recent orders and current stock levels from the Shopify Admin API and
// writes them where the CSV import puts them:
//   * order lines   → `sales` table (same row shape + lineKey as the CSV import,
//                      so CSV history and synced lines merge without duplicates)
//   * stock levels  → `shopify_sync.inventory` (same shape as the CSV stock
//                      upload; the app overlays it onto settings.shopifyInventory)
//
// Nothing is ever written to Shopify. Only Celestial Dyeworks products are kept,
// and no customer data is requested.
//
// Called two ways:
//   POST  from the app's "Sync with Shopify" button — Authorization: Bearer <Supabase access token>
//   GET   from the daily Vercel cron               — Authorization: Bearer <CRON_SECRET>
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   SHOPIFY_STORE_DOMAIN       your-store.myshopify.com
//   SHOPIFY_CLIENT_ID          } app from the Shopify Dev Dashboard (client-credentials grant)
//   SHOPIFY_CLIENT_SECRET      }
//   SHOPIFY_ADMIN_TOKEN        (alternative) a legacy custom-app Admin API token (shpat_…)
//   SUPABASE_SERVICE_ROLE_KEY  server-only key; bypasses RLS, so writes are scoped to OWNER_USER_ID
//   OWNER_USER_ID              the owner's Supabase auth UUID
//   CRON_SECRET                any long random string (Vercel sends it to the cron)
//   VITE_SUPABASE_URL          already set for the app

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

const API_VERSION = '2026-07';
const DEFAULT_DAYS = 60; // read_orders scope covers the last 60 days
const OWN_VENDOR = 'Celestial Dyeworks';

// Kept in step with isOwnBrand() in src/lib/shopify.ts (copied, not imported:
// that module pulls in the browser Supabase client).
const brandKey = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function isOwnBrand(vendor: string | undefined | null, title: string | undefined | null): boolean {
    if (vendor) return brandKey(vendor) === brandKey(OWN_VENDOR);
    return brandKey(title).startsWith(brandKey(OWN_VENDOR));
}

const env = (k: string) => (process.env[k] || '').trim();
const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (set: any) => Number(set?.shopMoney?.amount) || 0;

class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

// ---------- Shopify ----------

function storeDomain(): string {
    const d = env('SHOPIFY_STORE_DOMAIN').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d) throw new HttpError(501, 'Shopify is not connected yet (SHOPIFY_STORE_DOMAIN is not set).');
    return d;
}

async function shopifyToken(domain: string): Promise<string> {
    const legacy = env('SHOPIFY_ADMIN_TOKEN');
    if (legacy) return legacy;
    const id = env('SHOPIFY_CLIENT_ID');
    const secret = env('SHOPIFY_CLIENT_SECRET');
    if (!id || !secret) throw new HttpError(501, 'Shopify is not connected yet (no app credentials set).');
    // Client-credentials grant: for an app installed on a store in the same
    // organization. Tokens last ~24h, so just fetch one per sync.
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
        throw new HttpError(502, `Shopify rejected the app credentials (${res.status}${body.error ? `: ${body.error_description || body.error}` : ''}).`);
    }
    return body.access_token;
}

function shopifyClient(domain: string, token: string) {
    return async function gql(query: string, variables: Record<string, any> = {}): Promise<any> {
        for (let attempt = 0; attempt < 6; attempt++) {
            const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
                body: JSON.stringify({ query, variables }),
            });
            if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
            const body = await res.json().catch(() => ({}));
            if (res.status === 401 || res.status === 403) {
                throw new HttpError(502, 'Shopify refused access — check the app is installed and has read_orders, read_products and read_inventory.');
            }
            if (!res.ok) throw new HttpError(502, `Shopify API error ${res.status}.`);
            const errs = body.errors || [];
            if (errs.some((e: any) => e?.extensions?.code === 'THROTTLED')) { await sleep(1000 * (attempt + 1)); continue; }
            if (errs.length) {
                const denied = errs.find((e: any) => e?.extensions?.code === 'ACCESS_DENIED');
                throw new HttpError(502, denied
                    ? `Shopify app is missing a permission: ${denied.message}`
                    : `Shopify API error: ${errs.map((e: any) => e.message).join('; ')}`);
            }
            return body.data;
        }
        throw new HttpError(503, 'Shopify is rate-limiting requests — try again in a minute.');
    };
}
type Gql = ReturnType<typeof shopifyClient>;

const ORDERS_QUERY = `
query Orders($cursor: String, $q: String) {
  orders(first: 20, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      cancelledAt
      displayFinancialStatus
      lineItems(first: 40) {
        nodes {
          name
          title
          variantTitle
          sku
          vendor
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          discountAllocations { allocatedAmountSet { shopMoney { amount } } }
        }
      }
    }
  }
}`;

const INVENTORY_QUERY = `
query Stock($cursor: String, $q: String) {
  products(first: 15, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title
      vendor
      variants(first: 50) {
        nodes { title sku inventoryQuantity inventoryItem { tracked } }
      }
    }
  }
}`;

/** YYYY-MM-DD of an ISO timestamp in the store's timezone (matches the CSV's local "Created at"). */
function localDate(iso: string, tz: string): string {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    } catch {
        return iso.slice(0, 10);
    }
}

async function fetchOrders(gql: Gql, days: number, tz: string) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const q = `created_at:>='${since}'`;
    const lines: any[] = [];
    const orderNames = new Set<string>();
    let skipped = 0;
    let cursor: string | null = null;
    for (;;) {
        const data = await gql(ORDERS_QUERY, { cursor, q });
        const page = data.orders;
        for (const o of page.nodes) {
            orderNames.add(o.name);
            const seen: Record<string, number> = {};
            for (const li of o.lineItems.nodes) {
                if (!isOwnBrand(li.vendor, li.title || li.name)) { skipped++; continue; }
                const lineName = li.name || [li.title, li.variantTitle].filter(Boolean).join(' - ');
                const sku = li.sku || '';
                // Same key scheme as parseOrdersCsv, so a line imported from CSV
                // and later synced is one row, not two.
                const base = `${o.name}|${lineName}|${sku}`;
                seen[base] = (seen[base] || 0) + 1;
                const discount = (li.discountAllocations || []).reduce((s: number, d: any) => s + money(d.allocatedAmountSet), 0);
                lines.push({
                    lineKey: `${base}|${seen[base]}`,
                    orderName: o.name,
                    orderDate: localDate(o.createdAt, tz),
                    productTitle: li.title || lineName,
                    variantTitle: li.variantTitle || '',
                    lineName,
                    sku,
                    quantity: Math.round(Number(li.quantity) || 0),
                    unitPrice: money(li.originalUnitPriceSet),
                    discount: Math.round(discount * 100) / 100,
                    financialStatus: String(o.displayFinancialStatus || '').toLowerCase(),
                    vendor: li.vendor || '',
                    cancelled: !!o.cancelledAt,
                });
            }
        }
        if (!page.pageInfo.hasNextPage) break;
        cursor = page.pageInfo.endCursor;
    }
    return { lines, orderNames, skipped };
}

async function fetchInventory(gql: Gql) {
    const totals = new Map<string, { name: string; sku: string; available: number; vendor: string }>();
    let cursor: string | null = null;
    for (;;) {
        const data = await gql(INVENTORY_QUERY, { cursor, q: `vendor:"${OWN_VENDOR}"` });
        const page = data.products;
        for (const p of page.nodes) {
            if (!isOwnBrand(p.vendor, p.title)) continue;
            for (const v of p.variants.nodes) {
                if (v.inventoryItem && v.inventoryItem.tracked === false) continue;
                // Same "Title - Opt1 / Opt2" name the CSV parser builds.
                const name = !v.title || v.title === 'Default Title' ? p.title : `${p.title} - ${v.title}`;
                const sku = v.sku || '';
                const key = `${name}|${sku}`;
                const qty = Math.max(0, Math.round(Number(v.inventoryQuantity) || 0));
                const prev = totals.get(key);
                if (prev) prev.available += qty;
                else totals.set(key, { name, sku, available: qty, vendor: p.vendor || '' });
            }
        }
        if (!page.pageInfo.hasNextPage) break;
        cursor = page.pageInfo.endCursor;
    }
    return { importedAt: new Date().toISOString(), source: 'shopify-api', rows: [...totals.values()] };
}

// ---------- Supabase ----------

function decodeJwtPart(jwt: string): string {
    try { return atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

function adminClient(): SupabaseClient {
    const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new HttpError(501, 'Server is missing SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL.');
    // Name the key's format (never its value) so a wrong paste is easy to spot.
    if (key.startsWith('sb_publishable_') || /^eyJ/.test(key) && /"role"\s*:\s*"anon"/.test(decodeJwtPart(key))) {
        throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY in Vercel is the public (anon/publishable) key — use the service_role or secret key instead.');
    }
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Every existing synced/imported line for these orders (paged past the 1000-row cap). */
async function existingLines(db: SupabaseClient, userId: string, orderNames: string[]) {
    const out: { id: number; lineKey: string; orderName: string }[] = [];
    for (let i = 0; i < orderNames.length; i += 100) {
        const chunk = orderNames.slice(i, i + 100);
        for (let from = 0; ; from += 1000) {
            const { data, error } = await db.from('sales')
                .select('id,lineKey,orderName')
                .eq('user_id', userId)
                .in('orderName', chunk)
                .range(from, from + 999);
            if (error) throw new HttpError(500, `Could not read sales: ${error.message}`);
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
    }
    return out;
}

/**
 * Shopify is the source of truth for every order in the sync window: its lines
 * are upserted (keeping the id of a matching CSV-imported line) and any older
 * row for those orders that Shopify no longer reports is removed.
 */
async function saveLines(db: SupabaseClient, userId: string, lines: any[], orderNames: Set<string>) {
    const existing = await existingLines(db, userId, [...orderNames]);
    const idByKey = new Map(existing.filter((r) => r.lineKey).map((r) => [r.lineKey, Number(r.id)]));
    const importedAt = new Date().toISOString();
    let nextId = Date.now() * 1000; // same id scheme as mergeSales
    let added = 0;
    let updated = 0;
    const rows = lines.map((l) => {
        const id = idByKey.get(l.lineKey);
        if (id) updated++; else added++;
        return { ...l, id: id ?? nextId++, user_id: userId, importedAt };
    });
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('sales').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
        if (error) throw new HttpError(500, `Could not save sales: ${error.message}`);
    }
    const keep = new Set(lines.map((l) => l.lineKey));
    const stale = existing.filter((r) => r.lineKey && !keep.has(r.lineKey)).map((r) => Number(r.id));
    for (let i = 0; i < stale.length; i += 200) {
        const { error } = await db.from('sales').delete().eq('user_id', userId).in('id', stale.slice(i, i + 200));
        if (error) throw new HttpError(500, `Could not remove outdated lines: ${error.message}`);
    }
    return { added, updated, removed: stale.length };
}

// ---------- Auth ----------

async function authorize(req: Request, db: SupabaseClient, viaCron: boolean): Promise<string> {
    const owner = env('OWNER_USER_ID');
    if (!owner) throw new HttpError(501, 'Server is missing OWNER_USER_ID.');
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!bearer) throw new HttpError(401, 'Not signed in.');
    if (viaCron) {
        const secret = env('CRON_SECRET');
        if (!secret || bearer !== secret) throw new HttpError(401, 'Unauthorized.');
        return owner;
    }
    // Verify the sign-in with the public key (the same one the app uses), so a
    // bad service key shows up later as its own clear error instead of here.
    const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
    const publicKey = env('VITE_SUPABASE_ANON_KEY');
    const verifier = publicKey ? createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }) : db;
    const { data, error } = await verifier.auth.getUser(bearer);
    if (error || !data?.user) {
        console.error('getUser failed:', error?.status, error?.message);
        throw new HttpError(401, `Couldn't confirm your sign-in with Supabase (${error?.message || 'no user'}). Try signing out and back in.`);
    }
    if (data.user.id !== owner) throw new HttpError(403, 'Only the shop owner can sync Shopify.');
    return owner;
}

// ---------- Handler ----------

async function run(req: Request, viaCron: boolean): Promise<Response> {
    const started = new Date().toISOString();
    let db: SupabaseClient | null = null;
    let userId = '';
    try {
        db = adminClient();
        userId = await authorize(req, db, viaCron);

        let days = DEFAULT_DAYS;
        if (!viaCron) {
            const body = await req.json().catch(() => ({}));
            if (Number(body?.days) > 0) days = Math.min(3650, Math.round(Number(body.days)));
        }

        const domain = storeDomain();
        const gql = shopifyClient(domain, await shopifyToken(domain));
        const shop = (await gql('{ shop { ianaTimezone } }')).shop;
        const tz = shop?.ianaTimezone || 'America/New_York';

        const [orders, inventory] = await Promise.all([fetchOrders(gql, days, tz), fetchInventory(gql)]);
        const saved = await saveLines(db, userId, orders.lines, orders.orderNames);

        const result = {
            ok: true,
            syncedAt: new Date().toISOString(),
            trigger: viaCron ? 'daily' : 'manual',
            days,
            orders: orders.orderNames.size,
            lines: orders.lines.length,
            skipped: orders.skipped,
            ...saved,
            variants: inventory.rows.length,
            available: inventory.rows.reduce((s, r) => s + r.available, 0),
        };
        const { error } = await db.from('shopify_sync').upsert(
            { user_id: userId, inventory, last_sync_at: result.syncedAt, last_result: result },
            { onConflict: 'user_id' }
        );
        if (error) throw new HttpError(500, `Orders saved, but stock levels could not be (run sql/shopify-sync.sql): ${error.message}`);
        return json(result);
    } catch (err: any) {
        const status = err instanceof HttpError ? err.status : 500;
        const message = err?.message || String(err);
        console.error('shopify-sync failed:', message);
        // Record the failure so the app can show it (best effort).
        if (db && userId) {
            await db.from('shopify_sync').upsert(
                { user_id: userId, last_result: { ok: false, error: message, at: started, trigger: viaCron ? 'daily' : 'manual' } },
                { onConflict: 'user_id' }
            ).then(() => {}, () => {});
        }
        return json({ ok: false, error: message }, status);
    }
}

export function GET(req: Request) { return run(req, true); }
export function POST(req: Request) { return run(req, false); }
