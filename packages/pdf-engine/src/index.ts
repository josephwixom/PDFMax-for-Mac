import * as pdfjsLib from 'pdfjs-dist';
import { Canvas, Rect, Ellipse, IText, Textbox, Polyline, Polygon, Line, Group, Path, FabricObject, Circle, Point, PencilBrush, Image as FabricImage } from 'fabric';
import { CalibrationManager } from './calibration';
import type { ScaleConfig } from '@pdfmax/shared';

export { CalibrationManager };
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfEngineOptions {
    pdfUrl?: string;
    pdfData?: ArrayBuffer;
    containerId: string;
    onPageRendered?: (pageNumber: number, totalPages: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapEngine — extracts PDF vector segments and snaps to nearest point on edge
// ─────────────────────────────────────────────────────────────────────────────

interface SnapPoint { x: number; y: number; type: 'endpoint' | 'intersection' | 'midpoint' | 'nearestEdge'; }

/** A line segment in canvas-pixel space */
interface Seg { x1: number; y1: number; x2: number; y2: number; }

class SnapEngine {
    /** Segments per page (canvas-pixel coords) */
    private segs: Map<number, Seg[]> = new Map();
    /** Grid: pageNum → Map<cellKey, segment indices> — index into segs array */
    private grid: Map<number, Map<string, number[]>> = new Map();
    private readonly CELL = 64; // grid cell size in canvas pixels
    private readonly THRESHOLD = 25; // snap radius in canvas pixels

    reset() { this.segs.clear(); this.grid.clear(); }

    /**
     * Extract segments from pdfjs operator list.
     * Uses viewport.convertToViewportPoint() for correct coord transform
     * under any page rotation / CTM.
     */
    async extractPage(page: any, pageNum: number, scale: number) {
        try {
            const ops = await page.getOperatorList();
            const OPS = pdfjsLib.OPS as any;
            const viewport = page.getViewport({ scale });
            const segments: Seg[] = [];

            // ── CTM (current transform matrix) stack ──────────────────────────
            // PDF CTM: [a, b, c, d, e, f]  (column-major 3×3 affine matrix)
            // Point transform: x' = a*x + c*y + e,  y' = b*x + d*y + f
            type Mat = [number, number, number, number, number, number];
            const identityMat: Mat = [1, 0, 0, 1, 0, 0];
            let ctm: Mat = [...identityMat];
            const ctmStack: Mat[] = [];

            const matMul = (m: Mat, n: Mat): Mat => [
                m[0] * n[0] + m[2] * n[1],
                m[1] * n[0] + m[3] * n[1],
                m[0] * n[2] + m[2] * n[3],
                m[1] * n[2] + m[3] * n[3],
                m[0] * n[4] + m[2] * n[5] + m[4],
                m[1] * n[4] + m[3] * n[5] + m[5],
            ];

            // Apply accumulated CTM to a local-space point → page PDF space
            const applyCtm = (lx: number, ly: number): [number, number] => {
                const [a, b, c, d, e, f] = ctm;
                return [a * lx + c * ly + e, b * lx + d * ly + f];
            };

            // convert from PDF-space → canvas-pixel-space using pdfjs viewport
            const toCanvas = (px: number, py: number): [number, number] => {
                const [vx, vy] = viewport.convertToViewportPoint(px, py);
                return [vx, vy];
            };

            // Add a segment: coords are in CTM-local space
            const addSeg = (ax: number, ay: number, bx: number, by: number) => {
                const [pax, pay] = applyCtm(ax, ay);
                const [pbx, pby] = applyCtm(bx, by);
                const [x1, y1] = toCanvas(pax, pay);
                const [x2, y2] = toCanvas(pbx, pby);
                // Skip degenerate segments
                if (Math.abs(x2 - x1) < 0.5 && Math.abs(y2 - y1) < 0.5) return;
                segments.push({ x1, y1, x2, y2 });
            };

            const { fnArray, argsArray } = ops;

            // Current pen position (local CTM space) and subpath start
            let cx = 0, cy = 0, sx = 0, sy = 0;
            let hasOpenSubpath = false;

            /**
             * Close the current open subpath by adding a cx→sx segment if needed.
             * Called both by explicit closePath ops and by paint ops (stroke/fill)
             * that implicitly close rectangular paths.
             */
            const closeSubpath = () => {
                if (hasOpenSubpath && (cx !== sx || cy !== sy)) {
                    addSeg(cx, cy, sx, sy);
                }
                hasOpenSubpath = false;
                cx = sx; cy = sy;
            };

            /**
             * Process a single path op.
             * op: the OPS constant   coords: flat coordinate array   offset: start index
             * Returns number of coordinates consumed.
             */
            const processOp = (op: number, coords: number[], offset: number): number => {
                if (op === OPS.moveTo) {
                    cx = coords[offset]; cy = coords[offset + 1];
                    sx = cx; sy = cy;
                    hasOpenSubpath = true;
                    return 2;
                } else if (op === OPS.lineTo) {
                    const nx = coords[offset], ny = coords[offset + 1];
                    addSeg(cx, cy, nx, ny);
                    cx = nx; cy = ny;
                    hasOpenSubpath = true;
                    return 2;
                } else if (op === OPS.curveTo) {
                    const nx = coords[offset + 4], ny = coords[offset + 5];
                    addSeg(cx, cy, nx, ny);
                    cx = nx; cy = ny;
                    return 6;
                } else if (op === OPS.curveTo1) {
                    const nx = coords[offset + 2], ny = coords[offset + 3];
                    addSeg(cx, cy, nx, ny);
                    cx = nx; cy = ny;
                    return 4;
                } else if (op === OPS.curveTo2) {
                    const nx = coords[offset + 2], ny = coords[offset + 3];
                    addSeg(cx, cy, nx, ny);
                    cx = nx; cy = ny;
                    return 4;
                } else if (
                    op === OPS.closePath ||
                    (OPS as any).closeStroke !== undefined && op === (OPS as any).closeStroke ||
                    (OPS as any).closeFillStroke !== undefined && op === (OPS as any).closeFillStroke ||
                    (OPS as any).closeEOFillStroke !== undefined && op === (OPS as any).closeEOFillStroke
                ) {
                    closeSubpath();
                    return 0;
                } else if (op === OPS.rectangle) {
                    const rx = coords[offset], ry = coords[offset + 1];
                    const rw = coords[offset + 2], rh = coords[offset + 3];
                    addSeg(rx, ry, rx + rw, ry);
                    addSeg(rx + rw, ry, rx + rw, ry + rh);
                    addSeg(rx + rw, ry + rh, rx, ry + rh);
                    addSeg(rx, ry + rh, rx, ry);
                    // Update current position so subsequent ops work correctly
                    cx = rx; cy = ry;
                    sx = rx; sy = ry;
                    hasOpenSubpath = false; // rectangle is already closed
                    return 4;
                }
                return 0;
            };

            /** Paint terminators — these implicitly end/close the current path. */
            const isPaintOp = (op: number) =>
                op === (OPS as any).stroke ||
                op === (OPS as any).fill ||
                op === (OPS as any).eoFill ||
                op === (OPS as any).fillStroke ||
                op === (OPS as any).eoFillStroke ||
                op === (OPS as any).closeStroke ||
                op === (OPS as any).closeFillStroke ||
                op === (OPS as any).closeEOFillStroke;

            for (let i = 0; i < fnArray.length; i++) {
                const fn = fnArray[i];
                const args = argsArray[i];

                if (fn === OPS.save) {
                    // Push a copy of the current CTM
                    ctmStack.push([...ctm]);
                } else if (fn === OPS.restore) {
                    // Pop CTM
                    if (ctmStack.length > 0) ctm = ctmStack.pop()!;
                } else if (fn === OPS.transform) {
                    // Concatenate the new matrix onto current CTM
                    // args = [a, b, c, d, e, f]
                    const m: Mat = args as Mat;
                    ctm = matMul(ctm, m);
                } else if (OPS.constructPath !== undefined && fn === OPS.constructPath) {
                    // pdfjs batches path ops into a single operator to save overhead.
                    // args[0] is an array of sub-op codes (same OPS constants).
                    // args[1] is a flat array of all the coordinates for all sub-ops in order.
                    const subOps: number[] = args[0];
                    const coords: number[] = args[1];
                    let coordIdx = 0;
                    for (const subOp of subOps) {
                        const consumed = processOp(subOp, coords, coordIdx);
                        coordIdx += consumed;
                    }
                } else if (isPaintOp(fn)) {
                    // Paint ops (stroke/fill) implicitly close the current open subpath.
                    // This captures the missing 4th side of rectangles drawn as 3 lineTo's.
                    closeSubpath();
                } else {
                    processOp(fn, args as number[], 0);
                }
            }



            this.segs.set(pageNum, segments);
            this.buildGrid(pageNum, segments);
            if (process.env.NODE_ENV !== 'production') {
                console.debug(`[SnapEngine] page ${pageNum}: ${segments.length} segs`);
            }
        } catch (e) {
            console.warn('[SnapEngine] getOperatorList failed on page', pageNum, e);
        }
    }

    private buildGrid(pageNum: number, segments: Seg[]) {
        const g = new Map<string, number[]>();
        for (let i = 0; i < segments.length; i++) {
            // Insert segment into every cell it passes through
            const { x1, y1, x2, y2 } = segments[i];
            const cells = this.cellsForSegment(x1, y1, x2, y2);
            for (const key of cells) {
                if (!g.has(key)) g.set(key, []);
                g.get(key)!.push(i);
            }
        }
        this.grid.set(pageNum, g);
    }

    /** Return all grid cell keys that a segment potentially passes through */
    private cellsForSegment(x1: number, y1: number, x2: number, y2: number): string[] {
        const C = this.CELL;
        const gx1 = Math.floor(Math.min(x1, x2) / C) - 1;
        const gx2 = Math.floor(Math.max(x1, x2) / C) + 1;
        const gy1 = Math.floor(Math.min(y1, y2) / C) - 1;
        const gy2 = Math.floor(Math.max(y1, y2) / C) + 1;
        const cells: string[] = [];
        for (let gx = gx1; gx <= gx2; gx++) {
            for (let gy = gy1; gy <= gy2; gy++) {
                cells.push(`${gx},${gy}`);
            }
        }
        return cells;
    }

    private cellKey(x: number, y: number) {
        return `${Math.floor(x / this.CELL)},${Math.floor(y / this.CELL)}`;
    }

    /** Nearest point on a segment to point (px, py) */
    private nearestOnSeg(seg: Seg, px: number, py: number): [number, number] {
        const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return [seg.x1, seg.y1];
        const t = Math.max(0, Math.min(1, ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq));
        return [seg.x1 + t * dx, seg.y1 + t * dy];
    }

    /**
     * Compute intersection of two line segments, returns null if they don't intersect.
     * Uses parametric form: P = A + t*(B-A), Q = C + s*(D-C)
     */
    private intersectionPoint(s1: Seg, s2: Seg): [number, number] | null {
        const dx1 = s1.x2 - s1.x1, dy1 = s1.y2 - s1.y1;
        const dx2 = s2.x2 - s2.x1, dy2 = s2.y2 - s2.y1;
        const denom = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denom) < 1e-10) return null; // parallel
        const t = ((s2.x1 - s1.x1) * dy2 - (s2.y1 - s1.y1) * dx2) / denom;
        const u = ((s2.x1 - s1.x1) * dy1 - (s2.y1 - s1.y1) * dx1) / denom;
        if (t < -0.01 || t > 1.01 || u < -0.01 || u > 1.01) return null;
        return [s1.x1 + t * dx1, s1.y1 + t * dy1];
    }

    /**
     * Find the nearest snap point within THRESHOLD canvas pixels.
     * Priority order (highest first):
     *   1. Endpoints / corners (segment endpoints within threshold)
     *   2. Intersections (where two segments cross within threshold)
     *   3. Nearest point ON any segment (midpoint fallback)
     * Returns null if nothing found.
     */
    nearest(pageNum: number, cx: number, cy: number): SnapPoint | null {
        const g = this.grid.get(pageNum);
        const segments = this.segs.get(pageNum);
        if (!g || !segments) return null;

        const T = this.THRESHOLD;
        const T2 = T * T;
        const cellR = Math.ceil(T / this.CELL) + 1;
        const gx0 = Math.floor(cx / this.CELL);
        const gy0 = Math.floor(cy / this.CELL);
        const seen = new Set<number>();
        const nearby: number[] = []; // segment indices near the cursor

        // ── Pass 1: collect nearby segments + check endpoints ──────────────
        let bestEndpointDist = T2;
        let bestEndpoint: SnapPoint | null = null;

        for (let dx = -cellR; dx <= cellR; dx++) {
            for (let dy = -cellR; dy <= cellR; dy++) {
                const key = `${gx0 + dx},${gy0 + dy}`;
                const indices = g.get(key);
                if (!indices) continue;
                for (const i of indices) {
                    if (seen.has(i)) continue;
                    seen.add(i);
                    nearby.push(i);

                    const seg = segments[i];
                    // Check both endpoints of this segment
                    for (const [ex, ey] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as [number, number][]) {
                        const d2 = (ex - cx) ** 2 + (ey - cy) ** 2;
                        if (d2 < bestEndpointDist) {
                            bestEndpointDist = d2;
                            bestEndpoint = { x: ex, y: ey, type: 'endpoint' };
                        }
                    }
                }
            }
        }

        // Endpoints win if found — return immediately for perfect corner snapping
        if (bestEndpoint) return bestEndpoint;

        // ── Pass 2: check intersections between nearby segment pairs ──────
        // Only run if no endpoint was found (keeps it fast)
        let bestIntersectionDist = T2;
        let bestIntersection: SnapPoint | null = null;

        for (let i = 0; i < nearby.length; i++) {
            for (let j = i + 1; j < nearby.length; j++) {
                const pt = this.intersectionPoint(segments[nearby[i]], segments[nearby[j]]);
                if (!pt) continue;
                const d2 = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
                if (d2 < bestIntersectionDist) {
                    bestIntersectionDist = d2;
                    bestIntersection = { x: pt[0], y: pt[1], type: 'intersection' };
                }
            }
        }

        if (bestIntersection) return bestIntersection;

        // ── Pass 3: nearest point ON any segment ─────────────────────────
        // Distinguish true geometric midpoint (t ≈ 0.5) from nearest-edge snap.
        let bestEdgeDist = T2;
        let bestEdge: SnapPoint | null = null;

        for (const i of nearby) {
            const seg = segments[i];
            const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) continue;
            const t = Math.max(0, Math.min(1, ((cx - seg.x1) * dx + (cy - seg.y1) * dy) / lenSq));
            const nx = seg.x1 + t * dx, ny = seg.y1 + t * dy;
            const d2 = (nx - cx) ** 2 + (ny - cy) ** 2;
            if (d2 < bestEdgeDist) {
                bestEdgeDist = d2;
                // True midpoint if projection param t is within 10% of 0.5
                const type: SnapPoint['type'] = Math.abs(t - 0.5) < 0.1 ? 'midpoint' : 'nearestEdge';
                bestEdge = { x: nx, y: ny, type };
            }
        }

        return bestEdge;
    }

    // ── Grid snap support ────────────────────────────────────────────────────
    gridSnapEnabled = false;
    gridSize = 20; // canvas pixels — default 20px

    /**
     * Snap a point to the nearest grid intersection when grid snap is active.
     * Grid snap is a fallback: vector snaps (endpoint, intersection, midpoint) take priority.
     */
    nearestGrid(cx: number, cy: number): SnapPoint {
        const g = this.gridSize;
        return {
            x: Math.round(cx / g) * g,
            y: Math.round(cy / g) * g,
            type: 'nearestEdge',
        };
    }

    /** Convenience: nearest vector snap OR grid snap, whichever applies. */
    nearestWithGrid(pageNum: number, cx: number, cy: number): SnapPoint | null {
        const vectorSnap = this.nearest(pageNum, cx, cy);
        if (vectorSnap) return vectorSnap;           // vector snap wins
        if (this.gridSnapEnabled) return this.nearestGrid(cx, cy);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Revision cloud path generator (module-level helper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an SVG path string that traces a rectangle with scalloped/bumpy edges
 * — identical to a Bluebeam/PDF revision cloud annotation.
 */
function makeRevisionCloudPath(x: number, y: number, w: number, h: number, bump = 0): string {
    const r = bump > 0 ? bump : Math.max(10, Math.min(20, Math.min(w, h) / 6));
    const arc = (_x1: number, _y1: number, x2: number, y2: number) =>
        `A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const parts: string[] = [];

    // Top edge: left → right
    const topBumps = Math.max(2, Math.round(w / (r * 2)));
    const topStep = w / topBumps;
    parts.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
    for (let i = 0; i < topBumps; i++)
        parts.push(arc(x + i * topStep, y, x + (i + 1) * topStep, y));

    // Right edge: top → bottom
    const rightBumps = Math.max(2, Math.round(h / (r * 2)));
    const rightStep = h / rightBumps;
    for (let i = 0; i < rightBumps; i++)
        parts.push(arc(x + w, y + i * rightStep, x + w, y + (i + 1) * rightStep));

    // Bottom edge: right → left
    const botBumps = Math.max(2, Math.round(w / (r * 2)));
    const botStep = w / botBumps;
    for (let i = 0; i < botBumps; i++)
        parts.push(arc(x + w - i * botStep, y + h, x + w - (i + 1) * botStep, y + h));

    // Left edge: bottom → top
    const leftBumps = Math.max(2, Math.round(h / (r * 2)));
    const leftStep = h / leftBumps;
    for (let i = 0; i < leftBumps; i++)
        parts.push(arc(x, y + h - i * leftStep, x, y + h - (i + 1) * leftStep));

    parts.push('Z');
    return parts.join(' ');
}


export class PdfEngine {
    private pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
    private canvasMap: Map<number, HTMLCanvasElement> = new Map();

    /** Expose the rendered PDF page canvas for redaction compositing */
    public getCanvasForPage(pageNumber: number): HTMLCanvasElement | undefined {
        return this.canvasMap.get(pageNumber);
    }
    private annotationLayers: Map<number, any> = new Map(); // Fabric canvases
    private container: HTMLElement;
    public calibration: CalibrationManager = new CalibrationManager();
    /** Callback invoked after a calibration line is drawn; UI should show modal */
    public onCalibrationLine?: (pageNumber: number, pixelLength: number) => void;
    /** Callback invoked when the Fabric selection changes; receives the active object or null */
    public onSelectionChanged?: (obj: any | null) => void;

    // ── Snapping ──────────────────────────────────────────────────────────────
    private snapEngine = new SnapEngine();
    private snapEnabled = true;
    /** Per-page render scales stored so snapPoint() can communicate with SnapEngine */
    private pageScales: Map<number, number> = new Map();
    /** Fabric Circle used as the snap indicator on the active canvas */
    // Per-canvas snap indicator circles (one per page canvas)
    private snapIndicators: Map<any, Circle> = new Map();
    private lastSnapCanvas: any = null;
    /** The drawn calibration line — kept so we can remove it after scale is confirmed */
    private activeCalibLine: Line | null = null;
    private activeCalibCanvas: any = null;

    // ── Count / Sequence numbering ─────────────────────────────────────────────
    /** Per-page running counter for the measure-count stamp tool.
     *  Persists across tool switches so sequences continue where they left off. */
    private countSequences: Map<number, number> = new Map();

    /** Return the next count number for `pageNum` without incrementing (peek). */
    getCountSequence(pageNum: number): number {
        return this.countSequences.get(pageNum) ?? 1;
    }

    /** Reset the sequence counter for `pageNum` back to 1 (or a custom start). */
    resetCountSequence(pageNum: number, startFrom = 1) {
        this.countSequences.set(pageNum, startFrom);
        // Dispatch so the UI can refresh any displayed counter
        window.dispatchEvent(new CustomEvent('pdfmax:count-sequence-changed', { detail: { page: pageNum, next: startFrom } }));
    }

    constructor(private options: PdfEngineOptions) {
        const el = document.getElementById(options.containerId);
        if (!el) throw new Error(`Container ${options.containerId} not found`);
        this.container = el;
    }

    get numPages(): number {
        return this.pdfDocument?.numPages ?? 0;
    }

    async loadDocument() {
        try {
            const src = this.options.pdfData
                ? { data: this.options.pdfData }
                : { url: this.options.pdfUrl! };
            this.pdfDocument = await pdfjsLib.getDocument(src).promise;
            return this.pdfDocument.numPages;
        } catch (error) {
            console.error('Error loading PDF:', error);
            throw error;
        }
    }

    /** Reload with a new URL (e.g. after file picker) and re-render all pages */
    async reloadDocument(url: string, data?: ArrayBuffer) {
        // Clear the existing pages from the DOM
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        this.canvasMap.clear();
        this.annotationLayers.clear();
        this.calibration = new CalibrationManager();
        this.snapEngine.reset();
        this.pageScales.clear();
        this.snapIndicators.clear();
        this.lastSnapCanvas = null;

        if (data) {
            (this.options as any).pdfData = data;
            (this.options as any).pdfUrl = undefined;
        } else {
            (this.options as any).pdfUrl = url;
            (this.options as any).pdfData = undefined;
        }
        this.pdfDocument = null;
        await this.loadDocument();
        await this.renderAllPages(1.5);
    }

    async renderPage(pageNumber: number, scale = 1.0) {
        if (!this.pdfDocument) throw new Error('Document not loaded');

        const page = await this.pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        // Create wrapper for the page
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper';
        pageWrapper.dataset.page = String(pageNumber);
        pageWrapper.style.position = 'relative';
        pageWrapper.style.width = `${viewport.width}px`;
        pageWrapper.style.height = `${viewport.height}px`;
        pageWrapper.style.marginBottom = '20px'; // Spacing between pages
        pageWrapper.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1)';

        // 1. PDF.js Base Canvas — raster render of the PDF page
        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        pdfCanvas.style.display = 'block';
        pdfCanvas.style.pointerEvents = 'none'; // annotation layer intercepts all events

        const context = pdfCanvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context not available');
        await page.render({ canvasContext: context, viewport }).promise;

        pageWrapper.appendChild(pdfCanvas);
        this.canvasMap.set(pageNumber, pdfCanvas);

        // Append wrapper to the live DOM BEFORE Fabric init
        // so Fabric's internal DOM mutations are in the document.
        this.container.appendChild(pageWrapper);

        // 3. Fabric.js Annotation Layer
        const annotationCanvas = document.createElement('canvas');
        annotationCanvas.id = `annotation-layer-${pageNumber}`;
        annotationCanvas.width = viewport.width;
        annotationCanvas.height = viewport.height;
        pageWrapper.appendChild(annotationCanvas);

        // Initialize Fabric.js AFTER the wrapper is in the live DOM
        const fabricCanvas = new Canvas(`annotation-layer-${pageNumber}`, {
            isDrawingMode: false,
            width: viewport.width,
            height: viewport.height,
        });

        // ─────────────────────────────────────────────────────────────────────
        // Style the Fabric wrapper (.canvas-container) that Fabric creates.
        // We query it from the live DOM; it reliably exists post-initialization.
        // ─────────────────────────────────────────────────────────────────────
        const applyCanvasStyles = () => {
            const canvasContainer = pageWrapper.querySelector('.canvas-container') as HTMLElement | null;
            if (canvasContainer) {
                canvasContainer.style.position = 'absolute';
                canvasContainer.style.top = '0';
                canvasContainer.style.left = '0';
                canvasContainer.style.width = `${viewport.width}px`;
                canvasContainer.style.height = `${viewport.height}px`;
                canvasContainer.style.zIndex = '10';
                canvasContainer.style.pointerEvents = 'all';
                canvasContainer.style.overflow = 'hidden';
            }
            const upperCanvas = pageWrapper.querySelector('.upper-canvas') as HTMLElement | null;
            if (upperCanvas) {
                upperCanvas.style.pointerEvents = 'all';
                // Cursor is managed per-tool by setTool(); default is crosshair
                upperCanvas.style.cursor = 'crosshair';
            }
        };

        applyCanvasStyles();
        // Backup: apply after next tick in case Fabric hasn't mutated the DOM yet
        setTimeout(applyCanvasStyles, 0);

        this.annotationLayers.set(pageNumber, fabricCanvas);
        this.pageScales.set(pageNumber, scale);
        this.wireSelectionCallbacks(fabricCanvas);
        this.initHistory(pageNumber, fabricCanvas);

        // Lazily extract snap points for this page (non-blocking)
        const pdfPage = await this.pdfDocument!.getPage(pageNumber);
        this.snapEngine.extractPage(pdfPage, pageNumber, scale);

        // ── Native AcroForm field overlay ─────────────────────────────────────
        // Read all widget annotations from the PDF page and render interactive
        // HTML inputs on top of the Fabric canvas (z-index: 20).
        try {
            await this.renderNativeFormFields(pageNumber, pdfPage, viewport, pageWrapper);
        } catch (err) {
            console.warn('[engine] AcroForm overlay failed for page', pageNumber, err);
        }

        if (this.options.onPageRendered) {
            this.options.onPageRendered(pageNumber, this.numPages);
        }

        return fabricCanvas;
    }

    /** Render every page in the document sequentially */
    async renderAllPages(scale = 1.5) {
        if (!this.pdfDocument) throw new Error('Document not loaded');
        for (let i = 1; i <= this.pdfDocument.numPages; i++) {
            await this.renderPage(i, scale);
        }
    }

    /**
     * Render a single page to a small detached canvas for thumbnail display.
     * Returns the HTMLCanvasElement — caller is responsible for appending it to the DOM.
     */
    async renderThumbnail(pageNumber: number, thumbScale = 0.12): Promise<HTMLCanvasElement> {
        if (!this.pdfDocument) throw new Error('Document not loaded');
        const page = await this.pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale: thumbScale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable');
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Native AcroForm Field Overlay
    // Reads widget annotations from the raw PDF via pdf.js getAnnotations(),
    // maps their rects from PDF-space → canvas-pixel-space, and places
    // interactive HTML inputs on a transparent overlay div (z-index: 20)
    // that sits above the Fabric annotation layer.
    // ───────────────────────────────────────────────────────────────────────

    /** Stores the overlay <div> per page so we can later collect field values */
    private nativeFormFieldOverlays: Map<number, HTMLElement> = new Map();

    private async renderNativeFormFields(
        pageNumber: number,
        pdfPage: pdfjsLib.PDFPageProxy,
        viewport: ReturnType<pdfjsLib.PDFPageProxy['getViewport']>,
        pageWrapper: HTMLElement,
    ): Promise<void> {
        const annotations = await pdfPage.getAnnotations();
        const widgets = annotations.filter((a: any) => a.subtype === 'Widget');
        if (widgets.length === 0) return;

        // Remove any existing overlay for this page
        const old = this.nativeFormFieldOverlays.get(pageNumber);
        old?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'pdfmax-form-overlay';
        overlay.dataset.page = String(pageNumber);
        overlay.style.cssText = [
            'position:absolute', 'top:0', 'left:0',
            `width:${viewport.width}px`, `height:${viewport.height}px`,
            'z-index:20', 'pointer-events:none', 'overflow:hidden',
        ].join(';');

        const baseStyle = [
            'position:absolute',
            'box-sizing:border-box',
            'font-family:sans-serif',
            'font-size:11px',
            'border:1.5px solid #3b82f6',
            'border-radius:2px',
            'background:rgba(255,255,255,0.92)',
            'color:#111',
            'padding:2px 4px',
            'pointer-events:all',
            'outline:none',
            'cursor:text',
        ].join(';');

        for (const ann of widgets) {
            // PDF rect: [x1, y1, x2, y2] in PDF points (bottom-left origin)
            const [rx1, ry1, rx2, ry2]: number[] = ann.rect;
            // pdf.js viewport maps PDF space → canvas-pixel space
            const [cx1, cy1] = viewport.convertToViewportPoint(rx1, ry2); // top-left
            const [cx2, cy2] = viewport.convertToViewportPoint(rx2, ry1); // bottom-right
            const x = Math.min(cx1, cx2);
            const y = Math.min(cy1, cy2);
            const w = Math.abs(cx2 - cx1);
            const h = Math.abs(cy2 - cy1);
            if (w < 2 || h < 2) continue;

            const fieldType: string = (ann.fieldType ?? 'Tx').toUpperCase();
            const fieldName: string = ann.fieldName ?? '';
            const defaultValue: string = ann.fieldValue ?? ann.defaultFieldValue ?? '';

            let el: HTMLElement;

            if (fieldType === 'Tx') {
                // Text field
                const isMultiline = !!(ann.multiLine);
                if (isMultiline) {
                    const ta = document.createElement('textarea');
                    ta.name = fieldName;
                    ta.defaultValue = defaultValue;
                    ta.rows = Math.max(2, Math.round(h / 14));
                    ta.style.cssText = `${baseStyle};left:${x}px;top:${y}px;width:${w}px;height:${h}px;resize:none;`;
                    el = ta;
                } else {
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.name = fieldName;
                    inp.defaultValue = defaultValue;
                    const isPassword = ann.password;
                    if (isPassword) inp.type = 'password';
                    inp.style.cssText = `${baseStyle};left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
                    el = inp;
                }
            } else if (fieldType === 'Btn') {
                const isCheckbox = !(ann.radioButton);
                const inp = document.createElement('input');
                inp.type = isCheckbox ? 'checkbox' : 'radio';
                inp.name = fieldName;
                inp.checked = defaultValue === 'Yes' || defaultValue === 'On';
                const size = Math.min(w, h);
                inp.style.cssText = `position:absolute;left:${x + (w - size) / 2}px;top:${y + (h - size) / 2}px;width:${size}px;height:${size}px;pointer-events:all;cursor:pointer;`;
                el = inp;
            } else if (fieldType === 'Ch') {
                // Choice / dropdown / listbox
                const sel = document.createElement('select');
                sel.name = fieldName;
                const opts: string[] = ann.options?.map((o: any) => (typeof o === 'string' ? o : o.displayValue ?? o.exportValue ?? '')) ?? [];
                for (const opt of opts) {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.textContent = opt;
                    if (opt === defaultValue) option.selected = true;
                    sel.appendChild(option);
                }
                sel.style.cssText = `${baseStyle};left:${x}px;top:${y}px;width:${w}px;height:${h}px;cursor:pointer;`;
                el = sel;
            } else {
                // Unknown / button widget — render a placeholder div
                el = document.createElement('div');
                el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:1px dashed #6b7280;pointer-events:none;`;
            }

            // Tag each input with field metadata for export collection
            (el as any).__pdfmaxField = { fieldName, fieldType, pageNumber };
            overlay.appendChild(el);
        }

        pageWrapper.appendChild(overlay);
        this.nativeFormFieldOverlays.set(pageNumber, overlay);
    }

    /**
     * Collect current form field values from all native AcroForm overlays.
     * Returns a map of { pageNumber → [{ fieldName, fieldType, value }] }
     */
    getNativeFormFieldValues(): Map<number, { fieldName: string; fieldType: string; value: string }[]> {
        const result = new Map<number, { fieldName: string; fieldType: string; value: string }[]>();
        for (const [page, overlay] of this.nativeFormFieldOverlays) {
            const fields: { fieldName: string; fieldType: string; value: string }[] = [];
            const inputs = Array.from(overlay.querySelectorAll('input, textarea, select'));
            for (const inp of inputs) {
                const meta = (inp as any).__pdfmaxField;
                if (!meta) continue;
                let value = '';
                if (inp instanceof HTMLInputElement && (inp.type === 'checkbox' || inp.type === 'radio')) {
                    value = inp.checked ? 'Yes' : 'Off';
                } else if (inp instanceof HTMLInputElement || inp instanceof HTMLTextAreaElement) {
                    value = inp.value;
                } else if (inp instanceof HTMLSelectElement) {
                    value = inp.value;
                }
                fields.push({ fieldName: meta.fieldName, fieldType: meta.fieldType, value });
            }
            if (fields.length > 0) result.set(page, fields);
        }
        return result;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Page Management (pdf-lib mutations)
    // ───────────────────────────────────────────────────────────────────────

    /** Export the current raw PDF bytes from pdfjs. */
    async getPdfBytes(): Promise<Uint8Array> {
        if (!this.pdfDocument) throw new Error('Document not loaded');
        return new Uint8Array(await (this.pdfDocument as any).getData());
    }

    // ───────────────────────────────────────────────────────────────────────
    // Text Search
    // ───────────────────────────────────────────────────────────────────────

    /** Match result — one rectangle per matched string occurrence */
    private searchHighlightEls: HTMLElement[] = [];

    /**
     * Search all pages for `query` (case-insensitive).
     * Returns an array of { page, rect } objects with canvas-pixel coordinates.
     * Renders yellow highlight <div>s directly on each pdf-page-wrapper.
     */
    async searchText(query: string): Promise<{ page: number; index: number; rect: DOMRect }[]> {
        this.clearSearchHighlights();
        if (!this.pdfDocument || !query.trim()) return [];

        const q = query.toLowerCase();
        const results: { page: number; index: number; rect: DOMRect }[] = [];
        let globalIndex = 0;

        for (let pageNum = 1; pageNum <= this.pdfDocument.numPages; pageNum++) {
            const page = await this.pdfDocument.getPage(pageNum);
            const scale = this.pageScales.get(pageNum) ?? 1.5;
            const viewport = page.getViewport({ scale });
            const textContent = await page.getTextContent();

            // Concatenate text items with space separators but track item boundaries
            type ItemMeta = { start: number; end: number; item: any };
            const metas: ItemMeta[] = [];
            let full = '';

            for (const rawItem of textContent.items as any[]) {
                const str: string = rawItem.str ?? '';
                const start = full.length;
                full += str;
                metas.push({ start, end: full.length, item: rawItem });
                if (rawItem.hasEOL) full += '\n'; else full += ' ';
            }

            // Find all occurrences of `q` in the full page string
            const lc = full.toLowerCase();
            let pos = 0;
            while ((pos = lc.indexOf(q, pos)) !== -1) {
                // Find which item(s) this match falls in — use leftmost item
                const meta = metas.find(m => pos >= m.start && pos < m.end);
                if (meta) {
                    const itm = meta.item;
                    // Transform: [scaleX, skewY, skewX, scaleY, tx, ty] (PDF user space)
                    const tx: number[] = itm.transform;
                    // Convert PDF point → canvas pixel via pdfjs viewport
                    // tx[4],tx[5] = text anchor (baseline, left edge) in PDF space
                    const [cx, cy] = viewport.convertToViewportPoint(tx[4], tx[5]);
                    // Font height in screen pixels: convert a point one font-unit above baseline
                    const fontSize = Math.abs(tx[3]); // font size in PDF user space
                    const [, cyTop] = viewport.convertToViewportPoint(tx[4], tx[5] + fontSize);
                    // cyTop < cy because screen Y is inverted (top-left origin)
                    const lineH = Math.max(cy - cyTop, 6); // height in screen px, min 6px
                    const charWidth = (itm.width / (itm.str?.length || 1)) * scale;
                    const charOffset = (pos - meta.start) * charWidth;
                    const matchW = q.length * charWidth;

                    const PAD = lineH * 0.1; // small vertical padding
                    // Build a DOM rect: top = cy - lineH (above baseline), height covers ascent+descent
                    const rect = new DOMRect(
                        cx + charOffset - 1,
                        cy - lineH - PAD,
                        matchW + 2,
                        lineH + PAD * 2,
                    );

                    results.push({ page: pageNum, index: globalIndex, rect });

                    // Render highlight overlay
                    const wrapper = this.container.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${pageNum}"]`);
                    if (wrapper) {
                        const hl = document.createElement('div');
                        hl.className = 'pdfmax-search-hl';
                        hl.dataset.searchIndex = String(globalIndex);
                        hl.style.cssText = `
                            position:absolute;
                            left:${rect.x}px;top:${rect.y}px;
                            width:${rect.width}px;height:${rect.height}px;
                            background:rgba(253,224,71,0.65);
                            outline:1.5px solid rgba(202,138,4,0.85);
                            border-radius:2px;
                            pointer-events:none;
                            z-index:30;
                        `;
                        wrapper.appendChild(hl);
                        this.searchHighlightEls.push(hl);
                    }

                    globalIndex++;
                }
                pos += q.length; // avoid overlapping
            }
        }

        return results;
    }

    /** Highlight the active (current) match differently from the rest. */
    setActiveSearchMatch(index: number) {
        for (const el of this.searchHighlightEls) {
            const isActive = el.dataset.searchIndex === String(index);
            el.style.background = isActive
                ? 'rgba(249,115,22,0.80)'   // vivid orange = current
                : 'rgba(253,224,71,0.65)';  // yellow = other
            el.style.outline = isActive
                ? '1.5px solid rgba(194,65,12,0.95)'
                : '1.5px solid rgba(202,138,4,0.85)';
        }
    }

    /** Remove all search highlight divs from the DOM. */
    clearSearchHighlights() {
        for (const el of this.searchHighlightEls) el.remove();
        this.searchHighlightEls = [];
    }

    /** Place an image (data URL) as a movable/resizable stamp on the current page. */
    async addImageStamp(dataUrl: string) {
        const pageNum = (window as any).__pdfMaxCurrentPage ?? 1;
        const canvas = this.annotationLayers.get(pageNum);
        if (!canvas) return;

        // Load image using Fabric's static fromURL
        const img = await FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });

        // Scale to fit within 40% of canvas width/height, preserving aspect ratio
        const maxW = (canvas.width ?? 800) * 0.4;
        const maxH = (canvas.height ?? 600) * 0.4;
        const scale = Math.min(maxW / (img.width || 1), maxH / (img.height || 1), 1);
        img.set({
            left: ((canvas.width ?? 800) - (img.width ?? 0) * scale) / 2,
            top: ((canvas.height ?? 600) - (img.height ?? 0) * scale) / 2,
            scaleX: scale,
            scaleY: scale,
            selectable: true,
            evented: true,
        });
        (img as any).markupType = 'image-stamp';
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        this.emitHistoryChanged();
    }

    /** Place a form field placeholder on the current page. */
    addFormField(fieldType: 'text' | 'checkbox' | 'dropdown' | 'radio', fieldName?: string) {
        const pageNum = (window as any).__pdfMaxCurrentPage ?? 1;
        const canvas = this.annotationLayers.get(pageNum);
        if (!canvas) return;

        const cw = canvas.width ?? 800;
        const ch = canvas.height ?? 600;
        const cx = cw / 2;
        const cy = ch / 2;

        const COLOR: Record<string, string> = {
            text: '#3b82f6',
            checkbox: '#10b981',
            dropdown: '#f59e0b',
            radio: '#8b5cf6',
        };
        const color = COLOR[fieldType] ?? '#6366f1';
        const uniqueName = fieldName ?? `${fieldType}_${Date.now()}`;

        let rect: any;
        if (fieldType === 'checkbox' || fieldType === 'radio') {
            // Small square / circle-ish shape
            const size = 20;
            rect = new Rect({
                left: cx - size / 2,
                top: cy - size / 2,
                width: size,
                height: size,
                fill: 'rgba(255,255,255,0.9)',
                stroke: color,
                strokeWidth: 2,
                strokeDashArray: [4, 2],
                rx: fieldType === 'radio' ? 10 : 2,
                ry: fieldType === 'radio' ? 10 : 2,
                selectable: true,
                evented: true,
            });
        } else {
            // Text / dropdown — wider rect
            const w = fieldType === 'dropdown' ? 160 : 200;
            const h = 28;
            rect = new Rect({
                left: cx - w / 2,
                top: cy - h / 2,
                width: w,
                height: h,
                fill: 'rgba(255,255,255,0.9)',
                stroke: color,
                strokeWidth: 1.5,
                strokeDashArray: [5, 3],
                rx: 3, ry: 3,
                selectable: true,
                evented: true,
            });
        }

        // Metadata used by pdfExporter for AcroForm writing
        (rect as any).pdfmax_formfield = {
            type: fieldType,
            name: uniqueName,
            required: false,
            defaultValue: '',
            color,
        };
        (rect as any).markupType = 'form-field';
        (rect as any).excludeFromExport = false; // will be handled specially in exporter

        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.requestRenderAll();
        this.emitHistoryChanged();
        window.dispatchEvent(new CustomEvent('pdfmax:selection-changed', { detail: { obj: rect } }));
    }

    /**
     * Remap markups from old page numbers to new page numbers.
     * `pageMap[oldPage] = newPage`, missing = page was deleted.
     */
    private remapMarkups(pageMap: Record<number, number>): Record<string, any> {
        const allMarkups = this.exportMarkups();
        const remapped: Record<string, any> = {};
        for (const [keyStr, data] of Object.entries(allMarkups)) {
            const oldPage = parseInt(keyStr, 10);
            const newPage = pageMap[oldPage];
            if (newPage != null) {
                remapped[String(newPage)] = data;
            }
        }
        return remapped;
    }

    private async reloadWithBytes(bytes: Uint8Array, pageMap: Record<number, number>): Promise<void> {
        // Save remapped markups before destroying canvases/pdfDocument
        const remappedMarkups = this.remapMarkups(pageMap);
        // Reload renders all pages from scratch
        await this.reloadDocument('', bytes.buffer as ArrayBuffer);
        // Restore remapped markups
        await this.loadMarkupsFromJSON(remappedMarkups);
        window.dispatchEvent(new CustomEvent('pdfmax:pages-changed'));
    }

    /** Delete a single page (1-based). */
    async deletePage(pageNum: number): Promise<void> {
        const { PDFDocument } = await import('pdf-lib');
        const bytes = await this.getPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        const total = pdfDoc.getPageCount();
        if (total <= 1) { alert('Cannot delete the only page.'); return; }
        pdfDoc.removePage(pageNum - 1);
        const newBytes = await pdfDoc.save();
        // Build page map: pages before deleted stay same, pages after shift down by 1
        const pageMap: Record<number, number> = {};
        for (let i = 1; i <= total; i++) {
            if (i < pageNum) pageMap[i] = i;
            else if (i > pageNum) pageMap[i] = i - 1;
            // i === pageNum → deleted, no mapping
        }
        await this.reloadWithBytes(newBytes, pageMap);
    }

    /** Rotate a single page (1-based) by the given clockwise degrees. */
    async rotatePage(pageNum: number, degrees: 90 | 180 | 270): Promise<void> {
        const { PDFDocument, degrees: deg } = await import('pdf-lib');
        const bytes = await this.getPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        const total = pdfDoc.getPageCount();
        const page = pdfDoc.getPage(pageNum - 1);
        const current = page.getRotation().angle;
        page.setRotation(deg((current + degrees) % 360));
        const newBytes = await pdfDoc.save();
        // Rotation doesn't change page numbers
        const pageMap: Record<number, number> = {};
        for (let i = 1; i <= total; i++) pageMap[i] = i;
        await this.reloadWithBytes(newBytes, pageMap);
    }

    /**
     * Reorder pages. `newOrder` is a 1-based array specifying the original page
     * at each new position, e.g. [3, 1, 2] means: new p1 = old p3, new p2 = old p1, new p3 = old p2.
     */
    async reorderPages(newOrder: number[]): Promise<void> {
        const { PDFDocument } = await import('pdf-lib');
        const bytes = await this.getPdfBytes();
        const src = await PDFDocument.load(bytes);
        const dst = await PDFDocument.create();
        const copied = await dst.copyPages(src, newOrder.map(p => p - 1));
        copied.forEach(p => dst.addPage(p));
        const newBytes = await dst.save();
        // pageMap[oldPage] = newPage
        const pageMap: Record<number, number> = {};
        newOrder.forEach((oldPage, newIdx) => { pageMap[oldPage] = newIdx + 1; });
        await this.reloadWithBytes(newBytes, pageMap);
    }

    /** Insert a blank A4 page after `afterPage` (0 = before first page). */
    async insertBlankPage(afterPage: number, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<void> {
        const { PDFDocument, PageSizes } = await import('pdf-lib');
        const bytes = await this.getPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        const total = pdfDoc.getPageCount();
        const size: [number, number] = orientation === 'portrait' ? PageSizes.A4 : [PageSizes.A4[1], PageSizes.A4[0]];
        const newPage = pdfDoc.insertPage(afterPage, size);
        void newPage; // blank page, no content
        const newBytes = await pdfDoc.save();
        // Pages after the insertion point shift up by 1
        const pageMap: Record<number, number> = {};
        for (let i = 1; i <= total; i++) {
            pageMap[i] = i <= afterPage ? i : i + 1;
        }
        await this.reloadWithBytes(newBytes, pageMap);
    }

    /** Append another PDF's pages after `insertAfter` (0 = prepend). */
    async combinePdf(bytes: Uint8Array, insertAfter: number): Promise<void> {
        const { PDFDocument } = await import('pdf-lib');
        const existingBytes = await this.getPdfBytes();
        const dst = await PDFDocument.load(existingBytes);
        const src = await PDFDocument.load(bytes);
        const existingTotal = dst.getPageCount();
        const srcTotal = src.getPageCount();
        const srcPages = await dst.copyPages(src, Array.from({ length: srcTotal }, (_, i) => i));
        // Insert each src page after insertAfter position
        srcPages.forEach((p, i) => dst.insertPage(insertAfter + i, p));
        const newBytes = await dst.save();
        // Existing pages after insertAfter shift up by srcTotal
        const pageMap: Record<number, number> = {};
        for (let i = 1; i <= existingTotal; i++) {
            pageMap[i] = i <= insertAfter ? i : i + srcTotal;
        }
        await this.reloadWithBytes(newBytes, pageMap);
    }

    /**
     * Extract specific pages (1-based) from the current document into a new PDF
     * and trigger a browser download.
     */
    async extractPages(pages: number[], filename = 'extracted.pdf'): Promise<void> {
        const { PDFDocument } = await import('pdf-lib');
        const srcBytes = await this.getPdfBytes();
        const src = await PDFDocument.load(srcBytes);
        const dst = await PDFDocument.create();
        const indices = pages.map(p => p - 1).filter(i => i >= 0 && i < src.getPageCount());
        const copied = await dst.copyPages(src, indices);
        copied.forEach(p => dst.addPage(p));
        const outBytes = await dst.save();
        this._downloadPdf(outBytes, filename);
    }

    /**
     * Split the document at `splitAfterPage` (1-based).
     * Downloads two PDFs: pages 1–N and pages N+1–end.
     */
    async splitPdf(splitAfterPage: number): Promise<void> {
        const { PDFDocument } = await import('pdf-lib');
        const srcBytes = await this.getPdfBytes();
        const src = await PDFDocument.load(srcBytes);
        const total = src.getPageCount();

        const partA = await PDFDocument.create();
        const partB = await PDFDocument.create();

        const idxA = Array.from({ length: splitAfterPage }, (_, i) => i);
        const idxB = Array.from({ length: total - splitAfterPage }, (_, i) => splitAfterPage + i);

        const copiedA = await partA.copyPages(src, idxA);
        copiedA.forEach(p => partA.addPage(p));

        const copiedB = await partB.copyPages(src, idxB);
        copiedB.forEach(p => partB.addPage(p));

        this._downloadPdf(await partA.save(), `part1_pp1-${splitAfterPage}.pdf`);
        await new Promise(r => setTimeout(r, 300)); // brief pause between downloads
        this._downloadPdf(await partB.save(), `part2_pp${splitAfterPage + 1}-${total}.pdf`);
    }

    private _downloadPdf(bytes: Uint8Array, filename: string): void {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ───────────────────────────────────────────────────────────────────────
    // Markup Layers
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Apply a layer visibility snapshot to all annotation layers.
     * `layers` is the array from the LayerStore: [{ id, name, visible, locked }]
     */
    applyLayerVisibility(layers: Array<{ id: string; name: string; visible: boolean; locked: boolean }>) {
        const visMap = new Map<string, boolean>();
        const lockMap = new Map<string, boolean>();
        for (const l of layers) {
            visMap.set(l.name, l.visible);
            lockMap.set(l.name, l.locked);
        }

        this.annotationLayers.forEach((canvas) => {
            let needsRender = false;
            canvas.getObjects().forEach((obj: any) => {
                const layerName: string = obj.pdfmaxLayer ?? 'Default';
                const visible = visMap.get(layerName) ?? true;
                const locked = lockMap.get(layerName) ?? false;

                if (obj.visible !== visible) {
                    obj.visible = visible;
                    needsRender = true;
                }
                // Locked: prevent selection + evented
                const shouldBeSelectable = !locked;
                if (obj.selectable !== shouldBeSelectable) {
                    obj.selectable = shouldBeSelectable;
                    obj.evented = shouldBeSelectable;
                    needsRender = true;
                }
            });
            if (needsRender) canvas.renderAll();
        });
    }

    /**
     * Assign the active (selected) Fabric object(s) to a layer.
     * Also stamps the active layer on any newly created objects if called
     * with the layer name right after creation.
     */
    setActiveObjectLayer(layerName: string) {
        this.annotationLayers.forEach((canvas) => {
            const active = canvas.getActiveObject() as any;
            if (!active) return;
            const targets = active.type === 'activeSelection'
                ? active._objects
                : [active];
            for (const obj of targets) {
                obj.pdfmaxLayer = layerName;
            }
            canvas.renderAll();
        });
    }

    /**
     * Stamp the active layer on the most recently added object to each canvas.
     * Call this immediately after adding a new markup.
     */
    stampActiveLayer(layerName: string) {
        this.annotationLayers.forEach((canvas) => {
            const objs = canvas.getObjects();
            if (!objs.length) return;
            const last = objs[objs.length - 1] as any;
            if (!last.pdfmaxLayer) last.pdfmaxLayer = layerName;
        });
    }

    /** Return unique layer names present across all pages */
    getLayerNamesInUse(): string[] {
        const names = new Set<string>();
        this.annotationLayers.forEach((canvas) => {
            canvas.getObjects().forEach((obj: any) => {
                names.add(obj.pdfmaxLayer ?? 'Default');
            });
        });
        return Array.from(names);
    }


    // ───────────────────────────────────────────────────────────────────────
    // Snapping public API + helpers
    // ───────────────────────────────────────────────────────────────────────

    /** Toggle snap-to-PDF-vectors globally. */
    setSnapEnabled(enabled: boolean) {
        this.snapEnabled = enabled;
        if (!enabled) this.hideSnapIndicator();
    }

    /** Toggle grid snap (independent of vector snap). */
    setGridSnapEnabled(enabled: boolean) {
        this.snapEngine.gridSnapEnabled = enabled;
        this.updateGridOverlay();
    }

    /** Set grid cell size in canvas pixels (e.g. 10, 20, 40). */
    setGridSize(px: number) {
        this.snapEngine.gridSize = Math.max(4, px);
        this.updateGridOverlay();
    }

    /**
     * Draw (or clear) a dot-grid background on every annotation canvas.
     * Called whenever gridSnapEnabled or gridSize changes.
     */
    private updateGridOverlay() {
        const enabled = this.snapEngine.gridSnapEnabled;
        const size = this.snapEngine.gridSize;
        for (const canvas of (this.annotationLayers as Map<number, any>).values()) {
            if (!enabled) {
                canvas.setBackgroundColor('transparent', () => canvas.requestRenderAll());
                continue;
            }
            // Build a small offscreen canvas that tiles the dot pattern
            const cell = size;
            const dot = Math.max(1.5, cell * 0.06);
            const off = document.createElement('canvas');
            off.width = cell;
            off.height = cell;
            const ctx = off.getContext('2d');
            if (!ctx) continue;
            ctx.clearRect(0, 0, cell, cell);
            ctx.beginPath();
            ctx.arc(cell / 2, cell / 2, dot, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(99,102,241,0.35)'; // indigo-500 at 35%
            ctx.fill();
            const pattern = canvas.getContext().createPattern(off, 'repeat');
            canvas.setBackgroundColor(pattern, () => canvas.requestRenderAll());
        }
    }

    /** Remove the orange calibration line drawn on the canvas (called after scale is confirmed). */
    removeCalibrationLine() {
        if (this.activeCalibLine && this.activeCalibCanvas) {
            this.activeCalibCanvas.remove(this.activeCalibLine);
            this.activeCalibCanvas.renderAll();
        }
        this.activeCalibLine = null;
        this.activeCalibCanvas = null;
    }

    /**
     * Given a raw canvas pointer on `pageNum`, return the snapped position.
     * Also updates the visual snap indicator on `canvas`.
     * If snap is disabled or no nearby vector point is found, returns `raw` unchanged.
     */
    private snapPoint(pageNum: number, raw: { x: number; y: number }, canvas: any): { x: number; y: number } {
        if (!this.snapEnabled) return raw;
        const snap = this.snapEngine.nearestWithGrid(pageNum, raw.x, raw.y);
        if (snap) {
            this.showSnapIndicator(canvas, snap.x, snap.y, snap.type);
            return snap;
        }
        // No snap — hide indicator
        this.showSnapIndicator(canvas, raw.x, raw.y, null);
        return raw;
    }

    /**
     * Show a type-specific snap indicator:
     *  'endpoint'     → solid blue filled square (exact corner)
     *  'intersection' → orange diamond/cross (line crossing)
     *  'midpoint'     → hollow grey circle (on-segment)
     *  null           → hide any existing indicator
     */
    private showSnapIndicator(
        canvas: any,
        x: number,
        y: number,
        type: 'endpoint' | 'intersection' | 'midpoint' | 'nearestEdge' | null
    ) {
        // Hide indicator on previously active canvas if we switched pages
        if (this.lastSnapCanvas && this.lastSnapCanvas !== canvas) {
            const prev = this.snapIndicators.get(this.lastSnapCanvas);
            if (prev) prev.set({ visible: false });
            this.lastSnapCanvas.requestRenderAll();
        }
        this.lastSnapCanvas = canvas;

        if (!type) {
            const cur = this.snapIndicators.get(canvas);
            if (cur && cur.visible) {
                cur.set({ visible: false });
                canvas.requestRenderAll();
            }
            return;
        }

        // Snap styles by type
        const styles: Record<string, { fill: string; stroke: string; strokeWidth: number; radius: number; strokeDashArray?: number[] }> = {
            endpoint: { fill: 'rgba(37,99,235,0.9)', stroke: '#1d4ed8', strokeWidth: 2, radius: 5 },
            intersection: { fill: 'rgba(234,88,12,0.85)', stroke: '#c2410c', strokeWidth: 2, radius: 6 },
            midpoint: { fill: 'rgba(100,116,139,0.25)', stroke: '#475569', strokeWidth: 1.5, radius: 6 },
            nearestEdge: { fill: 'rgba(100,116,139,0.05)', stroke: '#94a3b8', strokeWidth: 1, radius: 4 },
        };
        const s = styles[type];

        // Lazy-create a Circle for this canvas
        let indicator = this.snapIndicators.get(canvas);
        if (!indicator) {
            indicator = new Circle({
                radius: 6,
                stroke: '#2563eb',
                strokeWidth: 2,
                fill: 'rgba(37,99,235,0.25)',
                selectable: false,
                evented: false,
                originX: 'center',
                originY: 'center',
                excludeFromExport: true,
            } as any);
            canvas.add(indicator);
            this.snapIndicators.set(canvas, indicator);
        }

        indicator.set({
            left: x,
            top: y,
            visible: true,
            radius: s.radius,
            fill: s.fill,
            stroke: s.stroke,
            strokeWidth: s.strokeWidth,
            strokeDashArray: s.strokeDashArray ?? [],
        } as any);
        indicator.setCoords();
        canvas.bringObjectToFront(indicator);
        canvas.requestRenderAll();
    }

    private hideSnapIndicator() {
        if (this.lastSnapCanvas) {
            const ind = this.snapIndicators.get(this.lastSnapCanvas);
            if (ind && ind.visible) {
                ind.set({ visible: false });
                this.lastSnapCanvas.requestRenderAll();
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Undo / Redo — JSON snapshot stacks per page
    // ───────────────────────────────────────────────────────────────────────

    private undoStacks: Map<number, string[]> = new Map();
    private redoStacks: Map<number, string[]> = new Map();
    private readonly MAX_HISTORY = 50;

    private initHistory(pageNum: number, canvas: any): void {
        this.undoStacks.set(pageNum, [JSON.stringify(canvas.toJSON())]);
        this.redoStacks.set(pageNum, []);

        const record = () => {
            const stack = this.undoStacks.get(pageNum)!;
            stack.push(JSON.stringify(canvas.toJSON(['selectable', 'evented'])));
            if (stack.length > this.MAX_HISTORY) stack.shift();
            this.redoStacks.set(pageNum, []); // clear redo on new action
            this.emitHistoryChanged();
        };

        canvas.on('object:added', record);
        canvas.on('object:removed', record);
        canvas.on('object:modified', record);
    }

    private emitHistoryChanged(): void {
        window.dispatchEvent(new CustomEvent('pdfmax:history-changed', {
            detail: { undoDepth: this.getUndoDepth(), redoDepth: this.getRedoDepth() },
        }));
    }

    /** Number of undo steps available on the active page */
    getUndoDepth(): number {
        let max = 0;
        this.undoStacks.forEach(stack => { if (stack.length - 1 > max) max = stack.length - 1; });
        return max;
    }

    /** Number of redo steps available on the active page */
    getRedoDepth(): number {
        let max = 0;
        this.redoStacks.forEach(stack => { if (stack.length > max) max = stack.length; });
        return max;
    }

    /** Undo the last action on every annotation layer */
    undo(): void {
        this.annotationLayers.forEach((canvas, pageNum) => {
            const stack = this.undoStacks.get(pageNum);
            const redo = this.redoStacks.get(pageNum);
            if (!stack || stack.length < 2) return;
            redo?.push(stack.pop()!); // move current onto redo
            const snapshot = stack[stack.length - 1];
            canvas.loadFromJSON(JSON.parse(snapshot), () => canvas.renderAll());
        });
        this.emitHistoryChanged();
    }

    /** Redo the last undone action */
    redo(): void {
        this.annotationLayers.forEach((canvas, pageNum) => {
            const stack = this.undoStacks.get(pageNum);
            const redo = this.redoStacks.get(pageNum);
            if (!redo || redo.length === 0) return;
            const snapshot = redo.pop()!;
            stack?.push(snapshot);
            canvas.loadFromJSON(JSON.parse(snapshot), () => canvas.renderAll());
        });
        this.emitHistoryChanged();
    }

    // ───────────────────────────────────────────────────────────────────────
    // Markup persistence (localStorage)
    // ───────────────────────────────────────────────────────────────────────

    /** Serialize all Fabric canvases to localStorage under the given key */
    saveMarkups(storageKey: string): void {
        const data: Record<number, object> = {};
        this.annotationLayers.forEach((canvas, pageNum) => {
            data[pageNum] = canvas.toJSON(['selectable', 'evented']);
        });
        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('[PdfEngine] Could not save markups to localStorage', e);
        }
    }

    /** Export all markups as a plain object (for download or backup) */
    exportMarkups(): Record<number, object> {
        const data: Record<number, object> = {};
        this.annotationLayers.forEach((canvas, pageNum) => {
            // Temporarily remove calibration-only lines from the canvas so they
            // are never serialized into exports or localStorage saves.
            const calibObjs = canvas.getObjects().filter((o: any) => o.pdfmax_type === 'calibrate');
            calibObjs.forEach((o: any) => canvas.remove(o));

            data[pageNum] = canvas.toJSON(['selectable', 'evented', 'markupType', 'measureType', 'measureValue', 'pdfmax_type']);

            // Restore calibration lines after serialization
            calibObjs.forEach((o: any) => canvas.add(o));
        });
        return data;
    }


    /** Restore Fabric canvases from localStorage */
    async loadMarkups(storageKey: string): Promise<void> {
        let raw: string | null;
        try {
            raw = localStorage.getItem(storageKey);
        } catch { return; }
        if (!raw) return;

        let data: Record<number, object>;
        try { data = JSON.parse(raw); } catch { return; }

        await this.loadMarkupsFromJSON(data);
    }

    /** Restore Fabric canvases from a plain JS object (e.g. imported JSON file). */
    async loadMarkupsFromJSON(data: Record<number, object>): Promise<void> {
        const promises: Promise<void>[] = [];
        this.annotationLayers.forEach((canvas, pageNum) => {
            const json = data[pageNum];
            if (!json) return;
            promises.push(
                new Promise<void>((resolve) => {
                    canvas.loadFromJSON(json, () => {
                        canvas.renderAll();
                        resolve();
                    });
                })
            );
        });
        await Promise.all(promises);
    }

    /** Delete the currently selected object(s) on all active canvases */
    deleteSelected(): void {
        this.annotationLayers.forEach((canvas) => {
            const active = canvas.getActiveObject();
            if (!active) return;
            if ((active as any).type === 'activeSelection') {
                (active as any).forEachObject((obj: any) => canvas.remove(obj));
                canvas.discardActiveObject();
            } else {
                canvas.remove(active);
            }
            canvas.renderAll();
        });
    }

    /** Subscribe to any markup add/modify/remove across all pages */
    subscribeMarkupChanges(callback: () => void): void {
        this.annotationLayers.forEach((canvas) => {
            canvas.on('object:added', callback);
            canvas.on('object:modified', callback);
            canvas.on('object:removed', callback);
        });
    }

    /**
     * Return a flat list of all markup objects across every page.
     * Each entry has the page number plus key Fabric properties.
     */
    getAllMarkups(): Array<{
        page: number;
        id: string;
        type: string;
        stroke?: string;
        fill?: string;
        strokeWidth?: number;
        text?: string;
        visible: boolean;
        pdfmax_status?: string;
        pdfmax_assignee?: string;
        pdfmax_due_date?: string;
        pdfmax_priority?: string;
    }> {
        const result: Array<{
            page: number;
            id: string;
            type: string;
            stroke?: string;
            fill?: string;
            strokeWidth?: number;
            text?: string;
            visible: boolean;
            pdfmax_status?: string;
            pdfmax_assignee?: string;
            pdfmax_due_date?: string;
            pdfmax_priority?: string;
        }> = [];

        this.annotationLayers.forEach((canvas, pageNum) => {
            canvas.getObjects().forEach((obj: any) => {
                // Skip calibration-only lines — they're temp UI, not real annotations
                if ((obj as any).pdfmax_type === 'calibrate') return;
                result.push({
                    page: pageNum,
                    id: obj.id ?? String(obj.__uid ?? Math.random()),
                    type: obj.type ?? 'object',
                    stroke: typeof obj.stroke === 'string' ? obj.stroke : undefined,
                    fill: typeof obj.fill === 'string' ? obj.fill : undefined,
                    strokeWidth: obj.strokeWidth,
                    text: obj.text,
                    visible: obj.visible !== false,
                    pdfmax_status: obj.pdfmax_status,
                    pdfmax_assignee: obj.pdfmax_assignee,
                    pdfmax_due_date: obj.pdfmax_due_date,
                    pdfmax_priority: obj.pdfmax_priority,
                });
            });
        });

        return result;
    }

    /**
     * Toggle visibility of a single markup object (identified by page + canvas index).
     */
    setMarkupVisible(page: number, index: number, visible: boolean): void {
        const canvas = this.annotationLayers.get(page);
        if (!canvas) return;
        const obj = canvas.getObjects()[index] as any;
        if (!obj) return;
        obj.visible = visible;
        // Deselect hidden object so handles don't ghost
        if (!visible && canvas.getActiveObject() === obj) {
            canvas.discardActiveObject();
        }
        canvas.requestRenderAll();
        this.emitHistoryChanged();
    }

    /**
     * Return all measurement markups (measure-length, measure-area, measure-perimeter, measure-count)
     * as structured rows for the Measurements summary table.
     */
    getMeasurements(): Array<{
        page: number;
        measureType: string;
        measureValue: string;
        stroke?: string;
        index: number;
    }> {
        const result: Array<{
            page: number;
            measureType: string;
            measureValue: string;
            stroke?: string;
            index: number;
        }> = [];

        this.annotationLayers.forEach((canvas, pageNum) => {
            canvas.getObjects().forEach((obj: any, idx: number) => {
                const mt: string | undefined = obj.measureType;
                if (!mt) return; // not a measurement
                result.push({
                    page: pageNum,
                    measureType: mt,
                    measureValue: String(obj.measureValue ?? ''),
                    stroke: typeof obj.stroke === 'string' ? obj.stroke : '#3b82f6',
                    index: idx,
                });
            });
        });

        return result;
    }

    /**
     * Select a specific markup on a given page (sets it as Fabric's active object).
     * Scrolls the page wrapper into view.
     */
    selectMarkup(page: number, index: number): void {
        const canvas = this.annotationLayers.get(page);
        if (!canvas) return;

        const objects = canvas.getObjects();
        const target = objects[index];
        if (!target) return;

        canvas.setActiveObject(target);
        canvas.renderAll();

        // Scroll the page wrapper into view
        const wrapper = this.container
            .closest('[class*="overflow"]')
            ?.parentElement
            ?.querySelector(`.pdf-page-wrapper[data-page="${page}"]`) as HTMLElement | null;
        if (wrapper) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            // Fallback: query globally
            const globalWrapper = document.querySelector(`.pdf-page-wrapper[data-page="${page}"]`) as HTMLElement | null;
            globalWrapper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Fire selection-changed so props panel updates
        this.onSelectionChanged?.(target);
    }

    /**
     * Apply a partial style patch to the currently active Fabric object.
     * Pass page=-1 to search all annotation layers for an active object.
     */
    updateActiveMarkup(patch: {
        stroke?: string;
        fill?: string;
        strokeWidth?: number;
        opacity?: number;
        text?: string;
    }, page = -1): void {
        const applyToCanvas = (canvas: any): boolean => {
            const obj = canvas.getActiveObject();
            if (!obj) return false;
            const { stroke, fill, strokeWidth, opacity, text } = patch;
            if (stroke !== undefined) obj.set('stroke', stroke);
            if (fill !== undefined) obj.set('fill', fill);
            if (strokeWidth !== undefined) obj.set('strokeWidth', strokeWidth);
            if (opacity !== undefined) obj.set('opacity', opacity);
            if (text !== undefined && 'text' in obj) obj.set('text', text);
            canvas.renderAll();
            this.onSelectionChanged?.(obj);
            return true;
        };
        if (page !== -1) {
            const canvas = this.annotationLayers.get(page);
            if (canvas) applyToCanvas(canvas);
        } else {
            for (const [, canvas] of this.annotationLayers) {
                if (applyToCanvas(canvas)) break;
            }
        }
    }

    /**
     * Insert a styled text stamp on a specific page, optionally at a given canvas position.
     */
    addStamp(page: number, label: string, style: {
        bgColor?: string;
        textColor?: string;
        borderColor?: string;
        fontSize?: number;
    } = {}, pos?: { left: number; top: number }): void {
        const canvas = this.annotationLayers.get(page);
        if (!canvas) return;
        const { bgColor = '#1e40af', textColor = '#ffffff', borderColor, fontSize = 28 } = style;
        const stamp = new IText(label, {
            left: pos?.left ?? canvas.getWidth() / 2,
            top: pos?.top ?? canvas.getHeight() * 0.2,
            originX: 'center',
            originY: 'center',
            fontSize,
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fill: textColor,
            backgroundColor: bgColor,
            stroke: borderColor ?? bgColor,
            strokeWidth: 2,
            padding: 10,
            editable: true,
        } as any);
        canvas.add(stamp);
        canvas.setActiveObject(stamp);
        canvas.renderAll();
        this.onSelectionChanged?.(stamp);
    }

    /**
     * Duplicate the active object on whichever canvas has a selection.
     * The copy is offset 15px right+down from the original.
     */
    duplicateActiveMarkup(): void {
        for (const [, canvas] of this.annotationLayers) {
            const obj = canvas.getActiveObject();
            if (!obj) continue;
            obj.clone().then((clone: any) => {
                clone.set({ left: (obj.left ?? 0) + 15, top: (obj.top ?? 0) + 15 });
                canvas.add(clone);
                canvas.setActiveObject(clone);
                canvas.renderAll();
                this.onSelectionChanged?.(clone);
            });
            break;
        }
    }

    bringToFront(): void {
        for (const [, canvas] of this.annotationLayers) {
            const obj = canvas.getActiveObject();
            if (!obj) continue;
            canvas.bringObjectToFront(obj);
            canvas.renderAll();
            break;
        }
    }

    sendToBack(): void {
        for (const [, canvas] of this.annotationLayers) {
            const obj = canvas.getActiveObject();
            if (!obj) continue;
            canvas.sendObjectToBack(obj);
            canvas.renderAll();
            break;
        }
    }

    // Wire selection callbacks so the UI can drive a Properties Panel
    private wireSelectionCallbacks(canvas: any): void {
        canvas.on('selection:created', (e: any) => {
            this.onSelectionChanged?.(e.selected?.[0] ?? null);
        });
        canvas.on('selection:updated', (e: any) => {
            this.onSelectionChanged?.(e.selected?.[0] ?? null);
        });
        canvas.on('selection:cleared', () => {
            this.onSelectionChanged?.(null);
        });
        // Right-click context menu — use native 'contextmenu' event so it fires
        // regardless of Fabric's internal mouse event handling.
        const upperCanvas: HTMLElement | null =
            (canvas.getElement() as HTMLElement)?.parentElement?.querySelector('.upper-canvas') ??
            (canvas.getElement() as HTMLElement);
        if (upperCanvas) {
            upperCanvas.addEventListener('contextmenu', (nativeEv: MouseEvent) => {
                nativeEv.preventDefault();
                const obj = canvas.getActiveObject();
                if (!obj) return;
                window.dispatchEvent(new CustomEvent('pdfmax:context-menu', {
                    detail: { x: nativeEv.clientX, y: nativeEv.clientY, obj },
                }));
            });
        }

        // ── Rich Text: emit events when a text object enters/exits edit mode ──
        canvas.on('text:editing:entered', (e: any) => {
            const obj = e.target ?? canvas.getActiveObject();
            window.dispatchEvent(new CustomEvent('pdfmax:text-editing-entered', { detail: { obj } }));
        });
        canvas.on('text:editing:exited', () => {
            window.dispatchEvent(new CustomEvent('pdfmax:text-editing-exited'));
        });
    }

    /**
     * Return the PDF's built-in outline (bookmarks) as a recursive tree.
     * Each node has title, pageNumber (1-indexed), and optional children.
     */
    async getOutline(): Promise<Array<{ title: string; page: number; children: any[] }>> {
        if (!this.pdfDocument) return [];
        const raw = await this.pdfDocument.getOutline();
        if (!raw || raw.length === 0) return [];

        const resolveNode = async (node: any): Promise<{ title: string; page: number; children: any[] }> => {
            let page = 1;
            try {
                if (node.dest) {
                    const dest = typeof node.dest === 'string'
                        ? await this.pdfDocument!.getDestination(node.dest)
                        : node.dest;
                    if (dest && dest[0]) {
                        const ref = dest[0];
                        page = await this.pdfDocument!.getPageIndex(ref) + 1;
                    }
                }
            } catch { /* unresolvable dest — default to page 1 */ }
            const children = await Promise.all((node.items ?? []).map(resolveNode));
            return { title: node.title ?? '(Untitled)', page, children };
        };

        return Promise.all(raw.map(resolveNode));
    }

    getAnnotationLayer(pageNumber: number) {
        return this.annotationLayers.get(pageNumber);
    }

    setDrawMode(tool: string, options: any) {
        // Apply tool to all pages for now
        this.annotationLayers.forEach((canvas, pageNum) => {
            // Clean up any previous pan-tool cursor listeners before switching tools
            if ((canvas as any)._panCursorCleanup) {
                (canvas as any)._panCursorCleanup();
                delete (canvas as any)._panCursorCleanup;
            }
            // Clean up calibrate-tool Escape key listener before switching tools
            if ((canvas as any)._calibEscapeCleanup) {
                (canvas as any)._calibEscapeCleanup();
                delete (canvas as any)._calibEscapeCleanup;
            }

            // Remove previous event listeners
            canvas.off('mouse:down');
            canvas.off('mouse:move');
            canvas.off('mouse:up');

            canvas.isDrawingMode = false;
            canvas.selection = false;


            // ── Persistent snap-hover listener (RAF-gated) ────────────────
            // Always active so the indicator appears before drawing starts.
            // requestAnimationFrame prevents running 60+ heavy lookups/frame.
            if (tool !== 'select' && tool !== 'pan' && tool !== 'cloud') {
                let snapRaf = 0;
                canvas.on('mouse:move', (o: any) => {
                    if (snapRaf) cancelAnimationFrame(snapRaf);
                    snapRaf = requestAnimationFrame(() => {
                        const pt = o.scenePoint ?? canvas.getPointer(o.e);
                        this.snapPoint(pageNum, pt, canvas);
                        snapRaf = 0;
                    });
                });
            }

            if (tool === 'select') {
                canvas.selection = true;
                return;
            }

            if (tool === 'pan') {
                // Set Fabric's own cursor properties so it doesn't override our hand cursor
                canvas.defaultCursor = 'grab';
                canvas.hoverCursor = 'grab';
                canvas.moveCursor = 'grabbing';

                // Also set on the DOM elements directly
                document.querySelectorAll<HTMLElement>('.upper-canvas').forEach((el) => {
                    el.style.cursor = 'grab';
                });

                // Swap to grabbing on mousedown, back to grab on mouseup
                const onDown = () => {
                    canvas.defaultCursor = 'grabbing';
                    document.querySelectorAll<HTMLElement>('.upper-canvas').forEach((el) => { el.style.cursor = 'grabbing'; });
                };
                const onUp = () => {
                    canvas.defaultCursor = 'grab';
                    document.querySelectorAll<HTMLElement>('.upper-canvas').forEach((el) => { el.style.cursor = 'grab'; });
                };
                document.addEventListener('mousedown', onDown);
                document.addEventListener('mouseup', onUp);

                // Store cleanup so setDrawMode restores crosshair when switching away
                (canvas as any)._panCursorCleanup = () => {
                    document.removeEventListener('mousedown', onDown);
                    document.removeEventListener('mouseup', onUp);
                    canvas.defaultCursor = 'default';
                    canvas.hoverCursor = 'move';
                    canvas.moveCursor = 'move';
                    document.querySelectorAll<HTMLElement>('.upper-canvas').forEach((el) => { el.style.cursor = 'crosshair'; });
                };
                return;
            }


            if (tool === 'cloud') {
                // Fabric 6: must explicitly create a PencilBrush — freeDrawingBrush is not auto-created
                const brush = new PencilBrush(canvas);
                brush.color = options.strokeColor || '#ef4444';
                brush.width = options.strokeWidth || 3;
                brush.decimate = 4; // smooth the path
                canvas.freeDrawingBrush = brush;
                canvas.isDrawingMode = true;
                return;
            }

            // ──────────────────────────────────────────────────────────────
            // CALIBRATE TOOL — draw a line then trigger the CalibrationModal
            // ──────────────────────────────────────────────────────────────
            if (tool === 'calibrate') {
                let calibStartPoint: any = null;
                let calibLine: Line | null = null;

                // Escape key: cancel mid-draw OR remove a committed line waiting for modal
                const onEscape = (e: KeyboardEvent) => {
                    if (e.key !== 'Escape') return;
                    // Cancel in-progress draw
                    if (calibLine) {
                        canvas.remove(calibLine);
                        canvas.renderAll();
                        calibLine = null;
                        calibStartPoint = null;
                    }
                    // Remove a finished-but-unconfirmed line (modal is open)
                    this.removeCalibrationLine();
                    this.hideSnapIndicator();
                };
                document.addEventListener('keydown', onEscape);

                // Store cleanup so switching tools removes the key listener
                (canvas as any)._calibEscapeCleanup = () => {
                    document.removeEventListener('keydown', onEscape);
                };

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    calibStartPoint = p;
                    calibLine = new Line([p.x, p.y, p.x, p.y], {
                        stroke: '#f59e0b',
                        strokeWidth: 3,
                        strokeDashArray: [8, 4],
                        selectable: false,
                    });
                    canvas.add(calibLine);
                });

                canvas.on('mouse:move', (o: any) => {
                    if (!calibLine || !calibStartPoint) return;
                    // Note: permanent hover listener already called snapPoint for indicator;
                    // here we just update the line geometry using the snapped coordinate.
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    calibLine.set({ x2: p.x, y2: p.y });

                    // Live label 
                    const dx = p.x - calibStartPoint.x;
                    const dy = p.y - calibStartPoint.y;
                    const pxLen = Math.sqrt(dx * dx + dy * dy);

                    const existing = this.calibration.toRealWorld(pageNum, pxLen);
                    calibLine.set('label' as any, existing);
                    canvas.requestRenderAll();
                });

                canvas.on('mouse:up', (o: any) => {
                    if (!calibLine || !calibStartPoint) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    const dx = p.x - calibStartPoint.x;
                    const dy = p.y - calibStartPoint.y;
                    const pixelLength = Math.sqrt(dx * dx + dy * dy);

                    // Leave the line selectable so user can click + Delete if they can't cancel immediately.
                    // Mark it as calibration-only so markup exports skip it.
                    calibLine.set({
                        selectable: true,
                        evented: true,
                        hasControls: false,   // hide resize handles — it's not a real annotation
                        hasBorders: true,
                        lockMovementX: true,
                        lockMovementY: true,
                        x2: p.x,
                        y2: p.y,
                        pdfmax_type: 'calibrate',  // excluded from exportMarkups()
                    } as any);
                    canvas.renderAll();


                    // Store reference so confirmCalibration() / Escape can remove it
                    this.activeCalibLine = calibLine;
                    this.activeCalibCanvas = canvas;

                    // Guard: ignore zero or near-zero length (user just clicked without dragging)
                    if (pixelLength < 5) {
                        canvas.remove(calibLine);
                        calibStartPoint = null;
                        calibLine = null;
                        this.activeCalibLine = null;
                        this.activeCalibCanvas = null;
                        this.hideSnapIndicator();
                        return;
                    }

                    // Fire callback so the React UI can show the CalibrationModal
                    if (this.onCalibrationLine) {
                        this.onCalibrationLine(pageNum, pixelLength);
                    }

                    calibStartPoint = null;
                    calibLine = null;
                });

                return;
            }


            // ──────────────────────────────────────────────────────────────
            // MEASURE-LENGTH / MEASURE-AREA / MEASURE-PERIMETER TOOL
            // ──────────────────────────────────────────────────────────────
            if (tool === 'measure-length' || tool === 'measure-area' || tool === 'measure-perimeter') {
                let mlPoints: Array<{ x: number, y: number }> = [];
                let mlPolyShape: Polyline | Polygon | null = null;
                let mlLabel: IText | null = null;
                let mlDrawing = false;

                const isArea = tool === 'measure-area';
                const isPerimeter = tool === 'measure-perimeter';

                const getDisplayLabel = (pts: Array<{ x: number, y: number }>, closed = false) => {
                    if (isArea) {
                        // Shoelace formula for polygon area in pixels²
                        let area = 0;
                        const n = pts.length;
                        for (let i = 0; i < n; i++) {
                            const j = (i + 1) % n;
                            area += pts[i].x * pts[j].y;
                            area -= pts[j].x * pts[i].y;
                        }
                        const pixelArea = Math.abs(area) / 2;
                        return this.calibration.areaToRealWorld(pageNum, pixelArea);
                    } else {
                        // Sum segment lengths
                        let total = 0;
                        for (let i = 1; i < pts.length; i++) {
                            const dx = pts[i].x - pts[i - 1].x;
                            const dy = pts[i].y - pts[i - 1].y;
                            total += Math.sqrt(dx * dx + dy * dy);
                        }
                        // Add closing segment for perimeter
                        if (isPerimeter && closed && pts.length > 2) {
                            const dx = pts[0].x - pts[pts.length - 1].x;
                            const dy = pts[0].y - pts[pts.length - 1].y;
                            total += Math.sqrt(dx * dx + dy * dy);
                        }
                        return this.calibration.toRealWorld(pageNum, total);
                    }
                };

                const finishMeasure = () => {
                    if (!mlPolyShape || !mlLabel) {
                        canvas.off('mouse:down', onMlDown);
                        canvas.off('mouse:move', onMlMove);
                        mlPoints = []; mlPolyShape = null; mlLabel = null; mlDrawing = false;
                        return;
                    }

                    // Compute final label with closed shape for perimeter
                    const finalLabel = getDisplayLabel(mlPoints, true);
                    mlLabel.set({ text: finalLabel });

                    // Remove loose objects from canvas, then re-add as a tagged Group
                    canvas.remove(mlPolyShape);
                    canvas.remove(mlLabel);

                    const measureType = isArea ? 'measure-area' : isPerimeter ? 'measure-perimeter' : 'measure-length';

                    // Position group at top-left of bounding box
                    const allX = mlPoints.map(p => p.x);
                    const allY = mlPoints.map(p => p.y);
                    const bboxLeft = Math.min(...allX);
                    const bboxTop = Math.min(...allY);

                    // Re-create shape with absolute coords for grouping
                    const shapeOpts = {
                        fill: isArea ? 'rgba(59,130,246,0.15)' : 'transparent',
                        stroke: '#3b82f6',
                        strokeWidth: 2,
                        selectable: true,
                        objectCaching: false,
                    };
                    const finalShape = isArea || isPerimeter
                        ? new Polygon(mlPoints, shapeOpts)
                        : new Polyline(mlPoints, shapeOpts);

                    const labelObj = new IText(finalLabel, {
                        left: bboxLeft + 4,
                        top: bboxTop - 22,
                        fontSize: 13,
                        fontFamily: 'monospace',
                        fill: '#1d4ed8',
                        backgroundColor: 'rgba(255,255,255,0.85)',
                        selectable: true,
                    });

                    const group = new Group([finalShape, labelObj], {
                        selectable: true,
                        evented: true,
                    });
                    (group as any).measureType = measureType;
                    (group as any).measureValue = finalLabel;
                    canvas.add(group);

                    canvas.off('mouse:down', onMlDown);
                    canvas.off('mouse:move', onMlMove);
                    canvas.renderAll();

                    mlPoints = []; mlPolyShape = null; mlLabel = null; mlDrawing = false;

                    // Fire volume prompt event after area measurement
                    if (isArea && typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('pdfmax:ask-volume', {
                            detail: { areaLabel: finalLabel, group },
                        }));
                    }
                };

                const onMlDown = (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    if (!mlDrawing) {
                        mlDrawing = true;
                        mlPoints = [{ x: p.x, y: p.y }, { x: p.x, y: p.y }];
                        const shapeOpts = {
                            fill: isArea ? 'rgba(59,130,246,0.15)' : 'transparent',
                            stroke: '#3b82f6',
                            strokeWidth: 2,
                            selectable: false,
                            objectCaching: false,
                        };
                        mlPolyShape = isArea || isPerimeter
                            ? new Polygon(mlPoints, shapeOpts)
                            : new Polyline(mlPoints, shapeOpts);
                        canvas.add(mlPolyShape);

                        mlLabel = new IText(getDisplayLabel(mlPoints), {
                            left: p.x + 8,
                            top: p.y - 20,
                            fontSize: 13,
                            fontFamily: 'monospace',
                            fill: '#1d4ed8',
                            backgroundColor: 'rgba(255,255,255,0.85)',
                            selectable: false,
                        });
                        canvas.add(mlLabel);
                    } else {
                        mlPoints.push({ x: p.x, y: p.y });
                    }
                };

                const onMlMove = (o: any) => {
                    if (!mlDrawing || !mlPolyShape || !mlLabel) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    mlPoints[mlPoints.length - 1] = { x: p.x, y: p.y };
                    mlPolyShape.set({ points: [...mlPoints] });
                    const label = getDisplayLabel(mlPoints);
                    mlLabel.set({ text: label, left: p.x + 8, top: p.y - 20 });
                    canvas.renderAll();
                };

                canvas.on('mouse:down', onMlDown);
                canvas.on('mouse:move', onMlMove);

                // ── Double-click to finish ────────────────────────────────
                let lastClickTime = 0;
                const DBL_THRESHOLD = 350;

                const onMlDblClick = () => {
                    if (!mlDrawing) return;
                    if (mlPoints.length > 2) mlPoints.pop();
                    finishMeasure();
                    window.removeEventListener('keydown', onMlKey);
                };

                const guardedOnMlDown = (o: any) => {
                    const now = Date.now();
                    if (now - lastClickTime < DBL_THRESHOLD) {
                        lastClickTime = 0;
                        return;
                    }
                    lastClickTime = now;
                    onMlDown(o);
                };
                canvas.off('mouse:down', onMlDown);
                canvas.on('mouse:down', guardedOnMlDown);
                canvas.on('mouse:dblclick', onMlDblClick);

                // ── Keyboard shortcuts (Esc or Enter) ────────────────────
                const onMlKey = (e: KeyboardEvent) => {
                    if (e.key === 'Escape' || e.key === 'Enter') {
                        finishMeasure();
                        canvas.off('mouse:dblclick', onMlDblClick);
                        window.removeEventListener('keydown', onMlKey);
                    }
                };
                window.addEventListener('keydown', onMlKey);
                return;
            }


            // ──────────────────────────────────────────────────────────────
            // MEASURE-COUNT TOOL — drop numbered pins
            // ──────────────────────────────────────────────────────────────
            if (tool === 'measure-count') {
                // Initialise from persisted sequence (survives tool switches)
                if (!this.countSequences.has(pageNum)) {
                    this.countSequences.set(pageNum, 1);
                }

                // Dispatch current count so the toolbar indicator is in sync
                window.dispatchEvent(new CustomEvent('pdfmax:count-sequence-changed', {
                    detail: { page: pageNum, next: this.countSequences.get(pageNum) }
                }));

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    const countNumber = this.countSequences.get(pageNum) ?? 1;

                    const pin = new Circle({
                        radius: 12,
                        fill: options.strokeColor || '#ef4444',
                        selectable: false,
                        evented: false,
                        originX: 'center',
                        originY: 'center',
                    });
                    const pinLabel = new IText(String(countNumber), {
                        fontSize: 12,
                        fontFamily: 'Arial',
                        fill: '#ffffff',
                        selectable: false,
                        evented: false,
                        originX: 'center',
                        originY: 'center',
                    });
                    const pinGroup = new Group([pin, pinLabel], {
                        left: p.x,
                        top: p.y,
                        originX: 'center',
                        originY: 'center',
                        selectable: true,
                        evented: true,
                    });
                    (pinGroup as any).measureType = 'measure-count';
                    (pinGroup as any).measureValue = String(countNumber);
                    canvas.add(pinGroup);
                    canvas.renderAll();

                    // Persist the incremented counter
                    const next = countNumber + 1;
                    this.countSequences.set(pageNum, next);
                    window.dispatchEvent(new CustomEvent('pdfmax:count-sequence-changed', {
                        detail: { page: pageNum, next }
                    }));
                });

                return;
            }

            // ──────────────────────────────────────────────────────────────
            // HIGHLIGHT TOOL — semi-transparent drag-draw rectangle
            // ──────────────────────────────────────────────────────────────
            if (tool === 'highlight') {
                let hlStart: { x: number; y: number } | null = null;
                let hlRect: Rect | null = null;
                const hlColor = options.strokeColor || '#facc15'; // yellow-400

                canvas.on('mouse:down', (o: any) => {
                    // Use raw pointer — snap is irrelevant for free-area text highlighting
                    const p = o.scenePoint ?? canvas.getPointer(o.e);
                    hlStart = p;
                    hlRect = new Rect({
                        left: p.x, top: p.y,
                        width: 0, height: 0,
                        fill: hlColor,
                        opacity: 0.35,
                        stroke: 'transparent',
                        strokeWidth: 0,
                        selectable: false,
                    });
                    (hlRect as any).markupType = 'highlight';
                    canvas.add(hlRect);
                });

                canvas.on('mouse:move', (o: any) => {
                    if (!hlRect || !hlStart) return;
                    // Use raw pointer — no snap for text highlighting
                    const p = o.scenePoint ?? canvas.getPointer(o.e);
                    hlRect.set({
                        width: Math.abs(p.x - hlStart.x),
                        height: Math.abs(p.y - hlStart.y),
                        left: Math.min(p.x, hlStart.x),
                        top: Math.min(p.y, hlStart.y),
                    });
                    canvas.requestRenderAll();
                });

                canvas.on('mouse:up', () => {
                    if (!hlRect) return;
                    if ((hlRect.width ?? 0) < 4 || (hlRect.height ?? 0) < 4) {
                        canvas.remove(hlRect);
                    } else {
                        hlRect.set({ selectable: true });
                        canvas.setActiveObject(hlRect);
                        this.emitHistoryChanged();
                        window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                    }
                    hlRect = null; hlStart = null;
                    this.hideSnapIndicator();
                    canvas.requestRenderAll();
                });
                return;
            }

            // ──────────────────────────────────────────────────────────────
            // MEASURE-ANGLE TOOL — 3-point click: A → vertex → B
            // ──────────────────────────────────────────────────────────────
            if (tool === 'measure-angle') {
                let anglePoints: { x: number; y: number }[] = [];
                let previewLine: Line | null = null;

                const cleanupAngle = () => {
                    if (previewLine) { canvas.remove(previewLine); previewLine = null; }
                };

                canvas.on('mouse:move', (o: any) => {
                    if (anglePoints.length === 0) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    const last = anglePoints[anglePoints.length - 1];
                    if (previewLine) {
                        previewLine.set({ x1: last.x, y1: last.y, x2: p.x, y2: p.y });
                    } else {
                        previewLine = new Line([last.x, last.y, p.x, p.y], {
                            stroke: options.strokeColor || '#f59e0b',
                            strokeWidth: 1.5,
                            strokeDashArray: [6, 4],
                            selectable: false, evented: false,
                        });
                        canvas.add(previewLine);
                    }
                    canvas.requestRenderAll();
                });

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    anglePoints.push(p);

                    if (anglePoints.length === 3) {
                        // All 3 points gathered — compute and draw
                        cleanupAngle();
                        const [A, V, B] = anglePoints;

                        // Vector math: angle at vertex V between VA and VB
                        const ax = A.x - V.x, ay = A.y - V.y;
                        const bx = B.x - V.x, by = B.y - V.y;
                        const dot = ax * bx + ay * by;
                        const magA = Math.sqrt(ax * ax + ay * ay);
                        const magB = Math.sqrt(bx * bx + by * by);
                        const cosTheta = Math.max(-1, Math.min(1, dot / (magA * magB)));
                        const angleDeg = (Math.acos(cosTheta) * 180 / Math.PI).toFixed(1);

                        // Draw two legs
                        const legColor = options.strokeColor || '#f59e0b';
                        const sw = options.strokeWidth || 2;
                        const legA = new Line([V.x, V.y, A.x, A.y], {
                            stroke: legColor, strokeWidth: sw, selectable: false, evented: false,
                        });
                        const legB = new Line([V.x, V.y, B.x, B.y], {
                            stroke: legColor, strokeWidth: sw, selectable: false, evented: false,
                        });

                        // Label at midpoint between A and B (offset above vertex)
                        const midX = (A.x + B.x) / 2;
                        const midY = (A.y + B.y) / 2;
                        const labelText = `${angleDeg}°`;
                        const label = new IText(labelText, {
                            left: midX,
                            top: midY - 18,
                            fontFamily: 'Arial',
                            fontSize: 13,
                            fill: legColor,
                            backgroundColor: 'rgba(255,255,255,0.85)',
                            selectable: false, evented: false,
                        });

                        const measureGroup = new Group([legA, legB, label], {
                            selectable: true, evented: true,
                        });
                        (measureGroup as any).measureType = 'measure-angle';
                        (measureGroup as any).measureValue = `${angleDeg}°`;
                        canvas.add(measureGroup);
                        canvas.setActiveObject(measureGroup);
                        canvas.requestRenderAll();
                        this.hideSnapIndicator();
                        this.emitHistoryChanged();

                        // Broadcast measurement update
                        try {
                            const measurements = this.getMeasurements();
                            window.dispatchEvent(new CustomEvent('pdfmax:measurements-updated', { detail: { measurements } }));
                        } catch { /* ignore */ }

                        anglePoints = [];
                    }
                });
                return;
            }

            // ──────────────────────────────────────────────────────────────
            // MEASURE-DIAMETER TOOL — 2-point click: shows chord as diameter
            // ──────────────────────────────────────────────────────────────
            if (tool === 'measure-diameter') {
                let diamStart: { x: number; y: number } | null = null;
                let diamPreview: Line | null = null;

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    if (!diamStart) {
                        diamStart = p;
                        diamPreview = new Line([p.x, p.y, p.x, p.y], {
                            stroke: options.strokeColor || '#06b6d4',
                            strokeWidth: options.strokeWidth || 2,
                            strokeDashArray: [6, 4],
                            selectable: false, evented: false,
                        });
                        canvas.add(diamPreview);
                    } else {
                        // Second click — finalize
                        if (diamPreview) canvas.remove(diamPreview);
                        const dx = p.x - diamStart.x, dy = p.y - diamStart.y;
                        const pixelLen = Math.sqrt(dx * dx + dy * dy);
                        const realLen = this.calibration.toRealWorld(pageNum, pixelLen);
                        const label = `Ø${realLen}`;

                        const measLine = new Line([diamStart.x, diamStart.y, p.x, p.y], {
                            stroke: options.strokeColor || '#06b6d4',
                            strokeWidth: options.strokeWidth || 2,
                            selectable: false, evented: false,
                        });
                        const midX = (diamStart.x + p.x) / 2;
                        const midY = (diamStart.y + p.y) / 2;
                        const measLabel = new IText(label, {
                            left: midX, top: midY - 16,
                            fontFamily: 'Arial', fontSize: 13,
                            fill: options.strokeColor || '#06b6d4',
                            backgroundColor: 'rgba(255,255,255,0.85)',
                            selectable: false, evented: false,
                        });
                        const measureGroup = new Group([measLine, measLabel], {
                            selectable: true, evented: true,
                        });
                        (measureGroup as any).measureType = 'measure-diameter';
                        (measureGroup as any).measureValue = label;
                        canvas.add(measureGroup);
                        canvas.setActiveObject(measureGroup);
                        canvas.requestRenderAll();
                        this.hideSnapIndicator();
                        this.emitHistoryChanged();

                        try {
                            const measurements = this.getMeasurements();
                            window.dispatchEvent(new CustomEvent('pdfmax:measurements-updated', { detail: { measurements } }));
                        } catch { /* ignore */ }

                        diamStart = null; diamPreview = null;
                    }
                });

                canvas.on('mouse:move', (o: any) => {
                    if (!diamStart || !diamPreview) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    diamPreview.set({ x2: p.x, y2: p.y });
                    canvas.requestRenderAll();
                });
                return;
            }

            if (tool === 'measure-cutout') {
                // Phase 1: draw outer polygon
                // Phase 2: draw void polygons (right-click to add another void, Escape to finish)
                const color = options.strokeColor || '#f59e0b';
                let phase: 'outer' | 'void' = 'outer';
                let points: Array<{ x: number; y: number }> = [];
                let preview: Polyline | null = null;
                let outerPoly: Polygon | null = null;
                let outerArea = 0;
                const voidAreas: number[] = [];
                const voidsPolys: Polygon[] = [];

                const polyArea = (pts: Array<{ x: number; y: number }>) => {
                    let a = 0;
                    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
                    }
                    return Math.abs(a / 2);
                };

                const finalizeCutout = () => {
                    const totalVoidArea = voidAreas.reduce((s, a) => s + a, 0);
                    const netPixelArea = Math.max(0, outerArea - totalVoidArea);
                    const netReal = this.calibration.areaToRealWorld(pageNum, netPixelArea);
                    const voidReal = this.calibration.areaToRealWorld(pageNum, totalVoidArea);
                    const allObjs: FabricObject[] = [];
                    if (outerPoly) allObjs.push(outerPoly);
                    allObjs.push(...voidsPolys);
                    const cx = outerPoly ? ((outerPoly.left ?? 0) + (outerPoly.width ?? 0) / 2) : 0;
                    const cy = outerPoly ? ((outerPoly.top ?? 0) + (outerPoly.height ?? 0) / 2) : 0;
                    const labelLines = [`Net: ${netReal}`, voidAreas.length > 0 ? `(−${voidReal} voids)` : ''];
                    const measLabel = new IText(labelLines.filter(Boolean).join('\n'), {
                        left: cx, top: cy,
                        fontFamily: 'Arial', fontSize: 13, textAlign: 'center',
                        fill: color,
                        backgroundColor: 'rgba(255,255,255,0.85)',
                        selectable: false, evented: false,
                    });
                    allObjs.push(measLabel);
                    const measureGroup = new Group(allObjs, { selectable: true, evented: true });
                    (measureGroup as any).measureType = 'measure-cutout';
                    (measureGroup as any).measureValue = netReal;
                    canvas.add(measureGroup);
                    canvas.setActiveObject(measureGroup);
                    if (preview) canvas.remove(preview);
                    preview = null;
                    canvas.requestRenderAll();
                    this.emitHistoryChanged();
                    try {
                        const measurements = this.getMeasurements();
                        window.dispatchEvent(new CustomEvent('pdfmax:measurements-updated', { detail: { measurements } }));
                    } catch { /* ignore */ }
                };

                const startVoidPhase = () => {
                    if (preview) { canvas.remove(preview); preview = null; }
                    points = [];
                    phase = 'void';
                };

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);

                    if (phase === 'outer') {
                        points.push(p);
                        if (!preview) {
                            preview = new Polyline([...points], {
                                stroke: color, strokeWidth: options.strokeWidth || 2,
                                fill: 'rgba(245,158,11,0.12)', strokeDashArray: [5, 4],
                                selectable: false, evented: false,
                            });
                            canvas.add(preview);
                        } else {
                            preview.set({ points: points.map(pp => ({ x: pp.x, y: pp.y })) });
                        }
                        canvas.requestRenderAll();
                    } else {
                        // void phase
                        points.push(p);
                        if (!preview) {
                            preview = new Polyline([...points], {
                                stroke: '#ef4444', strokeWidth: options.strokeWidth || 2,
                                fill: 'rgba(239,68,68,0.18)', strokeDashArray: [5, 4],
                                selectable: false, evented: false,
                            });
                            canvas.add(preview);
                        } else {
                            preview.set({ points: points.map(pp => ({ x: pp.x, y: pp.y })) });
                        }
                        canvas.requestRenderAll();
                    }
                });

                canvas.on('mouse:move', (o: any) => {
                    if (!preview || points.length === 0) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    const pts = [...points, p];
                    preview.set({ points: pts.map(pp => ({ x: pp.x, y: pp.y })) });
                    canvas.requestRenderAll();
                });

                canvas.on('mouse:dblclick', async () => {
                    if (points.length < 3) return;
                    if (preview) { canvas.remove(preview); preview = null; }

                    if (phase === 'outer') {
                        outerArea = polyArea(points);
                        outerPoly = new Polygon(points.map(p => ({ x: p.x, y: p.y })), {
                            stroke: color, strokeWidth: options.strokeWidth || 2,
                            fill: 'rgba(245,158,11,0.12)',
                            selectable: false, evented: false,
                        });
                        canvas.add(outerPoly);
                        canvas.requestRenderAll();
                        // Ask user whether to add a void region — use custom event instead of blocking confirm
                        const addVoid = await new Promise<boolean>((resolve) => {
                            const handler = (ev: Event) => {
                                window.removeEventListener('pdfmax:cutout-choice', handler);
                                resolve((ev as CustomEvent).detail?.addVoid === true);
                            };
                            window.addEventListener('pdfmax:cutout-choice', handler);
                            window.dispatchEvent(new CustomEvent('pdfmax:cutout-prompt', {
                                detail: { phase: 'outer' }
                            }));
                        });
                        if (addVoid) {
                            startVoidPhase();
                        } else {
                            finalizeCutout();
                        }
                    } else {
                        // Finalize this void
                        const vArea = polyArea(points);
                        voidAreas.push(vArea);
                        const voidPoly = new Polygon(points.map(p => ({ x: p.x, y: p.y })), {
                            stroke: '#ef4444', strokeWidth: options.strokeWidth || 2,
                            fill: 'rgba(239,68,68,0.18)',
                            selectable: false, evented: false,
                        });
                        canvas.add(voidPoly);
                        voidsPolys.push(voidPoly);
                        canvas.requestRenderAll();
                        const addAnother = await new Promise<boolean>((resolve) => {
                            const handler = (ev: Event) => {
                                window.removeEventListener('pdfmax:cutout-choice', handler);
                                resolve((ev as CustomEvent).detail?.addVoid === true);
                            };
                            window.addEventListener('pdfmax:cutout-choice', handler);
                            window.dispatchEvent(new CustomEvent('pdfmax:cutout-prompt', {
                                detail: { phase: 'void' }
                            }));
                        });
                        if (addAnother) {
                            startVoidPhase();
                        } else {
                            finalizeCutout();
                        }
                    }
                });

                canvas.on('key:down', (o: any) => {
                    if (o.e?.key === 'Escape') finalizeCutout();
                });
                return;
            }

            // ── DIMENSION LINE TOOL (3 clicks: A → B → offset) ─────────────────
            if (tool === 'dimension-linear') {
                const color = options.strokeColor || '#1d4ed8';
                const sw = options.strokeWidth || 1.5;
                let ptA: { x: number; y: number } | null = null;
                let ptB: { x: number; y: number } | null = null;
                let previewLine: Line | null = null;  // AB preview
                let previewDim: Group | null = null;  // full dimension preview

                /** Build the geometry for a dimension line group */
                const buildDimGroup = (
                    a: { x: number; y: number },
                    b: { x: number; y: number },
                    offset: number,   // perpendicular offset in pixels (signed)
                    label: string,
                ) => {
                    // Direction of AB
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = dx / len, uy = dy / len;
                    // Perpendicular unit (rotated 90° CCW)
                    const px = -uy * offset, py = ux * offset;

                    // Extension line endpoints (offset + small overshoot)
                    const overshoot = 8;
                    const extA1 = { x: a.x, y: a.y };
                    const extA2 = { x: a.x + px + (-uy) * overshoot, y: a.y + py + ux * overshoot };
                    const extB1 = { x: b.x, y: b.y };
                    const extB2 = { x: b.x + px + (-uy) * overshoot, y: b.y + py + ux * overshoot };

                    // Dim line endpoints (on the offset)
                    const dimA = { x: a.x + px, y: a.y + py };
                    const dimB = { x: b.x + px, y: b.y + py };

                    // Arrowhead helper
                    const arrowHead = (tip: { x: number; y: number }, dir: { x: number; y: number }) => {
                        const hw = 4, hl = 10;
                        const perp = { x: -dir.y, y: dir.x };
                        return new Polygon([
                            { x: tip.x, y: tip.y },
                            { x: tip.x - dir.x * hl + perp.x * hw, y: tip.y - dir.y * hl + perp.y * hw },
                            { x: tip.x - dir.x * hl - perp.x * hw, y: tip.y - dir.y * hl - perp.y * hw },
                        ], { fill: color, stroke: color, strokeWidth: 1, selectable: false, evented: false });
                    };

                    const extLine1 = new Line([extA1.x, extA1.y, extA2.x, extA2.y], { stroke: color, strokeWidth: sw, selectable: false, evented: false });
                    const extLine2 = new Line([extB1.x, extB1.y, extB2.x, extB2.y], { stroke: color, strokeWidth: sw, selectable: false, evented: false });
                    const dimLine = new Line([dimA.x, dimA.y, dimB.x, dimB.y], { stroke: color, strokeWidth: sw, selectable: false, evented: false });
                    const headA = arrowHead(dimA, { x: ux, y: uy });   // arrow at A side pointing toward B
                    const headB = arrowHead(dimB, { x: -ux, y: -uy }); // arrow at B side pointing toward A

                    const midX = (dimA.x + dimB.x) / 2;
                    const midY = (dimA.y + dimB.y) / 2;
                    // Rotate angle for the label
                    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

                    const labelObj = new IText(label, {
                        left: midX,
                        top: midY - 14,
                        fontFamily: 'Arial',
                        fontSize: 12,
                        fill: color,
                        backgroundColor: 'rgba(255,255,255,0.9)',
                        textAlign: 'center',
                        angle: angleDeg,
                        originX: 'center',
                        originY: 'bottom',
                        selectable: false,
                        evented: false,
                        editable: false,
                    });

                    const grp = new Group([extLine1, extLine2, dimLine, headA, headB, labelObj], {
                        selectable: true, evented: true,
                    });
                    (grp as any).markupType = 'dimension-linear';
                    (grp as any).measureValue = label;
                    return grp;
                };

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);

                    if (!ptA) {
                        ptA = p;
                        // Start preview line
                        previewLine = new Line([p.x, p.y, p.x, p.y], {
                            stroke: color, strokeWidth: sw,
                            strokeDashArray: [6, 4], selectable: false, evented: false,
                        });
                        canvas.add(previewLine);
                    } else if (!ptB) {
                        ptB = p;
                        if (previewLine) canvas.remove(previewLine);
                        // Show dimension preview
                        const label = this.calibration.toRealWorld(pageNum, Math.sqrt((ptB.x - ptA.x) ** 2 + (ptB.y - ptA.y) ** 2));
                        previewDim = buildDimGroup(ptA, ptB, 40, label);
                        canvas.add(previewDim);
                        canvas.requestRenderAll();
                    } else {
                        // Third click: compute offset from AB midpoint to click point
                        const dx = ptB.x - ptA.x, dy = ptB.y - ptA.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpX = -dy / len, perpY = dx / len;
                        const midX = (ptA.x + ptB.x) / 2, midY = (ptA.y + ptB.y) / 2;
                        const signedOffset = (p.x - midX) * perpX + (p.y - midY) * perpY;

                        if (previewDim) canvas.remove(previewDim);
                        const label = this.calibration.toRealWorld(pageNum, len);
                        const dimGrp = buildDimGroup(ptA, ptB, signedOffset, label);
                        canvas.add(dimGrp);
                        canvas.setActiveObject(dimGrp);
                        canvas.requestRenderAll();
                        this.hideSnapIndicator();
                        this.emitHistoryChanged();
                        ptA = null; ptB = null; previewLine = null; previewDim = null;
                    }
                });

                canvas.on('mouse:move', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);

                    if (ptA && !ptB && previewLine) {
                        previewLine.set({ x2: p.x, y2: p.y });
                        canvas.requestRenderAll();
                    } else if (ptA && ptB) {
                        // Update preview dim with live offset
                        const dx = ptB.x - ptA.x, dy = ptB.y - ptA.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpX = -dy / len, perpY = dx / len;
                        const midX = (ptA.x + ptB.x) / 2, midY = (ptA.y + ptB.y) / 2;
                        const signedOffset = (p.x - midX) * perpX + (p.y - midY) * perpY;
                        if (previewDim) canvas.remove(previewDim);
                        const label = this.calibration.toRealWorld(pageNum, len);
                        previewDim = buildDimGroup(ptA, ptB, signedOffset, label);
                        canvas.add(previewDim);
                        canvas.requestRenderAll();
                    }
                });
                return;
            }

            // ── LEADER ANNOTATION TOOL (2 clicks: anchor → text position) ─────
            if (tool === 'leader') {
                const color = options.strokeColor || '#0f172a';
                const sw = options.strokeWidth || 1.5;
                let anchor: { x: number; y: number } | null = null;
                let previewLine: Line | null = null;

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);

                    if (!anchor) {
                        anchor = p;
                        previewLine = new Line([p.x, p.y, p.x, p.y], {
                            stroke: color, strokeWidth: sw,
                            strokeDashArray: [6, 4], selectable: false, evented: false,
                        });
                        canvas.add(previewLine);
                    } else {
                        // Second click — build the leader
                        if (previewLine) canvas.remove(previewLine);

                        const dx = anchor.x - p.x, dy = anchor.y - p.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ux = dx / len, uy = dy / len;
                        const hw = 6, hl = 14;
                        const perp = { x: -uy, y: ux };

                        // Arrowhead at anchor point
                        const headPts = [
                            { x: anchor.x, y: anchor.y },
                            { x: anchor.x - ux * hl + perp.x * hw, y: anchor.y - uy * hl + perp.y * hw },
                            { x: anchor.x - ux * hl - perp.x * hw, y: anchor.y - uy * hl - perp.y * hw },
                        ];
                        const arrowHead = new Polygon(headPts, {
                            fill: color, stroke: color, strokeWidth: 1,
                            selectable: false, evented: false,
                        });

                        // Leader line (anchor → text end)
                        const leaderLine = new Line([anchor.x, anchor.y, p.x, p.y], {
                            stroke: color, strokeWidth: sw,
                            selectable: false, evented: false,
                        });

                        // Short horizontal shelf at text end
                        const shelfLen = 30;
                        const shelf = new Line([p.x, p.y, p.x + shelfLen, p.y], {
                            stroke: color, strokeWidth: sw,
                            selectable: false, evented: false,
                        });

                        // Group all geometry
                        const geomGroup = new Group([leaderLine, arrowHead, shelf], {
                            selectable: true, evented: true,
                        });
                        (geomGroup as any).markupType = 'leader';

                        // Editable label above shelf
                        const labelText = new IText('Label', {
                            left: p.x,
                            top: p.y - 18,
                            fontFamily: 'Arial',
                            fontSize: 13,
                            fill: color,
                            selectable: true,
                            editable: true,
                        });
                        (labelText as any).markupType = 'leader-label';

                        // Sync label when geometry group moves
                        const syncLabel = () => {
                            labelText.set({ left: geomGroup.left ?? p.x, top: (geomGroup.top ?? p.y) - 18 });
                            canvas.requestRenderAll();
                        };
                        geomGroup.on('moving', syncLabel);
                        geomGroup.on('scaling', syncLabel);

                        canvas.add(geomGroup);
                        canvas.add(labelText);
                        canvas.setActiveObject(labelText);
                        // Enter edit mode so user can type the label immediately
                        (labelText as any).enterEditing?.();
                        canvas.requestRenderAll();
                        this.hideSnapIndicator();
                        this.emitHistoryChanged();

                        anchor = null; previewLine = null;
                    }
                });

                canvas.on('mouse:move', (o: any) => {
                    if (!anchor || !previewLine) return;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const p = this.snapPoint(pageNum, raw, canvas);
                    previewLine.set({ x2: p.x, y2: p.y });
                    canvas.requestRenderAll();
                });
                return;
            }

            let isDrawing = false;
            let startRect: Rect | Ellipse | null = null;
            let activePolyShape: Polyline | Polygon | null = null;
            let polyPoints: Array<{ x: number, y: number }> = [];

            // Helper to finalize polyline/polygon
            const finishPolyShape = () => {
                isDrawing = false;
                if (activePolyShape) {
                    activePolyShape.set({ selectable: true });
                    canvas.setActiveObject(activePolyShape);
                    // Remove dynamic event listner if we added one specifically
                    canvas.off('mouse:down', onPolyMouseDown);
                    canvas.off('mouse:move', onPolyMouseMove);
                    // Rebind default
                    bindDefaultEvents();
                }
                activePolyShape = null;
                polyPoints = [];
            };

            const onPolyMouseDown = (o: any) => {
                const raw = canvas.getPointer(o.e);
                const pointer = this.snapPoint(pageNum, raw, canvas);

                if (!isDrawing) {
                    isDrawing = true;
                    polyPoints = [{ x: pointer.x, y: pointer.y }, { x: pointer.x, y: pointer.y }];

                    const shapeOptions = {
                        fill: tool === 'polygon' ? (options.fillColor || 'rgba(239, 68, 68, 0.2)') : 'transparent',
                        stroke: options.strokeColor || '#ef4444',
                        strokeWidth: options.strokeWidth || 3,
                        selectable: false,
                        objectCaching: false
                    };

                    activePolyShape = tool === 'polygon'
                        ? new Polygon(polyPoints, shapeOptions)
                        : new Polyline(polyPoints, shapeOptions);

                    canvas.add(activePolyShape);
                } else {
                    // Add new point (snapped)
                    polyPoints.push({ x: pointer.x, y: pointer.y });
                }
            };

            const onPolyMouseMove = (o: any) => {
                if (!isDrawing || !activePolyShape) return;
                const raw = canvas.getPointer(o.e);
                const pointer = this.snapPoint(pageNum, raw, canvas);
                // Update the last point to the current mouse position
                polyPoints[polyPoints.length - 1] = { x: pointer.x, y: pointer.y };
                activePolyShape.set({ points: [...polyPoints] }); // Trigger update
                canvas.renderAll();
            };

            const bindDefaultEvents = () => {
                let startPoint: any = null;
                // Shared line shape for the 'line' tool
                let activeLine: Line | null = null;

                canvas.on('mouse:down', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    // Snap for precision tools; use raw for area-fill tools (redact, wipeout)
                    const pointer = (tool === 'redact') ? raw : this.snapPoint(pageNum, raw, canvas);

                    if (tool === 'text') {
                        // ── TEXT BOX ─────────────────────────────────────
                        const tb = new Textbox('', {
                            left: pointer.x,
                            top: pointer.y,
                            // dynamicMinWidth lets Fabric expand the box as text
                            // is typed rather than wrapping at a fixed width.
                            dynamicMinWidth: 60,
                            width: 120,
                            fontFamily: 'Arial',
                            fontSize: options.fontSize ?? 16,
                            fill: options.strokeColor || '#1e293b',
                            backgroundColor: 'rgba(255,255,255,0.0)',
                            selectable: true,
                            editable: true,
                            splitByGrapheme: false,
                            cursorColor: options.strokeColor || '#1e293b',
                        });
                        canvas.add(tb);
                        canvas.setActiveObject(tb);
                        tb.enterEditing();
                        // Force re-render on each keystroke so the grown box is visible
                        tb.on('changed', () => canvas.requestRenderAll());
                        return;
                    }


                    isDrawing = true;
                    startPoint = { x: pointer.x, y: pointer.y };

                    if (tool === 'rectangle') {
                        startRect = new Rect({
                            left: startPoint.x,
                            top: startPoint.y,
                            width: 0,
                            height: 0,
                            fill: options.fillColor || 'transparent',
                            stroke: options.strokeColor || '#ef4444',
                            strokeWidth: options.strokeWidth || 3,
                            selectable: false
                        });
                        canvas.add(startRect);
                    } else if (tool === 'ellipse') {
                        // ── ELLIPSE TOOL ─────────────────────────────────
                        startRect = new Ellipse({
                            left: startPoint.x,
                            top: startPoint.y,
                            rx: 0,
                            ry: 0,
                            fill: options.fillColor || 'transparent',
                            stroke: options.strokeColor || '#ef4444',
                            strokeWidth: options.strokeWidth || 3,
                            selectable: false,
                        } as any);
                        canvas.add(startRect);
                    } else if (tool === 'cloud-shape') {
                        // ── CLOUD SHAPE (revision cloud) ──────────────────
                        // Show a dashed preview rect while dragging
                        startRect = new Rect({
                            left: startPoint.x,
                            top: startPoint.y,
                            width: 0,
                            height: 0,
                            fill: 'transparent',
                            stroke: options.strokeColor || '#ef4444',
                            strokeWidth: 1,
                            strokeDashArray: [6, 4],
                            selectable: false,
                        });
                        canvas.add(startRect);
                    } else if (tool === 'line' || tool === 'arrow') {
                        // ── LINE / ARROW TOOL ────────────────────────────
                        activeLine = new Line(
                            [startPoint.x, startPoint.y, startPoint.x, startPoint.y],
                            {
                                stroke: options.strokeColor || '#ef4444',
                                strokeWidth: options.strokeWidth || 3,
                                selectable: false,
                                evented: false,
                            }
                        );
                        canvas.add(activeLine);
                    } else if (tool === 'wipeout') {
                        // ── WIPEOUT ───────────────────────────────────────
                        startRect = new Rect({
                            left: startPoint.x,
                            top: startPoint.y,
                            width: 0,
                            height: 0,
                            fill: '#ffffff',
                            stroke: 'transparent',
                            strokeWidth: 0,
                            selectable: false,
                            ...(({ markupType: 'wipeout' } as any)),
                        } as any);
                        (startRect as any).markupType = 'wipeout';
                        canvas.add(startRect);
                    } else if (tool === 'redact') {
                        // ── REDACTION BOX ─────────────────────────────────
                        startRect = new Rect({
                            left: startPoint.x,
                            top: startPoint.y,
                            width: 0,
                            height: 0,
                            fill: 'rgba(220,38,38,0.25)',
                            stroke: '#dc2626',
                            strokeWidth: 2,
                            strokeDashArray: [6, 4],
                            selectable: false,
                        } as any);
                        (startRect as any).markupType = 'redaction';
                        canvas.add(startRect);
                    }
                    // callout: no shape yet on mouse:down (created on first move)
                });

                let calloutLine: Line | null = null;

                canvas.on('mouse:move', (o: any) => {
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    // Snap for precision geometry tools; use raw for area-fill tools (redact)
                    const pointer = (tool === 'redact') ? raw : this.snapPoint(pageNum, raw, canvas);

                    if (tool === 'cloud-shape' && startRect && startPoint) {
                        // Update preview dashed rect
                        startRect.set({
                            width: Math.abs(pointer.x - startPoint.x),
                            height: Math.abs(pointer.y - startPoint.y),
                            left: Math.min(pointer.x, startPoint.x),
                            top: Math.min(pointer.y, startPoint.y),
                        });
                        canvas.requestRenderAll();
                    } else if ((tool === 'rectangle' || tool === 'wipeout' || tool === 'redact') && startRect && startPoint) {
                        startRect.set({
                            width: Math.abs(pointer.x - startPoint.x),
                            height: Math.abs(pointer.y - startPoint.y),
                            left: Math.min(pointer.x, startPoint.x),
                            top: Math.min(pointer.y, startPoint.y)
                        });
                        canvas.requestRenderAll();
                    } else if (tool === 'ellipse' && startRect && startPoint) {
                        // ── ELLIPSE drag update ───────────────────────────
                        const rx = Math.abs(pointer.x - startPoint.x) / 2;
                        const ry = Math.abs(pointer.y - startPoint.y) / 2;
                        startRect.set({
                            rx, ry,
                            left: Math.min(pointer.x, startPoint.x),
                            top: Math.min(pointer.y, startPoint.y),
                        } as any);
                        canvas.requestRenderAll();
                    } else if ((tool === 'line' || tool === 'arrow') && activeLine) {
                        activeLine.set({ x2: pointer.x, y2: pointer.y });
                        canvas.requestRenderAll();
                    } else if (tool === 'callout' && startPoint) {
                        if (!calloutLine) {
                            calloutLine = new Line([startPoint.x, startPoint.y, pointer.x, pointer.y], {
                                stroke: options.strokeColor || '#2563eb',
                                strokeWidth: options.strokeWidth || 2,
                                selectable: false,
                                evented: false,
                            });
                            canvas.add(calloutLine);
                        } else {
                            calloutLine.set({ x2: pointer.x, y2: pointer.y });
                            canvas.requestRenderAll();
                        }
                    }
                });

                canvas.on('mouse:up', (o: any) => {
                    isDrawing = false;
                    const raw = o.scenePoint ?? canvas.getPointer(o.e);
                    const pointer = this.snapPoint(pageNum, raw, canvas);
                    this.hideSnapIndicator();

                    if (tool === 'cloud-shape' && startRect && startPoint) {
                        // Remove preview rect, build final bumpy cloud Path
                        canvas.remove(startRect);
                        startRect = null;
                        const x0 = Math.min(pointer.x, startPoint.x);
                        const y0 = Math.min(pointer.y, startPoint.y);
                        const w = Math.abs(pointer.x - startPoint.x);
                        const h = Math.abs(pointer.y - startPoint.y);
                        if (w > 4 && h > 4) {
                            const pathData = makeRevisionCloudPath(x0, y0, w, h);
                            const cloudPath = new Path(pathData, {
                                left: x0,
                                top: y0,
                                fill: options.fillColor || 'transparent',
                                stroke: options.strokeColor || '#ef4444',
                                strokeWidth: options.strokeWidth || 2,
                                selectable: true,
                                objectCaching: false,
                            });
                            canvas.add(cloudPath);
                            canvas.setActiveObject(cloudPath);
                        }
                        canvas.requestRenderAll();
                    } else if (tool === 'rectangle' && startRect) {
                        startRect.set({ selectable: true });
                        canvas.setActiveObject(startRect);
                        canvas.requestRenderAll();
                    } else if (tool === 'ellipse' && startRect && startPoint) {
                        // ── ELLIPSE finalize ─────────────────────────────
                        const rx = Math.abs(pointer.x - startPoint.x) / 2;
                        const ry = Math.abs(pointer.y - startPoint.y) / 2;
                        if (rx > 2 && ry > 2) {
                            startRect.set({ rx, ry, selectable: true } as any);
                            canvas.setActiveObject(startRect);
                        } else {
                            canvas.remove(startRect);
                        }
                        startRect = null;
                        canvas.requestRenderAll();
                    }

                    if (tool === 'wipeout' && startRect) {
                        // Send wipeout below all other markups but above PDF canvas
                        startRect.set({ selectable: true });
                        canvas.sendObjectToBack(startRect);
                        canvas.requestRenderAll();
                    }

                    if (tool === 'redact' && startRect) {
                        // Finalize redaction rect and add centered label
                        const rx = startRect.left ?? 0;
                        const ry = startRect.top ?? 0;
                        const rw = startRect.width ?? 0;
                        const rh = startRect.height ?? 0;
                        if (rw > 4 && rh > 4) {
                            startRect.set({ selectable: true });
                            // Add "REDACTED" label centered in the box
                            const label = new IText('REDACTED', {
                                left: rx + rw / 2,
                                top: ry + rh / 2,
                                fontSize: Math.max(10, Math.min(rh * 0.4, 24)),
                                fontFamily: 'Arial',
                                fontWeight: 'bold',
                                fill: '#dc2626',
                                originX: 'center',
                                originY: 'center',
                                selectable: false,
                                evented: false,
                            } as any);
                            (label as any).markupType = 'redaction-label';
                            canvas.add(label);
                            canvas.setActiveObject(startRect);
                        } else {
                            canvas.remove(startRect);
                        }
                        canvas.requestRenderAll();
                    }

                    if ((tool === 'line' || tool === 'arrow') && activeLine && startPoint) {
                        activeLine.set({ x2: pointer.x, y2: pointer.y });
                        if (tool === 'arrow') {
                            // ── Build arrowhead at endpoint ───────────────
                            const color = options.strokeColor || '#ef4444';
                            const sw = options.strokeWidth || 3;
                            const dx = pointer.x - startPoint.x;
                            const dy = pointer.y - startPoint.y;
                            const len = Math.sqrt(dx * dx + dy * dy) || 1;
                            const ux = dx / len, uy = dy / len;
                            const px = -uy, py = ux;
                            const hw = 7, hl = 16;
                            const ahPts = [
                                { x: pointer.x, y: pointer.y },
                                { x: pointer.x - ux * hl + px * hw, y: pointer.y - uy * hl + py * hw },
                                { x: pointer.x - ux * hl - px * hw, y: pointer.y - uy * hl - py * hw },
                            ];
                            const head = new Polygon(ahPts, {
                                fill: color, stroke: color, strokeWidth: 1,
                                selectable: false, evented: false,
                            });
                            const arrowGroup = new Group([activeLine, head], {
                                selectable: true, evented: true,
                            });
                            (arrowGroup as any).markupType = 'arrow';
                            canvas.add(arrowGroup);
                            canvas.setActiveObject(arrowGroup);
                        } else {
                            activeLine.set({ selectable: true, evented: true });
                            canvas.setActiveObject(activeLine);
                        }
                        canvas.requestRenderAll();
                        activeLine = null;
                    }

                    if (tool === 'callout' && calloutLine && startPoint) {
                        // ── Build grouped callout: leader + arrowhead + bubble ─
                        const color = options.strokeColor || '#2563eb';
                        const sw = options.strokeWidth || 2;

                        // Arrow direction (from head back toward tail for arrowhead at tail)
                        const dx = startPoint.x - pointer.x;
                        const dy = startPoint.y - pointer.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ux = dx / len, uy = dy / len;   // unit toward tail
                        const px = -uy, py = ux;              // perpendicular
                        const hw = 8, hl = 14;                // arrowhead half-width, length

                        // Arrowhead triangle vertices (at tail / startPoint)
                        const ahPts = [
                            { x: startPoint.x, y: startPoint.y },
                            { x: startPoint.x - ux * hl + px * hw, y: startPoint.y - uy * hl + py * hw },
                            { x: startPoint.x - ux * hl - px * hw, y: startPoint.y - uy * hl - py * hw },
                        ];
                        const arrowHead = new Polygon(ahPts, {
                            fill: color,
                            stroke: color,
                            strokeWidth: 1,
                            selectable: false,
                            evented: false,
                        });

                        // Bubble rect at head (pointer), centered
                        const bw = 120, bh = 36;
                        const bubbleRect = new Rect({
                            left: pointer.x - bw / 2,
                            top: pointer.y - bh / 2,
                            width: bw,
                            height: bh,
                            rx: 6, ry: 6,
                            fill: 'rgba(255,255,255,0.95)',
                            stroke: color,
                            strokeWidth: sw,
                            selectable: false,
                            evented: false,
                        });

                        // Update calloutLine to be the final position
                        calloutLine.set({
                            x1: startPoint.x, y1: startPoint.y,
                            x2: pointer.x, y2: pointer.y,
                            stroke: color, strokeWidth: sw,
                            selectable: false, evented: false,
                        });

                        // Text label — kept OUTSIDE the group so it's directly
                        // editable via double-click (Fabric IText inside Group
                        // doesn't support enterEditing reliably).
                        const labelText = new IText('Label', {
                            left: pointer.x - 60,
                            top: pointer.y - 9,
                            width: 120,
                            fontFamily: 'Arial',
                            fontSize: 13,
                            fill: '#0f172a',
                            textAlign: 'center',
                            selectable: true,
                            editable: true,
                        });
                        (labelText as any).markupType = 'callout-label';

                        // Group the visual elements (leader line + arrowhead + bubble)
                        const structGroup = new Group([calloutLine, arrowHead, bubbleRect], {
                            selectable: true,
                            evented: true,
                        });
                        (structGroup as any).markupType = 'callout';

                        // Keep the label synced when the group moves/scales/rotates
                        const syncLabel = () => {
                            const gLeft = structGroup.left ?? 0;
                            const gTop = structGroup.top ?? 0;
                            const gW = structGroup.width ?? 0;
                            const gH = structGroup.height ?? 0;
                            // Bubble is at the "head" end — center of the group bounds
                            labelText.set({
                                left: gLeft - gW / 2 + (gW / 2 - 60),
                                top: gTop - gH / 2 + (gH / 2 - 9),
                            });
                            canvas.requestRenderAll();
                        };
                        structGroup.on('moving', syncLabel);
                        structGroup.on('scaling', syncLabel);
                        structGroup.on('rotating', syncLabel);

                        canvas.add(structGroup);
                        canvas.add(labelText);
                        canvas.setActiveObject(structGroup);
                        canvas.requestRenderAll();
                    }

                    startRect = null;
                    calloutLine = null;
                    startPoint = null;
                });
            };

            if (tool === 'polyline' || tool === 'polygon') {
                // ── Double-click to finish ────────────────────────────────
                // Fabric fires mouse:down twice before mouse:dblclick fires,
                // so we guard with a 350 ms timestamp to drop the phantom point.
                let lastPolyClickTime = 0;
                const POLY_DBL_THRESHOLD = 350;

                const guardedPolyMouseDown = (o: any) => {
                    const now = Date.now();
                    if (now - lastPolyClickTime < POLY_DBL_THRESHOLD) {
                        // Second click of a double-click — ignore it
                        lastPolyClickTime = 0;
                        return;
                    }
                    lastPolyClickTime = now;
                    onPolyMouseDown(o);
                };

                const onPolyDblClick = () => {
                    if (!isDrawing) return;
                    // Remove the extra point that the second click added
                    if (polyPoints.length > 2) polyPoints.pop();
                    finishPolyShape();
                    canvas.off('mouse:dblclick', onPolyDblClick);
                    window.removeEventListener('keydown', handlePolyKey);
                };

                const handlePolyKey = (e: KeyboardEvent) => {
                    if (e.key === 'Escape' || e.key === 'Enter') {
                        finishPolyShape();
                        canvas.off('mouse:dblclick', onPolyDblClick);
                        window.removeEventListener('keydown', handlePolyKey);
                    }
                };

                canvas.on('mouse:down', guardedPolyMouseDown);
                canvas.on('mouse:move', onPolyMouseMove);
                canvas.on('mouse:dblclick', onPolyDblClick);
                window.addEventListener('keydown', handlePolyKey);
            } else {
                bindDefaultEvents();
            }
        });
    }
}
