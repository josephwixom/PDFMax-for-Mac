'use client';

import React, { useState, useEffect } from 'react';
import { useMeasureStore } from '@/store/useMeasureStore';
import { exportMarkupsAsPdf } from '@/lib/pdfExporter';

// ── Paper sizes in inches ──────────────────────────────────────────────────
const PAPER_SIZES = [
    { id: 'letter', label: 'Letter (8.5" × 11")', wIn: 8.5, hIn: 11 },
    { id: 'legal', label: 'Legal (8.5" × 14")', wIn: 8.5, hIn: 14 },
    { id: 'tabloid', label: 'Tabloid (11" × 17")', wIn: 11, hIn: 17 },
    { id: 'a4', label: 'A4 (8.27" × 11.69")', wIn: 8.27, hIn: 11.69 },
    { id: 'a3', label: 'A3 (11.69" × 16.54")', wIn: 11.69, hIn: 16.54 },
    { id: 'd', label: 'D-size (24" × 36")', wIn: 24, hIn: 36 },
] as const;

// ── Scale presets ──────────────────────────────────────────────────────────
const SCALE_PRESETS = [
    { label: 'Fit to Page', value: 'fit' },
    { label: 'Actual Size (100%)', value: '100' },
    { label: '75%', value: '75' },
    { label: '50%', value: '50' },
    { label: '25%', value: '25' },
    { label: 'Custom %', value: 'custom' },
] as const;

interface PrintScaleModalProps {
    open: boolean;
    onClose: () => void;
    currentPage: number;
    /** Raw PDF page dimensions in points (72pt = 1in). */
    pdfPageWidthPt: number;
    pdfPageHeightPt: number;
    /** Flattened exported PDF blob (pre-computed by caller). */
    exportedPdfBlob: Blob | null;
    exporting: boolean;
}

export const PrintScaleModal: React.FC<PrintScaleModalProps> = ({
    open, onClose, currentPage, pdfPageWidthPt, pdfPageHeightPt, exportedPdfBlob, exporting,
}) => {
    const { getPageScale } = useMeasureStore();
    const [paperId, setPaperId] = useState<string>('letter');
    const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');
    const [scaleMode, setScaleMode] = useState<string>('fit');
    const [customPct, setCustomPct] = useState('100');

    // Reset on open
    useEffect(() => {
        if (open) { setPaperId('letter'); setScaleMode('fit'); setCustomPct('100'); }
    }, [open]);

    if (!open) return null;

    const paper = PAPER_SIZES.find(p => p.id === paperId) ?? PAPER_SIZES[0];
    const paperW = orientation === 'landscape' ? Math.max(paper.wIn, paper.hIn) : Math.min(paper.wIn, paper.hIn);
    const paperH = orientation === 'landscape' ? Math.min(paper.wIn, paper.hIn) : Math.max(paper.wIn, paper.hIn);

    // PDF page size in inches
    const pageWIn = pdfPageWidthPt / 72;
    const pageHIn = pdfPageHeightPt / 72;

    // Fit % = smallest ratio of paper to page
    const fitPct = Math.round(Math.min((paperW / pageWIn), (paperH / pageHIn)) * 100);

    const resolvedPct = scaleMode === 'fit'
        ? fitPct
        : scaleMode === 'custom'
            ? (parseFloat(customPct) || 100)
            : parseInt(scaleMode, 10);

    // If calibration is set, compute what 1" on printed paper equals in real-world units
    const scaleConfig = getPageScale(currentPage);
    let calibrationHint = '';
    if (scaleMode !== 'fit' && scaleConfig && scaleConfig.pixelsPerUnit > 0 && pdfPageWidthPt > 0) {
        // pixels per unit on the fabric canvas, fabric canvas width ≈ pdfPts for our engine
        // 1 inch on paper at the scaled print = (72pt / resolvedPct) canvas pixels
        const fabricPxPerPaperInch = (72 / (resolvedPct / 100));
        const realUnitsPerPaperInch = fabricPxPerPaperInch / scaleConfig.pixelsPerUnit;
        const unitLabel = scaleConfig.unit ?? 'ft';
        calibrationHint = `At ${resolvedPct}%, 1" on paper ≈ ${realUnitsPerPaperInch.toFixed(2)} ${unitLabel} real-world`;
    }

    const handlePrint = () => {
        if (!exportedPdfBlob) return;
        const url = URL.createObjectURL(exportedPdfBlob);
        window.open(url, '_blank');
        // Note: revoke after a delay to allow the tab to load
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-[480px] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" /></svg>
                        <h2 className="font-bold text-gray-800 text-sm">Print at Scale</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {/* PDF page size info */}
                    <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        PDF page: <span className="font-mono font-semibold text-gray-700">{pageWIn.toFixed(2)}" × {pageHIn.toFixed(2)}"</span>
                        {scaleConfig && <span className="ml-2 text-indigo-600">· Scale calibrated ({scaleConfig.label ?? scaleConfig.unit})</span>}
                    </div>

                    {/* Paper size + Orientation */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Paper Size</label>
                            <select
                                value={paperId}
                                onChange={e => setPaperId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none bg-white"
                            >
                                {PAPER_SIZES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Orientation</label>
                            <div className="flex gap-2">
                                {(['portrait', 'landscape'] as const).map(o => (
                                    <button
                                        key={o}
                                        onClick={() => setOrientation(o)}
                                        className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${orientation === o ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        {o.charAt(0).toUpperCase() + o.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Scale mode */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-2">Print Scale</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {SCALE_PRESETS.map(preset => (
                                <button
                                    key={preset.value}
                                    onClick={() => setScaleMode(preset.value)}
                                    className={`text-xs py-1.5 rounded-lg border transition-colors ${scaleMode === preset.value ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                        {scaleMode === 'custom' && (
                            <div className="mt-2 flex items-center gap-2">
                                <input
                                    type="number"
                                    value={customPct}
                                    min="1" max="1000" step="1"
                                    onChange={e => setCustomPct(e.target.value)}
                                    className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-400 outline-none"
                                />
                                <span className="text-xs text-gray-500">% of original size</span>
                            </div>
                        )}
                    </div>

                    {/* Instruction box */}
                    <div className="bg-indigo-50 rounded-xl border border-indigo-200 px-4 py-3 text-xs space-y-1">
                        <p className="font-semibold text-indigo-800">How to print at scale:</p>
                        <ol className="list-decimal list-inside space-y-0.5 text-indigo-700">
                            <li>Click <strong>Open for Printing</strong> — the marked-up PDF opens in a new tab.</li>
                            <li>Press <strong>Ctrl+P</strong> (or ⌘P) to open Chrome's print dialog.</li>
                            <li>Click <strong>More settings</strong> → set <strong>Scale</strong> to&nbsp;
                                <span className="font-mono bg-indigo-200 px-1 rounded">
                                    {scaleMode === 'fit' ? 'Fit to page' : `${resolvedPct}%`}
                                </span>
                            </li>
                            {scaleMode === 'fit' && <li>Set <strong>Paper size</strong> to <strong>{paper.label}</strong>.</li>}
                        </ol>
                        {calibrationHint && (
                            <p className="text-indigo-600 font-medium pt-1 border-t border-indigo-200 mt-2">
                                📐 {calibrationHint}
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-2 px-5 py-4 bg-gray-50 border-t border-gray-200">
                    <button
                        onClick={onClose}
                        className="flex-1 px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handlePrint}
                        disabled={!exportedPdfBlob || exporting}
                        className="flex-2 flex-grow flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                        {exporting ? (
                            <>
                                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                Preparing…
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" /></svg>
                                Open for Printing
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
