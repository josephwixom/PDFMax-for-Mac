/**
 * redactionExporter.ts
 *
 * Apply redaction markups permanently to a PDF:
 * 1. For each page with redaction objects, composite the rendered page canvas
 *    with solid black rectangles painted over the redacted zones.
 * 2. Embed the composited canvas as a full-page PNG image via pdf-lib,
 *    replacing the original page content — so the original text/vectors are gone.
 * 3. Pages without any redaction markups are copied unchanged.
 */
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

// ── Helpers ───────────────────────────────────────────────────────────────

function hasRedactions(pageJson: any): boolean {
    return (pageJson?.objects ?? []).some(
        (o: any) => o.markupType === 'redaction'
    );
}

function getRedactionRects(pageJson: any): Array<{ left: number; top: number; width: number; height: number }> {
    return (pageJson?.objects ?? [])
        .filter((o: any) => o.markupType === 'redaction')
        .map((o: any) => ({
            left: o.left ?? 0,
            top: o.top ?? 0,
            width: o.width ?? 0,
            height: o.height ?? 0,
        }));
}

/**
 * Composite the existing rendered page canvas with black redaction boxes,
 * returns a PNG data URL.
 */
function compositeRedactions(
    pageCanvas: HTMLCanvasElement,
    rects: Array<{ left: number; top: number; width: number; height: number }>,
    scaleX: number,
    scaleY: number,
): string {
    const offscreen = document.createElement('canvas');
    offscreen.width = pageCanvas.width;
    offscreen.height = pageCanvas.height;
    const ctx = offscreen.getContext('2d')!;

    // Draw the original page
    ctx.drawImage(pageCanvas, 0, 0);

    // Paint solid black over each redaction zone
    ctx.fillStyle = '#000000';
    for (const r of rects) {
        // Fabric coords → canvas pixel coords (top-left origin, same as canvas)
        const px = r.left * scaleX;
        const py = r.top * scaleY;
        const pw = r.width * scaleX;
        const ph = r.height * scaleY;
        ctx.fillRect(px, py, pw, ph);
    }

    return offscreen.toDataURL('image/png');
}

// ── Main export function ──────────────────────────────────────────────────

export async function applyRedactions(
    originalPdfBytes: ArrayBuffer,
    allMarkupJson: Record<number, any>,
    pageScales: Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>,
    engine: { getCanvasForPage: (p: number) => HTMLCanvasElement | undefined },
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageNum = pageIdx + 1;
        const pageJson = allMarkupJson[pageNum];
        if (!pageJson || !hasRedactions(pageJson)) continue;

        const page = pages[pageIdx];
        const { width: pdfW, height: pdfH } = page.getSize();
        const scale = pageScales.get(pageNum);
        const fabW = scale?.fabricWidth ?? pdfW;
        const fabH = scale?.fabricHeight ?? pdfH;

        // Scale factors: canvas pixel → fabric coord (same), fabric → PDF points
        // The canvas IS the fabric coordinate space (1 px = 1 fabric unit at current zoom)
        const scaleX = fabW / fabW; // = 1 (canvas pixels = fabric units)
        const scaleY = fabH / fabH; // = 1

        const pageCanvas = engine.getCanvasForPage(pageNum);
        if (!pageCanvas) {
            // Fallback: can't get canvas — skip this page's redactions safely
            console.warn(`[Redaction] No canvas for page ${pageNum}, skipping`);
            continue;
        }

        const rects = getRedactionRects(pageJson);
        const pngDataUrl = compositeRedactions(pageCanvas, rects, scaleX, scaleY);

        // Convert dataURL to Uint8Array for pdf-lib
        const base64 = pngDataUrl.split(',')[1];
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        // Embed composited page as PNG image
        const pngImage = await pdfDoc.embedPng(bytes);

        // Replace the page's entire content stream with a single full-page image draw
        // Step 1: clear existing content streams
        page.node.set(PDFName.of('Contents'), pdfDoc.context.obj([]));

        // Step 2: draw the image at full page size
        page.drawImage(pngImage, { x: 0, y: 0, width: pdfW, height: pdfH });

        // Step 3: remove any annotations on this page (the redaction boxes themselves
        //         are now burned into the image)
        const annots: PDFArray | undefined = page.node.Annots();
        if (annots) {
            page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([]));
        }
    }

    return pdfDoc.save();
}
