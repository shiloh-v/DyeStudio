import { useEffect, useState } from 'react';

// Lightweight toast notifications. Imperative API (call toast() from anywhere,
// like the alert() it replaces) backed by a single <Toaster/> mounted at the
// app root — no context/provider wiring needed at call sites.

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
}

let items: ToastItem[] = [];
let listeners: Array<(items: ToastItem[]) => void> = [];
let nextId = 1;

function emit() {
    listeners.forEach((l) => l(items));
}

function dismiss(id: number) {
    items = items.filter((t) => t.id !== id);
    emit();
}

/** Show a toast. `toast('Saved!', 'success')`. Returns the toast id. */
export function toast(message: string, type: ToastType = 'info', durationMs = 3500): number {
    const id = nextId++;
    items = [...items, { id, message, type }];
    emit();
    if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
    }
    return id;
}

const STYLES: Record<ToastType, { bg: string; icon: string }> = {
    success: { bg: 'bg-teal-600', icon: '✓' },
    error: { bg: 'bg-red-600', icon: '⚠️' },
    info: { bg: 'bg-gray-800', icon: 'ℹ️' },
};

export function Toaster() {
    const [list, setList] = useState<ToastItem[]>(items);

    useEffect(() => {
        listeners.push(setList);
        return () => {
            listeners = listeners.filter((l) => l !== setList);
        };
    }, []);

    if (list.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80 pointer-events-none">
            {list.map((t) => {
                const s = STYLES[t.type];
                return (
                    <div
                        key={t.id}
                        onClick={() => dismiss(t.id)}
                        className={`${s.bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-2 cursor-pointer pointer-events-auto animate-[fadeIn_0.15s_ease-out]`}
                        role="status"
                    >
                        <span className="text-sm leading-5 flex-shrink-0">{s.icon}</span>
                        <span className="text-sm leading-5 flex-1 whitespace-pre-line">{t.message}</span>
                    </div>
                );
            })}
        </div>
    );
}
