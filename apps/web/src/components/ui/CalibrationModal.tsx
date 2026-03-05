'use client';

import React, { useState, useEffect } from 'react';
import { useMeasureStore } from '@/store/useMeasureStore';
import type { MeasureUnit } from '@pdfmax/shared';

const UNITS: { value: MeasureUnit; label: string }[] = [
    { value: 'ft', label: 'Feet (ft)' },
    { value: 'in', label: 'Inches (in)' },
    { value: 'm', label: 'Meters (m)' },
    { value: 'cm', label: 'Centimeters (cm)' },
    { value: 'mm', label: 'Millimeters (mm)' },
];

export const CalibrationModal = () => {
    const { showCalibrationModal, pendingCalibration, confirmCalibration, closeCalibrationModal } = useMeasureStore();
    const [realWorldLength, setRealWorldLength] = useState('');
    const [unit, setUnit] = useState<MeasureUnit>('ft');

    // Reset input whenever modal opens so stale values never carry over
    useEffect(() => {
        if (showCalibrationModal) setRealWorldLength('');
    }, [showCalibrationModal]);

    if (!showCalibrationModal || !pendingCalibration) return null;

    const handleConfirm = () => {
        const length = parseFloat(realWorldLength);
        if (!isNaN(length) && length > 0) {
            confirmCalibration(length, unit);
        }
    };

    const handleCancel = () => {
        window.dispatchEvent(new CustomEvent('pdfmax:scale-cancelled'));
        closeCalibrationModal();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') handleCancel();
    };

    const pxPerUnit = (pendingCalibration.pixelLength / (parseFloat(realWorldLength) || 1)).toFixed(2);

    return (
        <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-96 bg-white rounded-xl shadow-2xl border border-amber-200 overflow-hidden"
            style={{ pointerEvents: 'all' }}
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200">
                <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7h5M3 12h5M3 17h5M16 3v18M16 3l4 4M16 21l4-4" />
                    </svg>
                    <h2 className="font-bold text-gray-800 text-sm">Set Page Scale</h2>
                </div>
                <span className="text-xs text-gray-500 bg-amber-100 px-2 py-0.5 rounded-full font-mono">
                    {pendingCalibration.pixelLength.toFixed(0)} px drawn
                </span>
            </div>

            {/* Body */}
            <div className="px-4 py-4 space-y-3">
                <label className="block text-xs font-semibold text-gray-600">
                    Real-world length of the line you drew:
                </label>
                <div className="flex gap-2">
                    <input
                        type="number"
                        value={realWorldLength}
                        onChange={(e) => setRealWorldLength(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                        placeholder="e.g. 20"
                        min="0.001"
                        step="any"
                        autoFocus
                    />
                    <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as MeasureUnit)}
                        className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                    >
                        {UNITS.map((u) => (
                            <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                    </select>
                </div>

                {/* Live scale preview */}
                <div className="bg-amber-50 rounded-lg px-3 py-2 text-xs text-gray-600 border border-amber-100">
                    <span className="font-semibold text-amber-700">{pendingCalibration.pixelLength.toFixed(0)} px</span>
                    {' = '}
                    <span className="font-semibold text-amber-700">{realWorldLength || '?'} {unit}</span>
                    <span className="text-gray-400 ml-2">({pxPerUnit} px/{unit})</span>
                </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
                <button
                    onClick={handleCancel}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleConfirm}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors shadow-sm"
                >
                    Set Scale ↵
                </button>
            </div>
        </div>
    );
};
