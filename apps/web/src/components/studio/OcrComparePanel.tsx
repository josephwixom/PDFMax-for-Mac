'use client';

import React, { useState, useRef, useCallback } from 'react';
import { extractPdfText, ExtractJob, type OcrPage } from '@/lib/ocrService';
import { comparePdfExtracts, type CompareResult, type PageChange } from '@/lib/diffEngine';

// ─── Diff PDF export ─────────────────────────────────────────────────────────
/**
 * Takes Version B's raw bytes and a CompareResult, then overlays:
 *  - Green semi-transparent rectangles on ADDED words (unique to B)
 *  - Red semi-transparent rectangles on REMOVED words (absent from B)
 *  - An amber "CHANGED" banner at the top of each changed page.
 * Returns the annotated PDF as a Uint8Array.
 */
async function buildDiffPdf(fileBBytes: ArrayBuffer, result: CompareResult): Promise<Uint8Array> {
    const { PDFDocument, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(fileBBytes);
    const pages = pdfDoc.getPages();

    for (const pc of result.pageChanges) {
        if (pc.similarity >= 0.99 || pc.changedWords.length === 0) continue;
        const page = pages[pc.pageNum - 1];
        if (!page) continue;
        const { width: W, height: H } = page.getSize();

        // Amber "CHANGED" banner at top
        const bannerH = Math.max(14, H * 0.02);
        page.drawRectangle({
            x: 0, y: H - bannerH,
            width: W, height: bannerH,
            color: rgb(1, 0.75, 0),
            opacity: 0.85,
        });

        for (const wc of pc.changedWords) {
            // changedWords from docIndex=1 → added to B (green)
            // changedWords from docIndex=0 → removed from A (red, shown as ghost annotation)
            // Only words with docIndex=1 have positions in Version B
            if (wc.docIndex !== 1) continue;

            const bx = wc.word.x * W;
            // ocrService stores y as distance from top (0-1); pdf-lib y is from bottom
            const by = H - (wc.word.y + wc.word.h) * H;
            const bw = Math.max(wc.word.w * W, 4);
            const bh = Math.max(wc.word.h * H, 6);

            const color = wc.type === 'added' ? rgb(0.1, 0.8, 0.2) : rgb(0.9, 0.15, 0.15);

            page.drawRectangle({
                x: bx, y: by,
                width: bw, height: bh,
                color,
                opacity: 0.28,
                borderColor: color,
                borderWidth: 0.5,
                borderOpacity: 0.6,
            });
        }
    }

    return pdfDoc.save();
}

/** Generate the diff PDF and open it in the main PDF viewer. */
async function openDiffInViewer(
    fileB: File,
    result: CompareResult,
    setExporting: (v: boolean) => void
) {
    setExporting(true);
    try {
        const bytes = await fileB.arrayBuffer();
        const diffBytes = await buildDiffPdf(bytes, result);
        const blob = new Blob([diffBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const diffFile = new File([blob], `diff_${fileB.name}`, { type: 'application/pdf' });
        window.dispatchEvent(new CustomEvent('pdfmax:open-file', { detail: { file: diffFile } }));
    } catch (err) {
        console.error('[OCR] exportDiffPdf failed', err);
    } finally {
        setExporting(false);
    }
}

// ─── Color helpers ────────────────────────────────────────────────────────────
const BADGE_IDENTICAL = 'bg-gray-100 text-gray-500';
const BADGE_CHANGED = 'bg-amber-100 text-amber-800';
const BADGE_ADDED = 'bg-green-100 text-green-800';
const BADGE_REMOVED = 'bg-red-100 text-red-800';

function pct(n: number) { return `${Math.round(n * 100)}%`; }

// ─── File picker card ─────────────────────────────────────────────────────────
function FilePicker({
    label, file, onFile,
}: { label: string; file: File | null; onFile: (f: File) => void }) {
    const ref = useRef<HTMLInputElement>(null);
    return (
        <div
            className={`relative flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center
                ${file ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
            onClick={() => ref.current?.click()}
        >
            <input ref={ref} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke={file ? '#6366f1' : '#9ca3af'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-xs font-semibold text-gray-600">{label}</span>
            {file
                ? <span className="text-[10px] text-indigo-600 font-medium truncate max-w-[110px]">{file.name}</span>
                : <span className="text-[10px] text-gray-400">Click to pick PDF</span>}
        </div>
    );
}

// ─── Inline diff renderer ─────────────────────────────────────────────────────
function InlineDiff({ page }: { page: PageChange }) {
    return (
        <div className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-words p-2 bg-gray-50 rounded max-h-48 overflow-y-auto">
            {page.diffs.map((d, i) => {
                if (d.type === 'equal') return <span key={i}>{d.text}</span>;
                const cls = d.type === 'added'
                    ? 'bg-green-200 text-green-900 rounded px-0.5'
                    : 'bg-red-200 text-red-900 line-through rounded px-0.5';
                return <span key={i} className={cls}>{d.text}</span>;
            })}
        </div>
    );
}

// ─── Page row ─────────────────────────────────────────────────────────────────
function PageRow({ pc, selected, onClick }: { pc: PageChange; selected: boolean; onClick: () => void }) {
    const isIdentical = pc.similarity >= 0.99;
    const isAdded = pc.addedCount > 0 && pc.removedCount === 0;
    const isRemoved = pc.addedCount === 0 && pc.removedCount > 0;
    const badge = isIdentical ? BADGE_IDENTICAL : isAdded ? BADGE_ADDED : isRemoved ? BADGE_REMOVED : BADGE_CHANGED;

    return (
        <>
            <tr
                className={`border-b border-gray-100 cursor-pointer transition-colors text-xs ${selected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                onClick={onClick}
            >
                <td className="px-2 py-1.5 text-center text-gray-500 border-r border-gray-100 w-10">{pc.pageNum}</td>
                <td className="px-2 py-1.5 border-r border-gray-100">
                    <div className="w-full bg-gray-200 rounded h-1.5 overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded" style={{ width: pct(pc.similarity) }} />
                    </div>
                    <span className="text-[10px] text-gray-400">{pct(pc.similarity)} match</span>
                </td>
                <td className="px-2 py-1.5 border-r border-gray-100 text-center text-green-700">+{pc.addedCount}</td>
                <td className="px-2 py-1.5 border-r border-gray-100 text-center text-red-600">-{pc.removedCount}</td>
                <td className="px-2 py-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge}`}>
                        {isIdentical ? '✓ Same' : isAdded ? '+ Added' : isRemoved ? '- Removed' : '~ Changed'}
                    </span>
                </td>
            </tr>
            {selected && !isIdentical && (
                <tr className="bg-indigo-50">
                    <td colSpan={5} className="px-3 pb-2">
                        <InlineDiff page={pc} />
                    </td>
                </tr>
            )}
        </>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function OcrComparePanel() {
    const [fileA, setFileA] = useState<File | null>(null);
    const [fileB, setFileB] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'extracting-a' | 'extracting-b' | 'diffing' | 'done' | 'error'>('idle');
    const [progress, setProgress] = useState({ page: 0, total: 0, doc: '' });
    const [result, setResult] = useState<CompareResult | null>(null);
    const [error, setError] = useState('');
    const [selectedPage, setSelectedPage] = useState<number | null>(null);
    const [filter, setFilter] = useState<'all' | 'changed' | 'identical'>('all');
    const [exporting, setExporting] = useState(false);
    const jobRef = useRef<ExtractJob | null>(null);

    const handleCompare = useCallback(async () => {
        if (!fileA || !fileB) return;
        setResult(null);
        setError('');
        setSelectedPage(null);

        try {
            const jobA = new ExtractJob();
            jobRef.current = jobA;
            setStatus('extracting-a');
            const bufA = await fileA.arrayBuffer();
            const pagesA = await extractPdfText(bufA, (p, t) => setProgress({ page: p, total: t, doc: fileA.name }), jobA);

            if (jobA.cancelled) return;

            const jobB = new ExtractJob();
            jobRef.current = jobB;
            setStatus('extracting-b');
            const bufB = await fileB.arrayBuffer();
            const pagesB = await extractPdfText(bufB, (p, t) => setProgress({ page: p, total: t, doc: fileB.name }), jobB);

            if (jobB.cancelled) return;

            setStatus('diffing');
            const res = comparePdfExtracts(pagesA, pagesB);
            setResult(res);
            setStatus('done');
        } catch (err: any) {
            setError(String(err?.message ?? err));
            setStatus('error');
        }
    }, [fileA, fileB]);

    const handleCancel = () => { jobRef.current?.cancel(); setStatus('idle'); };

    const filtered = result
        ? result.pageChanges.filter(pc =>
            filter === 'all' ? true :
                filter === 'changed' ? pc.similarity < 0.99 :
                    pc.similarity >= 0.99)
        : [];

    return (
        <div className="flex flex-col h-full text-sm overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-3 pt-3 pb-2 border-b border-gray-200 bg-white">
                <h3 className="font-semibold text-gray-800 text-xs uppercase tracking-wide mb-2">OCR / Version Compare</h3>

                {/* File pickers */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <FilePicker label="Version A (Original)" file={fileA} onFile={setFileA} />
                    <FilePicker label="Version B (Updated)" file={fileB} onFile={setFileB} />
                </div>

                {/* Compare / Cancel / Open-in-viewer buttons */}
                <div className="flex gap-2">
                    {status === 'idle' || status === 'done' || status === 'error' ? (
                        <button
                            onClick={handleCompare}
                            disabled={!fileA || !fileB}
                            className="flex-1 py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {status === 'done' ? '↺ Re-compare' : 'Compare Documents'}
                        </button>
                    ) : (
                        <button onClick={handleCancel}
                            className="flex-1 py-1.5 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200 transition-colors">
                            Cancel
                        </button>
                    )}
                    {result && fileB && status === 'done' && (
                        <button
                            onClick={() => openDiffInViewer(fileB, result, setExporting)}
                            disabled={exporting}
                            title="Open Version B with changes highlighted in the viewer"
                            className="flex items-center gap-1 px-2 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0"
                        >
                            {exporting ? (
                                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                            )}
                            {exporting ? 'Building…' : 'Open in Viewer'}
                        </button>
                    )}
                </div>

                {/* Progress */}
                {(status === 'extracting-a' || status === 'extracting-b' || status === 'diffing') && (
                    <div className="mt-2">
                        <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                            <span>{status === 'diffing' ? 'Computing diff…' : `Extracting "${progress.doc}"…`}</span>
                            {status !== 'diffing' && <span>{progress.page}/{progress.total}</span>}
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 rounded transition-all duration-300"
                                style={{
                                    width: status === 'diffing' ? '100%'
                                        : progress.total ? pct(progress.page / progress.total)
                                            : '0%'
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Error */}
                {status === 'error' && (
                    <div className="mt-2 text-[10px] text-red-600 bg-red-50 rounded px-2 py-1">{error}</div>
                )}
            </div>

            {/* Results */}
            {result && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Summary bar */}
                    <div className="shrink-0 px-3 py-2 bg-gray-50 border-b border-gray-200">
                        <p className="text-[10px] text-gray-600 leading-relaxed">{result.summary}</p>
                        <div className="flex gap-2 mt-1.5">
                            {(['all', 'changed', 'identical'] as const).map(f => (
                                <button key={f} onClick={() => setFilter(f)}
                                    className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors capitalize ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {f === 'all' ? `All (${result.pageChanges.length})` :
                                        f === 'changed' ? `Changed (${result.changedPages})` :
                                            `Same (${result.unchangedPages})`}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Page table */}
                    <div className="flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-xs text-gray-400">No pages match filter.</div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-100 sticky top-0 shadow-sm">
                                    <tr className="text-[10px] text-gray-500 uppercase">
                                        <th className="px-2 py-1.5 border-b border-gray-200 border-r w-10">Pg</th>
                                        <th className="px-2 py-1.5 border-b border-gray-200 border-r">Match</th>
                                        <th className="px-2 py-1.5 border-b border-gray-200 border-r w-10 text-center">+</th>
                                        <th className="px-2 py-1.5 border-b border-gray-200 border-r w-10 text-center">-</th>
                                        <th className="px-2 py-1.5 border-b border-gray-200">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(pc => (
                                        <PageRow
                                            key={pc.pageNum}
                                            pc={pc}
                                            selected={selectedPage === pc.pageNum}
                                            onClick={() => setSelectedPage(selectedPage === pc.pageNum ? null : pc.pageNum)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* OCR legend */}
                    <div className="shrink-0 px-3 py-1.5 bg-gray-50 border-t border-gray-200 flex gap-3 text-[10px] text-gray-400">
                        <span className="bg-green-200 px-1 rounded">Added text</span>
                        <span className="bg-red-200 px-1 rounded line-through">Removed text</span>
                        <span>Click row to see diff</span>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!result && status === 'idle' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                    </svg>
                    <p className="text-center px-4">Pick two PDF versions to compare changes between revisions</p>
                </div>
            )}
        </div>
    );
}
