import { useEffect, useState } from 'react';
import { fetchRecipeHistory, HISTORY_EVENT, type HistoryEntry } from '../lib/recipeHistory';

// A recipe's history log: dye-day + batch notes and every saved edit,
// newest first. Loads when shown and refreshes after anything is logged.
export function RecipeHistory({ recipeId }: { recipeId: number }) {
    const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'note' | 'edit'>('all');

    useEffect(() => {
        let active = true;
        const load = () => fetchRecipeHistory(recipeId)
            .then((e) => { if (active) { setEntries(e); setError(''); } })
            .catch((e) => { if (active) setError(String(e?.message || e)); });
        load();
        window.addEventListener(HISTORY_EVENT, load);
        return () => { active = false; window.removeEventListener(HISTORY_EVENT, load); };
    }, [recipeId]);

    if (error) {
        return (
            <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">
                History isn't set up yet — run <code>sql/recipe-history.sql</code> in Supabase.
                <span className="block text-amber-700/80 mt-1">({error})</span>
            </p>
        );
    }
    if (!entries) return <p className="text-xs text-gray-500">Loading history…</p>;

    const shown = entries.filter((e) => filter === 'all' || e.kind === filter || (filter === 'edit' && e.kind === 'created'));
    const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    return (
        <div>
            <div className="flex gap-1 mb-2">
                {(['all', 'note', 'edit'] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2 py-0.5 rounded text-xs ${filter === f ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        {f === 'all' ? 'All' : f === 'note' ? 'Notes' : 'Changes'}
                    </button>
                ))}
            </div>
            {shown.length === 0 && <p className="text-xs text-gray-500">Nothing logged yet.</p>}
            <ol className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {shown.map((e) => (
                    <li key={e.id} className={`border-l-2 pl-2 ${e.kind === 'note' ? 'border-amber-400' : 'border-teal-300'}`}>
                        <div className="flex justify-between gap-2 text-gray-500">
                            <span className="font-medium text-gray-700">
                                {e.kind === 'note' ? `📝 ${e.source_label || 'Note'}` : e.kind === 'created' ? '✨ Created' : '✏️ Edited'}
                            </span>
                            <span className="shrink-0" title={new Date(e.created_at).toLocaleString()}>{fmt(e.created_at)}</span>
                        </div>
                        {e.kind === 'note' && <p className="text-gray-700 whitespace-pre-line">{e.body}</p>}
                        {e.kind === 'edit' && (
                            <ul className="text-gray-600">
                                {(e.changes || []).map((c, i) => (
                                    <li key={i}>
                                        <span className="font-medium">{c.field}:</span>{' '}
                                        {c.from == null ? <span className="text-green-700">added {c.to}</span>
                                            : c.to == null ? <span className="text-red-700 line-through">{c.from}</span>
                                            : c.from.length + c.to.length > 60
                                                ? <span className="block whitespace-pre-line"><span className="text-red-700 line-through">{c.from}</span><br /><span className="text-green-700">{c.to}</span></span>
                                                : <><span className="text-red-700 line-through">{c.from}</span> → <span className="text-green-700">{c.to}</span></>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}
