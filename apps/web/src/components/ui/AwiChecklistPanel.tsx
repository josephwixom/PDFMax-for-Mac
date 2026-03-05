'use client';

import React, { useState, useCallback } from 'react';
import { AWI_CHECKLIST, type AwiCheckItem } from '@/lib/awiChecklist';

type Status = 'pass' | 'warn' | 'fail' | 'na' | null;
type StatusMap = Record<string, Status>;

const CATEGORIES = [
    { key: 'drawing', label: 'Drawing', color: 'blue' },
    { key: 'dimensions', label: 'Dimensions', color: 'purple' },
    { key: 'joinery', label: 'Joinery', color: 'orange' },
    { key: 'material', label: 'Material', color: 'green' },
    { key: 'hardware', label: 'Hardware', color: 'yellow' },
    { key: 'finish', label: 'Finish', color: 'red' },
] as const;

const STATUS_OPTS: { key: Status; label: string; cls: string; active: string }[] = [
    { key: 'pass', label: '✓', cls: 'text-gray-500 hover:bg-green-100 hover:text-green-700', active: 'bg-green-500 text-white' },
    { key: 'warn', label: '⚠', cls: 'text-gray-500 hover:bg-amber-100 hover:text-amber-700', active: 'bg-amber-500 text-white' },
    { key: 'fail', label: '✗', cls: 'text-gray-500 hover:bg-red-100 hover:text-red-700', active: 'bg-red-500 text-white' },
    { key: 'na', label: 'N/A', cls: 'text-gray-500 hover:bg-gray-100 hover:text-gray-700', active: 'bg-gray-400 text-white' },
];

interface AwiChecklistPanelProps {
    onClose: () => void;
}

export const AwiChecklistPanel = ({ onClose }: AwiChecklistPanelProps) => {
    const [statuses, setStatuses] = useState<StatusMap>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.key)));

    const toggle = useCallback((id: string, status: Status) => {
        setStatuses(prev => ({ ...prev, [id]: prev[id] === status ? null : status }));
    }, []);

    const toggleCategory = useCallback((key: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const exportJson = useCallback(() => {
        const output = AWI_CHECKLIST.map(item => ({
            id: item.id,
            section: item.section,
            description: item.description,
            status: statuses[item.id] ?? null,
        }));
        const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `awi-checklist-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [statuses]);

    const resetAll = useCallback(() => {
        setStatuses({});
    }, []);

    // Counts
    const allItems = AWI_CHECKLIST;
    const passCount = allItems.filter(i => statuses[i.id] === 'pass').length;
    const warnCount = allItems.filter(i => statuses[i.id] === 'warn').length;
    const failCount = allItems.filter(i => statuses[i.id] === 'fail').length;
    const naCount = allItems.filter(i => statuses[i.id] === 'na').length;
    const doneCount = passCount + warnCount + failCount + naCount;
    const pct = Math.round((doneCount / allItems.length) * 100);

    return (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-start justify-end">
            <div className="h-full w-[420px] bg-white shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 py-3 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="font-bold text-sm">AWI Premium Grade Checklist</h2>
                        <p className="text-slate-400 text-[10px] mt-0.5">Architectural Woodwork Standards · 3rd Edition</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Progress bar */}
                <div className="shrink-0 px-4 py-2 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex gap-2 text-[11px]">
                            <span className="text-green-700 font-semibold">✓ {passCount}</span>
                            <span className="text-amber-600 font-semibold">⚠ {warnCount}</span>
                            <span className="text-red-600 font-semibold">✗ {failCount}</span>
                            <span className="text-gray-500">N/A {naCount}</span>
                        </div>
                        <span className="text-[11px] font-mono text-gray-500">{pct}% reviewed</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
                        <div className="h-full rounded transition-all duration-300" style={{
                            width: `${pct}%`,
                            background: failCount > 0 ? '#ef4444' : warnCount > 0 ? '#f59e0b' : '#22c55e',
                        }} />
                    </div>
                </div>

                {/* Checklist */}
                <div className="flex-1 overflow-y-auto">
                    {CATEGORIES.map(cat => {
                        const items = AWI_CHECKLIST.filter((i: AwiCheckItem) => i.category === cat.key);
                        const isOpen = expanded.has(cat.key);
                        const catPass = items.filter(i => statuses[i.id] === 'pass').length;
                        const catFail = items.filter(i => statuses[i.id] === 'fail').length;
                        return (
                            <div key={cat.key} className="border-b border-gray-100">
                                {/* Category header */}
                                <button
                                    className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                                    onClick={() => toggleCategory(cat.key)}
                                >
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{cat.label}</span>
                                    <div className="flex items-center gap-2">
                                        {catFail > 0 && <span className="text-[10px] font-semibold text-red-600">{catFail} fail</span>}
                                        {catPass > 0 && <span className="text-[10px] font-semibold text-green-600">{catPass}/{items.length} pass</span>}
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                            style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                                            <path d="m6 9 6 6 6-6" />
                                        </svg>
                                    </div>
                                </button>

                                {/* Items */}
                                {isOpen && items.map((item: AwiCheckItem) => {
                                    const s = statuses[item.id] ?? null;
                                    return (
                                        <div key={item.id} className={`px-4 py-2.5 border-b border-gray-50 ${s === 'fail' ? 'bg-red-50' : s === 'pass' ? 'bg-green-50/40' : ''}`}>
                                            <div className="flex items-start gap-2">
                                                <span className="shrink-0 text-[10px] font-mono text-gray-400 pt-0.5 w-12">{item.id}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-gray-800 leading-relaxed">{item.description}</p>
                                                    <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed italic">{item.premium}</p>
                                                </div>
                                                {/* Status buttons */}
                                                <div className="flex gap-0.5 shrink-0">
                                                    {STATUS_OPTS.map(opt => (
                                                        <button
                                                            key={opt.key}
                                                            title={opt.key === 'pass' ? 'Pass' : opt.key === 'warn' ? 'Warning' : opt.key === 'fail' ? 'Fail' : 'N/A'}
                                                            onClick={() => toggle(item.id, opt.key)}
                                                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold transition-colors ${s === opt.key ? opt.active : opt.cls}`}
                                                        >
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="shrink-0 border-t border-gray-200 px-4 py-2 flex gap-2 bg-gray-50">
                    <button
                        onClick={exportJson}
                        disabled={doneCount === 0}
                        className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        Export JSON
                    </button>
                    <button
                        onClick={resetAll}
                        className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </div>
        </div>
    );
};
