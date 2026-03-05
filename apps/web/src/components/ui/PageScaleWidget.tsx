'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useMeasureStore } from '@/store/useMeasureStore';
import { useDocStore } from '@/store/useDocStore';
import type { MeasureUnit } from '@pdfmax/shared';

/* ─── Unit helpers ────────────────────────────────────────────────────────── */

const UNITS: { value: MeasureUnit; label: string; abbr: string }[] = [
    { value: 'in', label: 'Inches', abbr: 'in' },
    { value: 'ft', label: 'Feet', abbr: 'ft' },
    { value: 'm', label: 'Meters', abbr: 'm' },
    { value: 'cm', label: 'Centimeters', abbr: 'cm' },
    { value: 'mm', label: 'Millimeters', abbr: 'mm' },
];

/**
 * Pixels per inch on the canvas (PDF rendered at 72 dpi × 1.5 scale = 108 px/in).
 * This is the baseline for converting drawing units to real-world units.
 */
const PX_PER_IN = 108; // 72 dpi × 1.5 render scale

/** Convert any unit to inches */
const toInches: Record<MeasureUnit, number> = {
    in: 1,
    ft: 12,
    m: 39.3701,
    cm: 0.393701,
    mm: 0.0393701,
};

/**
 * Compute pixelsPerUnit for a "1 drawUnit = ratio realUnit" scale.
 * e.g. "1 in = 20 ft"  →  pixelsPerUnit (ft)  =  PX_PER_IN / (20 * 12)
 * meaning: 1 ft of real-world == PX_PER_IN / (ratio * toInches[realUnit]) canvas px
 */
function computePixelsPerUnit(
    drawUnit: MeasureUnit,
    ratio: number,
    realUnit: MeasureUnit,
): number {
    // How many canvas pixels is 1 draw-unit?
    const pxPerDrawUnit = PX_PER_IN * toInches[drawUnit];
    // How many inches is 'ratio real-units'?
    const realInches = ratio * toInches[realUnit];
    // So 1 canvas draw-unit = realInches of real-world
    // pixelsPerUnit(realUnit) = canvas pixels per 1 real-world unit
    return pxPerDrawUnit / (realInches / toInches[realUnit]);
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export const PageScaleWidget = () => {
    const { pageScales, setPageScale, clearPageScale } = useMeasureStore();
    const { currentPage } = useDocStore();

    const [open, setOpen] = useState(false);
    const [drawQty, setDrawQty] = useState('1');
    const [drawUnit, setDrawUnit] = useState<MeasureUnit>('in');
    const [realQty, setRealQty] = useState('');
    const [realUnit, setRealUnit] = useState<MeasureUnit>('ft');
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Current scale for this page
    const scale = pageScales[currentPage];
    const scaleLabel = scale?.label ?? 'Not set';

    // Close popover on outside click
    useEffect(() => {
        if (!open) return;
        const handle = (e: MouseEvent) => {
            if (
                popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [open]);

    // When modal opens, pre-populate from existing scale if available
    useEffect(() => {
        if (!open) return;
        // Always start with a clean form so user sees the intent clearly
        setDrawQty('1');
        setDrawUnit('in');
        setRealQty('');
        setRealUnit('ft');
    }, [open]);

    const handleSet = () => {
        const ratio = parseFloat(realQty);
        if (isNaN(ratio) || ratio <= 0) return;
        const drawQtyNum = parseFloat(drawQty);
        if (isNaN(drawQtyNum) || drawQtyNum <= 0) return;

        const pixelsPerUnit = computePixelsPerUnit(drawUnit, ratio / drawQtyNum, realUnit);
        const label = `${drawQty} ${drawUnit} = ${realQty} ${realUnit}`;
        setPageScale(currentPage, { pixelsPerUnit, unit: realUnit, label });

        // Also update the activePageScale label
        window.dispatchEvent(new CustomEvent('pdfmax:scale-set', {
            detail: { label, pageNumber: currentPage },
        }));
        setOpen(false);
    };

    const handleClear = () => {
        clearPageScale(currentPage);
        useMeasureStore.setState({ activePageScale: 'Not calibrated' });
        setOpen(false);
    };

    return (
        <div className="relative">
            {/* Trigger pill */}
            <button
                ref={buttonRef}
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1.5 px-2 h-7 rounded hover:bg-gray-700 transition-colors text-xs font-mono"
                title="Set page scale"
            >
                {/* Ruler icon */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-amber-400"
                >
                    <path d="M3 7h5M3 12h5M3 17h5M16 3v18M16 3l4 4M16 21l4-4" />
                </svg>
                <span className={scale ? 'text-amber-300' : 'text-gray-400'}>
                    {scale ? scaleLabel : 'Set Scale'}
                </span>
            </button>

            {/* Popover */}
            {open && (
                <div
                    ref={popoverRef}
                    className="absolute bottom-full right-0 mb-2 w-72 bg-gray-900 border border-gray-600 rounded-xl shadow-2xl overflow-hidden z-50"
                >
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M3 7h5M3 12h5M3 17h5M16 3v18M16 3l4 4M16 21l4-4" />
                        </svg>
                        <span className="text-xs font-bold text-amber-400">Set Page Scale</span>
                        <span className="ml-auto text-[10px] text-gray-500 font-mono">Page {currentPage}</span>
                    </div>

                    {/* Current scale badge */}
                    {scale && (
                        <div className="mx-3 mt-2.5 px-2.5 py-1.5 bg-amber-500/10 rounded-lg border border-amber-500/20 flex items-center gap-2">
                            <span className="text-[10px] text-gray-400">Current</span>
                            <span className="text-xs font-mono text-amber-300 font-semibold">{scaleLabel}</span>
                        </div>
                    )}

                    {/* Scale input form */}
                    <div className="px-3 py-3 space-y-2.5">
                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Quick set</p>

                        {/* "draw qty + unit = real qty + unit" row */}
                        <div className="flex items-center gap-1.5">
                            {/* Draw side */}
                            <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={drawQty}
                                onChange={(e) => setDrawQty(e.target.value)}
                                className="w-12 text-center text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-amber-400"
                                placeholder="1"
                            />
                            <select
                                value={drawUnit}
                                onChange={(e) => setDrawUnit(e.target.value as MeasureUnit)}
                                className="flex-1 text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                            >
                                {UNITS.map((u) => (
                                    <option key={u.value} value={u.value}>{u.abbr}</option>
                                ))}
                            </select>

                            <span className="text-gray-400 text-xs font-bold">=</span>

                            {/* Real-world side */}
                            <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={realQty}
                                onChange={(e) => setRealQty(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSet();
                                    if (e.key === 'Escape') setOpen(false);
                                }}
                                className="w-14 text-center text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-amber-400"
                                placeholder="20"
                                autoFocus
                            />
                            <select
                                value={realUnit}
                                onChange={(e) => setRealUnit(e.target.value as MeasureUnit)}
                                className="flex-1 text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                            >
                                {UNITS.map((u) => (
                                    <option key={u.value} value={u.value}>{u.abbr}</option>
                                ))}
                            </select>
                        </div>

                        <p className="text-[10px] text-gray-500 leading-relaxed">
                            e.g. 1 in on page = 20 ft in real life
                        </p>
                    </div>

                    {/* Tip: draw-line approach */}
                    <div className="mx-3 mb-3 px-2.5 py-1.5 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <p className="text-[10px] text-blue-400 leading-relaxed">
                            <span className="font-semibold">Tip:</span> Use the{' '}
                            <span className="font-mono">Calibrate</span> tool to draw a known line for maximum accuracy.
                        </p>
                    </div>

                    {/* Footer buttons */}
                    <div className="flex gap-2 px-3 pb-3">
                        {scale && (
                            <button
                                onClick={handleClear}
                                className="px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
                            >
                                Clear
                            </button>
                        )}
                        <button
                            onClick={() => setOpen(false)}
                            className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSet}
                            disabled={!realQty || parseFloat(realQty) <= 0}
                            className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Set Scale ↵
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
