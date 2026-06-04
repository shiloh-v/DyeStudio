import { useEffect, useRef, useState } from 'react';

// Promise-based replacements for the native confirm()/prompt() dialogs.
//   if (await confirmDialog({ message: 'Delete this?' })) { ... }
//   const name = await promptDialog({ message: 'Name?', defaultValue: 'x' });
// Backed by a single <DialogHost/> mounted at the app root. Requests queue so
// overlapping calls each get their own dialog in turn.

export interface ChoiceButton {
    label: string;
    value: string;
    danger?: boolean;
    primary?: boolean;
}

interface DialogRequest {
    id: number;
    kind: 'confirm' | 'prompt' | 'choice';
    title?: string;
    message: string;
    confirmText: string;
    cancelText: string;
    danger: boolean;
    defaultValue: string;
    inputType: string;
    buttons: ChoiceButton[];
    resolve: (value: boolean | string | null) => void;
}

let queue: DialogRequest[] = [];
let listeners: Array<(req: DialogRequest | null) => void> = [];
let nextId = 1;

function current(): DialogRequest | null {
    return queue[0] || null;
}

function emit() {
    const c = current();
    listeners.forEach((l) => l(c));
}

function settle(value: boolean | string | null) {
    const c = queue[0];
    if (!c) return;
    c.resolve(value);
    queue = queue.slice(1);
    emit();
}

export interface ConfirmOptions {
    message: string;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        queue.push({
            id: nextId++,
            kind: 'confirm',
            title: opts.title,
            message: opts.message,
            confirmText: opts.confirmText ?? 'OK',
            cancelText: opts.cancelText ?? 'Cancel',
            danger: opts.danger ?? false,
            defaultValue: '',
            inputType: 'text',
            buttons: [],
            resolve: (v) => resolve(v === true),
        });
        emit();
    });
}

export interface PromptOptions {
    message: string;
    title?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    inputType?: string;
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        queue.push({
            id: nextId++,
            kind: 'prompt',
            title: opts.title,
            message: opts.message,
            confirmText: opts.confirmText ?? 'OK',
            cancelText: opts.cancelText ?? 'Cancel',
            danger: false,
            defaultValue: opts.defaultValue ?? '',
            inputType: opts.inputType ?? 'text',
            buttons: [],
            resolve: (v) => resolve(typeof v === 'string' ? v : null),
        });
        emit();
    });
}

export interface ChoiceOptions {
    message: string;
    title?: string;
    buttons: ChoiceButton[];
}

// Multi-button dialog. Resolves to the chosen button's `value`, or null if the
// user dismisses via Escape / click-outside.
export function choiceDialog(opts: ChoiceOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        queue.push({
            id: nextId++,
            kind: 'choice',
            title: opts.title,
            message: opts.message,
            confirmText: 'OK',
            cancelText: 'Cancel',
            danger: false,
            defaultValue: '',
            inputType: 'text',
            buttons: opts.buttons,
            resolve: (v) => resolve(typeof v === 'string' ? v : null),
        });
        emit();
    });
}

export function DialogHost() {
    const [req, setReq] = useState<DialogRequest | null>(current());
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        listeners.push(setReq);
        return () => {
            listeners = listeners.filter((l) => l !== setReq);
        };
    }, []);

    useEffect(() => {
        if (req) {
            setText(req.defaultValue);
            // focus after paint
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [req?.id]);

    if (!req) return null;

    const onConfirm = () => settle(req.kind === 'prompt' ? text : true);
    const onCancel = () => settle(req.kind === 'prompt' ? null : false);

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
            onClick={onCancel}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel();
            }}
        >
            <div
                className="bg-white rounded-lg card-shadow p-6 max-w-sm w-full"
                onClick={(e) => e.stopPropagation()}
            >
                {req.title && <h3 className="text-lg font-semibold mb-2">{req.title}</h3>}
                <p className="text-sm text-gray-700 mb-4 whitespace-pre-line">{req.message}</p>

                {req.kind === 'prompt' && (
                    <input
                        ref={inputRef}
                        type={req.inputType}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onConfirm();
                        }}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 mb-4"
                    />
                )}

                {req.kind === 'choice' ? (
                    <div className="flex flex-wrap justify-end gap-2">
                        {req.buttons.map((b) => (
                            <button
                                key={b.value}
                                type="button"
                                ref={(el) => { if (b.primary) el?.focus(); }}
                                onClick={() => settle(b.value)}
                                className={`${
                                    b.primary
                                        ? 'bg-teal-600 hover:bg-teal-700 text-white'
                                        : b.danger
                                        ? 'bg-red-600 hover:bg-red-700 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                } px-4 py-2 rounded-lg transition-colors font-medium`}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                        >
                            {req.cancelText}
                        </button>
                        <button
                            type="button"
                            ref={(el) => { if (req.kind === 'confirm') el?.focus(); }}
                            onClick={onConfirm}
                            className={`${
                                req.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
                            } text-white px-4 py-2 rounded-lg transition-colors font-medium`}
                        >
                            {req.confirmText}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
