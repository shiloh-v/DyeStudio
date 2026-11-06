// Printable yarn pull list for a dye session: what to take off the shelf (totals
// per base + size) and what to bundle into each pan. Opens as its own page so
// the browser's Print works on it directly.

import { currentColorName } from './recipeMatch';
import { canonicalYarnRef } from './yarnMatch';
import { DateUtils } from './dates';

export interface PullLine { base: string; hankSize: number; qty: number }
export interface PullPan { num: number; label: string; lines: PullLine[]; detail?: string }
export interface PullGroup { name: string; pans: PullPan[]; tray?: boolean }
export interface PullTotal extends PullLine { pans: number[] }

export interface PullList {
    groups: PullGroup[];
    totals: PullTotal[];
    skeins: number;
    grams: number;
}

const int = (v: any) => parseInt(v) || 0;

/** Turn a session's pans into pan-by-pan bundles plus shelf totals. */
export function buildPullList(session: any, recipes: any[], sketches: any[] = [], catalog: any[] = []): PullList {
    const yarn = (base: any) => canonicalYarnRef(base, catalog) || String(base || '');
    const groups: PullGroup[] = [];
    let lastKey: string | null = null;

    (session?.pans || []).forEach((pan: any, idx: number) => {
        const num = idx + 1;
        let name: string;
        let key: string | null = null;
        let lines: PullLine[];
        let detail: string | undefined;
        let tray = false;

        if (pan.type === 'gradientTray') {
            tray = true;
            name = `Gradient tray · ${pan.gradientDye || 'dye not set'}`;
            const depths = Array.isArray(pan.depths) ? pan.depths : [];
            lines = [{ base: yarn(pan.gradientYarnBase), hankSize: int(pan.gradientHankSize), qty: depths.length || 10 }];
            if (depths.length) detail = `Depths: ${depths.join(' · ')}`;
        } else if (pan.type === 'dyeSquareTray') {
            tray = true;
            name = `Dye square tray · ${[pan.squareColorA, pan.squareColorB].filter(Boolean).join(' × ') || 'dyes not set'}`;
            lines = [{ base: yarn(pan.gradientYarnBase), hankSize: int(pan.gradientHankSize), qty: 25 }];
        } else {
            name = currentColorName(pan, recipes, sketches) || (pan.type === 'adHoc' ? 'Ad hoc' : 'Pan');
            if (pan.type === 'pan') key = `pan|${pan.recipeId ?? ''}|${name}`;
            else if (pan.type === 'colorLab') key = `cl|${pan.colorSketchId ?? name}`;
            lines = (pan.yarns || [])
                .filter((y: any) => y?.base && int(y.quantity) > 0)
                .map((y: any) => ({ base: yarn(y.base), hankSize: int(y.hankSize), qty: int(y.quantity) }));
        }

        const p: PullPan = { num, label: tray ? 'Tray' : `Pan ${num}`, lines, detail };
        const prev = groups[groups.length - 1];
        // Same color back to back (a pair) shares one card, like the Queue.
        if (key && key === lastKey && prev) prev.pans.push(p);
        else groups.push({ name, pans: [p], tray });
        lastKey = key;
    });

    const map = new Map<string, PullTotal>();
    for (const g of groups) for (const p of g.pans) for (const l of p.lines) {
        const k = `${l.base.toLowerCase()}|${l.hankSize}`;
        const t = map.get(k) || { base: l.base, hankSize: l.hankSize, qty: 0, pans: [] };
        t.qty += l.qty;
        if (!t.pans.includes(p.num)) t.pans.push(p.num);
        map.set(k, t);
    }
    const totals = [...map.values()].sort((a, b) => a.base.localeCompare(b.base) || b.hankSize - a.hankSize);
    return {
        groups,
        totals,
        skeins: totals.reduce((s, t) => s + t.qty, 0),
        grams: totals.reduce((s, t) => s + t.qty * t.hankSize, 0),
    };
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const g = (n: number) => `${n.toLocaleString()}g`;

function panRange(nums: number[]): string {
    if (nums.length === 1) return `Pan ${nums[0]}`;
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    return contiguous ? `Pans ${nums[0]}–${nums[nums.length - 1]}` : `Pans ${nums.join(', ')}`;
}

/** Standalone, print-ready HTML page for a session's pull list. */
export function pullListHtml(session: any, list: PullList): string {
    const date = session?.date ? DateUtils.formatDate(session.date) : 'No date set';
    const panCount = (session?.pans || []).filter((p: any) => p.type !== 'gradientTray' && p.type !== 'dyeSquareTray').length;
    const trayCount = (session?.pans || []).length - panCount;
    const summary = [`${panCount} pan${panCount === 1 ? '' : 's'}`, trayCount ? `${trayCount} tray${trayCount === 1 ? '' : 's'}` : '', `${g(list.grams)} undyed`]
        .filter(Boolean).join(' · ');

    const totalRows = list.totals.map((t) => `
        <tr><td class="chk"><span class="box"></span></td><td>${esc(t.base)} ${t.hankSize}g</td>
        <td class="r num">${t.qty}</td><td class="r num">${g(t.qty * t.hankSize)}</td>
        <td class="to">${esc(t.pans.length === 1 ? `Pan ${t.pans[0]}` : `Pans ${t.pans.join(', ')}`)}</td></tr>`).join('');

    const cards = list.groups.map((grp) => {
        const nums = grp.pans.map((p) => p.num);
        const pans = grp.pans.map((p) => {
            const weight = p.lines.reduce((s, l) => s + l.qty * l.hankSize, 0);
            const lines = p.lines.length
                ? p.lines.map((l) => `<li><span class="box"></span><span class="q">${l.qty}×</span>${esc(l.base)} ${l.hankSize}g<span class="g">${g(l.qty * l.hankSize)}</span></li>`).join('')
                : '<li class="none">No yarn listed</li>';
            return `<div class="pan"><span class="tag">${esc(p.label)}</span><div><ul>${lines}</ul>
                ${p.lines.length > 1 ? `<div class="sub">${g(weight)} total</div>` : ''}
                ${p.detail ? `<div class="sub">${esc(p.detail)}</div>` : ''}</div></div>`;
        }).join('');
        return `<div class="card${grp.tray ? ' tray' : ''}"><div class="head"><span class="name">${esc(grp.name)}</span>
            <span class="label">${grp.tray ? `#${nums[0]}` : esc(panRange(nums))}</span></div>${pans}</div>`;
    }).join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(session?.name || 'Dye session')} · Yarn pull list</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1c2626; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.page { max-width: 820px; margin: 0 auto; padding: 24px 16px 40px; display: grid; gap: 20px; }
.bar { display: flex; justify-content: flex-end; }
.bar button { background: #0f766e; color: #fff; border: 0; border-radius: 6px; padding: 8px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 6px 24px; border-bottom: 2px solid #1c2626; padding-bottom: 8px; }
h1 { font-size: 26px; margin: 0; line-height: 1.1; }
h2 { font-size: 15px; margin: 0 0 6px; }
.meta { color: #5d6e6c; text-align: right; }
.meta strong { color: #1c2626; }
.label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: #5d6e6c; font-weight: 600; }
.box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #1c2626; border-radius: 2px; flex: none; }
.num, .q, .g { font-variant-numeric: tabular-nums; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #cfdcda; }
th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: #5d6e6c; }
.r { text-align: right; } td.chk { width: 26px; } td.to { color: #5d6e6c; }
tr.sum td { border-bottom: 0; font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 560px) { .cards { grid-template-columns: 1fr; } }
.card { border: 1px solid #cfdcda; border-radius: 6px; padding: 8px 12px 6px; break-inside: avoid; min-width: 0; }
.card.tray { background: #eef5f4; border-color: #eef5f4; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.name { font-weight: 650; font-size: 15px; }
.pan { display: grid; grid-template-columns: 50px 1fr; gap: 8px; padding: 5px 0; border-top: 1px dashed #cfdcda; }
.head + .pan { border-top: 0; }
.tag { font-weight: 600; color: #0f766e; font-size: 12px; padding-top: 1px; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
li { display: flex; align-items: center; gap: 8px; }
.q { font-weight: 600; min-width: 2.2em; }
.g { margin-left: auto; color: #5d6e6c; font-size: 11.5px; }
.sub { color: #5d6e6c; font-size: 11.5px; margin-top: 2px; }
.none { color: #5d6e6c; font-style: italic; }
.notes { min-height: 70px; }
@media print {
  @page { size: letter; margin: 0.45in; }
  .bar { display: none; }
  .page { padding: 0; max-width: none; gap: 12px; }
  body { font-size: 11.5px; }
  h1 { font-size: 21px; }
  .cards { grid-template-columns: 1fr 1fr; gap: 7px; }
  .card { padding: 6px 10px 4px; }
  .pan { padding: 3px 0; }
  th, td { padding: 3px 8px; }
  .card.tray { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style></head>
<body><div class="page">
<div class="bar"><button type="button" onclick="window.print()">Print</button></div>
<header><div><div class="label">Yarn pull list</div><h1>${esc(session?.name || 'Dye session')}</h1></div>
<div class="meta"><strong>${esc(date)}</strong><br>${esc(summary)}</div></header>
<section class="wrap"><h2>Pull from the shelf</h2>
<table><thead><tr><th></th><th>Base</th><th class="r">Skeins</th><th class="r">Weight</th><th>Goes to</th></tr></thead>
<tbody>${totalRows}<tr class="sum"><td></td><td>Total</td><td class="r num">${list.skeins}</td><td class="r num">${g(list.grams)}</td><td></td></tr></tbody></table>
</section>
<section><h2>Group by pan</h2><div class="cards">${cards}
<div class="card"><div class="head"><span class="name">Notes</span></div><div class="notes"></div></div>
</div></section>
</div></body></html>`;
}

/** Open the pull list in a new tab (call from a click so it isn't blocked). */
export function openPullList(session: any, recipes: any[], sketches: any[] = [], catalog: any[] = []): boolean {
    const html = pullListHtml(session, buildPullList(session, recipes, sketches, catalog));
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return !!w;
}
