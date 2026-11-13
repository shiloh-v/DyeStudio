// Shows a print-ready HTML page (pull list, packing slip) full-screen inside the
// app, with Close and Print. It prints from the app's own window instead of a
// new blob: tab, because phones (iOS Safari, Android Chrome, and the installed
// home-screen app) often won't print a blob: page or can't open one at all.
//
// The installed iPhone home-screen app ignores window.print(), so there the
// page is turned into a PDF and Print opens the share sheet (which has Print).
//
// The page lives in a shadow root so its styles can't clash with the app's, and
// a print stylesheet hides the app while printing.

const ROOT_ID = 'print-view-root';

const OUTER_CSS = `
#${ROOT_ID} { position: fixed; inset: 0; z-index: 9999; background: #fff; overflow-y: auto; -webkit-overflow-scrolling: touch; }
#${ROOT_ID} .pv-bar { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; gap: 8px;
  padding: max(10px, env(safe-area-inset-top)) 16px 10px; background: #fff; border-bottom: 1px solid #cfdcda; }
#${ROOT_ID} .pv-bar button { border-radius: 6px; padding: 8px 18px; font: 600 15px system-ui, sans-serif; cursor: pointer; }
#${ROOT_ID} .pv-close { background: #fff; color: #1c2626; border: 1px solid #cfdcda; }
#${ROOT_ID} .pv-print { background: #0f766e; color: #fff; border: 0; }
@media print {
  @page { size: letter; margin: 0.45in; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { position: static; overflow: visible; }
  #${ROOT_ID} .pv-bar { display: none; }
}`;

let close: (() => void) | null = null;

// iOS sets navigator.standalone only in a home-screen web app.
const isIosHomeScreenApp = () => (navigator as any).standalone === true;

/** Show a standalone HTML document full-screen with Close / Print. */
export function showPrintPage(html: string): boolean {
    close?.();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Page CSS targets `body`; inside a shadow root that's the host. `@page`
    // is ignored there, so it lives in OUTER_CSS.
    const css = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n')
        .replace(/(^|[\s,}])body(?=[\s,{.:])/g, '$1:host')
        .replace(/@page\s*\{[^}]*\}/g, '');

    const outerStyle = document.createElement('style');
    outerStyle.textContent = OUTER_CSS;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', doc.title || 'Print preview');

    const bar = document.createElement('div');
    bar.className = 'pv-bar';
    const closeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'pv-close', textContent: 'Close' });
    const printBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'pv-print', textContent: 'Print' });
    bar.append(closeBtn, printBtn);

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    // The page's own Print bar is replaced by ours.
    shadow.innerHTML = `<style>${css}\n:host { display: block; } .bar { display: none !important; }</style>${doc.body.innerHTML}`;
    root.append(bar, host);

    const prevTitle = document.title;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close?.(); };
    close = () => {
        root.remove(); outerStyle.remove();
        document.title = prevTitle;
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey);
        close = null;
    };
    closeBtn.onclick = () => close?.();
    let pdf: File | null = null;
    printBtn.onclick = () => {
        if (pdf) navigator.share({ files: [pdf], title: doc.title }).catch(() => { /* cancelled */ });
        else window.print();
    };
    if (isIosHomeScreenApp() && typeof navigator.canShare === 'function') {
        // Build it up front: the share sheet must open straight from the tap.
        printBtn.disabled = true;
        printBtn.textContent = 'Preparing…';
        import('./printPdf')
            .then(({ buildPrintPdf }) => buildPrintPdf(html))
            .then((file) => { if (navigator.canShare({ files: [file] })) pdf = file; })
            .catch((e) => console.error('Could not build the PDF', e))
            .finally(() => { printBtn.disabled = false; printBtn.textContent = 'Print'; });
    }
    document.addEventListener('keydown', onKey);

    // The title names the PDF when "printing" to a file.
    if (doc.title) document.title = doc.title;
    document.body.style.overflow = 'hidden';
    document.head.append(outerStyle);
    document.body.append(root);
    printBtn.focus();
    return true;
}
