'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useToolStore } from '@/store/useToolStore';
import { useMeasureStore } from '@/store/useMeasureStore';
import { useDocStore } from '@/store/useDocStore';
import { useCollabStore } from '@/store/useCollabStore';
import { useToolChestStore } from '@/store/useToolChestStore';
import { CollaboratorModal } from '@/components/ui/CollaboratorModal';
import { HelpCenterModal } from '@/components/ui/HelpCenterModal';
import { AiReviewPanel } from '@/components/studio/AiReviewPanel';
import { useAuth } from '@/lib/useAuth';
import { useRouter } from 'next/navigation';
import type { Reviewer } from '@pdfmax/shared';

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;

const PRESET_COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#000000', // black
    '#ffffff', // white
];

const STROKE_WIDTHS = [1, 2, 3, 5, 8];

export const Toolbar = () => {
    const {
        activeTool, setActiveTool,
        strokeColor, setStrokeColor,
        strokeWidth, setStrokeWidth,
        zoom, setZoom,
    } = useToolStore();
    const { activePageScale } = useMeasureStore();
    const { fileName } = useDocStore();
    const [colorPickerOpen, setColorPickerOpen] = useState(false);
    const [colorDropdownOpen, setColorDropdownOpen] = useState(false);
    const [stampOpen, setStampOpen] = useState(false);
    const [customStampText, setCustomStampText] = useState('');
    // Saved image stamps — persisted in localStorage
    const [savedImageStamps, setSavedImageStamps] = useState<{ name: string; dataUrl: string }[]>(() => {
        try { return JSON.parse(localStorage.getItem('pdfmax:image-stamps') ?? '[]'); } catch { return []; }
    });
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
    const colorRef = useRef<HTMLDivElement>(null);
    const colorDropdownRef = useRef<HTMLDivElement>(null);
    const colorBtnRef = useRef<HTMLButtonElement>(null);
    const exportBtnRef = useRef<HTMLButtonElement>(null);
    const stampBtnRef = useRef<HTMLButtonElement>(null);
    const [dropdownAnchor, setDropdownAnchor] = useState<{ x: number; y: number } | null>(null);
    const [exportAnchor, setExportAnchor] = useState<{ x: number; y: number } | null>(null);
    const [stampAnchor, setStampAnchor] = useState<{ x: number; y: number } | null>(null);
    const stampRef = useRef<HTMLDivElement>(null);
    const exportRef = useRef<HTMLDivElement>(null);
    const importFileRef = useRef<HTMLInputElement>(null);
    const zoomPct = Math.round((zoom ?? 1) * 100);

    // ── Collaboration state ─────────────────────────────────────────────────
    const { reviewer, setReviewer, isLive, peers } = useCollabStore();
    const [collabModalOpen, setCollabModalOpen] = useState(false);
    const [shareToast, setShareToast] = useState<string | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [undoToast, setUndoToast] = useState<string | null>(null);
    const [undoDepth, setUndoDepth] = useState(0);
    const [redoDepth, setRedoDepth] = useState(0);

    const [awiOpen, setAwiOpen] = useState(false);

    const [markupOpen, setMarkupOpen] = useState(false);
    const [measureOpen, setMeasureOpen] = useState(false);
    const [formsOpen, setFormsOpen] = useState(false);
    const [presetsOpen, setPresetsOpen] = useState(false);
    const markupRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const formsRef = useRef<HTMLDivElement>(null);
    const presetsRef = useRef<HTMLDivElement>(null);
    const { presets, applyPreset } = useToolChestStore();
    // Prevents SSR/client hydration mismatch — reviewer comes from localStorage
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    // Sequence count state — updated by pdfmax:count-sequence-changed events from engine
    const [countNext, setCountNext] = useState(1);
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.next !== undefined) setCountNext(detail.next);
        };
        window.addEventListener('pdfmax:count-sequence-changed', handler);
        return () => window.removeEventListener('pdfmax:count-sequence-changed', handler);
    }, []);

    // ── Auth ────────────────────────────────────────────────────────────────
    const { user, signOut } = useAuth();
    const router = useRouter();
    const handleSignOut = async () => {
        await signOut();
        router.replace('/login');
    };


    /** Generate a compressed session URL from current markups and copy to clipboard */
    const handleShare = useCallback(async () => {
        const engine = (window as any).__pdfMaxEngine;
        if (!engine) return;
        try {
            const markups = engine.exportMarkups();
            const json = JSON.stringify(markups);
            // Compress with CompressionStream (supported on all modern browsers)
            let base64 = '';
            try {
                const cs = new (window as any).CompressionStream('gzip');
                const writer = cs.writable.getWriter();
                const reader = cs.readable.getReader();
                const enc = new TextEncoder();
                writer.write(enc.encode(json));
                writer.close();
                const chunks: Uint8Array[] = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
                const buf = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
                let offset = 0;
                chunks.forEach(c => { buf.set(c, offset); offset += c.length; });
                base64 = btoa(String.fromCharCode(...buf));
            } catch {
                // Fallback: plain base64 if CompressionStream unavailable
                base64 = btoa(encodeURIComponent(json));
            }
            const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(base64)}`;
            await navigator.clipboard.writeText(url);
            setShareToast('Share link copied to clipboard!');
            setTimeout(() => setShareToast(null), 3000);
        } catch (err) {
            console.error('[PDFMax] share failed', err);
        }
    }, []);

    const handleCollaborateClick = useCallback(() => {
        if (!reviewer) {
            setCollabModalOpen(true);
        } else {
            handleShare();
        }
    }, [reviewer, handleShare]);

    const handleCollaboratorConfirm = useCallback((r: Reviewer) => {
        setReviewer(r);
        // Propagate to engine so future markups carry this author
        const engine = (window as any).__pdfMaxEngine;
        if (engine?.setReviewer) engine.setReviewer(r);
        setCollabModalOpen(false);
        // Immediately generate share link
        setTimeout(() => handleShare(), 50);
    }, [setReviewer, handleShare]);

    // Save status listener
    useEffect(() => {
        const handler = (e: Event) => {
            const status = (e as CustomEvent).detail?.status as 'saved' | 'saving' | undefined;
            if (status) setSaveStatus(status);
        };
        window.addEventListener('pdfmax:save-status', handler);
        return () => window.removeEventListener('pdfmax:save-status', handler);
    }, []);

    // Listen for undo/redo depth from engine
    useEffect(() => {
        const handler = (e: Event) => {
            const { undoDepth: u, redoDepth: r } = (e as CustomEvent).detail ?? {};
            if (u !== undefined) setUndoDepth(u);
            if (r !== undefined) setRedoDepth(r);
        };
        window.addEventListener('pdfmax:history-changed', handler);
        return () => window.removeEventListener('pdfmax:history-changed', handler);
    }, []);

    // ? keyboard shortcut — open help modal
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key === '?') setHelpOpen(true);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // Refs to track open states for the outside-click handler (avoids stale closures)
    const exportOpenRef = useRef(false);
    const colorDropdownOpenRef = useRef(false);
    useEffect(() => { exportOpenRef.current = exportOpen; }, [exportOpen]);
    useEffect(() => { colorDropdownOpenRef.current = colorDropdownOpen; }, [colorDropdownOpen]);

    // Close export + color dropdowns on outside click — only when actually open
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (exportOpenRef.current && exportRef.current && !exportRef.current.contains(e.target as Node)) {
                setExportOpen(false);
            }
            if (colorDropdownOpenRef.current && colorDropdownRef.current && !colorDropdownRef.current.contains(e.target as Node)) {
                setColorDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const openFile = () => window.dispatchEvent(new Event('pdfmax:open-file'));
    const undo = () => {
        window.dispatchEvent(new Event('pdfmax:undo'));
        setUndoToast(`↩ Undo${undoDepth > 1 ? ` (${undoDepth - 1} left)` : ''}`);
        setTimeout(() => setUndoToast(null), 1500);
    };
    const redo = () => {
        window.dispatchEvent(new Event('pdfmax:redo'));
        setUndoToast(`↪ Redo${redoDepth > 1 ? ` (${redoDepth - 1} left)` : ''}`);
        setTimeout(() => setUndoToast(null), 1500);
    };
    const exportJson = () => { window.dispatchEvent(new Event('pdfmax:export')); setExportOpen(false); };
    const exportPdf = () => { window.dispatchEvent(new Event('pdfmax:export-pdf')); setExportOpen(false); };
    const exportNativePdf = () => { window.dispatchEvent(new Event('pdfmax:export-native-pdf')); setExportOpen(false); };
    const exportApplyRedactions = () => { window.dispatchEvent(new Event('pdfmax:apply-redactions')); setExportOpen(false); };
    const printPdf = () => { window.dispatchEvent(new Event('pdfmax:print')); setExportOpen(false); };
    const openPageOps = () => { window.dispatchEvent(new Event('pdfmax:page-operations')); setExportOpen(false); };
    const importJson = () => { importFileRef.current?.click(); setExportOpen(false); };
    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string);
                window.dispatchEvent(new CustomEvent('pdfmax:import-markups', { detail: { data } }));
            } catch { alert('Invalid markup JSON file.'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
    const toggleSnap = () => {
        const next = !snapEnabled;
        setSnapEnabled(next);
        window.dispatchEvent(new CustomEvent('pdfmax:set-snap', { detail: { enabled: next } }));
    };
    const toggleGridSnap = () => {
        const next = !gridSnapEnabled;
        setGridSnapEnabled(next);
        window.dispatchEvent(new CustomEvent('pdfmax:set-grid-snap', { detail: { enabled: next } }));
    };

    const ToolBtn = ({
        tool, title, children,
    }: { tool: string; title: string; children: React.ReactNode }) => (
        <button
            className={`p-2 rounded transition-colors ${activeTool === tool ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
            title={title}
            onClick={() => setActiveTool(tool as any)}
        >
            {children}
        </button>
    );

    // ── Tool definitions ──────────────────────────────────────────────────────
    const MARKUP_TOOLS: { tool: string; label: string; icon: React.ReactNode }[] = [
        { tool: 'text', label: 'Text Box', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" x2="15" y1="20" y2="20" /><line x1="12" x2="12" y1="4" y2="20" /></svg> },
        { tool: 'highlight', label: 'Highlight', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></svg> },
        { tool: 'rectangle', label: 'Rectangle', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></svg> },
        { tool: 'ellipse', label: 'Ellipse', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6" /></svg> },
        { tool: 'cloud-shape', label: 'Rev. Cloud', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 A3 3 0 0 1 15 4 A3 3 0 0 1 20 8 A3 3 0 0 1 21 13 A3 3 0 0 1 17 18 A3 3 0 0 1 11 20 A3 3 0 0 1 5 18 A3 3 0 0 1 3 13 A3 3 0 0 1 4 7 A3 3 0 0 1 9 3 Z" /></svg> },
        { tool: 'cloud', label: 'Freehand', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19A4.5 4.5 0 0 0 18 10h-.5a7.1 7.1 0 0 0-14 0h-.5a4.5 4.5 0 0 0 0 9h14Z" /></svg> },
        { tool: 'wipeout', label: 'Wipeout', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></svg> },
        { tool: 'redact', label: 'Redaction', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="12" x="3" y="6" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="8" y1="6" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="18" /></svg> },
        { tool: 'line', label: 'Line', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5" /></svg> },
        { tool: 'arrow', label: 'Arrow', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" /></svg> },
        { tool: 'polyline', label: 'Polyline', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 20 10 4 16 16 20 8" /></svg> },
        { tool: 'polygon', label: 'Polygon', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 22 22 22" /></svg> },
        { tool: 'callout', label: 'Callout', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
        { tool: 'dimension-linear', label: 'Dimension', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><polyline points="6 9 3 12 6 15" /><polyline points="18 9 21 12 18 15" /><line x1="3" y1="6" x2="3" y2="8" /><line x1="21" y1="6" x2="21" y2="8" /></svg> },
        { tool: 'leader', label: 'Leader', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="21" x2="15" y2="9" /><polyline points="10 9 15 9 15 14" /><line x1="15" y1="9" x2="21" y2="9" /></svg> },
        { tool: 'signature', label: 'Signature', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16l9.5-9.5" /><path d="m13 7 3-3 4 4-3 3" /><path d="m7.5 13.5 3 3" /></svg> },
    ];

    const MEASURE_TOOLS: { tool: string; label: string; icon: React.ReactNode }[] = [
        { tool: 'calibrate', label: 'Set Scale', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z" /><path d="m7.5 10.5 2 2" /><path d="m10.5 7.5 2 2" /><path d="m13.5 4.5 2 2" /><path d="m4.5 13.5 2 2" /></svg> },
        { tool: 'measure-length', label: 'Length', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12H2" /><path d="M5 15l-3-3 3-3" /><path d="M19 15l3-3-3-3" /></svg> },
        { tool: 'measure-area', label: 'Area', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></svg> },
        { tool: 'measure-perimeter', label: 'Perimeter', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 19 8 17 17 7 17 5 8" /></svg> },
        { tool: 'measure-angle', label: 'Angle', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20h20" /><path d="m6 20 6-13 6 13" /></svg> },
        { tool: 'measure-diameter', label: 'Diameter', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /></svg> },
        { tool: 'measure-cutout', label: 'Cutout', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="1" /><path d="M9 9h6v6H9z" /></svg> },
        { tool: 'measure-count', label: 'Count', icon: <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg> },
    ];

    const activeMarkup = MARKUP_TOOLS.find(t => t.tool === activeTool);
    const activeMeasure = MEASURE_TOOLS.find(t => t.tool === activeTool);
    const markupActive = !!activeMarkup;
    const measureActive = !!activeMeasure;

    // Outside-click to close tool dropdowns
    // IMPORTANT: use setTimeout(0) so the close runs AFTER React onClick handlers
    // fire on the dropdown items — otherwise mousedown closes before onClick selects.
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (markupRef.current && !markupRef.current.contains(e.target as Node)) {
                setTimeout(() => setMarkupOpen(false), 0);
            }
            if (measureRef.current && !measureRef.current.contains(e.target as Node)) {
                setTimeout(() => setMeasureOpen(false), 0);
            }
            if (formsRef.current && !formsRef.current.contains(e.target as Node)) {
                setTimeout(() => setFormsOpen(false), 0);
            }
            if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
                setTimeout(() => setPresetsOpen(false), 0);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <>
            <div className="flex items-center justify-between px-3 py-2 bg-gray-900 text-white border-b border-gray-700 h-14 shrink-0 shadow-lg z-10">
                <div className="flex items-center gap-2 overflow-visible">

                    {/* Logo + Open button */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* App logo instead of text */}
                        <img src="/icon-192.png" alt="PDF Max" className="w-7 h-7 rounded-md" />
                        <button
                            onClick={openFile}
                            className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs transition-colors border border-gray-600"
                            title="Open PDF"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                            <span className="max-w-[100px] truncate text-gray-300">{fileName || 'Open…'}</span>
                        </button>
                    </div>

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* Undo / Redo */}
                    <div className="flex bg-gray-800 rounded p-1 gap-0.5 shrink-0">
                        <button
                            onClick={undo}
                            disabled={undoDepth === 0}
                            className="relative p-1.5 rounded hover:bg-gray-700 transition-colors disabled:opacity-40"
                            title={undoDepth > 0 ? `Undo (${undoDepth} left · Ctrl+Z)` : 'Nothing to undo'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                            {undoDepth > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                                    {undoDepth > 99 ? '99+' : undoDepth}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={redo}
                            disabled={redoDepth === 0}
                            className="relative p-1.5 rounded hover:bg-gray-700 transition-colors disabled:opacity-40"
                            title={redoDepth > 0 ? `Redo (${redoDepth} left · Ctrl+Y)` : 'Nothing to redo'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
                            {redoDepth > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                                    {redoDepth > 99 ? '99+' : redoDepth}
                                </span>
                            )}
                        </button>
                    </div>

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* Navigation Tools */}
                    <div className="flex bg-gray-800 rounded p-1 shrink-0">
                        <ToolBtn tool="select" title="Select">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="m13 13 6 6" /></svg>
                        </ToolBtn>
                        <ToolBtn tool="pan" title="Pan (hold middle-click)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
                        </ToolBtn>
                    </div>

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* Search button */}
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('pdfmax:open-search'))}
                        className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs transition-colors border border-gray-600 text-gray-200 shrink-0"
                        title="Find in PDF (Ctrl+F)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                        </svg>
                        <span>Find</span>
                    </button>

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* ── Count Sequence Indicator (visible when Count tool is active) ── */}
                    {activeTool === 'measure-count' && (
                        <>
                            <div className="flex items-center gap-1.5 bg-rose-900/60 border border-rose-700/60 rounded px-2.5 py-1 shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
                                </svg>
                                <span className="text-[11px] font-bold text-rose-300 tabular-nums">Next: #{countNext}</span>
                                <button
                                    onClick={() => {
                                        const engine = (window as any).__pdfMaxEngine;
                                        if (engine?.resetCountSequence) {
                                            // Reset for current visible page
                                            const page = (window as any).__pdfMaxCurrentPage ?? 1;
                                            engine.resetCountSequence(page, 1);
                                        }
                                    }}
                                    className="ml-0.5 text-[10px] text-rose-400 hover:text-rose-200 transition-colors"
                                    title="Reset count sequence to 1"
                                >↺</button>
                            </div>
                            <div className="h-6 w-px bg-gray-700 shrink-0" />
                        </>
                    )}

                    {/* ── Markup Dropdown ─────────────────────────────── */}
                    <div className="relative shrink-0" ref={markupRef}>
                        <button
                            onClick={() => { setMarkupOpen(o => !o); setMeasureOpen(false); }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border shrink-0 ${markupActive || markupOpen
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-200'
                                }`}
                            title="Markup tools"
                        >
                            {activeMarkup ? activeMarkup.icon : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                            )}
                            <span>{activeMarkup ? activeMarkup.label : 'Markup'}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>

                        {markupOpen && (
                            <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-2 w-52">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-1 pb-1.5">Annotation Tools</p>
                                <div className="grid grid-cols-2 gap-0.5">
                                    {MARKUP_TOOLS.map(({ tool, label, icon }) => (
                                        <button
                                            key={tool}
                                            onClick={() => {
                                                if (tool === 'signature') {
                                                    window.dispatchEvent(new CustomEvent('pdfmax:open-signature'));
                                                } else {
                                                    setActiveTool(tool as any);
                                                }
                                                setMarkupOpen(false);
                                            }}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left w-full ${activeTool === tool
                                                ? 'bg-blue-600 text-white'
                                                : 'text-gray-300 hover:bg-gray-700'
                                                }`}
                                        >
                                            {icon}
                                            <span>{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Measure Dropdown ─────────────────────────────── */}
                    <div className="relative shrink-0" ref={measureRef}>
                        <button
                            onClick={() => { setMeasureOpen(o => !o); setMarkupOpen(false); }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border shrink-0 ${measureActive || measureOpen
                                ? 'bg-amber-600 border-amber-500 text-white'
                                : 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-200'
                                }`}
                            title="Measurement tools"
                        >
                            {activeMeasure ? activeMeasure.icon : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z" /></svg>
                            )}
                            <span>{activeMeasure ? activeMeasure.label : 'Measure'}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>

                        {measureOpen && (
                            <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-2 w-44">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-1 pb-1.5">Measurement Tools</p>
                                <div className="flex flex-col gap-0.5">
                                    {MEASURE_TOOLS.map(({ tool, label, icon }) => (
                                        <button
                                            key={tool}
                                            onClick={() => { setActiveTool(tool as any); setMeasureOpen(false); }}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left ${activeTool === tool
                                                ? 'bg-amber-600 text-white'
                                                : 'text-gray-300 hover:bg-gray-700'
                                                }`}
                                        >
                                            {icon}
                                            <span>{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Forms Dropdown ───────────────────────────────── */}
                    <div className="relative shrink-0" ref={formsRef}>
                        <button
                            onClick={() => { setFormsOpen(o => !o); setMarkupOpen(false); setMeasureOpen(false); }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border shrink-0 ${formsOpen
                                ? 'bg-emerald-700 border-emerald-500 text-white'
                                : 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-200'
                                }`}
                            title="Form field tools"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="4" rx="1" /><rect x="3" y="11" width="18" height="4" rx="1" /><rect x="3" y="17" width="9" height="4" rx="1" /></svg>
                            <span>Forms</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>

                        {formsOpen && (
                            <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-2 w-44">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-1 pb-1.5">Form Field Tools</p>
                                <div className="flex flex-col gap-0.5">
                                    {([
                                        { type: 'text', label: 'Text Field', color: '#3b82f6', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" x2="15" y1="20" y2="20" /><line x1="12" x2="12" y1="4" y2="20" /></svg> },
                                        { type: 'checkbox', label: 'Checkbox', color: '#10b981', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></svg> },
                                        { type: 'dropdown', label: 'Dropdown', color: '#f59e0b', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 11h8" /><path d="m16 13-4 4-4-4" /></svg> },
                                        { type: 'radio', label: 'Radio Button', color: '#8b5cf6', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg> },
                                    ] as const).map(({ type, label, color, icon }) => (
                                        <button
                                            key={type}
                                            onClick={() => {
                                                window.dispatchEvent(new CustomEvent('pdfmax:place-form-field', { detail: { fieldType: type } }));
                                                setFormsOpen(false);
                                            }}
                                            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left text-gray-300 hover:bg-gray-700 w-full"
                                        >
                                            <span style={{ color }}>{icon}</span>
                                            <span>{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Scale readout */}
                    {activePageScale !== 'Not calibrated' && (
                        <div className="flex items-center gap-1 bg-amber-900/40 border border-amber-700 text-amber-300 text-xs px-2 py-1 rounded shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z" /></svg>
                            {activePageScale}
                        </div>
                    )}

                    {/* Snap toggle */}
                    <button
                        onClick={toggleSnap}
                        title={snapEnabled ? 'Snap to PDF vectors: ON (click to disable)' : 'Snap to PDF vectors: OFF (click to enable)'}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors border ${snapEnabled
                            ? 'bg-blue-700 border-blue-500 text-white'
                            : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        {/* Magnet icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4" />
                            <path d="M18 15h2a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-4" />
                            <path d="M4 8h16" />
                            <path d="M8 22v-7a4 4 0 0 1 8 0v7" />
                            <path d="M8 22h8" />
                        </svg>
                        <span>Snap</span>
                    </button>

                    {/* Grid Snap toggle */}
                    <button
                        onClick={toggleGridSnap}
                        title={gridSnapEnabled ? 'Grid Snap: ON (click to disable)' : 'Grid Snap: OFF (click to enable)'}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors border ${gridSnapEnabled
                            ? 'bg-emerald-700 border-emerald-500 text-white'
                            : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        {/* Grid icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <path d="M3 9h18" /><path d="M3 15h18" />
                            <path d="M9 3v18" /><path d="M15 3v18" />
                        </svg>
                        <span>Grid</span>
                    </button>

                    {/* Grid size input — only when grid snap is active */}
                    {gridSnapEnabled && (
                        <div className="flex items-center gap-1 bg-gray-800 border border-emerald-600 rounded px-1.5 py-1">
                            <label className="text-[10px] text-emerald-400 font-semibold whitespace-nowrap">Size</label>
                            <input
                                type="number"
                                min={4} max={200} step={4}
                                defaultValue={20}
                                className="w-12 bg-transparent text-[11px] text-white text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                title="Grid cell size in canvas pixels"
                                onBlur={e => {
                                    const px = Math.max(4, Math.min(200, parseInt(e.target.value, 10) || 20));
                                    e.target.value = String(px);
                                    window.dispatchEvent(new CustomEvent('pdfmax:set-grid-size', { detail: { px } }));
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            />
                            <span className="text-[10px] text-gray-400">px</span>
                        </div>
                    )}

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* ── Presets Quick-Apply Dropdown ─────────────────────── */}
                    <div className="relative shrink-0" ref={presetsRef}>
                        <button
                            onClick={() => setPresetsOpen(o => !o)}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors border shrink-0 ${presetsOpen
                                ? 'bg-violet-700 border-violet-500 text-white'
                                : 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-200'
                                }`}
                            title="Tool Presets"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" />
                            </svg>
                            <span>Presets</span>
                            {presets.length > 0 && (
                                <span className="bg-violet-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">{presets.length}</span>
                            )}
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>

                        {presetsOpen && (
                            <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-2 w-56">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-1 pb-1.5">Tool Presets</p>
                                {presets.length === 0 ? (
                                    <p className="text-xs text-gray-500 px-2 py-3 text-center">No presets saved yet.<br />Use the Tool Chest in the right panel.</p>
                                ) : (
                                    <div className="flex flex-col gap-0.5">
                                        {presets.map(preset => (
                                            <button
                                                key={preset.id}
                                                onClick={() => { applyPreset(preset.id); setPresetsOpen(false); }}
                                                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left w-full text-gray-300 hover:bg-gray-700"
                                                title={`Apply: ${preset.name}`}
                                            >
                                                {/* Mini visual preview */}
                                                <div
                                                    className="w-5 h-5 rounded border-2 shrink-0"
                                                    style={{
                                                        background: preset.fillColor === 'transparent' ? 'repeating-linear-gradient(45deg,#4b5563,#4b5563 2px,#374151 2px,#374151 4px)' : preset.fillColor,
                                                        borderColor: preset.strokeColor,
                                                        borderWidth: Math.min(preset.strokeWidth, 3),
                                                    }}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate leading-tight">{preset.name}</p>
                                                    <p className="text-[10px] text-gray-500 leading-tight">{preset.tool} · {preset.strokeWidth}px</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="h-6 w-px bg-gray-700 shrink-0" />

                    {/* Color + Stroke Width */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* Color dropdown trigger */}
                        <button
                            ref={colorBtnRef}
                            onClick={() => {
                                if (colorDropdownOpen) {
                                    setColorDropdownOpen(false);
                                    setDropdownAnchor(null);
                                } else {
                                    const r = colorBtnRef.current?.getBoundingClientRect();
                                    if (r) setDropdownAnchor({ x: r.left, y: r.bottom + 4 });
                                    setColorDropdownOpen(true);
                                }
                            }}
                            className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 transition-colors"
                            title={`Color: ${strokeColor}`}
                        >
                            <span
                                className="block w-4 h-4 rounded-full border border-gray-500 shrink-0"
                                style={{ background: strokeColor }}
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>

                        {/* Stroke width compact select */}
                        <select
                            value={strokeWidth}
                            onChange={(e) => setStrokeWidth(Number(e.target.value))}
                            className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-1.5 py-1.5 hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                            title="Stroke width"
                        >
                            {STROKE_WIDTHS.map((w) => (
                                <option key={w} value={w}>{w} px</option>
                            ))}
                        </select>
                    </div>

                    {/* Stamp dropdown */}
                    <div className="relative shrink-0" ref={stampRef}>
                        <button
                            ref={stampBtnRef}
                            onClick={() => {
                                if (stampOpen) {
                                    setStampOpen(false);
                                    setStampAnchor(null);
                                } else {
                                    const r = stampBtnRef.current?.getBoundingClientRect();
                                    if (r) setStampAnchor({ x: r.left, y: r.bottom + 4 });
                                    setStampOpen(true);
                                }
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border shrink-0 ${stampOpen ? 'bg-violet-700 border-violet-500 text-white' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`}
                            title="Insert Stamp"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                            Stamp
                        </button>
                    </div>

                    {/* Image stamp upload */}
                    <label
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border shrink-0 bg-gray-800 border-gray-600 hover:bg-gray-700 cursor-pointer"
                        title="Insert image from file (PNG, JPG, SVG)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                        Image
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            className="sr-only"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                    const dataUrl = reader.result as string;
                                    // Dispatch to engine
                                    window.dispatchEvent(new CustomEvent('pdfmax:add-image-stamp', {
                                        detail: { dataUrl, name: file.name },
                                    }));
                                    // Save to library
                                    setSavedImageStamps(prev => {
                                        const next = [{ name: file.name, dataUrl }, ...prev.filter(s => s.name !== file.name)].slice(0, 20);
                                        localStorage.setItem('pdfmax:image-stamps', JSON.stringify(next));
                                        return next;
                                    });
                                };
                                reader.readAsDataURL(file);
                                e.target.value = '';
                            }}
                        />
                    </label>

                    {/* Hidden import file input */}
                    <input
                        ref={importFileRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={handleImportFile}
                    />

                    {/* Hidden DXF import input */}
                    <input
                        id="dxf-file-input"
                        type="file"
                        accept=".dxf"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) window.dispatchEvent(new CustomEvent('pdfmax:open-dxf', { detail: { file } }));
                            e.target.value = '';
                        }}
                    />

                    {/* Export/Import dropdown */}
                    <div ref={exportRef} className="relative shrink-0">
                        <button
                            ref={exportBtnRef}
                            onClick={() => {
                                if (exportOpen) {
                                    setExportOpen(false);
                                    setExportAnchor(null);
                                } else {
                                    const r = exportBtnRef.current?.getBoundingClientRect();
                                    if (r) setExportAnchor({ x: r.right - 176, y: r.bottom + 4 });
                                    setExportOpen(true);
                                }
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium transition-colors border border-gray-600"
                            title="Export / Import markups"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                            Export
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                    </div>


                    {/* Auto-save status */}
                    {saveStatus !== 'idle' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${saveStatus === 'saving'
                            ? 'bg-amber-900 text-amber-300'
                            : 'bg-green-900 text-green-300'
                            }`}>
                            {saveStatus === 'saving' ? 'Saving…' : 'Saved ✓'}
                        </span>
                    )}
                </div>

                {/* Right side */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Reviewer identity badge — only after mount to avoid SSR mismatch */}
                    {mounted && reviewer && (
                        <button
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-xs"
                            title={`You: ${reviewer.name} — click to change identity`}
                            onClick={() => setCollabModalOpen(true)}
                        >
                            <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                                style={{ background: reviewer.color }}
                            >
                                {reviewer.name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')}
                            </div>
                            <span className="text-gray-300 max-w-[80px] truncate">{reviewer.name}</span>
                        </button>
                    )}
                    <button
                        className="bg-blue-600 hover:bg-blue-500 text-sm font-medium px-4 py-1.5 rounded transition-colors shadow-sm flex items-center gap-1.5"
                        onClick={handleCollaborateClick}
                        title={mounted && reviewer ? 'Copy share link' : 'Set identity and collaborate'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
                        {mounted && reviewer ? 'Share' : 'Collaborate'}
                    </button>
                    {/* AWI / AI Compliance Review button */}
                    <button
                        onClick={() => setAwiOpen(o => !o)}
                        title="AWI Premium Grade Compliance Review"
                        className={`w-7 h-7 rounded-full border font-bold text-[10px] flex items-center justify-center shrink-0 transition-colors ${awiOpen
                            ? 'bg-amber-500 border-amber-400 text-white'
                            : 'bg-amber-700 hover:bg-amber-600 border-amber-600 text-amber-100 hover:text-white'
                            }`}
                    >
                        AWI
                    </button>
                    {/* Help button */}
                    <button
                        onClick={() => setHelpOpen(true)}
                        className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white transition-colors text-sm font-bold flex items-center justify-center"
                        title="Keyboard shortcuts (?)"
                    >
                        ?
                    </button>

                    {/* User avatar + sign out */}
                    {mounted && user && (
                        <div className="flex items-center gap-1.5 pl-1 border-l border-gray-700">
                            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                                title={user.email ?? 'Signed in'}>
                                {(user.email ?? 'U')[0].toUpperCase()}
                            </div>
                            <button
                                onClick={handleSignOut}
                                title="Sign out"
                                className="text-[10px] text-gray-400 hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-gray-700"
                            >
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div >

            {collabModalOpen && (
                <CollaboratorModal
                    onClose={() => setCollabModalOpen(false)}
                    onConfirm={handleCollaboratorConfirm}
                />
            )
            }

            {
                helpOpen && (
                    <HelpCenterModal onClose={() => setHelpOpen(false)} />
                )
            }

            {/* AWI / AI Compliance Review floating panel */}
            {awiOpen && (
                <>
                    {/* Backdrop — click to close */}
                    <div className="fixed inset-0 z-40" onClick={() => setAwiOpen(false)} />
                    <div
                        className="fixed top-12 right-4 z-50 w-96 h-[82vh] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag header with close button */}
                        <div className="flex items-center justify-between px-3 py-2 bg-amber-700 text-white shrink-0 rounded-t-xl">
                            <span className="text-xs font-bold tracking-wide">🏛 AWI Premium Compliance Review</span>
                            <button onClick={() => setAwiOpen(false)} className="hover:bg-amber-600 rounded p-0.5 transition-colors" title="Close">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <AiReviewPanel />
                        </div>
                    </div>
                </>
            )}


            {
                undoToast && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900/95 text-white text-sm px-4 py-2 rounded-xl shadow-xl pointer-events-none">
                        {undoToast}
                    </div>
                )
            }

            {
                shareToast && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-xl shadow-xl flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        {shareToast}
                    </div>
                )
            }

            {/* ── Fixed-position dropdown panels (escape overflow-x:auto clip) ── */}

            {
                colorDropdownOpen && dropdownAnchor && (
                    <>
                        <div className="fixed inset-0 z-[9990]" onMouseDown={() => { setColorDropdownOpen(false); setDropdownAnchor(null); }} />
                        <div
                            className="fixed z-[9991] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-2 w-40"
                            style={{ left: dropdownAnchor.x, top: dropdownAnchor.y }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="grid grid-cols-5 gap-1.5 mb-2">
                                {PRESET_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${strokeColor === color ? 'border-white scale-110' : 'border-gray-600'}`}
                                        style={{ background: color }}
                                        onClick={() => { setStrokeColor(color); setColorDropdownOpen(false); setDropdownAnchor(null); }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            <label className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-800 cursor-pointer text-xs text-gray-400 transition-colors">
                                <span className="block w-5 h-5 rounded-full border border-gray-500 shrink-0" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
                                Custom…
                                <input type="color" value={strokeColor} onChange={(e) => { setStrokeColor(e.target.value); setColorDropdownOpen(false); setDropdownAnchor(null); }} className="sr-only" />
                            </label>
                        </div>
                    </>
                )
            }

            {
                stampOpen && stampAnchor && (
                    <>
                        <div className="fixed inset-0 z-[9990]" onMouseDown={() => { setStampOpen(false); setStampAnchor(null); }} />
                        <div
                            className="fixed z-[9991] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-64"
                            style={{ left: stampAnchor.x, top: stampAnchor.y }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            {/* Saved image stamps library */}
                            {savedImageStamps.length > 0 && (
                                <>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Image Library</p>
                                    <div className="grid grid-cols-4 gap-1.5 mb-3 max-h-32 overflow-y-auto">
                                        {savedImageStamps.map((stamp, i) => (
                                            <div key={i} className="relative group">
                                                <button
                                                    title={stamp.name}
                                                    onClick={() => {
                                                        window.dispatchEvent(new CustomEvent('pdfmax:add-image-stamp', { detail: { dataUrl: stamp.dataUrl, name: stamp.name } }));
                                                        setStampOpen(false); setStampAnchor(null);
                                                    }}
                                                    className="w-full aspect-square rounded border border-gray-200 overflow-hidden hover:border-violet-400 transition-colors"
                                                >
                                                    <img src={stamp.dataUrl} alt={stamp.name} className="w-full h-full object-contain" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSavedImageStamps(prev => { const next = prev.filter((_, j) => j !== i); localStorage.setItem('pdfmax:image-stamps', JSON.stringify(next)); return next; }); }}
                                                    className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 bg-red-500 rounded-full text-white text-[8px] items-center justify-center"
                                                    title="Remove from library"
                                                >×</button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="border-t border-gray-100 mb-2" />
                                </>
                            )}
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Presets</p>
                            <div className="grid grid-cols-2 gap-1.5 mb-3">
                                {([
                                    { label: 'APPROVED', bg: '#16a34a', text: '#fff' },
                                    { label: 'REVIEWED', bg: '#2563eb', text: '#fff' },
                                    { label: 'FOR REVIEW', bg: '#ea580c', text: '#fff' },
                                    { label: 'VOID', bg: '#dc2626', text: '#fff' },
                                    { label: 'DRAFT', bg: '#6b7280', text: '#fff' },
                                    { label: 'FINAL', bg: '#1e1e2e', text: '#fff' },
                                ] as const).map(({ label, bg, text }) => (
                                    <button
                                        key={label}
                                        onClick={() => { window.dispatchEvent(new CustomEvent('pdfmax:add-stamp', { detail: { label, style: { bgColor: bg, textColor: text } } })); setStampOpen(false); setStampAnchor(null); }}
                                        className="px-2 py-1.5 rounded text-xs font-bold text-white text-center transition-opacity hover:opacity-80"
                                        style={{ background: bg }}
                                    >{label}</button>
                                ))}
                            </div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Custom</p>
                            <div className="flex gap-1">
                                <input
                                    type="text"
                                    placeholder="Your text…"
                                    value={customStampText}
                                    onChange={(e) => setCustomStampText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && customStampText.trim()) {
                                            window.dispatchEvent(new CustomEvent('pdfmax:add-stamp', { detail: { label: customStampText.trim(), style: { bgColor: '#374151', textColor: '#fff' } } }));
                                            setCustomStampText(''); setStampOpen(false); setStampAnchor(null);
                                        }
                                    }}
                                    className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                />
                                <button
                                    onClick={() => {
                                        if (customStampText.trim()) {
                                            window.dispatchEvent(new CustomEvent('pdfmax:add-stamp', { detail: { label: customStampText.trim(), style: { bgColor: '#374151', textColor: '#fff' } } }));
                                            setCustomStampText(''); setStampOpen(false); setStampAnchor(null);
                                        }
                                    }}
                                    className="px-2 py-1 bg-violet-600 text-white rounded text-xs font-semibold hover:bg-violet-700"
                                >+</button>
                            </div>
                        </div>
                    </>
                )
            }

            {
                exportOpen && exportAnchor && (
                    <>
                        <div className="fixed inset-0 z-[9990]" onMouseDown={() => { setExportOpen(false); setExportAnchor(null); }} />
                        <div
                            className="fixed z-[9991] w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
                            style={{ left: exportAnchor.x, top: exportAnchor.y }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <button onClick={printPdf} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-emerald-400 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" /></svg>
                                Print at Scale
                            </button>
                            <div className="border-t border-gray-700 my-0.5" />
                            <button onClick={exportJson} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /></svg>
                                Export JSON
                            </button>
                            <button onClick={exportPdf} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                Export PDF (Flattened)
                            </button>
                            <button onClick={exportNativePdf} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-300 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="8 13 12 17 16 13" /><line x1="12" x2="12" y1="7" y2="17" /></svg>
                                Export PDF (Native)
                            </button>
                            <button onClick={exportApplyRedactions} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="12" x="3" y="6" rx="2" /><line x1="7" y1="6" x2="7" y2="18" /><line x1="17" y1="6" x2="17" y2="18" /></svg>
                                Apply Redactions
                            </button>
                            <div className="border-t border-gray-700 my-0.5" />
                            <button onClick={openPageOps} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-violet-300 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" x2="15" y1="13" y2="13" /><line x1="9" x2="12" y1="17" y2="17" /></svg>
                                Extract / Split Pages
                            </button>
                            <div className="border-t border-gray-700 my-0.5" />
                            <button onClick={importJson} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>
                                Import JSON
                            </button>
                            <button onClick={() => { document.getElementById('dxf-file-input')?.click(); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-cyan-300 hover:bg-gray-700 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><path d="M10 13l2 2 4-4" /></svg>
                                Import DXF
                            </button>
                        </div>
                    </>
                )
            }
        </>
    );
};

