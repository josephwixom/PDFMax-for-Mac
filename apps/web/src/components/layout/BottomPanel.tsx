'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkupStatusBadge } from '@/components/studio/MarkupStatusBadge';
import { useCollabStore } from '@/store/useCollabStore';
import { updateMarkupStatus } from '@/lib/studioApi';
import type { MarkupStatus } from '@pdfmax/shared';

interface MarkupRow {
    page: number;
    index: number;
    type: string;
    color: string;
    strokeWidth?: number;
    text?: string;
    sessionMarkupId?: string;
    authorColor?: string;
    status?: MarkupStatus;
    visible: boolean;
    pdfmax_status?: string;
    pdfmax_assignee?: string;
    pdfmax_due_date?: string;
    pdfmax_priority?: string;
}

interface MeasurementRow {
    page: number;
    index: number;
    measureType: string;
    measureValue: string;
    stroke?: string;
}

const TYPE_LABELS: Record<string, string> = {
    rect: 'Rectangle',
    path: 'Freehand',
    line: 'Line',
    polyline: 'Polyline',
    polygon: 'Polygon',
    'i-text': 'Text',
    text: 'Text',
    circle: 'Count Pin',
    group: 'Group',
};

const MEASURE_LABELS: Record<string, string> = {
    'measure-length': 'Length',
    'measure-area': 'Area',
    'measure-perimeter': 'Perimeter',
    'measure-count': 'Count',
    'measure-volume': 'Volume',
};

const humanType = (t: string) => TYPE_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
const humanMeasure = (t: string) => MEASURE_LABELS[t] ?? t;

/** Parse a measureValue string like "12.50 ft" → { value: 12.5, unit: 'ft' } */
const parseValueAndUnit = (s: string): { value: number; unit: string } => {
    const m = s.match(/^([\d.]+)\s*(.*?)$/);
    return m ? { value: parseFloat(m[1]), unit: m[2].trim() } : { value: 0, unit: '' };
};

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 250;

type TabId = 'markups' | 'measurements';

export const BottomPanel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [activeTab, setActiveTab] = useState<TabId>('markups');
    const [markups, setMarkups] = useState<MarkupRow[]>([]);
    const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [batchAssignee, setBatchAssignee] = useState('');
    const [batchStatus, setBatchStatus] = useState('');
    const [batchPriority, setBatchPriority] = useState('');
    const [batchDueDate, setBatchDueDate] = useState('');
    const { activeSession, sessionMarkups, updateSessionMarkupStatus } = useCollabStore();

    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { startY: e.clientY, startHeight: height };

        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const delta = dragRef.current.startY - ev.clientY;
            setHeight(Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta));
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [height]);

    // On engine-ready, request a fresh broadcast
    useEffect(() => {
        const onEngineReady = () => {
            window.dispatchEvent(new Event('pdfmax:request-markups-broadcast'));
        };
        window.addEventListener('pdfmax:engine-ready', onEngineReady);
        window.dispatchEvent(new Event('pdfmax:request-markups-broadcast'));
        return () => window.removeEventListener('pdfmax:engine-ready', onEngineReady);
    }, []);

    // Listen for live markup updates
    useEffect(() => {
        const handler = (e: Event) => {
            const raw: Array<{
                page: number;
                type: string;
                stroke?: string;
                fill?: string;
                strokeWidth?: number;
                text?: string;
            }> = (e as CustomEvent).detail?.markups ?? [];

            const pageCounters: Record<number, number> = {};
            const rows: MarkupRow[] = raw.map((m) => {
                const idx = pageCounters[m.page] ?? 0;
                pageCounters[m.page] = idx + 1;
                return {
                    page: m.page,
                    index: idx,
                    type: m.type,
                    color: m.stroke ?? m.fill ?? '#888',
                    strokeWidth: m.strokeWidth,
                    text: m.text,
                    visible: (m as any).visible !== false,
                    pdfmax_status: (m as any).pdfmax_status,
                    pdfmax_assignee: (m as any).pdfmax_assignee,
                    pdfmax_due_date: (m as any).pdfmax_due_date,
                    pdfmax_priority: (m as any).pdfmax_priority,
                };
            });
            setMarkups(rows);
        };

        window.addEventListener('pdfmax:markups-updated', handler);
        return () => window.removeEventListener('pdfmax:markups-updated', handler);
    }, []);

    // Listen for measurement updates
    useEffect(() => {
        const handler = (e: Event) => {
            const raw: Array<{
                page: number;
                index: number;
                measureType: string;
                measureValue: string;
                stroke?: string;
            }> = (e as CustomEvent).detail?.measurements ?? [];
            setMeasurements(raw);
        };
        window.addEventListener('pdfmax:measurements-updated', handler);
        return () => window.removeEventListener('pdfmax:measurements-updated', handler);
    }, []);

    const handleRowClick = (row: MarkupRow, rowIndex: number) => {
        setSelectedIndex(rowIndex);
        window.dispatchEvent(
            new CustomEvent('pdfmax:select-markup', {
                detail: { page: row.page, index: row.index },
            })
        );
    };

    const handleToggleVisible = (row: MarkupRow, rowIndex: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const nextVisible = !row.visible;
        setMarkups(prev => prev.map((m, i) => i === rowIndex ? { ...m, visible: nextVisible } : m));
        window.dispatchEvent(
            new CustomEvent('pdfmax:toggle-markup-visibility', {
                detail: { page: row.page, index: row.index, visible: nextVisible },
            })
        );
    };

    const handleCheckRow = (rowIndex: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedRows(prev => {
            const next = new Set(prev);
            next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
            return next;
        });
    };

    const handleBatchAssign = () => {
        const rows = markups.filter((_, i) => selectedRows.has(i));
        if (rows.length === 0) return;
        window.dispatchEvent(new CustomEvent('pdfmax:batch-assign-markups', {
            detail: {
                targets: rows.map(r => ({ page: r.page, index: r.index })),
                status: batchStatus || undefined,
                assignee: batchAssignee || undefined,
                priority: batchPriority || undefined,
                dueDate: batchDueDate || undefined,
            },
        }));
        // Optimistically update local state
        setMarkups(prev => prev.map((m, i) => selectedRows.has(i) ? {
            ...m,
            pdfmax_status: batchStatus || m.pdfmax_status,
            pdfmax_assignee: batchAssignee || m.pdfmax_assignee,
            pdfmax_priority: batchPriority || m.pdfmax_priority,
            pdfmax_due_date: batchDueDate || m.pdfmax_due_date,
        } : m));
        setSelectedRows(new Set());
        setBatchAssignee(''); setBatchStatus(''); setBatchPriority(''); setBatchDueDate('');
    };

    const exportMarkupsCSV = () => {
        if (markups.length === 0) return;
        const header = 'Row,Type,Page,Color,Stroke Width,Text\n';
        const body = markups
            .map((m, i) =>
                [i + 1, humanType(m.type), m.page, m.color, m.strokeWidth ?? '', m.text ?? '']
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                    .join(',')
            )
            .join('\n');
        const blob = new Blob([header + body], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pdfmax-markups-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportMeasurementsCSV = () => {
        if (measurements.length === 0) return;
        const header = 'Row,Type,Page,Value,Unit,Color\n';
        const body = measurements
            .map((m, i) => {
                const { value, unit } = parseValueAndUnit(m.measureValue);
                return [i + 1, humanMeasure(m.measureType), m.page, value, unit, m.stroke ?? '']
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                    .join(',');
            })
            .join('\n');
        // Compute actual sums for totals row
        const lengthRows = measurements.filter(m => m.measureType === 'measure-length' || m.measureType === 'measure-perimeter');
        const areaRows = measurements.filter(m => m.measureType === 'measure-area');
        const countRows = measurements.filter(m => m.measureType === 'measure-count');
        const totalLen = lengthRows.reduce((s, m) => s + parseValueAndUnit(m.measureValue).value, 0);
        const totalArea = areaRows.reduce((s, m) => s + parseValueAndUnit(m.measureValue).value, 0);
        const lenUnit = lengthRows[0] ? parseValueAndUnit(lengthRows[0].measureValue).unit : '';
        const areaUnit = areaRows[0] ? parseValueAndUnit(areaRows[0].measureValue).unit : '';
        const totalsRow = [
            `\n"","TOTALS","All pages"`,
            lengthRows.length > 0 ? `"${totalLen.toFixed(2)} ${lenUnit} (${lengthRows.length} length${lengthRows.length !== 1 ? 's' : ''})","${lenUnit}"` : `"",""`,
            `"${countRows.length} pin${countRows.length !== 1 ? 's' : ''}"`,
            ...(areaRows.length > 0 ? [`"Total area: ${totalArea.toFixed(2)} ${areaUnit}"`] : []),
        ].join(',');
        const blob = new Blob([header + body + totalsRow], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pdfmax-measurements-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ── Collapsed state ─────────────────────────────────────────────────
    if (!isOpen) {
        return (
            <div
                className="h-8 bg-gray-100 border-t border-gray-300 flex items-center px-4 shrink-0 shadow-sm z-20 cursor-pointer hover:bg-gray-200 transition-colors select-none"
                onClick={() => setIsOpen(true)}
            >
                <button className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                    Markups List
                    {markups.length > 0 && (
                        <span className="ml-1 bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                            {markups.length}
                        </span>
                    )}
                    {measurements.length > 0 && (
                        <span className="ml-1 bg-green-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                            {measurements.length} meas.
                        </span>
                    )}
                </button>
            </div>
        );
    }

    // Compute totals for measurements
    const lengthMeasures = measurements.filter(m => m.measureType === 'measure-length' || m.measureType === 'measure-perimeter');
    const areaMeasures = measurements.filter(m => m.measureType === 'measure-area');
    const countMeasures = measurements.filter(m => m.measureType === 'measure-count');
    const volumeMeasures = measurements.filter(m => m.measureType === 'measure-volume');

    const sumLength = lengthMeasures.reduce((acc, m) => acc + parseValueAndUnit(m.measureValue).value, 0);
    const sumArea = areaMeasures.reduce((acc, m) => acc + parseValueAndUnit(m.measureValue).value, 0);
    const totalCountPins = countMeasures.length;
    const lengthUnit = lengthMeasures[0] ? parseValueAndUnit(lengthMeasures[0].measureValue).unit : '';
    const areaUnit = areaMeasures[0] ? parseValueAndUnit(areaMeasures[0].measureValue).unit : '';

    return (
        <div
            ref={panelRef}
            className="bg-white border-t border-gray-300 flex flex-col shrink-0 z-20 shadow-lg relative"
            style={{ height: `${height}px` }}
        >
            {/* Draggable resize handle */}
            <div
                className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize bg-transparent hover:bg-blue-400 transition-colors z-30 group"
                onMouseDown={onHandleMouseDown}
            >
                <div className="absolute inset-x-0 top-0 h-px bg-gray-300 group-hover:bg-blue-400 transition-colors" />
            </div>

            {/* Header with tabs */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0 mt-0.5">
                {/* Tab buttons */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setActiveTab('markups')}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${activeTab === 'markups'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                        Markups
                        {markups.length > 0 && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${activeTab === 'markups' ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700'}`}>
                                {markups.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('measurements')}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${activeTab === 'measurements'
                            ? 'bg-green-600 text-white'
                            : 'text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="m3 15 4-8 4 5 4-3 4 6" /></svg>
                        Measurements
                        {measurements.length > 0 && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${activeTab === 'measurements' ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700'}`}>
                                {measurements.length}
                            </span>
                        )}
                    </button>
                </div>

                <div className="flex items-center gap-1">
                    {/* Tab-specific CSV export */}
                    {activeTab === 'markups' && (
                        <button
                            onClick={exportMarkupsCSV}
                            className="p-1.5 hover:bg-gray-200 rounded text-gray-500 transition-colors"
                            title="Export markups to CSV"
                            disabled={markups.length === 0}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        </button>
                    )}
                    {activeTab === 'measurements' && (
                        <button
                            onClick={exportMeasurementsCSV}
                            className="p-1.5 hover:bg-gray-200 rounded text-gray-500 transition-colors"
                            title="Export measurements to CSV"
                            disabled={measurements.length === 0}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        </button>
                    )}
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1.5 hover:bg-gray-200 rounded text-gray-500 transition-colors"
                        title="Collapse"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                </div>
            </div>

            {/* ── Markups Tab ─────────────────────────────────────────── */}
            {activeTab === 'markups' && (
                <div className="flex-1 overflow-auto bg-white">
                    {markups.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="m13 13 6 6" /></svg>
                            <span>No markups yet — draw something!</span>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full">
                            {/* Batch assignment bar */}
                            {selectedRows.size > 0 && (
                                <div className="bg-indigo-50 border-b border-indigo-200 px-3 py-2 flex flex-wrap items-center gap-2 shrink-0">
                                    <span className="text-xs font-semibold text-indigo-700">{selectedRows.size} selected</span>
                                    <select value={batchStatus} onChange={e => setBatchStatus(e.target.value)}
                                        className="text-xs border border-indigo-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none">
                                        <option value="">Status…</option>
                                        <option value="open">Open</option>
                                        <option value="in-review">In Review</option>
                                        <option value="resolved">Resolved</option>
                                    </select>
                                    <input type="text" value={batchAssignee} onChange={e => setBatchAssignee(e.target.value)}
                                        placeholder="Assignee…" className="text-xs border border-indigo-300 rounded px-2 py-1 bg-white w-28 focus:outline-none" />
                                    <select value={batchPriority} onChange={e => setBatchPriority(e.target.value)}
                                        className="text-xs border border-indigo-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none">
                                        <option value="">Priority…</option>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                        <option value="critical">Critical</option>
                                    </select>
                                    <input type="date" value={batchDueDate} onChange={e => setBatchDueDate(e.target.value)}
                                        className="text-xs border border-indigo-300 rounded px-2 py-1 bg-white focus:outline-none" />
                                    <button onClick={handleBatchAssign}
                                        className="text-xs px-3 py-1 bg-indigo-600 text-white rounded font-semibold hover:bg-indigo-700 transition-colors">
                                        Apply
                                    </button>
                                    <button onClick={() => setSelectedRows(new Set())}
                                        className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors">Clear</button>
                                </div>
                            )}
                            <table className="w-full text-left border-collapse text-sm">
                                <thead className="bg-gray-100 sticky top-0 shadow-sm">
                                    <tr>
                                        <th className="p-2 border-b border-r border-gray-200 w-6 text-center">
                                            <input type="checkbox" className="w-3 h-3 accent-indigo-600"
                                                checked={selectedRows.size === markups.length && markups.length > 0}
                                                onChange={() => setSelectedRows(prev => prev.size === markups.length ? new Set() : new Set(markups.map((_, i) => i)))}
                                            />
                                        </th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-500 w-7 text-center" title="Visibility">👁</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-500 w-8 text-center">#</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600">Type</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-16">Page</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-20">Color</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-24">Status</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-20">Priority</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-28">Assignee</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-24">Due</th>
                                        {activeSession && <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-28">Rev. Status</th>}
                                        <th className="p-2 border-b border-gray-200 font-medium text-gray-600">Text</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {markups.map((markup, i) => (
                                        <tr
                                            key={`${markup.page}-${markup.index}-${i}`}
                                            onClick={() => handleRowClick(markup, i)}
                                            className={`border-b border-gray-100 cursor-pointer transition-colors ${selectedRows.has(i) ? 'bg-indigo-50' :
                                                !markup.visible ? 'opacity-40' :
                                                    selectedIndex === i ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'hover:bg-gray-50'
                                                }`}
                                        >
                                            {/* Checkbox */}
                                            <td className="p-1 border-r border-gray-100 text-center" onClick={e => handleCheckRow(i, e)}>
                                                <input type="checkbox" className="w-3 h-3 accent-indigo-600" checked={selectedRows.has(i)} onChange={() => { }} />
                                            </td>
                                            {/* Visibility toggle */}
                                            <td className="p-1 border-r border-gray-100 text-center" onClick={(e) => handleToggleVisible(markup, i, e)}>
                                                <button
                                                    className={`w-5 h-5 flex items-center justify-center mx-auto rounded transition-colors hover:bg-gray-200 ${markup.visible ? 'text-gray-400' : 'text-gray-300'}`}
                                                    title={markup.visible ? 'Hide markup' : 'Show markup'}
                                                >
                                                    {markup.visible ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                                                    ) : (
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="p-2 border-r border-gray-100 text-center text-gray-400 text-xs">{i + 1}</td>
                                            <td className="p-2 border-r border-gray-100 font-medium text-gray-800">{humanType(markup.type)}</td>
                                            <td className="p-2 border-r border-gray-100 text-gray-500 text-center">{markup.page}</td>
                                            <td className="p-2 border-r border-gray-100">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 rounded border border-gray-300 shrink-0" style={{ backgroundColor: markup.color }} />
                                                </div>
                                            </td>
                                            {/* Status chip */}
                                            <td className="p-2 border-r border-gray-100">
                                                {markup.pdfmax_status ? (
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${markup.pdfmax_status === 'resolved' ? 'bg-green-100 text-green-700' :
                                                        markup.pdfmax_status === 'in-review' ? 'bg-amber-100 text-amber-700' :
                                                            'bg-blue-100 text-blue-700'
                                                        }`}>{markup.pdfmax_status}</span>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            {/* Priority badge */}
                                            <td className="p-2 border-r border-gray-100">
                                                {markup.pdfmax_priority ? (
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${markup.pdfmax_priority === 'critical' ? 'bg-red-100 text-red-700' :
                                                        markup.pdfmax_priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                                            markup.pdfmax_priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                                'bg-sky-100 text-sky-700'
                                                        }`}>{markup.pdfmax_priority}</span>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            {/* Assignee */}
                                            <td className="p-2 border-r border-gray-100 text-xs text-gray-600 truncate max-w-[120px]">
                                                {markup.pdfmax_assignee || <span className="text-gray-300">—</span>}
                                            </td>
                                            {/* Due date — red if overdue */}
                                            <td className={`p-2 border-r border-gray-100 text-xs ${markup.pdfmax_due_date && new Date(markup.pdfmax_due_date) < new Date() && markup.pdfmax_status !== 'resolved'
                                                ? 'text-red-600 font-semibold' : 'text-gray-500'
                                                }`}>
                                                {markup.pdfmax_due_date || <span className="text-gray-300">—</span>}
                                            </td>
                                            {activeSession && (
                                                <td className="p-2 border-r border-gray-100" onClick={e => e.stopPropagation()}>
                                                    {markup.sessionMarkupId ? (
                                                        <MarkupStatusBadge
                                                            status={markup.status ?? 'open'}
                                                            onChange={async (s) => {
                                                                updateSessionMarkupStatus(markup.sessionMarkupId!, s);
                                                                await updateMarkupStatus(markup.sessionMarkupId!, s);
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="text-gray-300 text-xs">—</span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="p-2 text-xs text-gray-600 truncate max-w-[200px]">
                                                {markup.text ?? <span className="text-gray-300">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Measurements Tab ─────────────────────────────────────── */}
            {activeTab === 'measurements' && (
                <div className="flex-1 overflow-auto bg-white flex flex-col">
                    {measurements.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 text-gray-400 text-sm gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m3 15 4-8 4 5 4-3 4 6" /></svg>
                            <span>No measurements yet — use Length, Area, Perimeter, or Count tools.</span>
                        </div>
                    ) : (
                        <div className="flex flex-col flex-1">
                            <table className="w-full text-left border-collapse text-sm flex-1">
                                <thead className="bg-gray-100 sticky top-0 shadow-sm">
                                    <tr>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-500 w-8 text-center">#</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600">Type</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-16">Page</th>
                                        <th className="p-2 border-b border-r border-gray-200 font-medium text-gray-600 w-12">Color</th>
                                        <th className="p-2 border-b border-gray-200 font-medium text-gray-600">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {measurements.map((m, i) => (
                                        <tr
                                            key={`${m.page}-${m.index}-${i}`}
                                            className="border-b border-gray-100 hover:bg-green-50 transition-colors"
                                        >
                                            <td className="p-2 border-r border-gray-100 text-center text-gray-400 text-xs">{i + 1}</td>
                                            <td className="p-2 border-r border-gray-100 font-medium text-gray-800">
                                                <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-semibold ${m.measureType === 'measure-area'
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : m.measureType === 'measure-perimeter'
                                                        ? 'bg-purple-100 text-purple-700'
                                                        : m.measureType === 'measure-count'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-green-100 text-green-700'
                                                    }`}>
                                                    {humanMeasure(m.measureType)}
                                                </span>
                                            </td>
                                            <td className="p-2 border-r border-gray-100 text-gray-500 text-center">{m.page}</td>
                                            <td className="p-2 border-r border-gray-100">
                                                {m.stroke ? (
                                                    <div
                                                        className="w-5 h-5 rounded border border-gray-200 mx-auto"
                                                        style={{ backgroundColor: m.stroke }}
                                                        title={m.stroke}
                                                    />
                                                ) : <span className="text-gray-300 text-xs block text-center">—</span>}
                                            </td>
                                            <td className="p-2 font-mono text-sm text-gray-800 font-semibold">
                                                {m.measureType === 'measure-count'
                                                    ? `Pin #${m.measureValue}`
                                                    : m.measureValue}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Totals row */}
                            <div className="border-t-2 border-gray-300 bg-gray-50 px-4 py-2 flex items-center gap-4 text-xs text-gray-600 shrink-0 flex-wrap">
                                <span className="font-semibold text-gray-700">Totals:</span>
                                {lengthMeasures.length > 0 && (
                                    <span className="text-green-700 font-semibold">
                                        📏 {sumLength % 1 === 0 ? sumLength : sumLength.toFixed(2)}{lengthUnit && ` ${lengthUnit}`} ({lengthMeasures.length} seg{lengthMeasures.length !== 1 ? 's' : ''})
                                    </span>
                                )}
                                {areaMeasures.length > 0 && (
                                    <span className="text-blue-700 font-semibold">
                                        ⬛ {sumArea % 1 === 0 ? sumArea : sumArea.toFixed(2)}{areaUnit && ` ${areaUnit}`} ({areaMeasures.length} area{areaMeasures.length !== 1 ? 's' : ''})
                                    </span>
                                )}
                                {countMeasures.length > 0 && (
                                    <span className="text-red-700 font-semibold">📍 {totalCountPins} count pin{totalCountPins !== 1 ? 's' : ''}</span>
                                )}
                                {volumeMeasures.length > 0 && (
                                    <span className="text-violet-700 font-semibold">⬜ {volumeMeasures.length} volume measurement{volumeMeasures.length !== 1 ? 's' : ''}</span>
                                )}
                                {measurements.length === 0 && <span className="text-gray-400">—</span>}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
