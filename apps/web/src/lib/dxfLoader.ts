/**
 * dxfLoader.ts
 *
 * Parses a DXF file and converts entities into Fabric.js objects
 * that can be added to the current PDF annotation canvas.
 *
 * Supported entity types: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, TEXT, MTEXT, ELLIPSE
 */

// dxf-parser has CommonJS exports; use dynamic require with a type shim
type DxfEntity = {
    type: string;
    vertices?: Array<{ x: number; y: number; z?: number }>;
    x?: number; y?: number; x2?: number; y2?: number;
    cx?: number; cy?: number; r?: number;
    startAngle?: number; endAngle?: number;
    rx?: number; ry?: number; rotation?: number;
    text?: string; value?: string;
    height?: number;
    color?: number;
};

type DxfData = {
    entities: DxfEntity[];
};

const DXF_COLOR_MAP: Record<number, string> = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
    5: '#0000ff', 6: '#ff00ff', 7: '#000000', 0: '#000000',
};
const dxfColor = (c?: number) => (c !== undefined && DXF_COLOR_MAP[c]) ?? '#2563eb';

/**
 * Load the DXF parser lazily (it's a CommonJS module).
 */
async function getDxfParser() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import('dxf-parser');
    return mod.default ? new (mod.default as any)() : new (mod as any)();
}

/**
 * Convert DXF canvas coords (Y-up) to Fabric canvas coords (Y-down).
 * We compute the bounding box first and then flip Y.
 */
function dxfToFabric(
    entities: DxfEntity[],
): Array<{
    type: 'line' | 'circle' | 'arc' | 'polyline' | 'text';
    props: Record<string, unknown>;
}> {
    // Determine Y bounds for flipping
    let minY = Infinity;
    let maxY = -Infinity;
    for (const e of entities) {
        const ys: number[] = [];
        if (e.y !== undefined) ys.push(e.y, e.y2 ?? e.y);
        if (e.cy !== undefined) ys.push(e.cy);
        if (e.vertices) e.vertices.forEach(v => ys.push(v.y));
        ys.forEach(y => { if (y < minY) minY = y; if (y > maxY) maxY = y; });
    }
    const height = maxY - minY;
    const flipY = (y: number) => height - (y - minY) + minY;

    const result: ReturnType<typeof dxfToFabric> = [];

    for (const e of entities) {
        const stroke = dxfColor(e.color);
        try {
            switch (e.type) {
                case 'LINE':
                    if (e.x !== undefined && e.y !== undefined && e.x2 !== undefined && e.y2 !== undefined) {
                        result.push({ type: 'line', props: { x1: e.x, y1: flipY(e.y), x2: e.x2, y2: flipY(e.y2), stroke, strokeWidth: 1 } });
                    }
                    break;

                case 'CIRCLE':
                    if (e.cx !== undefined && e.cy !== undefined && e.r !== undefined) {
                        result.push({ type: 'circle', props: { cx: e.cx, cy: flipY(e.cy), r: e.r, fill: 'transparent', stroke, strokeWidth: 1 } });
                    }
                    break;

                case 'ARC':
                    if (e.cx !== undefined && e.cy !== undefined && e.r !== undefined) {
                        result.push({ type: 'arc', props: { cx: e.cx, cy: flipY(e.cy), r: e.r, startAngle: e.startAngle ?? 0, endAngle: e.endAngle ?? 360, stroke, strokeWidth: 1 } });
                    }
                    break;

                case 'LWPOLYLINE':
                case 'POLYLINE':
                    if (e.vertices && e.vertices.length >= 2) {
                        result.push({
                            type: 'polyline',
                            props: {
                                points: e.vertices.map(v => ({ x: v.x, y: flipY(v.y) })),
                                fill: 'transparent', stroke, strokeWidth: 1,
                            },
                        });
                    }
                    break;

                case 'TEXT':
                case 'MTEXT':
                    if ((e.text || e.value) && e.x !== undefined && e.y !== undefined) {
                        result.push({
                            type: 'text',
                            props: {
                                text: e.text ?? e.value ?? '',
                                left: e.x, top: flipY(e.y),
                                fontSize: Math.max(8, (e.height ?? 5) * 3),
                                fill: stroke,
                                fontFamily: 'Arial',
                            },
                        });
                    }
                    break;

                default:
                    break;
            }
        } catch {
            // skip bad entities
        }
    }

    return result;
}

/**
 * Fit all entities to a target width/height by computing a uniform scale.
 * Returns objects with absolute positions scaled and offset to center.
 */
function scaleToFit(
    entities: ReturnType<typeof dxfToFabric>,
    targetW: number,
    targetH: number,
    paddingFraction = 0.1,
): ReturnType<typeof dxfToFabric> {
    // Collect all X / Y values
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const visit = (x: unknown, y: unknown) => {
        if (typeof x === 'number' && typeof y === 'number') {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    };
    for (const e of entities) {
        const p = e.props;
        visit(p.x1, p.y1); visit(p.x2, p.y2);
        visit(p.cx, p.cy); visit(p.left, p.top);
        if (Array.isArray(p.points)) (p.points as any[]).forEach(pt => visit(pt.x, pt.y));
    }
    if (!isFinite(minX)) return entities; // nothing to scale
    const dxfW = maxX - minX || 1;
    const dxfH = maxY - minY || 1;
    const pad = Math.min(targetW, targetH) * paddingFraction;
    const scale = Math.min((targetW - pad * 2) / dxfW, (targetH - pad * 2) / dxfH);
    const offX = pad - minX * scale;
    const offY = pad - minY * scale;

    const tx = (x: unknown) => typeof x === 'number' ? x * scale + offX : x;
    const ty = (y: unknown) => typeof y === 'number' ? y * scale + offY : y;

    return entities.map(e => {
        const p = { ...e.props };
        p.x1 = tx(p.x1); p.y1 = ty(p.y1);
        p.x2 = tx(p.x2); p.y2 = ty(p.y2);
        p.cx = tx(p.cx); p.cy = ty(p.cy);
        p.left = tx(p.left); p.top = ty(p.top);
        if (typeof p.r === 'number') p.r = p.r * scale;
        if (Array.isArray(p.points)) {
            p.points = (p.points as Array<{ x: number; y: number }>).map(pt => ({ x: pt.x * scale + offX, y: pt.y * scale + offY }));
        }
        return { type: e.type, props: p };
    });
}

/**
 * Main entry point: parse a DXF file and place geometry on the canvas.
 *
 * @param file  The .dxf File object from an <input> or drop
 * @param canvas  The Fabric Canvas for the current page
 * @param viewportW  Width of the canvas (pixels)
 * @param viewportH  Height of the canvas (pixels)
 */
export async function loadDxfFile(
    file: File,
    canvas: any, // Fabric Canvas
    viewportW: number,
    viewportH: number,
): Promise<number> {
    const text = await file.text();
    const parser = await getDxfParser();
    const dxf: DxfData = parser.parseSync(text);

    const raw = dxfToFabric(dxf.entities ?? []);
    const scaled = scaleToFit(raw, viewportW, viewportH);

    // Import Fabric classes dynamically (same pattern as engine)
    const fabric = await import('fabric');
    const addedObjects: any[] = [];

    for (const e of scaled) {
        const p = e.props;
        let obj: any;
        try {
            switch (e.type) {
                case 'line':
                    obj = new fabric.Line([+(p.x1 ?? 0), +(p.y1 ?? 0), +(p.x2 ?? 0), +(p.y2 ?? 0)], {
                        stroke: p.stroke as string, strokeWidth: p.strokeWidth as number ?? 1,
                        selectable: true, evented: true,
                    });
                    break;
                case 'circle':
                    obj = new fabric.Circle({
                        left: +(p.cx ?? 0) - +(p.r ?? 5),
                        top: +(p.cy ?? 0) - +(p.r ?? 5),
                        radius: +(p.r ?? 5),
                        fill: 'transparent', stroke: p.stroke as string, strokeWidth: +(p.strokeWidth ?? 1),
                        selectable: true, evented: true,
                    });
                    break;
                case 'polyline':
                    obj = new fabric.Polyline(p.points as any[], {
                        fill: 'transparent', stroke: p.stroke as string, strokeWidth: +(p.strokeWidth ?? 1),
                        selectable: true, evented: true,
                    });
                    break;
                case 'text':
                    obj = new fabric.IText(String(p.text ?? ''), {
                        left: +(p.left ?? 0), top: +(p.top ?? 0),
                        fontSize: +(p.fontSize ?? 12), fill: p.fill as string,
                        fontFamily: p.fontFamily as string ?? 'Arial',
                        selectable: true, evented: true,
                    });
                    break;
                default:
                    continue;
            }
        } catch {
            continue;
        }
        if (obj) {
            (obj as any).pdfmax_dxf = true;
            (obj as any).markupType = 'dxf-import';
            canvas.add(obj);
            addedObjects.push(obj);
        }
    }

    canvas.requestRenderAll();
    return addedObjects.length;
}
