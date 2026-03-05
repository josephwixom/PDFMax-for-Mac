'use client';

import React, { useState, useCallback } from 'react';

interface PageOperationsModalProps {
    isOpen: boolean;
    totalPages: number;
    /** Called with the parsed page list when user confirms Extract */
    onExtract: (pages: number[]) => void;
    /** Called with the chunk size (1 = every page, N = every N pages) */
    onSplit: (chunkSize: number) => void;
    onClose: () => void;
}

/** Parse a human-readable page spec like "1,3,5-8,10" into a 0-based page index array */
function parsePageSpec(spec: string, total: number): number[] | null {
    const pages = new Set<number>();
    const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            if (isNaN(a) || isNaN(b) || a < 1 || b > total || a > b) return null;
            for (let i = a; i <= b; i++) pages.add(i - 1); // 0-based
        } else {
            const n = Number(part);
            if (isNaN(n) || n < 1 || n > total) return null;
            pages.add(n - 1);
        }
    }
    return pages.size > 0 ? Array.from(pages).sort((a, b) => a - b) : null;
}

export function PageOperationsModal({ isOpen, totalPages, onExtract, onSplit, onClose }: PageOperationsModalProps) {
    const [tab, setTab] = useState<'extract' | 'split'>('extract');
    const [extractSpec, setExtractSpec] = useState('');
    const [splitMode, setSplitMode] = useState<'individual' | 'every'>('individual');
    const [splitN, setSplitN] = useState('1');
    const [error, setError] = useState('');

    const handleExtract = useCallback(() => {
        setError('');
        const pages = parsePageSpec(extractSpec, totalPages);
        if (!pages) {
            setError(`Invalid page range. Use "1,3,5-8" format (1–${totalPages})`);
            return;
        }
        onExtract(pages);
        onClose();
    }, [extractSpec, totalPages, onExtract, onClose]);

    const handleSplit = useCallback(() => {
        setError('');
        const n = splitMode === 'individual' ? 1 : parseInt(splitN, 10);
        if (isNaN(n) || n < 1 || n > totalPages) {
            setError(`Chunk size must be between 1 and ${totalPages}`);
            return;
        }
        onSplit(n);
        onClose();
    }, [splitMode, splitN, totalPages, onSplit, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-white font-bold text-lg">Page Operations</h2>
                        <p className="text-indigo-200 text-xs mt-0.5">{totalPages} pages total</p>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                    {(['extract', 'split'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => { setTab(t); setError(''); }}
                            className={`flex-1 py-3 text-sm font-semibold transition-all ${tab === t ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {t === 'extract' ? '✂️ Extract Pages' : '📄 Split PDF'}
                        </button>
                    ))}
                </div>

                <div className="p-6 space-y-4">
                    {tab === 'extract' ? (
                        <>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                Extract specific pages into a new PDF file. Specify pages using commas and ranges.
                            </p>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                    Pages to extract
                                </label>
                                <input
                                    type="text"
                                    value={extractSpec}
                                    onChange={e => { setExtractSpec(e.target.value); setError(''); }}
                                    onKeyDown={e => e.key === 'Enter' && handleExtract()}
                                    placeholder={`e.g. 1,3,5-8 (1–${totalPages})`}
                                    autoFocus
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
                                />
                                <p className="text-xs text-gray-400 mt-1.5">
                                    Examples: <span className="font-mono text-indigo-600">2</span> &nbsp;•&nbsp;
                                    <span className="font-mono text-indigo-600">1,3,5</span> &nbsp;•&nbsp;
                                    <span className="font-mono text-indigo-600">1-5,8,10-12</span>
                                </p>
                            </div>
                            {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
                            <div className="flex gap-3 pt-2">
                                <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                                    Cancel
                                </button>
                                <button onClick={handleExtract} disabled={!extractSpec.trim()}
                                    className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
                                    Extract & Download
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                Split this PDF into multiple separate files and download them as a ZIP.
                            </p>
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all"
                                    style={{ borderColor: splitMode === 'individual' ? '#6366f1' : '#e5e7eb', background: splitMode === 'individual' ? '#eef2ff' : 'white' }}>
                                    <input type="radio" name="splitMode" value="individual" checked={splitMode === 'individual'}
                                        onChange={() => setSplitMode('individual')} className="accent-indigo-600" />
                                    <div>
                                        <p className="text-sm font-semibold text-gray-800">One file per page</p>
                                        <p className="text-xs text-gray-500">Creates {totalPages} individual PDF{totalPages !== 1 ? 's' : ''}</p>
                                    </div>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all"
                                    style={{ borderColor: splitMode === 'every' ? '#6366f1' : '#e5e7eb', background: splitMode === 'every' ? '#eef2ff' : 'white' }}>
                                    <input type="radio" name="splitMode" value="every" checked={splitMode === 'every'}
                                        onChange={() => setSplitMode('every')} className="accent-indigo-600" />
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-gray-800">Every N pages</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-gray-500">Split every</span>
                                            <input
                                                type="number" min={1} max={totalPages}
                                                value={splitN}
                                                onChange={e => setSplitN(e.target.value)}
                                                onClick={() => setSplitMode('every')}
                                                className="w-14 border border-gray-300 rounded px-2 py-1 text-xs font-mono text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                            />
                                            <span className="text-xs text-gray-500">pages</span>
                                        </div>
                                    </div>
                                </label>
                            </div>
                            {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
                            <div className="flex gap-3 pt-2">
                                <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                                    Cancel
                                </button>
                                <button onClick={handleSplit}
                                    className="flex-1 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
                                    Split & Download
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
