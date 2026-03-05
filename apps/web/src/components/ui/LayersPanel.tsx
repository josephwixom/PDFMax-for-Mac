'use client';

import React, { useState } from 'react';
import { useLayerStore, type MarkupLayer } from '@/store/useLayerStore';

const LAYER_COLORS = [
    '#6366f1', // indigo
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // emerald
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
    '#84cc16', // lime
];

const EyeIcon = ({ visible }: { visible: boolean }) => visible ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
    </svg>
) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

const LockIcon = ({ locked }: { locked: boolean }) => locked ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
);

export const LayersPanel: React.FC = () => {
    const { layers, activeLayerId, addLayer, removeLayer, toggleVisible, toggleLocked, renameLayer, setActiveLayer } = useLayerStore();
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState(LAYER_COLORS[0]);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameVal, setRenameVal] = useState('');

    const handleAdd = () => {
        if (!newName.trim()) return;
        addLayer(newName.trim(), newColor);
        setNewName('');
        setAdding(false);
    };

    const applyLayer = (layerName: string) => {
        const engine = (window as any).__pdfMaxEngine;
        if (engine?.setActiveObjectLayer) {
            engine.setActiveObjectLayer(layerName);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-200 bg-white shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Layers</p>
                    <button
                        onClick={() => setAdding(a => !a)}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                        title="Add layer"
                    >
                        + New
                    </button>
                </div>

                {/* New layer form */}
                {adding && (
                    <div className="flex flex-col gap-1.5 mb-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Layer name…"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleAdd();
                                if (e.key === 'Escape') setAdding(false);
                            }}
                            className="text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                        />
                        {/* Color picker row */}
                        <div className="flex flex-wrap gap-1">
                            {LAYER_COLORS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setNewColor(c)}
                                    className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${newColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                                    style={{ background: c }}
                                />
                            ))}
                        </div>
                        <div className="flex gap-1">
                            <button onClick={handleAdd} className="flex-1 text-xs py-1 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700">Add</button>
                            <button onClick={() => setAdding(false)} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">Cancel</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Layer list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {layers.map((layer: MarkupLayer) => (
                    <div
                        key={layer.id}
                        className={`rounded-lg border transition-all group ${activeLayerId === layer.id
                                ? 'border-blue-400 bg-blue-50'
                                : 'border-gray-200 bg-white hover:border-blue-200'
                            } ${!layer.visible ? 'opacity-50' : ''}`}
                    >
                        {renamingId === layer.id ? (
                            <div className="px-2 py-1.5">
                                <input
                                    autoFocus
                                    type="text"
                                    value={renameVal}
                                    onChange={e => setRenameVal(e.target.value)}
                                    onBlur={() => { if (renameVal.trim()) renameLayer(layer.id, renameVal.trim()); setRenamingId(null); }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { if (renameVal.trim()) renameLayer(layer.id, renameVal.trim()); setRenamingId(null); }
                                        if (e.key === 'Escape') setRenamingId(null);
                                    }}
                                    className="w-full text-xs border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none"
                                />
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                                {/* Color dot — click to set active layer */}
                                <button
                                    onClick={() => setActiveLayer(layer.id)}
                                    className="shrink-0"
                                    title={`Set "${layer.name}" as active drawing layer`}
                                >
                                    <div
                                        className={`w-3.5 h-3.5 rounded-full border-2 transition-transform ${activeLayerId === layer.id ? 'border-blue-600 scale-125' : 'border-transparent hover:scale-110'}`}
                                        style={{ background: layer.color }}
                                    />
                                </button>

                                {/* Layer name */}
                                <button
                                    className="flex-1 text-left min-w-0"
                                    onClick={() => setActiveLayer(layer.id)}
                                    onDoubleClick={() => { setRenamingId(layer.id); setRenameVal(layer.name); }}
                                    title="Click to activate · Double-click to rename"
                                >
                                    <span className={`text-xs truncate leading-tight block ${activeLayerId === layer.id ? 'font-semibold text-blue-700' : 'font-medium text-gray-700'}`}>
                                        {layer.name}
                                    </span>
                                </button>

                                {/* Actions */}
                                <div className="flex gap-0.5 items-center">
                                    {/* Apply to selection */}
                                    <button
                                        onClick={() => applyLayer(layer.name)}
                                        className="opacity-0 group-hover:opacity-100 text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 transition-all font-semibold"
                                        title="Move selected markup(s) to this layer"
                                    >
                                        Move
                                    </button>
                                    {/* Lock toggle */}
                                    <button
                                        onClick={() => toggleLocked(layer.id)}
                                        className={`p-1 rounded transition-colors ${layer.locked ? 'text-amber-500 hover:text-amber-700' : 'text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100'}`}
                                        title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                                    >
                                        <LockIcon locked={layer.locked} />
                                    </button>
                                    {/* Visibility toggle */}
                                    <button
                                        onClick={() => toggleVisible(layer.id)}
                                        className={`p-1 rounded transition-colors ${layer.visible ? 'text-gray-400 hover:text-gray-600' : 'text-gray-300 hover:text-gray-500'}`}
                                        title={layer.visible ? 'Hide layer' : 'Show layer'}
                                    >
                                        <EyeIcon visible={layer.visible} />
                                    </button>
                                    {/* Delete (not for default) */}
                                    {layer.id !== 'default' && (
                                        <button
                                            onClick={() => removeLayer(layer.id)}
                                            className="p-1 rounded opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                                            title="Delete layer"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer hint */}
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
                <p className="text-[10px] text-gray-400 leading-snug text-center">
                    Click dot = active layer for new markups<br />
                    Hover = Move selected / Lock / Hide
                </p>
            </div>
        </div>
    );
};
