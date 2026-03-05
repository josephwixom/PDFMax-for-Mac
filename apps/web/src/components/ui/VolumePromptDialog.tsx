'use client';

import React, { useState, useEffect, useRef } from 'react';

interface VolumePromptDialogProps {
    isOpen: boolean;
    areaLabel: string;
    defaultUnit?: string;
    onConfirm: (depth: number, unit: string) => void;
    onClose: () => void;
}

const UNITS = ['ft', 'in', 'm', 'cm', 'mm'];

export const VolumePromptDialog = ({ isOpen, areaLabel, defaultUnit, onConfirm, onClose }: VolumePromptDialogProps) => {
    const [depth, setDepth] = useState('');
    const [unit, setUnit] = useState(defaultUnit ?? 'ft');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setDepth('');
            if (defaultUnit) setUnit(defaultUnit);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, defaultUnit]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const d = parseFloat(depth);
        if (!isNaN(d) && d > 0) {
            onConfirm(d, unit);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

            {/* Dialog */}
            <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 w-72 text-sm">
                <h3 className="font-semibold text-white mb-1 text-base">Calculate Volume</h3>
                <p className="text-gray-400 text-xs mb-4">
                    Area measured: <span className="text-blue-300 font-mono">{areaLabel}</span>
                    <br />Enter depth to compute volume.
                </p>

                <div className="flex gap-2 mb-4">
                    <input
                        ref={inputRef}
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Depth"
                        value={depth}
                        onChange={e => setDepth(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                    />
                    <select
                        value={unit}
                        onChange={e => setUnit(e.target.value)}
                        className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
                    >
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                </div>

                <div className="flex gap-2 justify-end">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        Skip
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!depth || isNaN(parseFloat(depth))}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                    >
                        Add Volume Label
                    </button>
                </div>
            </div>
        </div>
    );
};
