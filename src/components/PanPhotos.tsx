import React, { useEffect, useRef, useState } from 'react';

type Photo = { id?: string | number; data: string; label?: string };

// Every photo on a recipe/sketch (falls back to the legacy single `photo`).
export function photosOf(src: { photos?: Photo[]; photo?: string } | null | undefined): Photo[] {
    if (!src) return [];
    const list = (src.photos || []).filter(p => p?.data);
    if (list.length > 0) return list;
    return src.photo ? [{ id: 'legacy', data: src.photo, label: 'Photo' }] : [];
}

const showLabel = (p: Photo) => p.label && p.label !== 'Photo';

// Swipeable strip of all the color's photos for the dyeing screen.
// Tap a photo to open it full screen, then swipe (or use arrows/keys) through the rest.
export function PanPhotos({ photos, alt }: { photos: Photo[]; alt?: string }) {
    const [openAt, setOpenAt] = useState<number | null>(null);
    if (photos.length === 0) return null;

    return (
        <div className="mb-4">
            <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                {photos.map((p, i) => (
                    <button
                        key={p.id ?? i}
                        type="button"
                        onClick={() => setOpenAt(i)}
                        className="snap-start flex-shrink-0 text-left focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-lg"
                    >
                        <img
                            src={p.data}
                            alt={p.label || alt}
                            className="rounded-lg border-2 border-teal-300 shadow-md object-cover"
                            style={{ width: photos.length === 1 ? '160px' : '150px', height: '150px' }}
                        />
                        <p className="text-xs text-gray-600 mt-1 text-center truncate" style={{ maxWidth: '150px' }}>
                            {showLabel(p) ? p.label : `Photo ${i + 1}`}
                        </p>
                    </button>
                ))}
            </div>
            {photos.length > 1 && (
                <p className="text-xs text-gray-500">{photos.length} photos — swipe to see them all, tap to enlarge</p>
            )}
            {openAt !== null && <PhotoViewer photos={photos} start={openAt} alt={alt} onClose={() => setOpenAt(null)} />}
        </div>
    );
}

function PhotoViewer({ photos, start, alt, onClose }: { photos: Photo[]; start: number; alt?: string; onClose: () => void }) {
    const scroller = useRef<HTMLDivElement>(null);
    const [idx, setIdx] = useState(start);

    const goTo = (i: number, smooth = true) => {
        const el = scroller.current;
        if (!el) return;
        const n = Math.max(0, Math.min(photos.length - 1, i));
        el.scrollTo({ left: n * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    };

    useEffect(() => {
        goTo(start, false);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowRight') goTo(idxRef.current + 1);
            else if (e.key === 'ArrowLeft') goTo(idxRef.current - 1);
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const idxRef = useRef(idx);
    idxRef.current = idx;

    const onScroll = () => {
        const el = scroller.current;
        if (!el || !el.clientWidth) return;
        const i = Math.round(el.scrollLeft / el.clientWidth);
        if (i !== idxRef.current) setIdx(i);
    };

    const cur = photos[idx];
    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.95)' }} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between px-4 py-3 text-white">
                <span className="text-sm">
                    {idx + 1} / {photos.length}{cur && showLabel(cur) ? ` · ${cur.label}` : ''}
                </span>
                <button type="button" onClick={onClose} className="text-2xl leading-none px-3 py-1 rounded hover:bg-white/10" aria-label="Close">✕</button>
            </div>
            <div
                ref={scroller}
                onScroll={onScroll}
                className="flex-1 flex overflow-x-auto snap-x snap-mandatory"
                style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
            >
                {photos.map((p, i) => (
                    <div key={p.id ?? i} className="snap-center flex-shrink-0 w-full h-full flex items-center justify-center p-2" onClick={onClose}>
                        <img src={p.data} alt={p.label || alt} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
                    </div>
                ))}
            </div>
            {photos.length > 1 && (
                <div className="flex items-center justify-center gap-6 py-3">
                    <button type="button" onClick={() => goTo(idx - 1)} disabled={idx === 0}
                        className="text-white text-xl w-11 h-11 rounded-full bg-white/15 disabled:opacity-30" aria-label="Previous photo">◀</button>
                    <div className="flex gap-1.5">
                        {photos.map((p, i) => (
                            <button key={p.id ?? i} type="button" onClick={() => goTo(i)} aria-label={`Photo ${i + 1}`}
                                className={`w-2 h-2 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`} />
                        ))}
                    </div>
                    <button type="button" onClick={() => goTo(idx + 1)} disabled={idx === photos.length - 1}
                        className="text-white text-xl w-11 h-11 rounded-full bg-white/15 disabled:opacity-30" aria-label="Next photo">▶</button>
                </div>
            )}
        </div>
    );
}
