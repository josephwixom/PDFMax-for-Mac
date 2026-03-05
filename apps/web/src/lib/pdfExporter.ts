/**
 * pdfExporter.ts
 * Flatten Fabric.js canvas markups onto a PDF using pdf-lib,
 * producing a self-contained annotated PDF for download.
 */
import { PDFDocument, rgb, StandardFonts, LineCapStyle, PDFTextField, PDFCheckBox, PDFDropdown } from 'pdf-lib';

// Cache embedded images within a single export call to avoid duplicate embeds
const imageCache = new Map<string, any>();

async function fetchImageBytes(src: string): Promise<{ bytes: Uint8Array; isPng: boolean } | null> {
    try {
        if (src.startsWith('data:')) {
            const [header, b64] = src.split(',');
            const isPng = header.includes('png');
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return { bytes, isPng };
        } else {
            const resp = await fetch(src);
            const buf = await resp.arrayBuffer();
            const isPng = src.toLowerCase().includes('.png') || resp.headers.get('content-type')?.includes('png') === true;
            return { bytes: new Uint8Array(buf), isPng };
        }
    } catch {
        return null;
    }
}

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

/**
 * Export markups as an annotated PDF.
 * @param originalPdfBytes  Raw bytes of the original PDF.
 * @param allMarkupJson     Map of pageNumber → Fabric canvas JSON (from engine.exportMarkups()).
 * @param pageScales        Map of pageNumber → { width, height } in PDF points.
 * @param nativeFieldValues Optional map of page → [{fieldName, fieldType, value}] from getNativeFormFieldValues().
 * @returns Uint8Array of the exported PDF.
 */
export async function exportMarkupsAsPdf(
    originalPdfBytes: ArrayBuffer,
    allMarkupJson: Record<number, any>,
    pageScales: Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>,
    nativeFieldValues?: Map<number, { fieldName: string; fieldType: string; value: string }[]>
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    imageCache.clear(); // Reset per export call

    // ── Apply native AcroForm field values (from HTML overlay inputs) ─────────
    if (nativeFieldValues && nativeFieldValues.size > 0) {
        try {
            const form = pdfDoc.getForm();
            for (const [, fields] of nativeFieldValues) {
                for (const { fieldName, fieldType, value } of fields) {
                    if (!fieldName) continue;
                    try {
                        if (fieldType === 'Tx') {
                            const f = form.getTextField(fieldName);
                            f.setText(value);
                        } else if (fieldType === 'Btn') {
                            const f = form.getCheckBox(fieldName);
                            if (value === 'Yes' || value === 'On') f.check(); else f.uncheck();
                        } else if (fieldType === 'Ch') {
                            const f = form.getDropdown(fieldName);
                            try { f.select(value); } catch { /* option not in list */ }
                        }
                    } catch { /* field may not exist or may be a different type */ }
                }
            }
        } catch {
            console.warn('[pdfExporter] Could not apply native form field values');
        }
    }

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
        // Coordinate helpers — Fabric: top-left origin / PDF: bottom-left origin
        const fy = (y: number) => pdfH - y * scaleY;
        const fx = (x: number) => x * scaleX;

        const objects: any[] = canvasJson.objects ?? [];

        for (const obj of objects) {
            // Skip system objects (snap indicator etc.)
            if (obj.excludeFromExport) continue;

            const sw = (obj.strokeWidth ?? 1) * Math.min(scaleX, scaleY);
            const stroke = parseColor(obj.stroke);
            const fill = parseColor(obj.fill, [1, 1, 1]);
            const opacity = obj.opacity ?? 1;
            const hasFill = obj.fill && obj.fill !== '' && obj.fill !== 'transparent' && obj.fill !== 'rgba(0,0,0,0)';
            const type = (obj.type ?? '').toLowerCase();

            if (type === 'line') {
                page.drawLine({
                    start: { x: fx(obj.x1 + (obj.left ?? 0)), y: fy(obj.y1 + (obj.top ?? 0)) },
                    end: { x: fx(obj.x2 + (obj.left ?? 0)), y: fy(obj.y2 + (obj.top ?? 0)) },
                    thickness: sw,
                    color: rgb(...stroke),
                    opacity,
                    lineCap: LineCapStyle.Round,
                });
            } else if (type === 'rect') {
                const x = fx(obj.left ?? 0);
                const y = fy((obj.top ?? 0) + (obj.height ?? 0));
                const w = (obj.width ?? 0) * scaleX;
                const h = (obj.height ?? 0) * scaleY;
                const isWipeout = obj.markupType === 'wipeout';
                if (isWipeout) {
                    // Fully opaque white rect — must cover the PDF content below
                    page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), opacity: 1 });
                } else {
                    if (hasFill) {
                        page.drawRectangle({ x, y, width: w, height: h, color: rgb(...fill), opacity });
                    }
                    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(...stroke), borderWidth: sw, opacity });
                }
            } else if (type === 'polyline' || type === 'polygon') {
                const pts: { x: number; y: number }[] = (obj.points ?? []).map((p: any) => ({
                    x: fx((obj.left ?? 0) + p.x),
                    y: fy((obj.top ?? 0) + p.y),
                }));
                if (pts.length < 2) continue;
                for (let i = 0; i < pts.length - 1; i++) {
                    page.drawLine({
                        start: pts[i],
                        end: pts[i + 1],
                        thickness: sw,
                        color: rgb(...stroke),
                        opacity,
                        lineCap: LineCapStyle.Round,
                    });
                }
                if (type === 'polygon' && pts.length > 2) {
                    page.drawLine({ start: pts[pts.length - 1], end: pts[0], thickness: sw, color: rgb(...stroke), opacity });
                }
            } else if (type === 'i-text' || type === 'textbox' || type === 'text') {
                const text = String(obj.text ?? '');
                if (!text) continue;
                const fontSize = (obj.fontSize ?? 16) * Math.min(scaleX, scaleY);
                page.drawText(text, {
                    x: fx(obj.left ?? 0),
                    y: fy((obj.top ?? 0) + fontSize),
                    size: fontSize,
                    font,
                    color: rgb(...parseColor(obj.fill ?? '#000000')),
                    opacity,
                });
            } else if (type === 'group') {
                // Group (stamps): render child objects
                const groupLeft = obj.left ?? 0;
                const groupTop = obj.top ?? 0;
                const groupW = obj.width ?? 100;
                const groupH = obj.height ?? 30;
                // Draw background rect
                const bgFill = obj.objects?.[0]?.fill;
                if (bgFill) {
                    page.drawRectangle({
                        x: fx(groupLeft),
                        y: fy(groupTop + groupH),
                        width: groupW * scaleX,
                        height: groupH * scaleY,
                        color: rgb(...parseColor(bgFill)),
                        opacity,
                        borderColor: rgb(...parseColor(bgFill)),
                        borderWidth: 1,
                    });
                }
                // Draw text child
                const textObj = (obj.objects ?? []).find((o: any) => o.type === 'i-text' || o.type === 'textbox' || o.type === 'text');
                if (textObj) {
                    const text = String(textObj.text ?? '');
                    const fontSize = (textObj.fontSize ?? 14) * Math.min(scaleX, scaleY);
                    page.drawText(text, {
                        x: fx(groupLeft + groupW / 2 - (text.length * fontSize * 0.3)),
                        y: fy(groupTop + groupH / 2 + fontSize / 3),
                        size: fontSize,
                        font,
                        color: rgb(...parseColor(textObj.fill ?? '#ffffff')),
                        opacity,
                    });
                }
            } else if (type === 'path') {
                // Freehand: approximate by sampling path data as line segments
                const pathData: string = obj.path ? JSON.stringify(obj.path) : '';
                const coords: Array<[number, number]> = [];
                if (Array.isArray(obj.path)) {
                    for (const cmd of obj.path) {
                        const c = cmd[0]?.toUpperCase();
                        if (c === 'M' || c === 'L') coords.push([+cmd[1], +cmd[2]]);
                        else if (c === 'Q') coords.push([+cmd[3], +cmd[4]]);
                        else if (c === 'C') coords.push([+cmd[5], +cmd[6]]);
                    }
                }
                const ox = obj.left ?? 0;
                const oy = obj.top ?? 0;
                for (let i = 0; i < coords.length - 1; i++) {
                    page.drawLine({
                        start: { x: fx(ox + coords[i][0]), y: fy(oy + coords[i][1]) },
                        end: { x: fx(ox + coords[i + 1][0]), y: fy(oy + coords[i + 1][1]) },
                        thickness: sw,
                        color: rgb(...stroke),
                        opacity,
                        lineCap: LineCapStyle.Round,
                    });
                }
            } else if (type === 'image') {
                // ── Image stamp (FabricImage) ────────────────────────────────
                const src: string = obj.src ?? obj._element?.src ?? obj.getSrc?.() ?? '';
                if (!src) continue;
                try {
                    let embeddedImg = imageCache.get(src);
                    if (!embeddedImg) {
                        const imgData = await fetchImageBytes(src);
                        if (!imgData) continue;
                        embeddedImg = imgData.isPng
                            ? await pdfDoc.embedPng(imgData.bytes)
                            : await pdfDoc.embedJpg(imgData.bytes);
                        imageCache.set(src, embeddedImg);
                    }
                    const left = obj.left ?? 0;
                    const top = obj.top ?? 0;
                    const natW = obj.width ?? embeddedImg.width;
                    const natH = obj.height ?? embeddedImg.height;
                    const sX = obj.scaleX ?? 1;
                    const sY = obj.scaleY ?? 1;
                    const imgW = natW * sX * scaleX;
                    const imgH = natH * sY * scaleY;
                    const x = fx(left);
                    const y = fy(top + natH * sY) + (natH * sY * scaleY - imgH); // bottom-left in PDF
                    page.drawImage(embeddedImg, { x, y: fy(top + natH * sY), width: imgW, height: imgH, opacity });
                } catch (err) {
                    console.warn('[pdfExporter] Failed to embed image stamp:', err);
                }
            } else if (type === 'rect' && obj.markupType === 'form-field' && obj.pdfmax_formfield) {
                // ── Form field visual placeholder (draw dashed rect) ─────────
                const x = fx(obj.left ?? 0);
                const y = fy((obj.top ?? 0) + (obj.height ?? 28));
                const w = (obj.width ?? 200) * scaleX;
                const h = (obj.height ?? 28) * scaleY;
                const ff = obj.pdfmax_formfield;
                const [fr, fg, fb] = parseColor(ff.color ?? '#3b82f6');
                page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(fr, fg, fb), borderWidth: 1, opacity: 0.4 });
                const labelText = ff.name ?? ff.type;
                const fontSize = Math.max(7, Math.min(h * 0.55, 11));
                try {
                    page.drawText(labelText, { x: x + 3, y: y + h / 2 - fontSize / 2, size: fontSize, font, color: rgb(fr, fg, fb), opacity: 0.7 });
                } catch { /* skip if text overflows */ }
            }
        }

        // ── AcroForm fields (interactive) ────────────────────────────────────
        const formFields = objects.filter((o: any) =>
            o.markupType === 'form-field' && o.pdfmax_formfield
        );
        if (formFields.length > 0) {
            const form = pdfDoc.getForm();
            for (const obj of formFields) {
                const ff = obj.pdfmax_formfield as {
                    type: string; name: string; required: boolean; defaultValue: string;
                };
                const x = fx(obj.left ?? 0);
                const y = fy((obj.top ?? 0) + (obj.height ?? 28));
                const w = Math.max(10, (obj.width ?? 200) * scaleX);
                const h = Math.max(8, (obj.height ?? 28) * scaleY);
                const fieldName = ff.name ?? `field_${Date.now()}`;

                try {
                    if (ff.type === 'text') {
                        let field: PDFTextField;
                        try { field = form.getTextField(fieldName); }
                        catch { field = form.createTextField(fieldName); }
                        if (ff.defaultValue) field.setText(ff.defaultValue);
                        if (ff.required) field.enableRequired();
                        field.addToPage(page, { x, y, width: w, height: h });
                    } else if (ff.type === 'checkbox') {
                        let field: PDFCheckBox;
                        try { field = form.getCheckBox(fieldName); }
                        catch { field = form.createCheckBox(fieldName); }
                        if (ff.required) field.enableRequired();
                        field.addToPage(page, { x, y, width: Math.min(w, h), height: Math.min(w, h) });
                    } else if (ff.type === 'dropdown') {
                        let field: PDFDropdown;
                        try { field = form.getDropdown(fieldName); }
                        catch { field = form.createDropdown(fieldName); }
                        if (ff.required) field.enableRequired();
                        if (ff.defaultValue) field.select(ff.defaultValue);
                        field.addToPage(page, { x, y, width: w, height: h });
                    } else if (ff.type === 'radio') {
                        // Radio — use a checkbox as approximation (pdf-lib radio groups require explicit values)
                        let field: PDFCheckBox;
                        try { field = form.getCheckBox(fieldName); }
                        catch { field = form.createCheckBox(fieldName); }
                        if (ff.required) field.enableRequired();
                        field.addToPage(page, { x, y, width: Math.min(w, h), height: Math.min(w, h) });
                    }
                } catch (err) {
                    console.warn('[pdfExporter] Failed to create AcroForm field:', fieldName, err);
                }
            }
        }
    }

    return pdfDoc.save();
}
