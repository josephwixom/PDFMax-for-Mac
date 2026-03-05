'use client';

import React, { useEffect } from 'react';

interface KeyboardHelpModalProps {
    onClose: () => void;
}

const SHORTCUTS = [
    {
        group: 'General',
        items: [
            { keys: ['Ctrl', 'Z'], label: 'Undo' },
            { keys: ['Ctrl', 'Y'], label: 'Redo' },
            { keys: ['Ctrl', 'A'], label: 'Select all markups' },
            { keys: ['Delete'], label: 'Delete selected markup' },
            { keys: ['Escape'], label: 'Deselect / cancel drawing' },
            { keys: ['?'], label: 'Open this help panel' },
        ],
    },
    {
        group: 'Navigation',
        items: [
            { keys: ['Scroll'], label: 'Zoom in / out' },
            { keys: ['Middle-click', 'drag'], label: 'Pan canvas' },
            { keys: ['+'], label: 'Zoom in' },
            { keys: ['-'], label: 'Zoom out' },
            { keys: ['0'], label: 'Reset zoom to 100%' },
        ],
    },
    {
        group: 'Drawing Tools',
        items: [
            { keys: ['Dbl-click'], label: 'Finish polyline / polygon / measure' },
            { keys: ['Enter'], label: 'Finish polyline / polygon / measure' },
            { keys: ['Escape'], label: 'Cancel current drawing' },
        ],
    },
    {
        group: 'Selection',
        items: [
            { keys: ['Click'], label: 'Select markup' },
            { keys: ['Del'], label: 'Delete selected' },
            { keys: ['Right-click'], label: 'Context menu (duplicate, style, delete)' },
        ],
    },
];

const Kbd = ({ k }: { k: string }) => (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-gray-300 bg-gray-100 text-gray-700 font-mono text-[11px] shadow-sm whitespace-nowrap">
        {k}
    </kbd>
);

export const KeyboardHelpModal = ({ onClose }: KeyboardHelpModalProps) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
                        </svg>
                        <h2 className="font-bold text-gray-800 text-base">Keyboard Shortcuts</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto p-5 grid grid-cols-2 gap-5">
                    {SHORTCUTS.map((section) => (
                        <div key={section.group}>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{section.group}</p>
                            <div className="space-y-1.5">
                                {section.items.map((item) => (
                                    <div key={item.label} className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-gray-600 min-w-0 leading-tight">{item.label}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.keys.map((k, i) => (
                                                <React.Fragment key={k}>
                                                    {i > 0 && <span className="text-gray-400 text-[10px]">+</span>}
                                                    <Kbd k={k} />
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                    <p className="text-[11px] text-gray-400">Press <Kbd k="?" /> or <Kbd k="Esc" /> to close</p>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};
