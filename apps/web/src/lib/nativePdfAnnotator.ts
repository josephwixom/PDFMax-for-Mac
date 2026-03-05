/**
 * nativePdfAnnotator.ts
 *
 * Embeds Fabric.js canvas markups as ISO 32000 native annotation objects
 * (Square, Circle, Line, FreeText, PolyLine, Polygon, Ink, …) into a PDF's
 * /Annots array via pdf-lib's low-level PDFDict/PDFContext API.
 *
 * The resulting file opens in Adobe Acrobat / Preview / Foxit with editable,
 * selectable annotation objects rather than flattened page-content pixels.
 */
import {
    PDFDocument,
    PDFName,
    PDFArray,
    PDFDict,
    PDFNumber,
    PDFString,
    PDFBool,
    rgb,
    StandardFonts,
    LineCapStyle,
} from 'pdf-lib';

// ── Helpers ──────────────────────────────────────────────────────────────

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
    const clean = hex.replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean;
    const n = parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function parseColor(val: unknown, fallback: RGB = [0, 0, 0]): RGB {
    if (typeof val === 'string' && val.startsWith('#')) return hexToRgb(val);
    if (typeof val === 'string' && val.startsWith('rgb')) {
        const m = val.match(/[\d.]+/g);
        if (m && m.length >= 3) return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
    }
    return fallback;
}

/** Clamp to [0,1] */
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Add a PDFDict annot ref to the page's /Annots array.
 * Creates the array if it does not exist.
 */
function addAnnotToPage(pdfDoc: PDFDocument, page: any, annotDict: PDFDict) {
    const annotRef = pdfDoc.context.register(annotDict);
    let annots: PDFArray | undefined = page.node.Annots();
    if (!annots) {
        const newArr = pdfDoc.context.obj([]);
        page.node.set(PDFName.of('Annots'), newArr);
        // Re-fetch after set to ensure we have the live array
        annots = page.node.Annots();
    }
    if (annots) {
        annots.push(annotRef);
    }
}

/**
 * Build a minimal annotation dict with the common required fields:
 *   Type /Annot, Subtype, Rect, F (Print flag), T (author), NM (unique name)
 */
function baseAnnot(
    pdfDoc: PDFDocument,
    subtype: string,
    rect: [number, number, number, number],
    opacity: number,
    contents = '',
    annotId?: string,
): PDFDict {
    const ctx = pdfDoc.context;
    const d = ctx.obj({}) as PDFDict;
    d.set(PDFName.of('Type'), PDFName.of('Annot'));
    d.set(PDFName.of('Subtype'), PDFName.of(subtype));
    d.set(PDFName.of('Rect'), ctx.obj(rect));
    d.set(PDFName.of('F'), PDFNumber.of(4)); // Print flag
    d.set(PDFName.of('T'), PDFString.of('PDF Max'));
    if (contents) d.set(PDFName.of('Contents'), PDFString.of(contents));
    if (annotId) d.set(PDFName.of('NM'), PDFString.of(annotId));
    if (opacity < 1) d.set(PDFName.of('CA'), PDFNumber.of(clamp01(opacity)));
    return d;
}

/** Set border style sub-dict */
function setBorderStyle(d: PDFDict, pdfDoc: PDFDocument, width: number) {
    d.set(PDFName.of('BS'), pdfDoc.context.obj({ W: width, S: 'S' }));
}

/** Encode a color array [r,g,b] ∈ [0,1] as a PDFArray */
function colorArray(ctx: any, c: RGB) {
    return ctx.obj(c.map((v: number) => PDFNumber.of(v)));
}

// ── Main export function ─────────────────────────────────────────────────

export async function embedNativeAnnotations(
    originalPdfBytes: ArrayBuffer,
    allMarkupJson: Record<number, any>,
    pageScales: Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();
    const ctx = pdfDoc.context;

    // Embed Helvetica for FreeText DA strings
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const [pageNumStr, canvasJson] of Object.entries(allMarkupJson)) {
        const pageIdx = parseInt(pageNumStr, 10) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) continue;
        const page = pages[pageIdx];
        const { width: pdfW, height: pdfH } = page.getSize();
        const scale = pageScales.get(pageIdx + 1);
        const fabW = scale?.fabricWidth ?? pdfW;
        const fabH = scale?.fabricHeight ?? pdfH;
        const scaleX = pdfW / fabW;
        const scaleY = pdfH / fabH;

        // Coordinate transforms: Fabric top-left → PDF bottom-left
        const fx = (x: number) => x * scaleX;
        const fy = (y: number) => pdfH - y * scaleY;

        const objects: any[] = canvasJson.objects ?? [];
        let annotIdx = 0;

        for (const obj of objects) {
            if (obj.excludeFromExport) continue;

            const type = (obj.type ?? '').toLowerCase();
            const markupType: string = obj.markupType ?? '';
            const sw = Math.max(0.25, (obj.strokeWidth ?? 1) * Math.min(scaleX, scaleY));
            const stroke = parseColor(obj.stroke);
            const fillRaw = obj.fill;
            const hasFill = fillRaw && fillRaw !== '' && fillRaw !== 'transparent' && fillRaw !== 'rgba(0,0,0,0)';
            const fill = hasFill ? parseColor(fillRaw) : null;
            const opacity = obj.opacity ?? 1;
            const annotId = `pdfmax-${pageIdx + 1}-${annotIdx++}`;

            // ── WIPEOUT: keep as flattened white rect (must occlude underlying content) ──
            if (markupType === 'wipeout') {
                const x = fx(obj.left ?? 0);
                const y = fy((obj.top ?? 0) + (obj.height ?? 0));
                page.drawRectangle({ x, y, width: (obj.width ?? 0) * scaleX, height: (obj.height ?? 0) * scaleY, color: rgb(1, 1, 1), opacity: 1 });
                continue;
            }

            // ── RECTANGLE → /Square annotation ───────────────────────────────────
            if (type === 'rect') {
                const x1 = fx(obj.left ?? 0);
                const y1 = fy((obj.top ?? 0) + (obj.height ?? 0));
                const x2 = x1 + (obj.width ?? 0) * scaleX;
                const y2 = y1 + (obj.height ?? 0) * scaleY;
                const d = baseAnnot(pdfDoc, 'Square', [x1, y1, x2, y2], opacity, '', annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                if (fill) d.set(PDFName.of('IC'), colorArray(ctx, fill));
                setBorderStyle(d, pdfDoc, sw);
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── ELLIPSE → /Circle annotation ─────────────────────────────────────
            if (type === 'ellipse') {
                const rx = (obj.rx ?? 0) * scaleX;
                const ry = (obj.ry ?? 0) * scaleY;
                const cx = fx((obj.left ?? 0) + (obj.rx ?? 0));
                const cy = fy((obj.top ?? 0) + (obj.ry ?? 0));
                const d = baseAnnot(pdfDoc, 'Circle', [cx - rx, cy - ry, cx + rx, cy + ry], opacity, '', annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                if (fill) d.set(PDFName.of('IC'), colorArray(ctx, fill));
                setBorderStyle(d, pdfDoc, sw);
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── LINE ─────────────────────────────────────────────────────────────
            if (type === 'line') {
                const x1 = fx((obj.x1 ?? 0) + (obj.left ?? 0));
                const y1 = fy((obj.y1 ?? 0) + (obj.top ?? 0));
                const x2 = fx((obj.x2 ?? 0) + (obj.left ?? 0));
                const y2 = fy((obj.y2 ?? 0) + (obj.top ?? 0));
                const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
                const maxX = Math.max(x1, x2), maxY = Math.max(y1, y2);
                const d = baseAnnot(pdfDoc, 'Line', [minX - sw, minY - sw, maxX + sw, maxY + sw], opacity, '', annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                d.set(PDFName.of('L'), ctx.obj([x1, y1, x2, y2]));
                setBorderStyle(d, pdfDoc, sw);
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── TEXT (i-text / textbox) → /FreeText annotation ───────────────────
            if (type === 'i-text' || type === 'textbox' || type === 'text') {
                const text = String(obj.text ?? '');
                if (!text) continue;
                const fontSize = (obj.fontSize ?? 16) * Math.min(scaleX, scaleY);
                const textColor = parseColor(obj.fill ?? '#000000');
                const tcStr = textColor.map(v => v.toFixed(3)).join(' ');
                const da = `/${font.name} ${fontSize.toFixed(1)} Tf ${tcStr} rg`;

                const x1 = fx(obj.left ?? 0);
                const y1 = fy((obj.top ?? 0) + fontSize * 1.5 + 4);
                const approxW = Math.max(60, text.length * fontSize * 0.55);
                const x2 = x1 + approxW;
                const y2 = fy((obj.top ?? 0) - 4);

                const d = baseAnnot(pdfDoc, 'FreeText', [x1, Math.min(y1, y2), x2, Math.max(y1, y2)], opacity, text, annotId);
                d.set(PDFName.of('DA'), PDFString.of(da));
                d.set(PDFName.of('C'), ctx.obj([])); // no border color (transparent)
                d.set(PDFName.of('DS'), PDFString.of(`font-size:${fontSize.toFixed(0)}pt`));
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── POLYLINE / POLYGON → /PolyLine or /Polygon ───────────────────────
            if (type === 'polyline' || type === 'polygon') {
                const pts: number[] = (obj.points ?? []).flatMap((p: any) => [
                    fx((obj.left ?? 0) + p.x),
                    fy((obj.top ?? 0) + p.y),
                ]);
                if (pts.length < 4) continue;

                const xs = pts.filter((_, i) => i % 2 === 0);
                const ys = pts.filter((_, i) => i % 2 === 1);
                const rect: [number, number, number, number] = [
                    Math.min(...xs) - sw, Math.min(...ys) - sw,
                    Math.max(...xs) + sw, Math.max(...ys) + sw,
                ];
                const subtype = type === 'polygon' ? 'Polygon' : 'PolyLine';
                const d = baseAnnot(pdfDoc, subtype, rect, opacity, '', annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                if (fill && type === 'polygon') d.set(PDFName.of('IC'), colorArray(ctx, fill));
                d.set(PDFName.of('Vertices'), ctx.obj(pts.map(v => PDFNumber.of(v))));
                setBorderStyle(d, pdfDoc, sw);
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── FREEHAND PATH → /Ink annotation ──────────────────────────────────
            if (type === 'path') {
                const coords: number[] = [];
                if (Array.isArray(obj.path)) {
                    for (const cmd of obj.path) {
                        const c = cmd[0]?.toUpperCase();
                        if (c === 'M' || c === 'L') {
                            coords.push(fx((obj.left ?? 0) + +cmd[1]));
                            coords.push(fy((obj.top ?? 0) + +cmd[2]));
                        } else if (c === 'Q') {
                            coords.push(fx((obj.left ?? 0) + +cmd[3]));
                            coords.push(fy((obj.top ?? 0) + +cmd[4]));
                        } else if (c === 'C') {
                            coords.push(fx((obj.left ?? 0) + +cmd[5]));
                            coords.push(fy((obj.top ?? 0) + +cmd[6]));
                        }
                    }
                }
                if (coords.length < 4) continue;

                const xs = coords.filter((_, i) => i % 2 === 0);
                const ys = coords.filter((_, i) => i % 2 === 1);
                const rect: [number, number, number, number] = [
                    Math.min(...xs) - sw * 2, Math.min(...ys) - sw * 2,
                    Math.max(...xs) + sw * 2, Math.max(...ys) + sw * 2,
                ];
                const d = baseAnnot(pdfDoc, 'Ink', rect, opacity, '', annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                // /InkList is an array of strokes; each stroke is an array of coords
                const inkStroke = ctx.obj(coords.map(v => PDFNumber.of(v)));
                d.set(PDFName.of('InkList'), ctx.obj([inkStroke]));
                setBorderStyle(d, pdfDoc, sw);
                addAnnotToPage(pdfDoc, page, d);
                continue;
            }

            // ── GROUP (arrow, callout, dimension, leader, stamp) ─────────────────
            // Groups contain complex geometry. We emit a minimal descriptive annot
            // (Text/Note popup or FreeText) so at least the metadata survives.
            // Full appearance rendering is handled by the flattened export.
            if (type === 'group') {
                const gLeft = obj.left ?? 0;
                const gTop = obj.top ?? 0;
                const gW = obj.width ?? 40;
                const gH = obj.height ?? 40;

                const x1 = fx(gLeft);
                const y1 = fy(gTop + gH);
                const x2 = fx(gLeft + gW);
                const y2 = fy(gTop);

                // Determine best subtype from markupType
                let subtype = 'Text'; // sticky-note style
                let contents = markupType || 'Markup';

                if (markupType === 'arrow') {
                    // Represent as a Line annotation between the two farthest children
                    const lineObj = (obj.objects ?? []).find((o: any) => o.type === 'line');
                    if (lineObj) {
                        const lx1 = fx(gLeft + (gW / 2) + (lineObj.x1 ?? 0) - ((lineObj.width ?? 0) / 2));
                        const ly1 = fy(gTop + (gH / 2) + (lineObj.y1 ?? 0) - ((lineObj.height ?? 0) / 2));
                        const lx2 = fx(gLeft + (gW / 2) + (lineObj.x2 ?? 0) - ((lineObj.width ?? 0) / 2));
                        const ly2 = fy(gTop + (gH / 2) + (lineObj.y2 ?? 0) - ((lineObj.height ?? 0) / 2));
                        const minX = Math.min(lx1, lx2), minY = Math.min(ly1, ly2);
                        const maxX = Math.max(lx1, lx2), maxY = Math.max(ly1, ly2);
                        const d = baseAnnot(pdfDoc, 'Line', [minX - sw, minY - sw, maxX + sw, maxY + sw], opacity, 'arrow', annotId);
                        d.set(PDFName.of('C'), colorArray(ctx, stroke));
                        d.set(PDFName.of('L'), ctx.obj([lx1, ly1, lx2, ly2]));
                        d.set(PDFName.of('LE'), ctx.obj([PDFName.of('OpenArrow'), PDFName.of('None')]));
                        setBorderStyle(d, pdfDoc, sw);
                        addAnnotToPage(pdfDoc, page, d);
                        continue;
                    }
                }

                if (markupType === 'callout') {
                    subtype = 'FreeText';
                    const labelChild = (obj.objects ?? []).find((o: any) => o.type === 'i-text' || o.type === 'textbox');
                    const textContent = labelChild?.text ?? 'Callout';
                    const fontSize = ((labelChild?.fontSize ?? 14) * Math.min(scaleX, scaleY)).toFixed(1);
                    const da = `/${font.name} ${fontSize} Tf 0 0 0 rg`;
                    const d = baseAnnot(pdfDoc, 'FreeText', [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], opacity, textContent, annotId);
                    d.set(PDFName.of('DA'), PDFString.of(da));
                    addAnnotToPage(pdfDoc, page, d);
                    continue;
                }

                if (markupType === 'stamp') {
                    const labelChild = (obj.objects ?? []).find((o: any) => o.type === 'i-text' || o.type === 'textbox');
                    contents = labelChild?.text ?? 'Stamp';
                    subtype = 'Stamp';
                }

                const d = baseAnnot(pdfDoc, subtype, [Math.min(x1, x2) - 2, Math.min(y1, y2) - 2, Math.max(x1, x2) + 2, Math.max(y1, y2) + 2], opacity, contents, annotId);
                d.set(PDFName.of('C'), colorArray(ctx, stroke));
                addAnnotToPage(pdfDoc, page, d);
            }
        }
    }

    return pdfDoc.save();
}
