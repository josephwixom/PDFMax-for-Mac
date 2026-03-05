'use client';

import React, { useState, useEffect } from 'react';

type Phase = 'outer' | 'void';

interface PromptState {
    open: boolean;
    phase: Phase;
}

/** Dispatches the answer back to the engine's awaiting promise. */
function answer(addVoid: boolean) {
    window.dispatchEvent(new CustomEvent('pdfmax:cutout-choice', { detail: { addVoid } }));
}

/**
 * CutoutPrompt — renders a floating confirmation banner when
 * the cutout (measure-cutout) tool needs to ask the user whether
 * to add a void region inside the drawn area.
 * Replaces the blocking window.confirm() that was there before.
 */
export const CutoutPrompt: React.FC = () => {
    const [state, setState] = useState<PromptState>({ open: false, phase: 'outer' });

    useEffect(() => {
        const handler = (e: Event) => {
            const phase = (e as CustomEvent).detail?.phase as Phase ?? 'outer';
            setState({ open: true, phase });
        };
        window.addEventListener('pdfmax:cutout-prompt', handler);
        return () => window.removeEventListener('pdfmax:cutout-prompt', handler);
    }, []);

    const dismiss = (addVoid: boolean) => {
        setState(s => ({ ...s, open: false }));
        answer(addVoid);
    };

    if (!state.open) return null;

    const isOuter = state.phase === 'outer';

    return (
        <div
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9998] flex flex-col items-center gap-2"
            style={{ pointerEvents: 'auto' }}
        >
            <div className="bg-gray-900 border border-amber-500/60 rounded-2xl shadow-2xl px-5 py-4 flex flex-col items-center gap-3 backdrop-blur-md"
                style={{ minWidth: 280 }}>
                {/* Icon + title */}
                <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                        fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="3" rx="1" />
                        <path d="M9 9h6v6H9z" />
                    </svg>
                    <p className="text-sm font-bold text-amber-300">
                        {isOuter ? 'Outer area drawn' : 'Void region drawn'}
                    </p>
                </div>

                <p className="text-xs text-gray-300 text-center leading-relaxed">
                    {isOuter
                        ? 'Would you like to draw a void (cutout) region inside this area?'
                        : 'Would you like to draw another void region?'}
                </p>

                {/* Action buttons */}
                <div className="flex gap-2 w-full">
                    <button
                        onClick={() => dismiss(true)}
                        className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-900 text-xs font-bold transition-colors"
                    >
                        {isOuter ? 'Add Void' : 'Add Another'}
                    </button>
                    <button
                        onClick={() => dismiss(false)}
                        className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-semibold transition-colors"
                    >
                        Finish
                    </button>
                </div>
            </div>

            {/* Small arrow pointing down toward the canvas */}
            <div className="w-3 h-3 bg-gray-900 border-r border-b border-amber-500/60 rotate-45 -mt-2.5" />
        </div>
    );
};
