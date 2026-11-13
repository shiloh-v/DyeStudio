// Printable packing slip for a delivery of finished yarn. You tick the batches
// going out in the Pipeline; the slip lists one line per Shopify variant
// (colorway + base + size) with the SKU and listing name when the uploaded
// Shopify stock file knows them, so whoever receives it can add the counts to
// Shopify line by line. Opens as its own page so the browser's Print works.

import type { Batch } from '../types';
import { currentColorName } from './recipeMatch';
import { canonicalYarnRef } from './yarnMatch';
import { sizeName } from './sizes';
import { DateUtils } from './dates';
import { comboKey, makeContext, resolveName } from './demand';
import { isOwnBrand } from './shopify';
import { showPrintPage } from './printView';

export interface SlipLine {
    colorway: string;
    base: string;
    hankSize: number;
    qty: number;
    batchIds: string[];
    sku: string;
    listing: string;
}

export interface PackingSlip {
    lines: SlipLine[];
    totals: { base: string; hankSize: number; qty: number }[];
    skeins: number;
    batchIds: string[];
}

const int = (v: any) => parseInt(v) || 0;

/** Shopify listing name + SKU per colorway/base/size, from the uploaded stock file. */
function shopifyIndex(recipes: any[], settings: any) {
    const index = new Map<string, { sku: string; listing: string }>();
    const rows = settings?.shopifyInventory?.rows || [];
    if (!rows.length) return index;
    const ctx = makeContext(recipes, [], settings);
    for (const row of rows) {
        if (!isOwnBrand(row.vendor, row.name)) continue;
        const r = resolveName(row.name, ctx);
        if (r.kind !== 'colorway' || !r.colorway) continue;
        const k = comboKey(r.colorway, r.base || '', r.hankSize || 0).toLowerCase();
        const prev = index.get(k);
        // Prefer a row that has a SKU when the same variant shows up twice.
        if (!prev || (!prev.sku && row.sku)) index.set(k, { sku: row.sku || '', listing: row.name });
    }
    return index;
}

export function buildPackingSlip(batches: Batch[], recipes: any[], settings: any): PackingSlip {
    const catalog = settings?.yarnBases || [];
    const index = shopifyIndex(recipes, settings);
    const map = new Map<string, SlipLine>();
    const batchIds: string[] = [];

    for (const b of batches) {
        const colorway = currentColorName(b, recipes) || b.colorway || 'Unnamed colorway';
        const id = String(b.batchId || '').trim();
        if (id) batchIds.push(id);
        const yarns = (b.yarnDetails || []).filter((y) => int(y.quantity) > 0);
        // Older hand-entered batches have a skein count but no yarn details.
        const rows = yarns.length
            ? yarns.map((y) => ({ base: canonicalYarnRef(y.base, catalog) || String(y.base || ''), hankSize: int(y.hankSize), qty: int(y.quantity) }))
            : int(b.skeins) > 0 ? [{ base: '', hankSize: 0, qty: int(b.skeins) }] : [];
        for (const y of rows) {
            const k = comboKey(colorway, y.base, y.hankSize).toLowerCase();
            const line = map.get(k) || { colorway, base: y.base, hankSize: y.hankSize, qty: 0, batchIds: [], sku: '', listing: '', ...index.get(k) };
            line.qty += y.qty;
            if (id && !line.batchIds.includes(id)) line.batchIds.push(id);
            map.set(k, line);
        }
    }

    const lines = [...map.values()].sort((a, b) =>
        a.colorway.localeCompare(b.colorway) || a.base.localeCompare(b.base) || b.hankSize - a.hankSize);

    const t = new Map<string, { base: string; hankSize: number; qty: number }>();
    for (const l of lines) {
        const k = `${l.base.toLowerCase()}|${l.hankSize}`;
        const row = t.get(k) || { base: l.base, hankSize: l.hankSize, qty: 0 };
        row.qty += l.qty;
        t.set(k, row);
    }
    const totals = [...t.values()].sort((a, b) => a.base.localeCompare(b.base) || b.hankSize - a.hankSize);
    return { lines, totals, skeins: lines.reduce((s, l) => s + l.qty, 0), batchIds };
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function sizeText(hankSize: number, settings: any) {
    if (!hankSize) return '';
    const name = sizeName(hankSize, settings);
    return name ? `${hankSize}g · ${name}` : `${hankSize}g`;
}

/** Standalone, print-ready HTML page for a packing slip. */
export function packingSlipHtml(slip: PackingSlip, settings: any, today = DateUtils.getTodayEST()): string {
    const showSku = slip.lines.some((l) => l.sku);
    const showListing = slip.lines.some((l) => l.listing);
    const colorways = new Set(slip.lines.map((l) => l.colorway)).size;
    const summary = `${slip.skeins} skein${slip.skeins === 1 ? '' : 's'} · ${colorways} colorway${colorways === 1 ? '' : 's'}`;
    const brand = 'Celestial Dyeworks';

    const rows = slip.lines.map((l) => `
        <tr><td class="chk"><span class="box"></span></td>
        <td><div class="cw">${esc(l.colorway)}</div>${showListing ? `<div class="sub">${l.listing ? esc(l.listing) : '<em>Not found in Shopify stock file</em>'}</div>` : ''}</td>
        <td>${esc(l.base || '—')}</td><td class="nw">${esc(sizeText(l.hankSize, settings) || '—')}</td>
        ${showSku ? `<td class="mono">${esc(l.sku || '—')}</td>` : ''}
        <td class="r num q">${l.qty}</td><td class="recv"><span class="line"></span></td></tr>`).join('');

    const totalRows = slip.totals.map((t) => `
        <tr><td>${esc(t.base || 'Base not recorded')}${t.hankSize ? ` ${esc(sizeText(t.hankSize, settings))}` : ''}</td><td class="r num">${t.qty}</td></tr>`).join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Packing slip · ${esc(DateUtils.formatDate(today))}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1c2626; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.page { max-width: 860px; margin: 0 auto; padding: 24px 16px 40px; display: grid; gap: 20px; }
.bar { display: flex; justify-content: flex-end; }
.bar button { background: #0f766e; color: #fff; border: 0; border-radius: 6px; padding: 8px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 6px 24px; border-bottom: 2px solid #1c2626; padding-bottom: 8px; }
h1 { font-size: 26px; margin: 0; line-height: 1.1; }
h2 { font-size: 15px; margin: 0 0 6px; }
.meta { color: #5d6e6c; text-align: right; }
.meta strong { color: #1c2626; }
.label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: #5d6e6c; font-weight: 600; }
.box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #1c2626; border-radius: 2px; }
.num { font-variant-numeric: tabular-nums; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #cfdcda; vertical-align: top; }
th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: #5d6e6c; white-space: nowrap; }
.r { text-align: right; } .nw { white-space: nowrap; }
td.chk { width: 26px; padding-top: 8px; }
.cw { font-weight: 600; }
.sub { color: #5d6e6c; font-size: 11.5px; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; white-space: nowrap; }
td.q { font-weight: 700; font-size: 15px; }
td.recv { width: 90px; }
.line { display: block; border-bottom: 1.5px solid #1c2626; height: 18px; }
tr.sum td { border-bottom: 0; font-weight: 700; }
.foot { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 20px; align-items: start; }
@media (max-width: 600px) { .foot { grid-template-columns: 1fr; } }
.sign { display: grid; gap: 18px; }
.sign div { display: grid; grid-template-columns: 124px 1fr; align-items: end; gap: 8px; }
.sign span.l { border-bottom: 1px solid #1c2626; height: 20px; }
.notes { border: 1px solid #cfdcda; border-radius: 6px; min-height: 80px; padding: 6px 10px; }
.batches { color: #5d6e6c; font-size: 11.5px; }
@media print {
  @page { size: letter; margin: 0.45in; }
  .bar { display: none; }
  .page { padding: 0; max-width: none; gap: 14px; }
  body { font-size: 11.5px; }
  h1 { font-size: 22px; }
  th, td { padding: 4px 8px; }
  tr { break-inside: avoid; }
}
</style></head>
<body><div class="page">
<div class="bar"><button type="button" onclick="window.print()">Print</button></div>
<header><div><div class="label">${esc(brand)} · Packing slip</div><h1>Yarn delivery</h1></div>
<div class="meta"><strong>${esc(DateUtils.formatDate(today))}</strong><br>${esc(summary)}</div></header>
<section class="wrap"><h2>In this delivery</h2>
<table><thead><tr><th></th><th>Colorway${showListing ? ' · Shopify listing' : ''}</th><th>Base</th><th>Size</th>${showSku ? '<th>SKU</th>' : ''}<th class="r">Qty</th><th>Received</th></tr></thead>
<tbody>${rows}
<tr class="sum"><td></td><td colspan="${showSku ? 4 : 3}">Total skeins</td><td class="r num">${slip.skeins}</td><td></td></tr></tbody></table>
</section>
<section class="foot">
<div class="wrap"><h2>By base</h2><table><tbody>${totalRows}</tbody></table>
${slip.batchIds.length ? `<p class="batches">Batches: ${esc(slip.batchIds.join(', '))}</p>` : ''}</div>
<div class="sign"><h2>Notes</h2><div class="notes"></div>
<div><span>Delivered by</span><span class="l"></span></div>
<div><span>Received by</span><span class="l"></span></div>
<div><span>Date</span><span class="l"></span></div>
<div><span>Added to Shopify</span><span class="l"></span></div></div>
</section>
</div></body></html>`;
}

/** Show the slip full-screen in the app, with Print. */
export function openPackingSlip(batches: Batch[], recipes: any[], settings: any): boolean {
    const html = packingSlipHtml(buildPackingSlip(batches, recipes, settings), settings);
    return showPrintPage(html);
}
