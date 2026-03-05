/**
 * OCR Service — extracts text from PDF pages using two strategies:
 *  1. pdf.js built-in text layer (fast, accurate for selectable PDFs)
 *  2. Tesseract.js OCR (fallback for scanned / image-only pages)
 *
 * Returns per-page text blocks with bounding-box info for diff highlighting.
 */
import * as pdfjsLib from 'pdfjs-dist';

export interface OcrWord {
    text: string;
    x: number;   // 0–1 relative to page width
    y: number;   // 0–1 relative to page height
    w: number;
    h: number;
}

export interface OcrPage {
    pageNum: number;
    text: string;         // full page text (newline-separated)
    words: OcrWord[];
    isOcr: boolean;       // true = Tesseract was used, false = pdf.js native
}

/** Cancel token so long extractions can be aborted. */
export class ExtractJob {
    cancelled = false;
    cancel() { this.cancelled = true; }
}

/**
 * Extract text from all pages of a PDF ArrayBuffer.
 * Falls back to Tesseract.js for pages with no extractable text.
 */
export async function extractPdfText(
    pdfData: ArrayBuffer,
    onProgress?: (page: number, total: number) => void,
    job?: ExtractJob
): Promise<OcrPage[]> {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfData) });
    const doc = await loadingTask.promise;
    const total = doc.numPages;
    const pages: OcrPage[] = [];

    for (let i = 1; i <= total; i++) {
        if (job?.cancelled) break;
        onProgress?.(i, total);

        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const W = viewport.width;
        const H = viewport.height;

        // ── Strategy 1: pdf.js native text extraction ─────────────────────
        const textContent = await page.getTextContent();
        const words: OcrWord[] = [];
        const lines: string[] = [];

        for (const item of textContent.items) {
            const t = item as any;
            if (!t.str?.trim()) continue;
            const tx = t.transform as number[];
            // pdf.js transform: [a, b, c, d, e, f] where e=x, f=y (PDF coords)
            const x = tx[4] / W;
            const y = 1 - (tx[5] + (t.height ?? 0)) / H;
            const w = (t.width ?? 50) / W;
            const h = (t.height ?? 10) / H;
            words.push({ text: t.str, x, y, w, h });
            lines.push(t.str);
        }

        const nativeText = lines.join(' ').trim();
        page.cleanup();

        if (nativeText.length > 30) {
            // Sufficient native text — no OCR needed
            pages.push({ pageNum: i, text: nativeText, words, isOcr: false });
            continue;
        }

        // ── Strategy 2: Tesseract OCR fallback ────────────────────────────
        try {
            const canvas = await renderPageToCanvas(page, 2.0);
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker('eng');
            const { data } = await worker.recognize(canvas) as any;

            await worker.terminate();

            const ocrWords: OcrWord[] = (data.words ?? []).map((w: any) => ({
                text: w.text,
                x: w.bbox.x0 / canvas.width,
                y: w.bbox.y0 / canvas.height,
                w: (w.bbox.x1 - w.bbox.x0) / canvas.width,
                h: (w.bbox.y1 - w.bbox.y0) / canvas.height,
            }));

            pages.push({
                pageNum: i,
                text: data.text,
                words: ocrWords,
                isOcr: true,
            });
        } catch (err) {
            console.warn(`[OCR] Tesseract failed on page ${i}:`, err);
            pages.push({ pageNum: i, text: nativeText || '', words, isOcr: false });
        }
    }

    return pages;
}

async function renderPageToCanvas(
    page: pdfjsLib.PDFPageProxy,
    scale: number
): Promise<HTMLCanvasElement> {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    return canvas;
}
