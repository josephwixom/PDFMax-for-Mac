'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useToolChestStore } from '@/store/useToolChestStore';

interface MenuTarget {
    x: number;
    y: number;
    obj: any;
}

interface MenuItem {
    label: string;
    icon: React.ReactNode;
    action: () => void;
    danger?: boolean;
    divider?: boolean;
}

/* ── Tiny icon helpers ──────────────────────────────────────────── */
const Icon = ({ d }: { d: string | string[] }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
    </svg>
);

export const ContextMenu = () => {
    const [target, setTarget] = useState<MenuTarget | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const styleCopied = useRef<Record<string, any> | null>(null);
    const { addPreset } = useToolChestStore();

    /* ── Open on right-click event ─────────────────────────────── */
    useEffect(() => {
        const handler = (e: Event) => {
            const { x, y, obj } = (e as CustomEvent).detail ?? {};
            setTarget({ x, y, obj });
        };
        window.addEventListener('pdfmax:context-menu', handler);
        return () => window.removeEventListener('pdfmax:context-menu', handler);
    }, []);

    /* ── Close on outside click or Escape ──────────────────────── */
    useEffect(() => {
        if (!target) return;
        const close = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setTarget(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTarget(null); };
        document.addEventListener('mousedown', close, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [target]);

    /* ── Block native context menu on canvas ───────────────────── */
    useEffect(() => {
        const prevent = (e: MouseEvent) => {
            const el = e.target as HTMLElement;
            if (el.tagName === 'CANVAS') e.preventDefault();
        };
        document.addEventListener('contextmenu', prevent);
        return () => document.removeEventListener('contextmenu', prevent);
    }, []);

    const dispatch = useCallback((type: string, detail: Record<string, any> = {}) => {
        window.dispatchEvent(new CustomEvent(type, { detail }));
        setTarget(null);
    }, []);

    if (!target) return null;

    const { x, y, obj } = target;
    const hasText = obj && 'text' in obj;

    const items: MenuItem[] = [
        {
            label: 'Duplicate',
            icon: <Icon d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />,
            action: () => dispatch('pdfmax:duplicate-markup'),
        },
        {
            label: 'Bring to Front',
            icon: <Icon d={['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M17 8H3', 'M21 12H7']} />,
            action: () => dispatch('pdfmax:bring-to-front'),
        },
        {
            label: 'Send to Back',
            icon: <Icon d={['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10']} />,
            action: () => dispatch('pdfmax:send-to-back'),
            divider: true,
        },
        {
            label: 'Copy Style',
            icon: <Icon d="M9 9h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V17a2 2 0 0 1-2 2z" />,
            action: () => {
                styleCopied.current = {
                    stroke: obj.stroke,
                    fill: obj.fill,
                    strokeWidth: obj.strokeWidth,
                    opacity: obj.opacity,
                };
                setTarget(null);
            },
        },
        {
            label: 'Paste Style',
            icon: <Icon d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />,
            action: () => {
                if (styleCopied.current) dispatch('pdfmax:update-markup', styleCopied.current);
            },
            divider: true,
        },
        {
            label: 'Add to Tool Chest',
            icon: <Icon d={['M12 5v14', 'M5 12h14']} />,
            action: () => {
                const name = hasText
                    ? (obj.text as string).slice(0, 20)
                    : `${obj.type ?? 'markup'} — ${(obj.stroke ?? '#000').slice(0, 7)}`;
                addPreset(name);
                setTarget(null);
            },
            divider: true,
        },
        {
            label: 'Delete',
            icon: <Icon d={['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2']} />,
            action: () => dispatch('pdfmax:delete-markup'),
            danger: true,
        },
    ];

    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = 188;
    const menuH = items.length * 32 + 12;
    const cx = x + menuW > vw ? x - menuW : x;
    const cy = y + menuH > vh ? y - menuH : y;

    return (
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 overflow-hidden"
            style={{ left: cx, top: cy, width: menuW, minWidth: menuW }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item, i) => (
                <React.Fragment key={i}>
                    {item.divider && i > 0 && (
                        <div className="my-1 border-t border-gray-100" />
                    )}
                    <button
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors ${item.danger
                                ? 'text-red-600 hover:bg-red-50'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                        onClick={item.action}
                    >
                        <span className={item.danger ? 'text-red-500' : 'text-gray-400'}>
                            {item.icon}
                        </span>
                        {item.label}
                    </button>
                </React.Fragment>
            ))}
        </div>
    );
};
