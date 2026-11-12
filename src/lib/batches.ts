import type { Batch } from '../types';

/**
 * The terminal pipeline stage. A batch here is FINISHED STOCK — dyed, labeled,
 * and sitting in inventory ready to sell. It is NOT a realized sale: actual
 * sales/revenue will come from the Shopify integration later.
 *
 * Back-compat: batches created before the Sold→Stocked rename still carry the
 * legacy status 'sold'. We treat both as "stocked" everywhere so the app is
 * correct whether or not the one-time data migration has run. New code only
 * ever writes 'stocked'.
 */
export const STOCKED_STATUS = 'stocked';
export const LEGACY_STOCKED_STATUS = 'sold';

export function isStocked(batch: { status?: string } | null | undefined): boolean {
    return batch?.status === STOCKED_STATUS || batch?.status === LEGACY_STOCKED_STATUS;
}

/** Batches that are finished stock (incl. legacy 'sold'). */
export function stockedBatches(batches: Batch[]): Batch[] {
    return (batches || []).filter(isStocked);
}

/** Batches still moving through the pipeline (not yet stocked). */
export function activeBatches(batches: Batch[]): Batch[] {
    return (batches || []).filter((b) => !isStocked(b));
}

/**
 * True when a dye session already has batches in the Pipeline, i.e. it was
 * finished. Older batches predate `sourceSessionId`, so also match the
 * "...session: <name>" note every finished batch carries.
 *
 * Use this alongside `session.archived`: the flag lives on the session row and
 * can be wiped by a save from another tab/device holding a stale copy, but the
 * batches are proof the session was finished — so it must never be finished
 * (batches created, inventory deducted) a second time.
 */
export function sessionHasBatches(
    session: { id?: any; name?: string } | null | undefined,
    batches: Array<{ sourceSessionId?: any; notes?: string }>,
): boolean {
    if (!session) return false;
    return (batches || []).some((b) =>
        (b.sourceSessionId != null && String(b.sourceSessionId) === String(session.id))
        || (!!session.name && (b.notes || '').endsWith(`session: ${session.name}`)));
}

/** A session is done if it's flagged archived OR its batches already exist. */
export function isSessionFinished(
    session: { id?: any; name?: string; archived?: boolean | null } | null | undefined,
    batches: Array<{ sourceSessionId?: any; notes?: string }>,
): boolean {
    return !!session && (!!session.archived || sessionHasBatches(session, batches));
}
