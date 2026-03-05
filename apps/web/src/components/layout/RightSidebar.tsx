'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useToolStore } from '@/store/useToolStore';
import { useToolChestStore } from '@/store/useToolChestStore';
import { useLayerStore } from '@/store/useLayerStore';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import type { Comment } from '@pdfmax/shared';

/* ─── Types ─────────────────────────────────────────────────────── */
interface MarkupProperties {
    type: string;
    markupType?: string;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    opacity?: number;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
}

const HUMANIZE: Record<string, string> = {
    rect: 'Rectangle', path: 'Freehand', line: 'Line',
    polyline: 'Polyline', polygon: 'Polygon',
    'i-text': 'Text', text: 'Text', circle: 'Count Pin', group: 'Group',
    ellipse: 'Ellipse',
};
const humanType = (t: string, obj?: MarkupProperties) => {
    // For groups, check if there's a markupType hint
    if (t === 'group' && obj?.markupType) {
        const mt = obj.markupType as string;
        const map: Record<string, string> = { arrow: 'Arrow', callout: 'Callout', 'measure-count': 'Count Pin' };
        return map[mt] ?? HUMANIZE[t] ?? t;
    }
    return HUMANIZE[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
};

const TOOL_NAMES: Record<string, string> = {
    select: 'Select', pan: 'Pan', text: 'Text', rectangle: 'Rectangle',
    cloud: 'Freehand', polyline: 'Polyline', polygon: 'Polygon', callout: 'Callout',
    'measure-length': 'Length', 'measure-area': 'Area', 'measure-count': 'Count',
};

/* ─── Sub-components ─────────────────────────────────────────────── */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{children}</p>
);

const ColorInput = ({
    label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) => (
    <div>
        <SectionLabel>{label}</SectionLabel>
        <div className="flex items-center gap-2">
            <label className="relative cursor-pointer shrink-0">
                <input
                    type="color"
                    value={value.startsWith('#') ? value : '#000000'}
                    onChange={(e) => onChange(e.target.value)}
                    className="sr-only"
                />
                <div
                    className="w-7 h-7 rounded border-2 border-gray-300 shadow-sm hover:scale-110 transition-transform"
                    style={{ background: value }}
                />
            </label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                spellCheck={false}
                maxLength={9}
            />
        </div>
    </div>
);

/* ─── Main component ─────────────────────────────────────────────── */
export const RightSidebar = () => {
    const [isOpen, setIsOpen] = useState(true);
    const [selected, setSelected] = useState<MarkupProperties | null>(null);
    const [activeTab, setActiveTab] = useState<'properties' | 'toolchest'>('properties');
    const [newPresetName, setNewPresetName] = useState('');
    const [savingPreset, setSavingPreset] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const { activeTool, strokeColor, strokeWidth, fillColor, opacity: toolOpacity } = useToolStore();
    const { presets, addPreset, removePreset, applyPreset, renamePreset } = useToolChestStore();
    const { layers } = useLayerStore();

    // Track local editable values separately from read-only display
    const [localStroke, setLocalStroke] = useState('');
    const [localFill, setLocalFill] = useState('');
    const [localTransparentFill, setLocalTransparentFill] = useState(false);
    const [localStrokeWidth, setLocalStrokeWidth] = useState(3);
    const [localOpacity, setLocalOpacity] = useState(100);
    const [localText, setLocalText] = useState('');
    const [localFontSize, setLocalFontSize] = useState(16);
    const [localFontFamily, setLocalFontFamily] = useState('Arial');
    const updateLock = useRef(false);
    // Raw Fabric object — needed for CommentsPanel to read/write pdfmax_comments
    const selectedObjRef = useRef<any>(null);
    // Markup status + assignment
    const [localStatus, setLocalStatus] = useState<'open' | 'in-review' | 'resolved'>('open');
    const [localAssignee, setLocalAssignee] = useState('');
    const [localPriority, setLocalPriority] = useState('');
    const [localDueDate, setLocalDueDate] = useState('');
    const [localLayer, setLocalLayer] = useState('default');

    /* ── Listen for selection changes ─────────────────────────── */
    useEffect(() => {
        const handler = (e: Event) => {
            const obj = (e as CustomEvent).detail?.obj;
            if (!obj) {
                setSelected(null);
                return;
            }
            const props: MarkupProperties = {
                type: obj.type ?? 'object',
                markupType: obj.markupType,
                stroke: obj.stroke,
                strokeWidth: obj.strokeWidth,
                fill: typeof obj.fill === 'string' ? obj.fill : undefined,
                opacity: obj.opacity,
                left: obj.left != null ? Math.round(obj.left) : undefined,
                top: obj.top != null ? Math.round(obj.top) : undefined,
                width: obj.width != null ? Math.round(obj.getScaledWidth?.() ?? obj.width) : undefined,
                height: obj.height != null ? Math.round(obj.getScaledHeight?.() ?? obj.height) : undefined,
                text: obj.text,
                fontSize: obj.fontSize,
                fontFamily: obj.fontFamily,
            };
            selectedObjRef.current = obj;
            setSelected(props);
            // Sync local editable state (without triggering an update)
            updateLock.current = true;
            setLocalStroke(obj.stroke ?? strokeColor);
            const rawFill = typeof obj.fill === 'string' ? obj.fill : 'transparent';
            setLocalFill(rawFill);
            setLocalTransparentFill(rawFill === 'transparent' || rawFill === '');
            setLocalStrokeWidth(obj.strokeWidth ?? strokeWidth);
            setLocalOpacity(Math.round((obj.opacity ?? 1) * 100));
            setLocalText(obj.text ?? '');
            setLocalFontSize(obj.fontSize ?? 16);
            setLocalFontFamily(obj.fontFamily ?? 'Arial');
            setLocalStatus(obj.pdfmax_status ?? 'open');
            setLocalAssignee(obj.pdfmax_assignee ?? '');
            setLocalPriority(obj.pdfmax_priority ?? '');
            setLocalDueDate(obj.pdfmax_due_date ?? '');
            setLocalLayer(obj.pdfmaxLayer ?? 'default');
            updateLock.current = false;
        };
        window.addEventListener('pdfmax:selection-changed', handler);
        return () => window.removeEventListener('pdfmax:selection-changed', handler);
    }, [strokeColor, strokeWidth]);

    /* ── Dispatch style update to canvas ─────────────────────── */
    const dispatch = useCallback((patch: Record<string, string | number>) => {
        if (updateLock.current) return;
        window.dispatchEvent(new CustomEvent('pdfmax:update-markup', { detail: patch }));
        // Keep selected mirror up to date
        setSelected((prev) => prev ? { ...prev, ...patch } : prev);
    }, []);

    /* ── Collapsed state ─────────────────────────────────────── */
    if (!isOpen) {
        return (
            <div className="w-12 bg-gray-100 border-l border-gray-300 flex flex-col items-center py-4 shrink-0 shadow-sm z-10">
                <button
                    onClick={() => setIsOpen(true)}
                    className="p-2 hover:bg-gray-200 rounded text-gray-600 transition-colors"
                    title="Open Panel"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" x2="3" y1="12" y2="12" /></svg>
                </button>
            </div>
        );
    }

    return (
        <div className="w-64 bg-gray-50 border-l border-gray-300 flex flex-col shrink-0 shadow-sm z-10">
            {/* Header tabs */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
                <div className="flex gap-1">
                    <button
                        className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${activeTab === 'properties' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        onClick={() => setActiveTab('properties')}
                    >
                        Properties
                    </button>
                    <button
                        className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${activeTab === 'toolchest' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        onClick={() => setActiveTab('toolchest')}
                    >
                        Tool Chest
                    </button>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
                    title="Close"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
            </div>

            {/* ── PROPERTIES TAB ────────────────────────────────────── */}
            {activeTab === 'properties' && (
                <div className="flex-1 overflow-y-auto">
                    {!selected ? (
                        <div className="p-6 text-center text-gray-400 text-sm mt-4">
                            <svg className="mx-auto mb-3 text-gray-300" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="m13 13 6 6" /></svg>
                            Select a markup to see its properties
                        </div>
                    ) : (
                        <div className="p-3 space-y-4">
                            {/* Type badge */}
                            <div className="flex items-center justify-between">
                                <SectionLabel>Object</SectionLabel>
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono">
                                    {humanType(selected.type, selected)}
                                </span>
                            </div>

                            {/* Text content + font controls */}
                            {selected.text !== undefined && (
                                <div className="space-y-2">
                                    <div>
                                        <SectionLabel>Text</SectionLabel>
                                        <textarea
                                            value={localText}
                                            onChange={(e) => {
                                                setLocalText(e.target.value);
                                                dispatch({ text: e.target.value });
                                            }}
                                            rows={2}
                                            className="w-full text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-800 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            placeholder="Text content…"
                                        />
                                    </div>
                                    {/* Font size + family */}
                                    {selected.fontSize !== undefined && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <SectionLabel>Font Size</SectionLabel>
                                                <input
                                                    type="number"
                                                    min={6} max={144}
                                                    value={localFontSize}
                                                    onChange={(e) => {
                                                        const v = Number(e.target.value);
                                                        setLocalFontSize(v);
                                                        dispatch({ fontSize: v });
                                                    }}
                                                    className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                />
                                            </div>
                                            <div>
                                                <SectionLabel>Font</SectionLabel>
                                                <select
                                                    value={localFontFamily}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        setLocalFontFamily(v);
                                                        dispatch({ fontFamily: v });
                                                    }}
                                                    className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                >
                                                    {['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Helvetica'].map(f => (
                                                        <option key={f} value={f}>{f}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Stroke color */}
                            {selected.stroke !== undefined && (
                                <ColorInput
                                    label="Stroke Color"
                                    value={localStroke}
                                    onChange={(v) => {
                                        setLocalStroke(v);
                                        dispatch({ stroke: v });
                                    }}
                                />
                            )}

                            {/* Stroke width */}
                            {selected.strokeWidth !== undefined && (
                                <div>
                                    <SectionLabel>Stroke Width — {localStrokeWidth}px</SectionLabel>
                                    <input
                                        type="range"
                                        min={1} max={30}
                                        value={localStrokeWidth}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setLocalStrokeWidth(v);
                                            dispatch({ strokeWidth: v });
                                        }}
                                        className="w-full accent-blue-600"
                                    />
                                </div>
                            )}

                            {/* Fill color */}
                            {selected.fill !== undefined && (
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <SectionLabel>Fill Color</SectionLabel>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={localTransparentFill}
                                                onChange={(e) => {
                                                    const trans = e.target.checked;
                                                    setLocalTransparentFill(trans);
                                                    if (trans) {
                                                        dispatch({ fill: 'transparent' });
                                                    } else {
                                                        const restore = localFill === 'transparent' || localFill === '' ? '#ffffff' : localFill;
                                                        dispatch({ fill: restore });
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                            <span className="text-[10px] text-gray-500">None</span>
                                        </label>
                                    </div>
                                    {!localTransparentFill && (
                                        <ColorInput
                                            label=""
                                            value={localFill === 'transparent' || localFill === '' ? '#ffffff' : localFill}
                                            onChange={(v) => {
                                                setLocalFill(v);
                                                dispatch({ fill: v });
                                            }}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Opacity */}
                            {selected.opacity !== undefined && (
                                <div>
                                    <SectionLabel>Opacity — {localOpacity}%</SectionLabel>
                                    <input
                                        type="range"
                                        min={5} max={100}
                                        value={localOpacity}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setLocalOpacity(v);
                                            dispatch({ opacity: v / 100 });
                                        }}
                                        className="w-full accent-blue-600"
                                    />
                                </div>
                            )}

                            {/* Position / Size (read-only) */}
                            {(selected.left !== undefined || selected.top !== undefined) && (
                                <div>
                                    <SectionLabel>Position</SectionLabel>
                                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                        <div className="bg-white border border-gray-200 rounded px-2 py-1.5">
                                            <span className="text-gray-400 mr-1">X</span>
                                            <span className="text-gray-800">{selected.left ?? '—'}</span>
                                        </div>
                                        <div className="bg-white border border-gray-200 rounded px-2 py-1.5">
                                            <span className="text-gray-400 mr-1">Y</span>
                                            <span className="text-gray-800">{selected.top ?? '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {(selected.width !== undefined || selected.height !== undefined) && (
                                <div>
                                    <SectionLabel>Size</SectionLabel>
                                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                        <div className="bg-white border border-gray-200 rounded px-2 py-1.5">
                                            <span className="text-gray-400 mr-1">W</span>
                                            <span className="text-gray-800">{selected.width ?? '—'}</span>
                                        </div>
                                        <div className="bg-white border border-gray-200 rounded px-2 py-1.5">
                                            <span className="text-gray-400 mr-1">H</span>
                                            <span className="text-gray-800">{selected.height ?? '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Status + Assignment */}
                            <div className="pt-2 border-t border-gray-200 space-y-2">
                                <div>
                                    <SectionLabel>Status</SectionLabel>
                                    <div className="flex gap-1">
                                        {([
                                            { value: 'open', label: 'Open', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-400' },
                                            { value: 'in-review', label: 'In Review', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-400' },
                                            { value: 'resolved', label: 'Resolved', bg: 'bg-green-100', text: 'text-green-700', ring: 'ring-green-400' },
                                        ] as const).map(({ value, label, bg, text, ring }) => (
                                            <button
                                                key={value}
                                                onClick={() => {
                                                    setLocalStatus(value);
                                                    if (selectedObjRef.current) {
                                                        selectedObjRef.current.set({ pdfmax_status: value });
                                                        selectedObjRef.current.canvas?.requestRenderAll();
                                                        window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                                    }
                                                }}
                                                className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${localStatus === value
                                                    ? `${bg} ${text} ring-1 ${ring}`
                                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <SectionLabel>Assignee</SectionLabel>
                                    <input
                                        type="text"
                                        value={localAssignee}
                                        onChange={(e) => {
                                            setLocalAssignee(e.target.value);
                                            if (selectedObjRef.current) {
                                                selectedObjRef.current.set({ pdfmax_assignee: e.target.value });
                                            }
                                        }}
                                        onBlur={() => window.dispatchEvent(new CustomEvent('pdfmax:force-save'))}
                                        placeholder="Name or email…"
                                        className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    />
                                </div>
                                <div>
                                    <SectionLabel>Priority</SectionLabel>
                                    <div className="flex gap-1">
                                        {([
                                            { value: '', label: '—', bg: 'bg-gray-100', text: 'text-gray-500' },
                                            { value: 'low', label: 'Low', bg: 'bg-sky-100', text: 'text-sky-700' },
                                            { value: 'medium', label: 'Med', bg: 'bg-amber-100', text: 'text-amber-700' },
                                            { value: 'high', label: 'High', bg: 'bg-orange-100', text: 'text-orange-700' },
                                            { value: 'critical', label: 'Crit', bg: 'bg-red-100', text: 'text-red-700' },
                                        ] as const).map(({ value, label, bg, text }) => (
                                            <button
                                                key={value}
                                                onClick={() => {
                                                    setLocalPriority(value);
                                                    if (selectedObjRef.current) {
                                                        selectedObjRef.current.set({ pdfmax_priority: value || undefined });
                                                        window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                                    }
                                                }}
                                                className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${localPriority === value ? `${bg} ${text} ring-1 ring-current` : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <SectionLabel>Due Date</SectionLabel>
                                    <input
                                        type="date"
                                        value={localDueDate}
                                        onChange={(e) => {
                                            setLocalDueDate(e.target.value);
                                            if (selectedObjRef.current) {
                                                selectedObjRef.current.set({ pdfmax_due_date: e.target.value || undefined });
                                                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                            }
                                        }}
                                        className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    />
                                </div>
                            </div>

                            {/* Layer assignment */}
                            <div>
                                <SectionLabel>Layer</SectionLabel>
                                <select
                                    value={localLayer}
                                    onChange={(e) => {
                                        const layerName = e.target.value;
                                        setLocalLayer(layerName);
                                        const engine = (window as any).__pdfMaxEngine;
                                        if (engine?.setActiveObjectLayer) engine.setActiveObjectLayer(layerName);
                                        window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                    }}
                                    className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                >
                                    {layers.map(l => (
                                        <option key={l.id} value={l.id}>{l.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Sequence counter reset (only for count pins) */}
                            {(selected?.markupType === 'measure-count' || selected?.type === 'circle') && (
                                <div>
                                    <SectionLabel>Sequence</SectionLabel>
                                    <button
                                        onClick={() => {
                                            const engine = (window as any).__pdfMaxEngine;
                                            const page = (window as any).__pdfMaxCurrentPage ?? 1;
                                            if (engine?.resetCountSequence) engine.resetCountSequence(page);
                                            else window.dispatchEvent(new CustomEvent('pdfmax:reset-count', { detail: { page } }));
                                        }}
                                        className="w-full text-xs py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded font-medium text-amber-700 transition-colors"
                                    >
                                        ↺ Reset counter to 1
                                    </button>
                                </div>
                            )}

                            {/* Form Field properties — shown when a form field is selected */}
                            {(selected as any)?.pdfmax_formfield && (
                                <div className="space-y-2.5 pt-2 border-t border-emerald-100">
                                    <SectionLabel>Form Field</SectionLabel>

                                    <div>
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Field Name</span>
                                        <input
                                            type="text"
                                            defaultValue={(selected as any).pdfmax_formfield.name ?? ''}
                                            onBlur={(e) => {
                                                if (!selected) return;
                                                (selected as any).pdfmax_formfield = { ...(selected as any).pdfmax_formfield, name: e.target.value };
                                                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                            }}
                                            className="mt-1 w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                            placeholder="e.g. first_name"
                                        />
                                    </div>

                                    <div>
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Type</span>
                                        <select
                                            defaultValue={(selected as any).pdfmax_formfield.type ?? 'text'}
                                            onChange={(e) => {
                                                if (!selected) return;
                                                (selected as any).pdfmax_formfield = { ...(selected as any).pdfmax_formfield, type: e.target.value };
                                                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                            }}
                                            className="mt-1 w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                        >
                                            <option value="text">Text Field</option>
                                            <option value="checkbox">Checkbox</option>
                                            <option value="dropdown">Dropdown</option>
                                            <option value="radio">Radio Button</option>
                                        </select>
                                    </div>

                                    <div>
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Default</span>
                                        <input
                                            type="text"
                                            defaultValue={(selected as any).pdfmax_formfield.defaultValue ?? ''}
                                            onBlur={(e) => {
                                                if (!selected) return;
                                                (selected as any).pdfmax_formfield = { ...(selected as any).pdfmax_formfield, defaultValue: e.target.value };
                                                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                            }}
                                            className="mt-1 w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                            placeholder="Optional default value"
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500 font-medium">Required</span>
                                        <button
                                            onClick={() => {
                                                if (!selected) return;
                                                const ff = (selected as any).pdfmax_formfield;
                                                (selected as any).pdfmax_formfield = { ...ff, required: !ff.required };
                                                window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                            }}
                                            className={`relative w-10 h-5 rounded-full transition-colors ${(selected as any).pdfmax_formfield.required ? 'bg-emerald-500' : 'bg-gray-200'}`}
                                        >
                                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(selected as any).pdfmax_formfield.required ? 'left-5' : 'left-0.5'}`} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2 border-t border-gray-200">
                                {selectedObjRef.current && (
                                    <CommentsPanel
                                        fabricObj={selectedObjRef.current}
                                        onAddComment={(_comment: Comment) => {
                                            // Trigger markup save to persist the comment
                                            window.dispatchEvent(new CustomEvent('pdfmax:force-save'));
                                        }}
                                    />
                                )}
                            </div>

                            <div className="pt-2 border-t border-gray-200 space-y-2">
                                {/* Save to tool chest */}
                                <button
                                    onClick={() => setSavingPreset(true)}
                                    className="w-full text-xs py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded font-medium text-gray-600 transition-colors"
                                >
                                    + Save to Tool Chest
                                </button>
                                <p className="text-xs text-gray-400 text-center">
                                    Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-gray-600 font-mono text-xs">Del</kbd> to remove selected
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TOOL CHEST TAB ────────────────────────────────────── */}
            {activeTab === 'toolchest' && (
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

                    {/* Save current tool button */}
                    {savingPreset ? (
                        <div className="flex gap-1">
                            <input
                                autoFocus
                                type="text"
                                placeholder="Preset name…"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newPresetName.trim()) {
                                        addPreset(newPresetName.trim());
                                        setNewPresetName('');
                                        setSavingPreset(false);
                                    }
                                    if (e.key === 'Escape') setSavingPreset(false);
                                }}
                                className="flex-1 text-xs border border-blue-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <button
                                onClick={() => {
                                    if (newPresetName.trim()) {
                                        addPreset(newPresetName.trim());
                                        setNewPresetName('');
                                        setSavingPreset(false);
                                    }
                                }}
                                className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                            >✓</button>
                            <button onClick={() => setSavingPreset(false)} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200">✕</button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setSavingPreset(true)}
                            className="w-full py-2 text-xs font-semibold border-2 border-dashed border-gray-300 rounded text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                        >
                            + Save Current Tool ({TOOL_NAMES[activeTool] ?? activeTool})
                        </button>
                    )}

                    {/* Presets list */}
                    {presets.length === 0 ? (
                        <div className="text-center text-gray-400 text-xs py-8 leading-relaxed">
                            <svg className="mx-auto mb-3 text-gray-300" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" /></svg>
                            No saved presets yet.<br />
                            Set your tool styles, then click Save.
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <SectionLabel>Saved Presets ({presets.length})</SectionLabel>
                            {presets.map((preset) => (
                                <div
                                    key={preset.id}
                                    className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 hover:border-blue-300 transition-colors group"
                                >
                                    {renamingId === preset.id ? (
                                        <input
                                            autoFocus
                                            type="text"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onBlur={() => {
                                                if (renameValue.trim()) renamePreset(preset.id, renameValue.trim());
                                                setRenamingId(null);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    if (renameValue.trim()) renamePreset(preset.id, renameValue.trim());
                                                    setRenamingId(null);
                                                }
                                                if (e.key === 'Escape') setRenamingId(null);
                                            }}
                                            className="w-full text-xs border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none"
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            {/* Visual preview */}
                                            <div className="relative shrink-0">
                                                <div
                                                    className="w-7 h-7 rounded border-2 shrink-0"
                                                    style={{
                                                        background: preset.fillColor === 'transparent' ? 'repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 3px,#fff 3px,#fff 6px)' : preset.fillColor,
                                                        borderColor: preset.strokeColor,
                                                        borderWidth: Math.min(preset.strokeWidth, 4),
                                                    }}
                                                />
                                            </div>
                                            {/* Name + meta */}
                                            <button
                                                className="flex-1 text-left min-w-0"
                                                onClick={() => applyPreset(preset.id)}
                                                title={`Click to apply: ${preset.name}`}
                                            >
                                                <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{preset.name}</p>
                                                <p className="text-[10px] text-gray-400 leading-tight">
                                                    {TOOL_NAMES[preset.tool] ?? preset.tool} · {preset.strokeWidth}px ·
                                                    <span className="inline-block w-2 h-2 rounded-full ml-1 align-middle" style={{ background: preset.strokeColor }} />
                                                </p>
                                            </button>
                                            {/* Actions */}
                                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => { setRenamingId(preset.id); setRenameValue(preset.name); }}
                                                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                                                    title="Rename"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                </button>
                                                <button
                                                    onClick={() => removePreset(preset.id)}
                                                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                                                    title="Delete"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Current tool indicator */}
                    <div className="mt-auto pt-3 border-t border-gray-200">
                        <SectionLabel>Active Tool</SectionLabel>
                        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1.5">
                            <div
                                className="w-4 h-4 rounded border-2 shrink-0"
                                style={{ background: fillColor === 'transparent' ? 'transparent' : fillColor, borderColor: strokeColor, borderWidth: Math.min(strokeWidth, 3) }}
                            />
                            <span className="text-xs text-gray-700 font-medium">{TOOL_NAMES[activeTool] ?? activeTool}</span>
                            <span className="ml-auto text-xs font-mono text-gray-400">{strokeWidth}px</span>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center mt-2">Double-click a preset name to rename</p>
                    </div>
                </div>
            )}

            {/* Save to chest modal (from Properties tab) */}
            {savingPreset && activeTab === 'properties' && (
                <div className="p-3 border-t border-gray-200 bg-white">
                    <p className="text-xs text-gray-600 mb-1.5 font-semibold">Name this preset:</p>
                    <div className="flex gap-1">
                        <input
                            autoFocus
                            type="text"
                            placeholder="e.g. Red Cloud 3pt"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newPresetName.trim()) {
                                    addPreset(newPresetName.trim());
                                    setNewPresetName('');
                                    setSavingPreset(false);
                                }
                                if (e.key === 'Escape') setSavingPreset(false);
                            }}
                            className="flex-1 text-xs border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                            onClick={() => {
                                if (newPresetName.trim()) {
                                    addPreset(newPresetName.trim());
                                    setNewPresetName('');
                                    setSavingPreset(false);
                                }
                            }}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                        >✓</button>
                        <button
                            onClick={() => setSavingPreset(false)}
                            className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200"
                        >✕</button>
                    </div>
                </div>
            )}
        </div>
    );
};
