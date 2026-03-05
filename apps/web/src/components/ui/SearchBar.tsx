'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { extractPdfText, ExtractJob, type OcrPage } from '@/lib/ocrService';

interface SearchResult {
    page: number;
    index: number;
    rect: DOMRect;
}

interface SearchBarProps {
    engineRef: React.MutableRefObject<any>;
}

type OcrStatus = 'idle' | 'prompted' | 'running' | 'done' | 'unavailable';

export const SearchBar: React.FC<SearchBarProps> = ({ engineRef }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');
    const [ocrProgress, setOcrProgress] = useState<{ page: number; total: number } | null>(null);
    const [ocrPages, setOcrPages] = useState<OcrPage[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ocrJobRef = useRef<ExtractJob | null>(null);

    // ── Open / close ───────────────────────────────────────────────────
    const openBar = useCallback(async () => {
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);

        // Check if the document has a text layer
        const engine = engineRef.current;
        if (!engine || !engine.pdfDocument) return;

        // Quick heuristic: sample the first page for native text
        try {
            const page = await engine.pdfDocument.getPage(1);
            const tc = await page.getTextContent();
            const hasText = (tc.items as any[]).some((item: any) => item.str?.trim().length > 0);
            if (!hasText) {
                setOcrStatus('prompted');
            }
        } catch {
            // Silently ignore — don't block search if check fails
        }
    }, [engineRef]);

    const closeBar = useCallback(() => {
        ocrJobRef.current?.cancel();
        setOpen(false);
        setQuery('');
        setResults([]);
        setActiveIndex(0);
        setOcrStatus('idle');
        setOcrProgress(null);
        setOcrPages([]);
        engineRef.current?.clearSearchHighlights();
    }, [engineRef]);

    // Ctrl+F / Cmd+F global shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                openBar();
            }
            if (e.key === 'Escape' && open) closeBar();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, openBar, closeBar]);

    // Listen for pdfmax:open-search event (toolbar button)
    useEffect(() => {
        const handler = () => openBar();
        window.addEventListener('pdfmax:open-search', handler);
        return () => window.removeEventListener('pdfmax:open-search', handler);
    }, [openBar]);

    // ── OCR scan ────────────────────────────────────────────────────────────
    const runOcr = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) return;
        setOcrStatus('running');
        setOcrProgress({ page: 0, total: 0 });
        const job = new ExtractJob();
        ocrJobRef.current = job;
        try {
            const bytes = await engine.getPdfBytes();
            const pages = await extractPdfText(
                bytes.buffer as ArrayBuffer,
                (pg, total) => setOcrProgress({ page: pg, total }),
                job,
            );
            if (!job.cancelled) {
                setOcrPages(pages);
                setOcrStatus('done');
                // If there's already a query, search immediately with OCR results
                if (query.trim()) runOcrSearch(query, pages);
            }
        } catch (err) {
            console.error('[SearchBar] OCR failed', err);
            setOcrStatus('unavailable');
        }
    }, [engineRef, query]);

    // ── Search logic ─────────────────────────────────────────────────────────
    const runOcrSearch = useCallback((q: string, pages: OcrPage[]) => {
        // Clear engine highlights — OCR search uses its own overlay approach
        engineRef.current?.clearSearchHighlights();
        const lq = q.toLowerCase();
        const found: SearchResult[] = [];
        let idx = 0;

        for (const pg of pages) {
            for (const word of pg.words) {
                if (word.text.toLowerCase().includes(lq)) {
                    // Convert relative coords (0-1) to canvas pixels
                    const wrapper = document.querySelector<HTMLElement>(
                        `.pdf-page-wrapper[data-page="${pg.pageNum}"]`
                    );
                    if (!wrapper) continue;
                    const W = wrapper.offsetWidth;
                    const H = wrapper.offsetHeight;
                    const rect = new DOMRect(
                        word.x * W,
                        word.y * H,
                        word.w * W,
                        word.h * H,
                    );
                    // Draw highlight
                    const hl = document.createElement('div');
                    hl.className = 'pdfmax-search-hl';
                    hl.dataset.searchIndex = String(idx);
                    hl.style.cssText = `
                        position:absolute;
                        left:${rect.x}px;top:${rect.y}px;
                        width:${rect.width}px;height:${rect.height}px;
                        background:rgba(250,204,21,0.45);
                        border:1px solid rgba(202,138,4,0.6);
                        border-radius:2px;pointer-events:none;z-index:20;
                        mix-blend-mode:multiply;
                    `;
                    wrapper.appendChild(hl);
                    // Register with engine for cleanup
                    engineRef.current?.searchHighlightEls?.push(hl);
                    found.push({ page: pg.pageNum, index: idx, rect });
                    idx++;
                }
            }
        }
        setResults(found);
        setActiveIndex(0);
        if (found.length > 0) {
            engineRef.current?.setActiveSearchMatch(0);
            scrollToMatch(found[0]);
        }
    }, [engineRef]);

    const runSearch = useCallback(async (q: string) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (!q.trim()) {
            engine.clearSearchHighlights();
            setResults([]);
            setActiveIndex(0);
            return;
        }
        // If OCR results are available, search those instead of the text layer
        if (ocrStatus === 'done' && ocrPages.length > 0) {
            runOcrSearch(q, ocrPages);
            return;
        }
        setLoading(true);
        try {
            const found: SearchResult[] = await engine.searchText(q);
            setResults(found);
            setActiveIndex(0);
            if (found.length > 0) {
                engine.setActiveSearchMatch(0);
                scrollToMatch(found[0]);
            }
        } finally {
            setLoading(false);
        }
    }, [engineRef, ocrStatus, ocrPages, runOcrSearch]);

    const handleQueryChange = (val: string) => {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(val), 350);
    };

    // ── Navigation ────────────────────────────────────────────────────────────
    const goTo = useCallback((idx: number) => {
        if (results.length === 0) return;
        const clamped = ((idx % results.length) + results.length) % results.length;
        setActiveIndex(clamped);
        engineRef.current?.setActiveSearchMatch(clamped);
        scrollToMatch(results[clamped]);
    }, [engineRef, results]);

    const scrollToMatch = (match: SearchResult) => {
        const wrapper = document.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${match.page}"]`);
        if (!wrapper) return;
        const scrollable = wrapper.closest('.overflow-auto') as HTMLElement | null;
        const target = scrollable ?? window as any;
        const wrapperTop = wrapper.getBoundingClientRect().top + (scrollable ? scrollable.scrollTop : window.scrollY);
        const scrollTop = wrapperTop + match.rect.y - (scrollable?.clientHeight ?? window.innerHeight) / 2;
        (scrollable ?? window).scrollTo({ top: scrollTop, behavior: 'smooth' });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.shiftKey ? goTo(activeIndex - 1) : goTo(activeIndex + 1);
        }
        if (e.key === 'Escape') closeBar();
    };

    if (!open) return null;

    return (
        <div
            className="fixed top-16 right-4 z-[100] bg-gray-900 border border-gray-600 rounded-xl shadow-2xl overflow-hidden"
            style={{ width: 360, backdropFilter: 'blur(8px)' }}
        >
            {/* ── OCR Prompt Banner ─────────────────────────────────────────── */}
            {ocrStatus === 'prompted' && (
                <div className="flex items-start gap-3 px-3 py-2.5 bg-amber-950/80 border-b border-amber-700/60">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                        <rect width="7" height="5" x="7" y="7" rx="1" /><rect width="7" height="5" x="10" y="12" rx="1" />
                    </svg>
                    <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-amber-300 leading-tight">No text layer detected</p>
                        <p className="text-[10px] text-amber-400/80 leading-snug mt-0.5">This may be a scanned PDF. Run OCR to make it searchable.</p>
                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={runOcr}
                                className="text-[11px] font-semibold bg-amber-500 hover:bg-amber-400 text-gray-900 px-2.5 py-1 rounded transition-colors"
                            >
                                Run OCR Scan
                            </button>
                            <button
                                onClick={() => setOcrStatus('unavailable')}
                                className="text-[11px] text-amber-400/70 hover:text-amber-300 px-1 py-1 transition-colors"
                            >
                                Skip
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── OCR Progress ─────────────────────────────────────────────── */}
            {ocrStatus === 'running' && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 bg-blue-950/80 border-b border-blue-700/60">
                    <svg className="animate-spin shrink-0" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-blue-300 font-medium">
                            Running OCR…
                            {ocrProgress && ocrProgress.total > 0 && (
                                <span className="ml-1 text-blue-400/70">
                                    page {ocrProgress.page} of {ocrProgress.total}
                                </span>
                            )}
                        </p>
                        {ocrProgress && ocrProgress.total > 0 && (
                            <div className="mt-1.5 h-1 bg-blue-900 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-400 rounded-full transition-all duration-300"
                                    style={{ width: `${(ocrProgress.page / ocrProgress.total) * 100}%` }}
                                />
                            </div>
                        )}
                    </div>
                    <button onClick={() => { ocrJobRef.current?.cancel(); setOcrStatus('idle'); }} className="text-[10px] text-blue-400/60 hover:text-blue-300 transition-colors">Cancel</button>
                </div>
            )}

            {/* ── OCR Done badge ────────────────────────────────────────────── */}
            {ocrStatus === 'done' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-950/80 border-b border-emerald-700/60">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    <span className="text-[10px] text-emerald-400 font-medium">OCR complete — searching extracted text</span>
                </div>
            )}

            {/* ── Search input row ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3 py-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={e => handleQueryChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search PDF… (Enter to navigate)"
                    className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 outline-none"
                    disabled={ocrStatus === 'running'}
                />
                {query.trim() && (
                    <span className={`text-xs font-medium shrink-0 ${results.length === 0 && !loading ? 'text-red-400' : 'text-gray-400'}`}>
                        {loading ? '…' : results.length === 0 ? 'No matches' : `${activeIndex + 1} / ${results.length}`}
                    </span>
                )}
                {results.length > 0 && (
                    <>
                        <button onClick={() => goTo(activeIndex - 1)} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors" title="Previous (Shift+Enter)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
                        </button>
                        <button onClick={() => goTo(activeIndex + 1)} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors" title="Next (Enter)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                    </>
                )}
                <button onClick={closeBar} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-white transition-colors" title="Close (Escape)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
        </div>
    );
};
