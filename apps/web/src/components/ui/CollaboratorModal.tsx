'use client';

import React, { useState } from 'react';
import { Reviewer } from '@pdfmax/shared';
import { useCollabStore } from '@/store/useCollabStore';

const PRESET_COLORS = [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
];

interface CollaboratorModalProps {
    onClose: () => void;
    onConfirm: (reviewer: Reviewer) => void;
}

export const CollaboratorModal = ({ onClose, onConfirm }: CollaboratorModalProps) => {
    const existingReviewer = useCollabStore(s => s.reviewer);
    const [name, setName] = useState(existingReviewer?.name ?? '');
    const [color, setColor] = useState(existingReviewer?.color ?? PRESET_COLORS[0]);

    const initials = name.trim()
        ? name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('')
        : '?';

    const handleConfirm = () => {
        if (!name.trim()) return;
        const reviewer: Reviewer = {
            id: existingReviewer?.id ?? crypto.randomUUID(),
            name: name.trim(),
            color,
        };
        onConfirm(reviewer);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-80 p-6 flex flex-col gap-5" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div>
                    <h2 className="text-gray-900 font-semibold text-lg">Collaborate</h2>
                    <p className="text-gray-500 text-sm mt-0.5">Set your name and color so others can identify your annotations.</p>
                </div>

                {/* Preview badge */}
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0"
                        style={{ background: color }}
                    >
                        {initials}
                    </div>
                    <span className="text-gray-700 text-sm font-medium">{name.trim() || 'Your name'}</span>
                </div>

                {/* Name input */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Name</label>
                    <input
                        autoFocus
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                        placeholder="Your name"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* Color picker */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Color</label>
                    <div className="flex gap-2 flex-wrap">
                        {PRESET_COLORS.map(c => (
                            <button
                                key={c}
                                className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                                style={{
                                    background: c,
                                    boxShadow: color === c ? `0 0 0 3px white, 0 0 0 5px ${c}` : undefined,
                                }}
                                onClick={() => setColor(c)}
                                title={c}
                            />
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 justify-end">
                    <button
                        className="px-4 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-4 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleConfirm}
                        disabled={!name.trim()}
                    >
                        Start collaborating
                    </button>
                </div>
            </div>
        </div>
    );
};
