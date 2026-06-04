import { useRef } from 'react';

/**
 * Guards a form against accidentally discarding unsaved edits.
 *
 * Snapshot the form's data when it opens (`markPristine`), then gate every
 * close path (✕, Cancel, click-outside) behind `canClose`. The confirm dialog
 * only appears when something actually changed since the form was opened — an
 * untouched form closes silently.
 *
 * Usage:
 *   const guard = useFormGuard();
 *   useEffect(() => { if (showForm) guard.markPristine(formData); }, [showForm]);
 *   const closeForm = () => { if (guard.canClose(formData)) resetForm(); };
 */
export function useFormGuard() {
    const pristine = useRef('');

    // Record the form's initial state. Call this when the form opens.
    const markPristine = (data: unknown) => {
        pristine.current = JSON.stringify(data);
    };

    const isDirty = (data: unknown) => JSON.stringify(data) !== pristine.current;

    // True if it's safe to close: nothing changed, or the user confirmed the
    // discard. Show the prompt only when there are actual unsaved changes.
    const canClose = (data: unknown) =>
        !isDirty(data) || confirm('You have unsaved changes. Discard them?');

    return { markPristine, isDirty, canClose };
}
