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
