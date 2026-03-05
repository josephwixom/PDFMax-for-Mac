'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfEngine } from '@pdfmax/pdf-engine';
import { useToolStore } from '@/store/useToolStore';
import { useMeasureStore } from '@/store/useMeasureStore';
import { useDocStore } from '@/store/useDocStore';
import { CalibrationModal } from '@/components/ui/CalibrationModal';
import { VolumePromptDialog } from '@/components/ui/VolumePromptDialog';
import { PrintScaleModal } from '@/components/ui/PrintScaleModal';
import { PageScaleWidget } from '@/components/ui/PageScaleWidget';
import { SearchBar } from '@/components/ui/SearchBar';
import RichTextToolbar from '@/components/ui/RichTextToolbar';
import { PageOperationsModal } from '@/components/ui/PageOperationsModal';
import { CutoutPrompt } from '@/components/ui/CutoutPrompt';
import { SignatureModal } from '@/components/ui/SignatureModal';
import { exportMarkupsAsPdf } from '@/lib/pdfExporter';
import { embedNativeAnnotations } from '@/lib/nativePdfAnnotator';
import { applyRedactions } from '@/lib/redactionExporter';
import { shareFile, installApplePencilListener } from '@/lib/capacitorBridge';
import { useLayerStore } from '@/store/useLayerStore';
import { useCollabStore } from '@/store/useCollabStore';


const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.1;
const UNITS_LIST = ['ft', 'in', 'm', 'cm', 'mm'];

export const PDFViewer = () => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [engine, setEngine] = useState<PdfEngine | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [pageJumping, setPageJumping] = useState(false);
    const [pageJumpValue, setPageJumpValue] = useState('');
    useEffect(() => { setMounted(true); }, []);

    // Volume prompt dialog state
    const [volumeDialogOpen, setVolumeDialogOpen] = useState(false);
    const [volumeAreaLabel, setVolumeAreaLabel] = useState('');
    const [volumeDefaultUnit, setVolumeDefaultUnit] = useState('ft');
    const volumeGroupRef = useRef<any>(null);

    // Stamp click-to-place state
    const [pendingStamp, setPendingStamp] = useState<{ label: string; style: Record<string, string> } | null>(null);

    // Print Scale Modal state
    const [printModalOpen, setPrintModalOpen] = useState(false);
    const [printExporting, setPrintExporting] = useState(false);
    const [printBlob, setPrintBlob] = useState<Blob | null>(null);
    const [printPageDims, setPrintPageDims] = useState<{ wPt: number; hPt: number }>({ wPt: 612, hPt: 792 });

    // Page Operations modal state
    const [pageOpsOpen, setPageOpsOpen] = useState(false);
    // Signature modal state
    const [sigModalOpen, setSigModalOpen] = useState(false);

    const { activeTool, strokeColor, strokeWidth, fillColor, opacity, zoom, setZoom } = useToolStore();
    const { openCalibrationModal, pageScales, restorePageScale } = useMeasureStore();
    const { setTotalPages, setCurrentPage, currentPage, totalPages, setFileName, fileName } = useDocStore();
    const isInitialized = useRef(false);
    // Stable ref to engine (SearchBar needs a ref, not state)
    const engineRef = useRef<PdfEngine | null>(null);
    useEffect(() => { engineRef.current = engine; }, [engine]);

    // ─── Layers: wire pdfmax:layers-changed → engine.applyLayerVisibility() ─
    const { layers, activeLayerId } = useLayerStore();
    const { reviewer } = useCollabStore();
    const activeLayerIdRef = useRef(activeLayerId);
    useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);
    const layersRef = useRef(layers);
    useEffect(() => { layersRef.current = layers; }, [layers]);

    useEffect(() => {
        if (!engine || !isLoaded) return;
        // Apply current layer state when engine first loads
        engine.applyLayerVisibility(layers);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, isLoaded]);

    useEffect(() => {
        const handler = (e: Event) => {
            const updatedLayers = (e as CustomEvent).detail as typeof layers;
            engineRef.current?.applyLayerVisibility(updatedLayers);
        };
        window.addEventListener('pdfmax:layers-changed', handler);
        return () => window.removeEventListener('pdfmax:layers-changed', handler);
    }, []);

    // ─── Image stamp: wire Toolbar "Image" button → engine ────────────────
    useEffect(() => {
        const handler = (e: Event) => {
            const { dataUrl } = (e as CustomEvent).detail ?? {};
            if (dataUrl) engineRef.current?.addImageStamp(dataUrl);
        };
        window.addEventListener('pdfmax:add-image-stamp', handler);
        return () => window.removeEventListener('pdfmax:add-image-stamp', handler);
    }, []);

    // Pan drag state
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

    // ─── Sync tool to PdfEngine ───────────────────────────────────────────
    useEffect(() => {
        if (engine && isLoaded) {
            engine.setDrawMode(activeTool, { strokeColor, strokeWidth, fillColor, opacity });
        }
    }, [engine, isLoaded, activeTool, strokeColor, strokeWidth, fillColor, opacity]);

    // ─── Push calibration scales into CalibrationManager ─────────────────
    useEffect(() => {
        if (!engine) return;
        Object.entries(pageScales).forEach(([page, config]) => {
            engine.calibration.setScale(Number(page), config);
        });
    }, [engine, pageScales]);

    // ─── Restore scale label when page changes ────────────────────────────
    useEffect(() => {
        restorePageScale(currentPage);
    }, [currentPage, restorePageScale]);

    // ─── Track visible page for engine methods (e.g. addImageStamp) ───────
    useEffect(() => {
        (window as any).__pdfMaxCurrentPage = currentPage;
    }, [currentPage]);

    // ─── Ctrl+Wheel zoom ──────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const currentZoom = zoom;

        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
                parseFloat((currentZoom + direction * ZOOM_STEP).toFixed(2))
            ));
            const rect = el.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const ratio = newZoom / currentZoom;
            requestAnimationFrame(() => {
                el.scrollLeft = (el.scrollLeft + mouseX) * ratio - mouseX;
                el.scrollTop = (el.scrollTop + mouseY) * ratio - mouseY;
            });
            setZoom(newZoom);
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [zoom, setZoom]);

    // ─── Drag pan ─────────────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;

        const onMouseDown = (e: MouseEvent) => {
            if (activeTool !== 'pan' && e.button !== 1) return;
            e.preventDefault();
            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
            el.style.cursor = 'grabbing';
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!isPanning.current) return;
            el.scrollLeft = panStart.current.scrollLeft - (e.clientX - panStart.current.x);
            el.scrollTop = panStart.current.scrollTop - (e.clientY - panStart.current.y);
        };
        const onMouseUp = () => {
            if (!isPanning.current) return;
            isPanning.current = false;
            el.style.cursor = activeTool === 'pan' ? 'grab' : '';
        };

        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        el.style.cursor = activeTool === 'pan' ? 'grab' : '';

        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [activeTool]);

    // ─── Touch: pinch-to-zoom + single-finger pan (iPad) ─────────────────
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;

        let lastDist = 0;
        let touchPanStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;

        const dist = (t: TouchList) => {
            const dx = t[0].clientX - t[1].clientX;
            const dy = t[0].clientY - t[1].clientY;
            return Math.hypot(dx, dy);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                lastDist = dist(e.touches);
            } else if (e.touches.length === 1 && activeTool === 'pan') {
                touchPanStart = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    scrollLeft: el.scrollLeft,
                    scrollTop: el.scrollTop,
                };
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const newDist = dist(e.touches);
                if (lastDist === 0) { lastDist = newDist; return; }
                const ratio = newDist / lastDist;
                lastDist = newDist;
                // Use zoom captured from the outer closure (re-runs when zoom changes)
                const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parseFloat(((zoom ?? 1) * ratio).toFixed(2))));
                setZoom(next);
            } else if (e.touches.length === 1 && touchPanStart) {
                el.scrollLeft = touchPanStart.scrollLeft - (e.touches[0].clientX - touchPanStart.x);
                el.scrollTop = touchPanStart.scrollTop - (e.touches[0].clientY - touchPanStart.y);
            }
        };

        const onTouchEnd = () => {
            lastDist = 0;
            touchPanStart = null;
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
        };
    }, [activeTool, setZoom]);


    // ─── Apple Pencil: install pressure-aware pointer listener ────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        const cleanup = installApplePencilListener(containerRef.current);
        return cleanup;
    }, [isLoaded]);

    // ─── IntersectionObserver: track current visible page ─────────────────
    useEffect(() => {

        if (!containerRef.current) return;
        const observer = new IntersectionObserver(
            (entries) => {
                // Find the most visible page wrapper
                let best: IntersectionObserverEntry | null = null;
                entries.forEach((entry) => {
                    if (!best || entry.intersectionRatio > best.intersectionRatio) {
                        best = entry;
                    }
                });
                if (best && (best as IntersectionObserverEntry).isIntersecting) {
                    const target = (best as IntersectionObserverEntry).target as HTMLElement;
                    const page = parseInt(target.dataset.page ?? '1', 10);
                    if (!isNaN(page)) setCurrentPage(page);
                }
            },
            { root: scrollContainerRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] }
        );

        // Observe all pdf-page-wrapper divs
        const wrappers = containerRef.current.querySelectorAll<HTMLElement>('.pdf-page-wrapper');
        wrappers.forEach((w) => observer.observe(w));

        return () => observer.disconnect();
    }, [isLoaded, setCurrentPage]);

    // ─── File open handler ────────────────────────────────────────────────
    const handleFileOpen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !engine) return;
        const data = await file.arrayBuffer();
        setIsLoaded(false);
        setFileName(file.name);
        await engine.reloadDocument('', data);
        // Attach IntersectionObserver to new page wrappers
        const wrappers = containerRef.current?.querySelectorAll<HTMLElement>('.pdf-page-wrapper');
        wrappers?.forEach((w, i) => { w.dataset.page = String(i + 1); });
        setIsLoaded(true);
        // Reset input value so the same file can be re-opened
        e.target.value = '';
    }, [engine, setFileName]);

    // Expose file open trigger via a custom event for Toolbar button + Studio panel
    useEffect(() => {
        const handler = async (e: Event) => {
            const file = (e as CustomEvent).detail?.file as File | undefined;
            if (file) {
                // Studio panel: file was passed directly
                if (!engine) return;
                const data = await file.arrayBuffer();
                setIsLoaded(false);
                setFileName(file.name);
                await engine.reloadDocument('', data);
                const wrappers = containerRef.current?.querySelectorAll<HTMLElement>('.pdf-page-wrapper');
                wrappers?.forEach((w, i) => { w.dataset.page = String(i + 1); });
                setIsLoaded(true);
            } else {
                // Toolbar: open OS file picker
                fileInputRef.current?.click();
            }
        };
        window.addEventListener('pdfmax:open-file', handler);
        return () => window.removeEventListener('pdfmax:open-file', handler);
    }, [engine, setFileName]);


    // ─── Delete / Backspace to remove selected markup ─────────────────
    useEffect(() => {
        if (!engine) return;
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                engine.deleteSelected();
            }
            // Ctrl+Z / Cmd+Z → undo
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
                e.preventDefault();
                engine.undo();
            }
            // Ctrl+Y / Cmd+Y or Ctrl+Shift+Z → redo
            if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                engine.redo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [engine]);

    // ─── Toolbar button events (undo / redo / export) ─────────────────
    useEffect(() => {
        if (!engine) return;
        const onUndo = () => { engine.undo(); };
        const onRedo = () => { engine.redo(); };
        const onExport = () => {
            const data = engine.exportMarkups();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pdfmax-markups-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };
        const onExportPdf = async () => {
            try {
                const markupJson = engine.exportMarkups();
                // Fetch original PDF bytes
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { alert('PDF source URL not available for export.'); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                // Build page dimension map
                const pageScales = new Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>();
                for (const [, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                    // Derive page num from canvas data attribute
                }
                // Simpler: iterate canvasMap for rendered page sizes
                for (const [pageNum, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                    pageScales.set(pageNum, {
                        width: canvas.width,
                        height: canvas.height,
                        fabricWidth: canvas.width,
                        fabricHeight: canvas.height,
                    });
                }
                const nativeFieldValues = (engine as any).getNativeFormFieldValues?.() as Map<number, { fieldName: string; fieldType: string; value: string }[]> | undefined;
                const pdfBytes = await exportMarkupsAsPdf(bytes, markupJson, pageScales, nativeFieldValues);
                const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
                const filename = `pdfmax-annotated-${new Date().toISOString().slice(0, 10)}.pdf`;
                // Use native share sheet on iOS, browser download on web
                await shareFile(blob, filename);
            } catch (err) {
                console.error('[PDFMax] PDF export failed', err);
                alert('PDF export failed. See console for details.');
            }
        };
        const onImportMarkups = async (e: Event) => {
            const data = (e as CustomEvent).detail?.data;
            if (!data || typeof data !== 'object') return;
            try {
                await engine.loadMarkupsFromJSON(data);
                // Broadcast updated list
                const markups = engine.getAllMarkups();
                window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
            } catch (err) {
                console.error('[PDFMax] Import failed', err);
            }
        };
        window.addEventListener('pdfmax:undo', onUndo);
        window.addEventListener('pdfmax:redo', onRedo);
        window.addEventListener('pdfmax:export', onExport);
        window.addEventListener('pdfmax:export-pdf', onExportPdf);
        window.addEventListener('pdfmax:import-markups', onImportMarkups);

        // ── Native PDF annotation export ────────────────────────────────────────
        const onExportNativePdf = async () => {
            if (!engine) return;
            try {
                const markupJson = engine.exportMarkups();
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { alert('PDF source URL not available for export.'); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                const pageScales = new Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>();
                for (const [pageNum, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                    pageScales.set(pageNum, {
                        width: canvas.width,
                        height: canvas.height,
                        fabricWidth: canvas.width,
                        fabricHeight: canvas.height,
                    });
                }
                const pdfBytes = await embedNativeAnnotations(bytes, markupJson, pageScales);
                const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
                const filename = `pdfmax-native-${new Date().toISOString().slice(0, 10)}.pdf`;
                await shareFile(blob, filename);
            } catch (err) {
                console.error('[PDFMax] Native PDF export failed', err);
                alert('Native PDF export failed. See console for details.');
            }
        };
        window.addEventListener('pdfmax:export-native-pdf', onExportNativePdf);

        // ── Apply Redactions (permanent) ─────────────────────────────────
        const onApplyRedactions = async () => {
            if (!engine) return;
            const confirmed = window.confirm(
                'Apply Redactions will permanently remove the redacted content from the downloaded PDF.\n\nThis action cannot be undone.\n\nContinue?'
            );
            if (!confirmed) return;
            try {
                const markupJson = engine.exportMarkups();
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { alert('PDF source URL not available for export.'); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                const pageScales = new Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>();
                for (const [pageNum, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                    pageScales.set(pageNum, {
                        width: canvas.width, height: canvas.height,
                        fabricWidth: canvas.width, fabricHeight: canvas.height,
                    });
                }
                const pdfBytes = await applyRedactions(
                    bytes, markupJson, pageScales,
                    { getCanvasForPage: (p: number) => (engine as any).getCanvasForPage(p) }
                );
                const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
                const filename = `pdfmax-redacted-${new Date().toISOString().slice(0, 10)}.pdf`;
                await shareFile(blob, filename);
            } catch (err) {
                console.error('[PDFMax] Apply redactions failed', err);
                alert('Apply Redactions failed. See console for details.');
            }
        };
        window.addEventListener('pdfmax:apply-redactions', onApplyRedactions);

        // ── Print at Scale ────────────────────────────────────────────────
        const onPrint = async () => {
            setPrintModalOpen(true);
            setPrintBlob(null);
            setPrintExporting(true);
            try {
                const markupJson = engine.exportMarkups();
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { setPrintExporting(false); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                const { PDFDocument } = await import('pdf-lib');
                const pdfDoc = await PDFDocument.load(bytes);
                const pg0 = pdfDoc.getPage(0);
                const { width: wPt, height: hPt } = pg0.getSize();
                setPrintPageDims({ wPt, hPt });
                const pageScalesMap = new Map<number, { width: number; height: number; fabricWidth: number; fabricHeight: number }>();
                for (const [pageNum, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                    pageScalesMap.set(pageNum, { width: canvas.width, height: canvas.height, fabricWidth: canvas.width, fabricHeight: canvas.height });
                }
                const flatPdfBytes = await exportMarkupsAsPdf(bytes, markupJson, pageScalesMap);
                setPrintBlob(new Blob([flatPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
            } catch (err) {
                console.error('[PDFMax] Print prepare failed', err);
                alert('Could not prepare print PDF. See console.');
                setPrintModalOpen(false);
            } finally {
                setPrintExporting(false);
            }
        };
        window.addEventListener('pdfmax:print', onPrint);

        const onSetSnap = (e: Event) => {
            const { enabled } = (e as CustomEvent).detail ?? {};
            engine.setSnapEnabled(Boolean(enabled));
        };
        window.addEventListener('pdfmax:set-snap', onSetSnap);

        const onSetGridSnap = (e: Event) => {
            const { enabled } = (e as CustomEvent).detail ?? {};
            engine.setGridSnapEnabled(Boolean(enabled));
        };
        window.addEventListener('pdfmax:set-grid-snap', onSetGridSnap);

        const onSetGridSize = (e: Event) => {
            const { px } = (e as CustomEvent).detail ?? {};
            if (typeof px === 'number') engine.setGridSize(px);
        };
        window.addEventListener('pdfmax:set-grid-size', onSetGridSize);

        // Session lock / unlock — prevent non-host participants from drawing
        const onSessionLocked = () => { useToolStore.getState().setActiveTool('pan'); };
        const onSessionUnlocked = () => { useToolStore.getState().setActiveTool('select'); };
        window.addEventListener('pdfmax:session-locked', onSessionLocked);
        window.addEventListener('pdfmax:session-unlocked', onSessionUnlocked);

        // Open signature modal
        const onOpenSig = () => setSigModalOpen(true);
        window.addEventListener('pdfmax:open-signature', onOpenSig);

        // Import DXF file
        const onOpenDxf = async (e: Event) => {
            const file = (e as CustomEvent).detail?.file as File | undefined;
            if (!file) return;
            try {
                const { loadDxfFile } = await import('@/lib/dxfLoader');
                const pageNum = (window as any).__pdfMaxCurrentPage ?? 1;
                const canvas = (engine as any).annotationLayers?.get(pageNum);
                if (!canvas) return;
                const vp = canvas.getElement?.();
                const w = vp?.width ?? canvas.width ?? 800;
                const h = vp?.height ?? canvas.height ?? 1100;
                const count = await loadDxfFile(file, canvas, w, h);
                window.dispatchEvent(new CustomEvent('pdfmax:toast', {
                    detail: { message: `Imported ${count} DXF entities`, kind: 'success' }
                }));
                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
            } catch (err) {
                console.error('DXF import failed:', err);
            }
        };
        window.addEventListener('pdfmax:open-dxf', onOpenDxf);

        // Place a form field placeholder on the canvas
        const onPlaceFormField = (e: Event) => {
            const { fieldType } = (e as CustomEvent).detail ?? {};
            if (!fieldType) return;
            (engine as any).addFormField?.(fieldType);
        };
        window.addEventListener('pdfmax:place-form-field', onPlaceFormField);

        const onPageOperations = () => setPageOpsOpen(true);
        window.addEventListener('pdfmax:page-operations', onPageOperations);

        const onExtractPages = async (e: Event) => {
            const { pages } = (e as CustomEvent).detail ?? {};
            if (!Array.isArray(pages) || pages.length === 0) return;
            try {
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { alert('PDF source URL not available.'); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                const { PDFDocument } = await import('pdf-lib');
                const srcDoc = await PDFDocument.load(bytes);
                const newDoc = await PDFDocument.create();
                const copied = await newDoc.copyPages(srcDoc, pages);
                copied.forEach(p => newDoc.addPage(p));
                const outBytes = await newDoc.save();
                const blob = new Blob([outBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
                const a = Object.assign(document.createElement('a'), {
                    href: URL.createObjectURL(blob),
                    download: `extracted-pages-${pages.map(p => p + 1).join(',')}.pdf`,
                });
                a.click();
                URL.revokeObjectURL(a.href);
            } catch (err) {
                console.error('[PDFMax] Extract pages failed', err);
                alert('Extract pages failed. See console for details.');
            }
        };
        window.addEventListener('pdfmax:extract-pages', onExtractPages);

        const onSplitPdf = async (e: Event) => {
            const { chunkSize } = (e as CustomEvent).detail ?? {};
            const n = typeof chunkSize === 'number' ? chunkSize : 1;
            try {
                const pdfUrl = (engine as any).options?.pdfUrl as string | undefined;
                if (!pdfUrl) { alert('PDF source URL not available.'); return; }
                const resp = await fetch(pdfUrl);
                const bytes = await resp.arrayBuffer();
                const { PDFDocument } = await import('pdf-lib');
                const srcDoc = await PDFDocument.load(bytes);
                const total = srcDoc.getPageCount();
                // Create chunks
                for (let start = 0; start < total; start += n) {
                    const end = Math.min(start + n, total);
                    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
                    const chunkDoc = await PDFDocument.create();
                    const copied = await chunkDoc.copyPages(srcDoc, pageIndices);
                    copied.forEach(p => chunkDoc.addPage(p));
                    const chunkBytes = await chunkDoc.save();
                    const blob = new Blob([chunkBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
                    const label = n === 1 ? `page-${start + 1}` : `pages-${start + 1}-${end}`;
                    const a = Object.assign(document.createElement('a'), {
                        href: URL.createObjectURL(blob),
                        download: `split-${label}.pdf`,
                    });
                    document.body.appendChild(a);
                    a.click();
                    URL.revokeObjectURL(a.href);
                    document.body.removeChild(a);
                    // Small delay between downloads so browser doesn't block them
                    await new Promise(res => setTimeout(res, 150));
                }
            } catch (err) {
                console.error('[PDFMax] Split PDF failed', err);
                alert('Split PDF failed. See console for details.');
            }
        };
        window.addEventListener('pdfmax:split-pdf', onSplitPdf);

        const onScaleConfirmed = () => {
            engine.removeCalibrationLine();
        };
        window.addEventListener('pdfmax:scale-confirmed', onScaleConfirmed);

        // Cancel: remove the orange dashed line without setting a scale
        const onScaleCancelled = () => {
            engine.removeCalibrationLine();
        };
        window.addEventListener('pdfmax:scale-cancelled', onScaleCancelled);


        return () => {
            window.removeEventListener('pdfmax:undo', onUndo);
            window.removeEventListener('pdfmax:redo', onRedo);
            window.removeEventListener('pdfmax:export', onExport);
            window.removeEventListener('pdfmax:export-pdf', onExportPdf);
            window.removeEventListener('pdfmax:export-native-pdf', onExportNativePdf);
            window.removeEventListener('pdfmax:apply-redactions', onApplyRedactions);
            window.removeEventListener('pdfmax:print', onPrint);
            window.removeEventListener('pdfmax:import-markups', onImportMarkups);
            window.removeEventListener('pdfmax:set-snap', onSetSnap);
            window.removeEventListener('pdfmax:set-grid-snap', onSetGridSnap);
            window.removeEventListener('pdfmax:set-grid-size', onSetGridSize);
            window.removeEventListener('pdfmax:session-locked', onSessionLocked);
            window.removeEventListener('pdfmax:session-unlocked', onSessionUnlocked);
            window.removeEventListener('pdfmax:open-signature', onOpenSig);
            window.removeEventListener('pdfmax:open-dxf', onOpenDxf);
            window.removeEventListener('pdfmax:place-form-field', onPlaceFormField);
            window.removeEventListener('pdfmax:page-operations', onPageOperations);
            window.removeEventListener('pdfmax:extract-pages', onExtractPages);
            window.removeEventListener('pdfmax:split-pdf', onSplitPdf);
            window.removeEventListener('pdfmax:scale-confirmed', onScaleConfirmed);
            window.removeEventListener('pdfmax:scale-cancelled', onScaleCancelled);
        };
    }, [engine]);

    // ─── Update markup properties from Properties Panel ───────────────
    useEffect(() => {
        if (!engine) return;
        const handler = (e: Event) => {
            const patch = (e as CustomEvent).detail ?? {};
            engine.updateActiveMarkup(patch);
        };
        window.addEventListener('pdfmax:update-markup', handler);
        return () => window.removeEventListener('pdfmax:update-markup', handler);
    }, [engine]);

    // ─── Stamp tool: click-to-place ────────────────────────────────────
    // Step 1: capture the stamp label+style and enter placement mode
    useEffect(() => {
        if (!engine) return;
        const handler = (e: Event) => {
            const { label, style } = (e as CustomEvent).detail ?? {};
            // Enter placement mode instead of immediately dropping at center
            setPendingStamp({ label: String(label ?? ''), style: style ?? {} });
        };
        window.addEventListener('pdfmax:add-stamp', handler);
        return () => window.removeEventListener('pdfmax:add-stamp', handler);
    }, [engine]);

    // Step 2: while pendingStamp is set, next canvas click drops the stamp there
    useEffect(() => {
        if (!pendingStamp || !engine) return;
        const container = containerRef.current;
        if (!container) return;

        const onContainerClick = (e: MouseEvent) => {
            // Walk up to find which page wrapper was clicked
            const wrapper = (e.target as HTMLElement)?.closest?.('[data-page]') as HTMLElement | null;
            const page = wrapper ? Number(wrapper.dataset.page ?? currentPage) : currentPage;
            const rect = (wrapper ?? container).getBoundingClientRect();
            const left = e.clientX - rect.left;
            const top = e.clientY - rect.top;
            engine.addStamp(page, pendingStamp.label, pendingStamp.style, { left, top });
            setPendingStamp(null);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPendingStamp(null);
        };

        container.addEventListener('click', onContainerClick);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('click', onContainerClick);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [pendingStamp, engine, currentPage]);

    // ─── Context menu actions ─────────────────────────────────────────
    useEffect(() => {
        if (!engine) return;
        const onDuplicate = () => engine.duplicateActiveMarkup();
        const onDelete = () => {
            // Ask Fabric to remove the active object on each canvas
            for (const [, canvas] of (engine as any).annotationLayers as Map<number, any>) {
                const obj = canvas.getActiveObject();
                if (obj) { canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll(); break; }
            }
            // Refresh list
            try {
                const markups = engine.getAllMarkups();
                window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
            } catch { /* ignore */ }
        };
        const onBringFront = () => engine.bringToFront();
        const onSendBack = () => engine.sendToBack();
        window.addEventListener('pdfmax:duplicate-markup', onDuplicate);
        window.addEventListener('pdfmax:delete-markup', onDelete);
        window.addEventListener('pdfmax:bring-to-front', onBringFront);
        window.addEventListener('pdfmax:send-to-back', onSendBack);
        return () => {
            window.removeEventListener('pdfmax:duplicate-markup', onDuplicate);
            window.removeEventListener('pdfmax:delete-markup', onDelete);
            window.removeEventListener('pdfmax:bring-to-front', onBringFront);
            window.removeEventListener('pdfmax:send-to-back', onSendBack);
        };
    }, [engine]);

    // ─── Handle BottomPanel row click → select markup ─────────────────
    useEffect(() => {
        if (!engine) return;
        const onSelectMarkup = (e: Event) => {
            const { page, index } = (e as CustomEvent).detail ?? {};
            if (page != null && index != null) {
                engine.selectMarkup(page, index);
            }
        };
        const onRequestBroadcast = () => {
            try {
                const markups = engine.getAllMarkups();
                window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
            } catch (e) {
                console.warn('[PDFMax] on-demand broadcast failed', e);
            }
        };
        const onToggleVisibility = (e: Event) => {
            const { page, index, visible } = (e as CustomEvent).detail ?? {};
            if (page == null || index == null || visible == null) return;
            engine.setMarkupVisible(page, index, visible);
            // Re-broadcast so other listeners (e.g., PDF export) stay in sync
            try {
                const markups = engine.getAllMarkups();
                window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
            } catch { /* noop */ }
        };
        const onBatchAssign = (e: Event) => {
            const { targets, status, assignee, priority, dueDate } = (e as CustomEvent).detail ?? {};
            if (!Array.isArray(targets) || targets.length === 0) return;
            let changed = false;
            targets.forEach(({ page, index }: { page: number; index: number }) => {
                const canvas = (engine as any).annotationLayers?.get(page);
                if (!canvas) return;
                const objs = canvas.getObjects();
                const obj = objs[index];
                if (!obj) return;
                if (status !== undefined) obj.set({ pdfmax_status: status });
                if (assignee !== undefined) obj.set({ pdfmax_assignee: assignee });
                if (priority !== undefined) obj.set({ pdfmax_priority: priority || undefined });
                if (dueDate !== undefined) obj.set({ pdfmax_due_date: dueDate || undefined });
                changed = true;
            });
            if (changed) {
                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                try {
                    const markups = engine.getAllMarkups();
                    window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
                } catch { /* noop */ }
            }
        };
        window.addEventListener('pdfmax:select-markup', onSelectMarkup);
        window.addEventListener('pdfmax:request-markups-broadcast', onRequestBroadcast);
        window.addEventListener('pdfmax:toggle-markup-visibility', onToggleVisibility);
        window.addEventListener('pdfmax:batch-assign-markups', onBatchAssign);
        return () => {
            window.removeEventListener('pdfmax:select-markup', onSelectMarkup);
            window.removeEventListener('pdfmax:request-markups-broadcast', onRequestBroadcast);
            window.removeEventListener('pdfmax:toggle-markup-visibility', onToggleVisibility);
            window.removeEventListener('pdfmax:batch-assign-markups', onBatchAssign);
        };
    }, [engine]);

    // ─── Page jump helpers ────────────────────────────────────────────
    const startPageJump = () => {
        setPageJumping(true);
        setPageJumpValue(String(currentPage));
    };
    const commitPageJump = () => {
        setPageJumping(false);
        const n = parseInt(pageJumpValue, 10);
        if (!isNaN(n) && n >= 1 && n <= totalPages) {
            setCurrentPage(n);
            const target = document.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${n}"]`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // ─── PDF Engine initialization ────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current || isInitialized.current) return;
        isInitialized.current = true;

        const initPdf = async () => {
            try {
                if (!containerRef.current!.id) {
                    containerRef.current!.id = `pdfmax-container-${Math.random().toString(36).substring(7)}`;
                }
                const engineInstance = new PdfEngine({
                    pdfUrl: '/sample.pdf',
                    containerId: containerRef.current!.id,
                    onPageRendered: (pageNum, total) => {
                        console.log(`Rendered page ${pageNum}/${total}`);
                        setTotalPages(total);
                    },
                });
                engineInstance.onCalibrationLine = (pageNumber, pixelLength) => {
                    openCalibrationModal(pageNumber, pixelLength);
                };
                // Fire selection changes as a window event for the Properties Panel
                engineInstance.onSelectionChanged = (obj) => {
                    window.dispatchEvent(new CustomEvent('pdfmax:selection-changed', { detail: { obj } }));
                };
                await engineInstance.loadDocument();
                await engineInstance.renderAllPages(1.5);

                // Tag each page wrapper with its page number for IntersectionObserver
                const wrappers = containerRef.current?.querySelectorAll<HTMLElement>('.pdf-page-wrapper');
                wrappers?.forEach((w, i) => { w.dataset.page = String(i + 1); });

                // Helper: broadcast all markups + measurements to listeners
                const broadcastMarkups = () => {
                    try {
                        const markups = engineInstance.getAllMarkups();
                        window.dispatchEvent(new CustomEvent('pdfmax:markups-updated', { detail: { markups } }));
                        const measurements = engineInstance.getMeasurements();
                        window.dispatchEvent(new CustomEvent('pdfmax:measurements-updated', { detail: { measurements } }));
                    } catch (e) {
                        console.warn('[PDFMax] broadcastMarkups failed', e);
                    }
                };

                // Volume prompt
                const onAskVolume = (e: Event) => {
                    const { areaLabel, group } = (e as CustomEvent).detail ?? {};
                    volumeGroupRef.current = group;
                    setVolumeAreaLabel(areaLabel ?? '');
                    // Extract base unit from area label (e.g. "42.3 ft²" → "ft",  "10.0 m²" → "m")
                    const unitMatch = (areaLabel ?? '').match(/[\d.]+\s*([a-zA-Z]+)/);
                    const baseUnit = unitMatch ? unitMatch[1].replace(/[²³]/g, '') : 'ft';
                    setVolumeDefaultUnit(UNITS_LIST.includes(baseUnit) ? baseUnit : 'ft');
                    setVolumeDialogOpen(true);
                };
                window.addEventListener('pdfmax:ask-volume', onAskVolume);

                // Wire auto-save + instant broadcast whenever a markup changes
                const docKey = `pdfmax:markups:${fileName || 'sample.pdf'}`;
                let saveTimer: ReturnType<typeof setTimeout>;
                engineInstance.subscribeMarkupChanges(() => {
                    broadcastMarkups();
                    clearTimeout(saveTimer);
                    window.dispatchEvent(new CustomEvent('pdfmax:save-status', { detail: { status: 'saving' } }));
                    saveTimer = setTimeout(() => {
                        engineInstance.saveMarkups(docKey);
                        window.dispatchEvent(new CustomEvent('pdfmax:save-status', { detail: { status: 'saved' } }));
                    }, 1000);
                });

                // ── Show the PDF immediately (before persistence) ──────────
                // This must happen BEFORE loadMarkups so that any error there
                // cannot keep the loading spinner stuck.
                setEngine(engineInstance);
                setIsLoaded(true);
                window.dispatchEvent(new CustomEvent('pdfmax:engine-ready', { detail: { engine: engineInstance } }));

                // Restore saved markups — non-critical, wrapped in its own try-catch
                try {
                    await engineInstance.loadMarkups(docKey);
                } catch (e) {
                    console.warn('[PDFMax] Could not restore markups from localStorage', e);
                }

                // ── Session URL restore (?session=<base64>) ─────────────────
                try {
                    const params = new URLSearchParams(window.location.search);
                    const sessionParam = params.get('session');
                    if (sessionParam) {
                        let jsonStr: string;
                        try {
                            // Try gzip decompress first
                            const decoded = atob(decodeURIComponent(sessionParam));
                            const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
                            const ds = new (window as any).DecompressionStream('gzip');
                            const writer = ds.writable.getWriter();
                            const reader = ds.readable.getReader();
                            writer.write(bytes);
                            writer.close();
                            const chunks: Uint8Array[] = [];
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                chunks.push(value);
                            }
                            const out = new Uint8Array(chunks.reduce((a: number, b: Uint8Array) => a + b.length, 0));
                            let off = 0;
                            chunks.forEach((c: Uint8Array) => { out.set(c, off); off += c.length; });
                            jsonStr = new TextDecoder().decode(out);
                        } catch {
                            // Fallback: plain base64
                            jsonStr = decodeURIComponent(atob(decodeURIComponent(sessionParam)));
                        }
                        const sessionMarkups = JSON.parse(jsonStr);
                        await engineInstance.loadMarkupsFromJSON(sessionMarkups);
                        console.info('[PDFMax] Loaded session markups from URL');
                        // Clean the URL param without reloading
                        const cleanUrl = window.location.pathname;
                        window.history.replaceState({}, '', cleanUrl);
                    }
                } catch (e) {
                    console.warn('[PDFMax] Could not restore session from URL', e);
                }


                // Broadcast persisted markups once the BottomPanel is mounted
                setTimeout(broadcastMarkups, 100);
            } catch (err) {
                console.error('Failed to init PDF Engine', err);
            }
        };

        setTimeout(initPdf, 100);
    }, []);

    const safeZoom = zoom ?? 1.0;
    const zoomPct = Math.round(safeZoom * 100);

    return (
        <div className="flex-1 flex flex-col overflow-hidden relative">
            <CalibrationModal />
            <VolumePromptDialog
                isOpen={volumeDialogOpen}
                areaLabel={volumeAreaLabel}
                defaultUnit={volumeDefaultUnit}
                onClose={() => setVolumeDialogOpen(false)}
                onConfirm={(depth, unit) => {
                    setVolumeDialogOpen(false);
                    // Parse area number from label (e.g. "42.3 ft²" → 42.3)
                    const areaNum = parseFloat(volumeAreaLabel);
                    if (!isNaN(areaNum) && depth > 0) {
                        const volume = areaNum * depth;
                        const vol = `${volume.toFixed(2)} ${unit}³`;
                        // Update the group's measureValue so it appears in table
                        const grp = volumeGroupRef.current;
                        if (grp) {
                            grp.measureType = 'measure-volume';
                            grp.measureValue = vol;
                            // Find and update the label IText inside the group
                            const items: any[] = grp.getObjects?.() ?? [];
                            const lbl = items.find((o: any) => o.type === 'i-text' || o.type === 'text');
                            if (lbl) { lbl.set({ text: `${volumeAreaLabel}\n${vol}` }); }
                            // Re-broadcast
                            if (engine) {
                                try {
                                    const measurements = engine.getMeasurements();
                                    window.dispatchEvent(new CustomEvent('pdfmax:measurements-updated', { detail: { measurements } }));
                                } catch {/* ignore */ }
                            }
                        }
                    }
                }}
            />

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileOpen}
            />

            {/* Scroll container */}
            <div
                ref={scrollContainerRef}
                className="flex-1 bg-gray-200 overflow-auto relative"
                style={{ userSelect: 'none', cursor: pendingStamp ? 'crosshair' : undefined }}
            >
                {/* Stamp placement hint banner */}
                {pendingStamp && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-violet-700/95 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 pointer-events-none select-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                        Click anywhere to place <strong>&ldquo;{pendingStamp.label}&rdquo;</strong> stamp — ESC to cancel
                    </div>
                )}
                {mounted && !isLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 z-20">
                        <svg className="animate-spin h-8 w-8 text-gray-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm font-medium">Loading PDF Document...</span>
                    </div>
                )}

                {/* CSS zoom wrapper */}
                <div
                    className="flex justify-center p-8"
                    style={{
                        transformOrigin: 'top center',
                        transform: `scale(${safeZoom})`,
                        width: `${(100 / safeZoom).toFixed(1)}%`,
                        minHeight: `${(100 / safeZoom).toFixed(1)}%`,
                    }}
                >
                    <div
                        ref={containerRef}
                        id="pdfmax-container"
                        className="relative transition-opacity duration-300"
                        style={{ opacity: isLoaded ? 1 : 0 }}
                    >
                        {/* PDF pages injected here by PdfEngine */}
                    </div>
                </div>
            </div>

            {/* Floating bottom bar — scale + zoom + page counter */}
            <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 bg-gray-900/90 backdrop-blur text-white rounded-lg shadow-xl px-2 py-1 text-sm select-none border border-gray-700">
                {/* Page scale widget */}
                <PageScaleWidget />
                <div className="w-px h-4 bg-gray-600 mx-1" />
                {/* Page counter */}
                {totalPages > 0 && (
                    <>
                        {pageJumping ? (
                            <input
                                autoFocus
                                type="number"
                                min={1}
                                max={totalPages}
                                value={pageJumpValue}
                                onChange={(e) => setPageJumpValue(e.target.value)}
                                onBlur={commitPageJump}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitPageJump();
                                    if (e.key === 'Escape') setPageJumping(false);
                                }}
                                className="w-14 text-center tabular-nums font-mono text-xs bg-gray-800 border border-blue-500 rounded px-1 py-0.5 text-white outline-none"
                            />
                        ) : (
                            <button
                                onClick={startPageJump}
                                className="px-2 text-xs text-gray-400 font-mono tabular-nums hover:text-white transition-colors rounded hover:bg-gray-700 py-0.5"
                                title="Click to jump to page"
                            >
                                Page {currentPage} / {totalPages}
                            </button>
                        )}
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                    </>
                )}
                {/* Zoom controls */}
                <button
                    onClick={() => setZoom(Math.max(MIN_ZOOM, parseFloat((safeZoom - ZOOM_STEP).toFixed(2))))}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 transition-colors text-lg font-bold"
                    title="Zoom out (Ctrl+scroll)"
                >−</button>
                <span className="w-12 text-center tabular-nums font-mono text-xs">{zoomPct}%</span>
                <button
                    onClick={() => setZoom(Math.min(MAX_ZOOM, parseFloat((safeZoom + ZOOM_STEP).toFixed(2))))}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 transition-colors text-lg font-bold"
                    title="Zoom in (Ctrl+scroll)"
                >+</button>
                <div className="w-px h-4 bg-gray-600 mx-1" />
                <button
                    onClick={() => setZoom(1.0)}
                    className="px-2 h-7 rounded hover:bg-gray-700 transition-colors text-xs"
                    title="Reset to 100%"
                >↺ 100%</button>
            </div>
            {/* Text Search Bar (Ctrl+F) */}
            <SearchBar engineRef={engineRef} />
            {/* Rich Text Toolbar — appears floating when any text annotation enters edit mode */}
            <RichTextToolbar />
            {/* Print Scale Modal */}
            <PrintScaleModal
                open={printModalOpen}
                onClose={() => setPrintModalOpen(false)}
                currentPage={currentPage}
                pdfPageWidthPt={printPageDims.wPt}
                pdfPageHeightPt={printPageDims.hPt}
                exportedPdfBlob={printBlob}
                exporting={printExporting}
            />
            {/* Cutout mode prompt (replaces blocking window.confirm) */}
            <CutoutPrompt />
            {/* Signature Modal */}
            <SignatureModal
                isOpen={sigModalOpen}
                signerName={reviewer?.name}
                onClose={() => setSigModalOpen(false)}
                onConfirm={async (dataUrl, signerName) => {
                    setSigModalOpen(false);
                    if (!engine) return;
                    await engine.addImageStamp(dataUrl);
                    // Stamp metadata on the newly active object
                    setTimeout(() => {
                        const canvas = (engine as any).annotationLayers?.get(
                            (window as any).__pdfMaxCurrentPage ?? 1
                        );
                        const obj = canvas?.getActiveObject();
                        if (obj) {
                            obj.pdfmax_sig_signer = signerName;
                            obj.pdfmax_sig_ts = new Date().toISOString();
                            obj.pdfmax_sig = true;
                            window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                        }
                    }, 100);
                }}
            />
            {/* Page Operations Modal (Extract / Split) */}
            <PageOperationsModal
                isOpen={pageOpsOpen}
                totalPages={totalPages}
                onClose={() => setPageOpsOpen(false)}
                onExtract={(pages) => window.dispatchEvent(new CustomEvent('pdfmax:extract-pages', { detail: { pages } }))}
                onSplit={(chunkSize) => window.dispatchEvent(new CustomEvent('pdfmax:split-pdf', { detail: { chunkSize } }))}
            />
        </div>
    );
};
