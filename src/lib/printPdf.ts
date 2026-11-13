// Builds a letter-size PDF of a print-ready HTML page, for the installed
// iPhone home-screen app, where iOS ignores window.print(). The PDF goes to the
// share sheet instead, which has Print. Loaded on demand (html2canvas + jsPDF
// are large), and only on that path.
//
// Pages follow the page's own print CSS: its @media print rules are applied,
// `break-before: page` starts a new page, and cards / table rows / the header
// are never cut in half.

const IN = 96;                       // CSS px per inch
const MARGIN = 0.45;                 // inches, matches the pages' @page margin
const PAGE_W = 8.5, PAGE_H = 11;
const CONTENT_W = Math.round((PAGE_W - 2 * MARGIN) * IN);   // 730px
const CONTENT_H = (PAGE_H - 2 * MARGIN) * IN;               // ~970px
const UNSPLITTABLE = '.card, tr, header, h2, li, p';

/** The page's `@media print { … }` bodies, so they can be applied on screen. */
function printRules(css: string): string {
    let out = '';
    const re = /@media\s+print\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
        let depth = 1, i = re.lastIndex;
        for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
        out += css.slice(re.lastIndex, i - 1) + '\n';
        re.lastIndex = i;
    }
    return out.replace(/@page\s*\{[^}]*\}/g, '');
}

function loadFrame(html: string): Promise<HTMLIFrameElement> {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const css = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');
    const extra = doc.createElement('style');
    extra.textContent = `${printRules(css)}\nhtml, body { width: ${CONTENT_W}px; margin: 0; background: #fff; overflow: hidden; }`;
    doc.head.append(extra);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = `position: fixed; left: -20000px; top: 0; width: ${CONTENT_W}px; height: 20000px; border: 0;`;
    return new Promise((resolve, reject) => {
        frame.onload = () => resolve(frame);
        frame.onerror = reject;
        frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
        document.body.append(frame);
    });
}

/** Where to cut a tall page into printed pages (CSS px from its top). */
function pageCuts(root: HTMLElement): number[] {
    const top = root.getBoundingClientRect().top;
    const height = root.scrollHeight;
    const boxes = [...root.querySelectorAll<HTMLElement>(UNSPLITTABLE)]
        .map((el) => { const r = el.getBoundingClientRect(); return { t: r.top - top, b: r.bottom - top }; });
    const forced = [...root.querySelectorAll<HTMLElement>('*')]
        .filter((el) => { const s = getComputedStyle(el); return s.breakBefore === 'page' || (s as any).pageBreakBefore === 'always'; })
        .map((el) => el.getBoundingClientRect().top - top)
        .sort((a, b) => a - b);
    const safe = (y: number) => !boxes.some((x) => x.t < y - 0.5 && x.b > y + 0.5);
    const candidates = [...new Set(boxes.map((x) => Math.ceil(x.b)).concat(height))].filter(safe).sort((a, b) => a - b);

    const cuts: number[] = [];
    let start = 0;
    while (start < height - 1) {
        const limit = start + CONTENT_H;
        const f = forced.find((y) => y > start + 1);
        let cut: number;
        if (f != null && f <= limit) cut = f;
        else if (limit >= height) cut = height;
        else cut = [...candidates].reverse().find((y) => y > start + 1 && y <= limit) ?? limit;
        cuts.push(cut);
        start = cut;
    }
    return cuts;
}

/** A PDF of the page, named after its <title>. */
export async function buildPrintPdf(html: string): Promise<File> {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const frame = await loadFrame(html);
    try {
        const fdoc = frame.contentDocument!;
        await (fdoc as any).fonts?.ready;
        const root = (fdoc.querySelector('.page') as HTMLElement) || fdoc.body;
        const scale = 2;
        // Measure the breaks on html2canvas's own copy, so they match what it draws.
        let cuts: number[] = [];
        const canvas = await html2canvas(root, {
            scale, backgroundColor: '#ffffff', logging: false,
            windowWidth: CONTENT_W, windowHeight: root.scrollHeight,
            onclone: (cdoc) => { cuts = pageCuts((cdoc.querySelector('.page') as HTMLElement) || cdoc.body); },
        });
        if (!cuts.length) cuts = [canvas.height / scale];

        const pdf = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
        let start = 0;
        cuts.forEach((cut, i) => {
            const h = Math.max(1, Math.round((cut - start) * scale));
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = h;
            const ctx = slice.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, slice.width, h);
            ctx.drawImage(canvas, 0, Math.round(start * scale), canvas.width, h, 0, 0, canvas.width, h);
            if (i) pdf.addPage();
            pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, PAGE_W - 2 * MARGIN, (cut - start) / IN);
            start = cut;
        });
        const name = (fdoc.title || 'Printout').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Printout';
        return new File([pdf.output('blob')], `${name}.pdf`, { type: 'application/pdf' });
    } finally {
        frame.remove();
    }
}
