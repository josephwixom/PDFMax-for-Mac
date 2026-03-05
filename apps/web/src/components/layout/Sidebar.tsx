'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDocStore } from '@/store/useDocStore';
import { StudioPanel } from '@/components/studio/StudioPanel';
import { OcrComparePanel } from '@/components/studio/OcrComparePanel';
import { AiReviewPanel } from '@/components/studio/AiReviewPanel';
import { LayersPanel } from '@/components/ui/LayersPanel';

/* ── Types ─────────────────────────────────────────────────────── */
interface OutlineNode {
    title: string;
    page: number;
    children: OutlineNode[];
}

/* ── Bookmark row ───────────────────────────────────────────────── */
const BookmarkRow = ({ node, depth = 0 }: { node: OutlineNode; depth?: number }) => {
    const [open, setOpen] = useState(depth === 0);
    const hasChildren = node.children.length > 0;
    const scrollToPage = () => {
        const el = document.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${node.page}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return (
        <div>
            <div className="flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-blue-50 group select-none" style={{ paddingLeft: `${8 + depth * 14}px` }}>
                {hasChildren ? (
                    <button className="shrink-0 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined }} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                ) : <span className="shrink-0 w-4" />}
                <button className="flex-1 text-left text-xs text-gray-700 group-hover:text-blue-700 truncate" onClick={scrollToPage} title={node.title}>{node.title}</button>
                <span className="shrink-0 text-[10px] text-gray-400 group-hover:text-blue-400">{node.page}</span>
            </div>
            {open && hasChildren && node.children.map((child, i) => <BookmarkRow key={i} node={child} depth={depth + 1} />)}
        </div>
    );
};

/* ── Context Menu ───────────────────────────────────────────────── */
interface ContextMenuState { page: number; x: number; y: number; }

const ContextMenu = ({
    state,
    onClose,
    onAction,
    totalPages,
}: {
    state: ContextMenuState;
    onClose: () => void;
    onAction: (action: string, page: number) => void;
    totalPages: number;
}) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const items = [
        { label: '↻ Rotate 90° CW', action: 'rotate-cw' },
        { label: '↺ Rotate 90° CCW', action: 'rotate-ccw' },
        { label: '↕ Rotate 180°', action: 'rotate-180' },
        { label: '─', action: 'sep1' },
        { label: '＋ Insert Blank Page After', action: 'insert-blank' },
        { label: '─', action: 'sep2' },
        { label: '⬇ Extract This Page', action: 'extract-single' },
        ...(state.page > 1 ? [{ label: `✂ Split Before Page ${state.page}`, action: 'split-before' }] : []),
        ...(state.page < totalPages ? [{ label: `✂ Split After Page ${state.page}`, action: 'split-after' }] : []),
        { label: '─', action: 'sep3' },
        { label: '🗑 Delete Page', action: 'delete', danger: true },
    ] as const;

    return (
        <div
            ref={ref}
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-56 text-sm"
            style={{ top: state.y, left: state.x }}
        >
            <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Page {state.page}</div>
            {items.map((item) =>
                item.action.startsWith('sep') ? (
                    <div key={item.action} className="my-1 border-t border-gray-100" />
                ) : (
                    <button
                        key={item.action}
                        className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors ${(item as any).danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'}`}
                        onClick={() => { onAction(item.action, state.page); onClose(); }}
                    >
                        {item.label}
                    </button>
                )
            )}
        </div>
    );
};

/* ── Thumbnail Item ─────────────────────────────────────────────── */
const ThumbnailItem = ({
    page,
    isActive,
    isDragOver,
    isSelected,
    selectionMode,
    engine,
    onClick,
    onContextMenu,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onToggleSelect,
}: {
    page: number;
    isActive: boolean;
    isDragOver: boolean;
    isSelected: boolean;
    selectionMode: boolean;
    engine: any;
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent, page: number) => void;
    onDragStart: (e: React.DragEvent, page: number) => void;
    onDragOver: (e: React.DragEvent, page: number) => void;
    onDrop: (e: React.DragEvent, page: number) => void;
    onDragEnd: () => void;
    onToggleSelect: (page: number) => void;
}) => {
    const canvasRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!engine || !canvasRef.current) return;
        const container = canvasRef.current;
        container.innerHTML = '';
        engine.renderThumbnail(page, 0.12).then((c: HTMLCanvasElement) => {
            c.style.width = '100%';
            c.style.height = 'auto';
            c.style.display = 'block';
            container.appendChild(c);
        }).catch(() => {
            container.innerHTML = `<div style="aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">Page ${page}</div>`;
        });
    }, [engine, page]);

    const handleClick = () => {
        if (selectionMode) {
            onToggleSelect(page);
        } else {
            onClick();
        }
    };

    return (
        <div
            draggable={!selectionMode}
            data-page={page}
            onClick={handleClick}
            onContextMenu={(e) => onContextMenu(e, page)}
            onDragStart={(e) => onDragStart(e, page)}
            onDragOver={(e) => onDragOver(e, page)}
            onDrop={(e) => onDrop(e, page)}
            onDragEnd={onDragEnd}
            className={`relative group cursor-pointer rounded border-2 transition-all duration-150 overflow-hidden shadow-sm bg-white select-none
                ${isSelected ? 'border-blue-500 ring-2 ring-blue-300' : isActive ? 'border-blue-400' : 'border-gray-200 hover:border-gray-400'}
                ${isDragOver ? 'border-blue-400 shadow-lg scale-105' : ''}`}
            title={selectionMode ? `${isSelected ? 'Deselect' : 'Select'} page ${page}` : `Page ${page} — drag to reorder, right-click for options`}
        >
            {/* Selection checkbox */}
            {selectionMode && (
                <div className="absolute top-1 left-1 z-10">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white/80 border-gray-400'}`}>
                        {isSelected && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </div>
                </div>
            )}

            {/* Drag handle (only when not in selection mode) */}
            {!selectionMode && (
                <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-60 transition-opacity z-10 text-gray-500 cursor-grab active:cursor-grabbing">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="8" cy="6" r="2" /><circle cx="16" cy="6" r="2" />
                        <circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" />
                        <circle cx="8" cy="18" r="2" /><circle cx="16" cy="18" r="2" />
                    </svg>
                </div>
            )}

            {/* Thumbnail canvas container */}
            <div ref={canvasRef} />

            {/* Page number badge */}
            <div className="absolute bottom-1 right-1 bg-gray-900/70 text-white text-[10px] px-1.5 py-0.5 rounded tabular-nums">
                {page}
            </div>
        </div>
    );
};

/* ── Split Dialog ───────────────────────────────────────────────── */
const SplitDialog = ({
    totalPages,
    onSplit,
    onClose,
}: {
    totalPages: number;
    onSplit: (splitAfter: number) => void;
    onClose: () => void;
}) => {
    const [splitAfter, setSplitAfter] = useState(Math.floor(totalPages / 2));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-72" onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Split PDF</h3>
                <p className="text-xs text-gray-500 mb-4">Split into two files at the selected page boundary.</p>

                <label className="block text-xs font-medium text-gray-700 mb-1">
                    Split after page:
                    <span className="ml-1 font-semibold text-blue-600">{splitAfter}</span>
                    <span className="text-gray-400"> of {totalPages}</span>
                </label>
                <input
                    type="range"
                    min={1}
                    max={totalPages - 1}
                    value={splitAfter}
                    onChange={e => setSplitAfter(Number(e.target.value))}
                    className="w-full accent-blue-600 mb-2"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mb-4">
                    <span>Part 1: pp 1–{splitAfter}</span>
                    <span>Part 2: pp {splitAfter + 1}–{totalPages}</span>
                </div>

                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors">Cancel</button>
                    <button
                        onClick={() => { onSplit(splitAfter); onClose(); }}
                        className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                    >
                        Split &amp; Download
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ── Main Sidebar ───────────────────────────────────────────────── */
export const Sidebar = () => {
    const { totalPages, currentPage, setCurrentPage } = useDocStore();
    const [activeTab, setActiveTab] = useState<'thumbnails' | 'bookmarks' | 'studio' | 'compare' | 'ai' | 'layers'>('thumbnails');
    const [outline, setOutline] = useState<OutlineNode[]>([]);
    const [outlineLoaded, setOutlineLoaded] = useState(false);
    const engineRef = useRef<any>(null);

    // Page order (1-based page numbers; reordering mutates this)
    const [pages, setPages] = useState<number[]>([]);
    const [dragging, setDragging] = useState<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    // Selection mode for Extract Pages
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

    // Split dialog
    const [splitDialogOpen, setSplitDialogOpen] = useState(false);

    // Build pages array from totalPages
    useEffect(() => {
        setPages(Array.from({ length: totalPages }, (_, i) => i + 1));
    }, [totalPages]);

    // Listen for engine-ready (fires on every file open)
    useEffect(() => {
        const handler = (e: Event) => {
            const engine = (e as CustomEvent).detail?.engine;
            if (!engine) return;
            engineRef.current = engine;
            setOutlineLoaded(false);
            setOutline([]);
            // Reset selection on new file
            setSelectionMode(false);
            setSelectedPages(new Set());
            engine.getOutline().then((nodes: OutlineNode[]) => {
                setOutline(nodes);
                setOutlineLoaded(true);
            }).catch(() => setOutlineLoaded(true));
        };
        window.addEventListener('pdfmax:engine-ready', handler);
        return () => window.removeEventListener('pdfmax:engine-ready', handler);
    }, []);

    // Refresh page list after any page mutation
    useEffect(() => {
        const handler = () => {
            const engine = engineRef.current;
            if (!engine) return;
            const n = engine.numPages;
            setPages(Array.from({ length: n }, (_, i) => i + 1));
        };
        window.addEventListener('pdfmax:pages-changed', handler);
        return () => window.removeEventListener('pdfmax:pages-changed', handler);
    }, []);

    /* ── Selection helpers ──────────────────────────────────────── */
    const toggleSelectionMode = useCallback(() => {
        setSelectionMode(m => !m);
        setSelectedPages(new Set());
    }, []);

    const togglePageSelect = useCallback((page: number) => {
        setSelectedPages(prev => {
            const next = new Set(prev);
            if (next.has(page)) next.delete(page);
            else next.add(page);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedPages(new Set(pages));
    }, [pages]);

    const clearSelection = useCallback(() => {
        setSelectedPages(new Set());
    }, []);

    /* ── Extract selected pages ─────────────────────────────────── */
    const handleExtract = useCallback(() => {
        if (selectedPages.size === 0) return;
        const sorted = Array.from(selectedPages).sort((a, b) => a - b);
        const filename = `extracted_pp${sorted[0]}${sorted.length > 1 ? `-${sorted[sorted.length - 1]}` : ''}.pdf`;
        window.dispatchEvent(new CustomEvent('pdfmax:extract-pages', { detail: { pages: sorted, filename } }));
        setSelectionMode(false);
        setSelectedPages(new Set());
    }, [selectedPages]);

    /* ── Drag handlers ──────────────────────────────────────────── */
    const handleDragStart = useCallback((e: React.DragEvent, page: number) => {
        setDragging(page);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, page: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(page);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, targetPage: number) => {
        e.preventDefault();
        if (dragging == null || dragging === targetPage) { setDragging(null); setDragOver(null); return; }
        setPages(prev => {
            const next = [...prev];
            const fromIdx = next.indexOf(dragging);
            const toIdx = next.indexOf(targetPage);
            next.splice(fromIdx, 1);
            next.splice(toIdx, 0, dragging);
            engineRef.current?.reorderPages(next)
                .catch((err: any) => console.error('[PDFMax] reorderPages failed', err));
            return next;
        });
        setDragging(null);
        setDragOver(null);
    }, [dragging]);

    const handleDragEnd = useCallback(() => {
        setDragging(null);
        setDragOver(null);
    }, []);

    /* ── Context menu actions ───────────────────────────────────── */
    const handleContextMenu = useCallback((e: React.MouseEvent, page: number) => {
        e.preventDefault();
        setContextMenu({ page, x: e.clientX, y: e.clientY });
    }, []);

    const handleContextAction = useCallback((action: string, page: number) => {
        const engine = engineRef.current;
        if (!engine) return;

        if (action === 'delete') {
            if (!confirm(`Delete page ${page}? This cannot be undone.`)) return;
            engine.deletePage(page).catch((err: any) => console.error('[PDFMax] deletePage failed', err));
        } else if (action === 'rotate-cw') {
            engine.rotatePage(page, 90).catch((err: any) => console.error('[PDFMax] rotatePage failed', err));
        } else if (action === 'rotate-ccw') {
            engine.rotatePage(page, 270).catch((err: any) => console.error('[PDFMax] rotatePage failed', err));
        } else if (action === 'rotate-180') {
            engine.rotatePage(page, 180).catch((err: any) => console.error('[PDFMax] rotatePage failed', err));
        } else if (action === 'insert-blank') {
            engine.insertBlankPage(page).catch((err: any) => console.error('[PDFMax] insertBlankPage failed', err));
        } else if (action === 'extract-single') {
            window.dispatchEvent(new CustomEvent('pdfmax:extract-pages', {
                detail: { pages: [page], filename: `page_${page}.pdf` },
            }));
        } else if (action === 'split-before') {
            // Split so part1 = pages 1..(page-1), part2 = page..end
            window.dispatchEvent(new CustomEvent('pdfmax:split-pdf', {
                detail: { splitAfter: page - 1 },
            }));
        } else if (action === 'split-after') {
            window.dispatchEvent(new CustomEvent('pdfmax:split-pdf', {
                detail: { splitAfter: page },
            }));
        }
    }, []);

    /* ── Combine PDF file picker ────────────────────────────────── */
    const handleCombine = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || !engineRef.current) return;
            const buf = await file.arrayBuffer();
            const engine = engineRef.current;
            const numPages = engine.numPages;
            await engine.combinePdf(new Uint8Array(buf), numPages);
        };
        input.click();
    }, []);

    return (
        <div className="w-60 bg-gray-50 border-r border-gray-200 h-full flex flex-col shrink-0 overflow-hidden">
            {/* Tabs — 6 tabs */}
            <div className="flex border-b border-gray-200">
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'thumbnails' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('thumbnails')}>Pages</button>
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'bookmarks' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('bookmarks')}>Bookmarks</button>
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'layers' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('layers')}>Layers</button>
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'studio' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('studio')}>Studio</button>
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'compare' ? 'text-rose-600 border-b-2 border-rose-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('compare')}>Compare</button>
                <button className={`flex-1 py-2 text-[9px] font-semibold transition-colors ${activeTab === 'ai' ? 'text-violet-600 border-b-2 border-violet-600 bg-white' : 'text-gray-500 hover:text-gray-800 bg-gray-50'}`} onClick={() => setActiveTab('ai')}>AI</button>
            </div>

            {/* Thumbnails tab */}
            {activeTab === 'thumbnails' && (
                <>
                    {/* Page action buttons — 2×2 grid */}
                    <div className="grid grid-cols-2 gap-1 px-2 py-1.5 border-b border-gray-200 bg-white">
                        <button
                            className="text-xs px-2 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors flex items-center justify-center gap-1"
                            title="Insert blank page at end"
                            onClick={() => engineRef.current?.insertBlankPage(engineRef.current.numPages)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                            Blank Page
                        </button>
                        <button
                            className="text-xs px-2 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors flex items-center justify-center gap-1"
                            title="Combine / merge another PDF"
                            onClick={handleCombine}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3" /></svg>
                            Merge PDF
                        </button>
                        <button
                            className={`text-xs px-2 py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${selectionMode
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                            title={selectionMode ? 'Exit extract mode' : 'Select pages to extract'}
                            onClick={toggleSelectionMode}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            {selectionMode ? 'Exit Extract' : 'Extract Pages'}
                        </button>
                        <button
                            className="text-xs px-2 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Split PDF into two files"
                            onClick={() => setSplitDialogOpen(true)}
                            disabled={totalPages < 2}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20l16-16M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                            Split PDF
                        </button>
                    </div>

                    {/* Selection mode toolbar */}
                    {selectionMode && (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 border-b border-blue-200">
                            <span className="text-[10px] text-blue-700 font-medium flex-1">
                                {selectedPages.size > 0 ? `${selectedPages.size} selected` : 'Tap pages to select'}
                            </span>
                            <button onClick={selectAll} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors">All</button>
                            <button onClick={clearSelection} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors">None</button>
                            <button
                                onClick={handleExtract}
                                disabled={selectedPages.size === 0}
                                className="text-[10px] bg-blue-600 disabled:bg-gray-300 text-white px-2 py-1 rounded font-semibold transition-colors hover:bg-blue-700 disabled:cursor-not-allowed"
                            >
                                ⬇ Download
                            </button>
                        </div>
                    )}

                    {/* Thumbnail grid */}
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                        {pages.length === 0 && (
                            <div className="text-gray-400 text-xs text-center mt-8 px-2 animate-pulse">Loading thumbnails…</div>
                        )}
                        {pages.map(page => (
                            <ThumbnailItem
                                key={page}
                                page={page}
                                isActive={page === currentPage}
                                isDragOver={dragOver === page}
                                isSelected={selectedPages.has(page)}
                                selectionMode={selectionMode}
                                engine={engineRef.current}
                                onClick={() => {
                                    setCurrentPage(page);
                                    const target = document.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${page}"]`);
                                    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                                onContextMenu={handleContextMenu}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                                onDragEnd={handleDragEnd}
                                onToggleSelect={togglePageSelect}
                            />
                        ))}
                    </div>
                </>
            )}

            {/* Bookmarks tab */}
            {activeTab === 'bookmarks' && (
                <div className="flex-1 overflow-y-auto py-2">
                    {!outlineLoaded ? (
                        <div className="text-gray-400 text-xs text-center mt-8 px-4 animate-pulse">Loading bookmarks…</div>
                    ) : outline.length === 0 ? (
                        <div className="text-gray-400 text-xs text-center mt-8 px-4 leading-relaxed">
                            <svg className="mx-auto mb-2 text-gray-300" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
                            No bookmarks in this document
                        </div>
                    ) : (
                        <div>{outline.map((node, i) => <BookmarkRow key={i} node={node} depth={0} />)}</div>
                    )}
                </div>
            )}

            {/* Studio tab */}
            {activeTab === 'studio' && (
                <div className="flex-1 overflow-hidden">
                    <StudioPanel />
                </div>
            )}

            {/* Compare tab */}
            {activeTab === 'compare' && (
                <div className="flex-1 overflow-hidden">
                    <OcrComparePanel />
                </div>
            )}

            {/* AI Review tab */}
            {activeTab === 'ai' && (
                <div className="flex-1 overflow-hidden">
                    <AiReviewPanel />
                </div>
            )}

            {/* Layers tab */}
            {activeTab === 'layers' && (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <LayersPanel />
                </div>
            )}

            {/* Context menu (portal-like fixed positioned) */}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onAction={handleContextAction}
                    totalPages={totalPages}
                />
            )}

            {/* Split dialog */}
            {splitDialogOpen && (
                <SplitDialog
                    totalPages={totalPages}
                    onSplit={(splitAfter) => {
                        window.dispatchEvent(new CustomEvent('pdfmax:split-pdf', { detail: { splitAfter } }));
                    }}
                    onClose={() => setSplitDialogOpen(false)}
                />
            )}
        </div>
    );
};
