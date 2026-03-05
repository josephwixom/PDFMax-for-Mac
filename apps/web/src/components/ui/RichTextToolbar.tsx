'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Constants ────────────────────────────────────────────────────────────
const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Trebuchet MS'];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

// ── Types ────────────────────────────────────────────────────────────────
interface FormatState {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    linethrough: boolean;
    fontSize: number;
    fontFamily: string;
    fill: string;
}

const DEFAULT_FORMAT: FormatState = {
    bold: false,
    italic: false,
    underline: false,
    linethrough: false,
    fontSize: 16,
    fontFamily: 'Arial',
    fill: '#1e293b',
};

// ── Component ────────────────────────────────────────────────────────────
export default function RichTextToolbar() {
    const [visible, setVisible] = useState(false);
    const [fmt, setFmt] = useState<FormatState>(DEFAULT_FORMAT);
    const activeObjRef = useRef<any>(null);

    // Helper: read current selection styles from the Fabric IText/Textbox
    const syncFormat = useCallback((obj: any) => {
        if (!obj || !obj.isEditing) return;
        const styles = obj.getSelectionStyles?.(obj.selectionStart, obj.selectionEnd, true) ?? [{}];
        const first = styles[0] ?? {};

        setFmt({
            bold: (first.fontWeight ?? obj.fontWeight ?? 'normal') === 'bold',
            italic: (first.fontStyle ?? obj.fontStyle ?? 'normal') === 'italic',
            underline: first.underline ?? obj.underline ?? false,
            linethrough: first.linethrough ?? obj.linethrough ?? false,
            fontSize: first.fontSize ?? obj.fontSize ?? 16,
            fontFamily: first.fontFamily ?? obj.fontFamily ?? 'Arial',
            fill: first.fill ?? obj.fill ?? '#1e293b',
        });
    }, []);

    useEffect(() => {
        const onEnter = (e: Event) => {
            const obj = (e as CustomEvent).detail?.obj;
            if (!obj) return;
            activeObjRef.current = obj;
            syncFormat(obj);
            setVisible(true);

            // Re-sync whenever the selection changes while editing
            obj.__richtextSync = () => syncFormat(obj);
            obj.on('selection:changed', obj.__richtextSync);
            obj.on('changed', obj.__richtextSync);
        };

        const onExit = () => {
            const obj = activeObjRef.current;
            if (obj?.__richtextSync) {
                obj.off('selection:changed', obj.__richtextSync);
                obj.off('changed', obj.__richtextSync);
                delete obj.__richtextSync;
            }
            activeObjRef.current = null;
            setVisible(false);
        };

        window.addEventListener('pdfmax:text-editing-entered', onEnter);
        window.addEventListener('pdfmax:text-editing-exited', onExit);
        return () => {
            window.removeEventListener('pdfmax:text-editing-entered', onEnter);
            window.removeEventListener('pdfmax:text-editing-exited', onExit);
        };
    }, [syncFormat]);

    // ── Apply style to the current selection ────────────────────────────
    const applyStyle = useCallback((style: Partial<FormatState>) => {
        const obj = activeObjRef.current;
        if (!obj || !obj.isEditing) return;

        const fabricStyle: Record<string, any> = {};
        if ('bold' in style) fabricStyle.fontWeight = style.bold ? 'bold' : 'normal';
        if ('italic' in style) fabricStyle.fontStyle = style.italic ? 'italic' : 'normal';
        if ('underline' in style) fabricStyle.underline = style.underline;
        if ('linethrough' in style) fabricStyle.linethrough = style.linethrough;
        if ('fontSize' in style) fabricStyle.fontSize = style.fontSize;
        if ('fontFamily' in style) fabricStyle.fontFamily = style.fontFamily;
        if ('fill' in style) fabricStyle.fill = style.fill;

        const hasSelection = (obj.selectionEnd ?? 0) > (obj.selectionStart ?? 0);
        if (hasSelection) {
            obj.setSelectionStyles(fabricStyle);
        } else {
            // No selection — apply to whole object as default
            Object.assign(fabricStyle, {});
            if ('bold' in style) obj.set({ fontWeight: style.bold ? 'bold' : 'normal' });
            if ('italic' in style) obj.set({ fontStyle: style.italic ? 'italic' : 'normal' });
            if ('underline' in style) obj.set({ underline: style.underline });
            if ('linethrough' in style) obj.set({ linethrough: style.linethrough });
            if ('fontSize' in style) obj.set({ fontSize: style.fontSize });
            if ('fontFamily' in style) obj.set({ fontFamily: style.fontFamily });
            if ('fill' in style) obj.set({ fill: style.fill });
        }

        obj.canvas?.requestRenderAll();
        setFmt(prev => ({ ...prev, ...style }));
    }, []);

    if (!visible) return null;

    // ── Render ───────────────────────────────────────────────────────────
    return (
        <div
            className="fixed z-[200] top-12 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-lg shadow-xl border"
            style={{
                background: 'rgba(15,23,42,0.97)',
                borderColor: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(8px)',
            }}
        >
            {/* Bold */}
            <FmtButton
                active={fmt.bold}
                title="Bold (Ctrl+B)"
                onClick={() => applyStyle({ bold: !fmt.bold })}
            >
                <span className="font-bold text-sm">B</span>
            </FmtButton>

            {/* Italic */}
            <FmtButton
                active={fmt.italic}
                title="Italic (Ctrl+I)"
                onClick={() => applyStyle({ italic: !fmt.italic })}
            >
                <span className="italic text-sm">I</span>
            </FmtButton>

            {/* Underline */}
            <FmtButton
                active={fmt.underline}
                title="Underline (Ctrl+U)"
                onClick={() => applyStyle({ underline: !fmt.underline })}
            >
                <span className="underline text-sm">U</span>
            </FmtButton>

            {/* Strikethrough */}
            <FmtButton
                active={fmt.linethrough}
                title="Strikethrough"
                onClick={() => applyStyle({ linethrough: !fmt.linethrough })}
            >
                <span className="line-through text-sm">S</span>
            </FmtButton>

            <div className="w-px h-5 bg-white/15 mx-0.5" />

            {/* Font family */}
            <select
                value={fmt.fontFamily}
                onChange={e => applyStyle({ fontFamily: e.target.value })}
                className="text-xs bg-white/10 text-white border border-white/15 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                style={{ minWidth: 130 }}
            >
                {FONT_FAMILIES.map(f => (
                    <option key={f} value={f} style={{ fontFamily: f, background: '#0f172a' }}>{f}</option>
                ))}
            </select>

            {/* Font size */}
            <select
                value={fmt.fontSize}
                onChange={e => applyStyle({ fontSize: Number(e.target.value) })}
                className="text-xs bg-white/10 text-white border border-white/15 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 w-14"
            >
                {FONT_SIZES.map(s => (
                    <option key={s} value={s} style={{ background: '#0f172a' }}>{s}</option>
                ))}
            </select>

            <div className="w-px h-5 bg-white/15 mx-0.5" />

            {/* Color picker */}
            <label className="relative flex items-center gap-1 cursor-pointer" title="Text color">
                <span
                    className="w-4 h-4 rounded-full border border-white/30 flex-shrink-0"
                    style={{ background: fmt.fill }}
                />
                <span className="text-white/60 text-[10px]">Color</span>
                <input
                    type="color"
                    value={fmt.fill}
                    onChange={e => applyStyle({ fill: e.target.value })}
                    className="sr-only"
                />
            </label>

            <div className="w-px h-5 bg-white/15 mx-0.5" />

            {/* Close (exit edit) */}
            <button
                onClick={() => {
                    const obj = activeObjRef.current;
                    obj?.exitEditing?.();
                    obj?.canvas?.discardActiveObject();
                    obj?.canvas?.requestRenderAll();
                    setVisible(false);
                }}
                className="text-white/40 hover:text-white/80 transition-colors px-1"
                title="Done editing"
            >
                ✕
            </button>
        </div>
    );
}

// ── Small toggle button ──────────────────────────────────────────────────
function FmtButton({ active, title, onClick, children }: {
    active: boolean;
    title: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            title={title}
            onMouseDown={e => { e.preventDefault(); onClick(); }} // prevent focus leaving the text obj
            className={`w-7 h-7 flex items-center justify-center rounded transition-all text-sm
                ${active
                    ? 'bg-blue-600 text-white ring-1 ring-blue-400'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
        >
            {children}
        </button>
    );
}
