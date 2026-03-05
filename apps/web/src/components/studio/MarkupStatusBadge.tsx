'use client';

import React from 'react';
import type { MarkupStatus } from '@pdfmax/shared';

const STATUS_CONFIG: Record<MarkupStatus, { label: string; emoji: string; bg: string; text: string }> = {
    open: { label: 'Open', emoji: '🟡', bg: 'bg-yellow-100', text: 'text-yellow-800' },
    accepted: { label: 'Accepted', emoji: '✅', bg: 'bg-green-100', text: 'text-green-800' },
    rejected: { label: 'Rejected', emoji: '❌', bg: 'bg-red-100', text: 'text-red-800' },
    question: { label: 'Question', emoji: '❓', bg: 'bg-purple-100', text: 'text-purple-800' },
};

interface MarkupStatusBadgeProps {
    status: MarkupStatus;
    onChange?: (status: MarkupStatus) => void;
    readonly?: boolean;
}

export function MarkupStatusBadge({ status, onChange, readonly = false }: MarkupStatusBadgeProps) {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;

    if (readonly || !onChange) {
        return (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                {cfg.emoji} {cfg.label}
            </span>
        );
    }

    return (
        <select
            value={status}
            onChange={(e) => onChange(e.target.value as MarkupStatus)}
            className={`text-[10px] font-semibold border-0 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none ${cfg.bg} ${cfg.text}`}
            onClick={(e) => e.stopPropagation()}
        >
            {(Object.keys(STATUS_CONFIG) as MarkupStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].emoji} {STATUS_CONFIG[s].label}</option>
            ))}
        </select>
    );
}
