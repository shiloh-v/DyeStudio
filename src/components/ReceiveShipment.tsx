import { useMemo, useState } from 'react';
import { toast } from '../lib/toast';
import type { InventoryItem } from '../types';

// Grams per unit, for converting dye amounts to ounces (how dyes are tracked).
const UNIT_TO_GRAM: Record<string, number> = { g: 1, oz: 28.3495, lb: 453.592, kg: 1000, ml: 1, L: 1000, tsp: 5, tbsp: 15 };
const toOunces = (qty: any, unit: string) => ((parseFloat(String(qty)) || 0) * (UNIT_TO_GRAM[unit] || 1)) / 28.3495;

// Yarn first (what shipments usually are), then everything else.
const CATEGORY_ORDER = ['yarn base', 'dye', 'ball band', 'chemical', 'tool', 'other'];

type Line = { key: number; itemId: string; qty: string };
let lineKey = 0;
const blank = (): Line => ({ key: ++lineKey, itemId: '', qty: '' });

// Current amount and display unit. Dyes are always shown in oz, like the table.
function current(item: InventoryItem) {
    if (item.category === 'dye') return { amount: Number(toOunces(item.quantity, item.unit || 'g').toFixed(2)), unit: 'oz' };
    return { amount: parseFloat(String(item.quantity)) || 0, unit: item.unit || '' };
}

/**
 * Log a delivery: pick existing items and how many arrived; each amount is
 * ADDED to what's on hand instead of replacing it.
 */
export function ReceiveShipment({ inventory, saveInventory, onClose }) {
    const [lines, setLines] = useState<Line[]>([blank()]);
    const [saving, setSaving] = useState(false);

    const groups = useMemo(() => {
        const byCat = new Map<string, InventoryItem[]>();
        for (const i of inventory as InventoryItem[]) {
            const cat = i.category || 'other';
            if (!byCat.has(cat)) byCat.set(cat, []);
            byCat.get(cat)!.push(i);
        }
        const rank = (c: string) => { const r = CATEGORY_ORDER.indexOf(c); return r < 0 ? CATEGORY_ORDER.length : r; };
        return [...byCat.entries()]
            .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
            .map(([cat, items]) => [cat, [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))] as const);
    }, [inventory]);

    const byId = useMemo(() => new Map((inventory as InventoryItem[]).map((i) => [String(i.id), i])), [inventory]);

    // Total being added per item (the same item can appear on several lines).
    const adds = useMemo(() => {
        const m = new Map<string, number>();
        for (const l of lines) {
            const n = parseFloat(l.qty);
            if (!l.itemId || !(n > 0)) continue;
            m.set(l.itemId, (m.get(l.itemId) || 0) + n);
        }
        return m;
    }, [lines]);

    const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const remove = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [blank()]));

    const save = async () => {
        if (adds.size === 0) return;
        setSaving(true);
        const next = (inventory as InventoryItem[]).map((i) => {
            const add = adds.get(String(i.id));
            if (!add) return i;
            if (i.category === 'dye') {
                return { ...i, quantity: Number((toOunces(i.quantity, i.unit || 'g') + add).toFixed(2)), unit: 'oz' };
            }
            return { ...i, quantity: Number(((parseFloat(String(i.quantity)) || 0) + add).toFixed(2)) };
        });
        const ok = await saveInventory(next);
        setSaving(false);
        if (ok === false) {
            toast('Could not save the shipment — nothing was added. Try again.', 'error', 6000);
            return;
        }
        toast(`Shipment added to ${adds.size} item${adds.size === 1 ? '' : 's'}`, 'success');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg card-shadow max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
                    <h3 className="text-xl font-semibold">📦 Receive shipment</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl bg-transparent">✕</button>
                </div>
                <div className="p-4 sm:p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                        Pick each item that arrived and how many. The amount is <strong>added</strong> to what you already have.
                        New yarn bases or sizes need to be created with + Add Item first.
                    </p>

                    <div className="space-y-3">
                        {lines.map((l) => {
                            const item = l.itemId ? byId.get(l.itemId) : undefined;
                            const cur = item ? current(item) : null;
                            const total = item ? adds.get(l.itemId) || 0 : 0;
                            return (
                                <div key={l.key} className="border rounded-lg p-3 space-y-2">
                                    <div className="flex gap-2 items-center">
                                        <select
                                            value={l.itemId}
                                            onChange={(e) => update(l.key, { itemId: e.target.value })}
                                            className="flex-1 min-w-0 px-2 py-2 border rounded-lg"
                                        >
                                            <option value="">Choose an item…</option>
                                            {groups.map(([cat, items]) => (
                                                <optgroup key={cat} label={cat}>
                                                    {items.map((i) => (
                                                        <option key={i.id} value={String(i.id)}>{i.name || '(unnamed)'}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            inputMode="decimal"
                                            value={l.qty}
                                            onChange={(e) => update(l.key, { qty: e.target.value })}
                                            placeholder="+ qty"
                                            className="w-24 px-2 py-2 border rounded-lg text-center"
                                        />
                                        <button type="button" onClick={() => remove(l.key)} className="text-gray-400 hover:text-red-600 bg-transparent px-1" title="Remove line">✕</button>
                                    </div>
                                    {cur && (
                                        <p className="text-xs text-gray-600">
                                            On hand {cur.amount} {cur.unit}
                                            {total > 0 && <> → <strong className="text-teal-700">{Number((cur.amount + total).toFixed(2))} {cur.unit}</strong></>}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="text-teal-700 hover:text-teal-900 bg-transparent font-medium text-sm">
                        + Another item
                    </button>

                    <div className="flex gap-3 pt-2 border-t">
                        <button
                            type="button"
                            onClick={save}
                            disabled={adds.size === 0 || saving}
                            className="flex-1 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 font-medium disabled:opacity-50"
                        >
                            {saving ? 'Saving…' : adds.size === 0 ? 'Add to inventory' : `Add to ${adds.size} item${adds.size === 1 ? '' : 's'}`}
                        </button>
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
