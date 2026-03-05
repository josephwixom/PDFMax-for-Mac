'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SignatureModalProps {
    isOpen: boolean;
    signerName?: string;
    onClose: () => void;
    onConfirm: (dataUrl: string, signerName: string) => void;
}

type Tab = 'draw' | 'type' | 'upload';

const FONTS = ['Dancing Script', 'Pacifico', 'Great Vibes', 'Caveat', 'Sacramento'];

export const SignatureModal: React.FC<SignatureModalProps> = ({
    isOpen, signerName = '', onClose, onConfirm,
}) => {
    const [tab, setTab] = useState<Tab>('draw');
    const [name, setName] = useState(signerName);
    const [typedFont, setTypedFont] = useState(FONTS[0]);
    const [isDrawing, setIsDrawing] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastPos = useRef<{ x: number; y: number } | null>(null);

    // Reset when opened
    useEffect(() => {
        if (isOpen) {
            setName(signerName);
            setTab('draw');
            clearCanvas();
        }
    }, [isOpen, signerName]);

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if ('touches' in e) {
            const touch = e.touches[0];
            return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
        }
        return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
    };

    const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setIsDrawing(true);
        lastPos.current = getPos(e, canvas);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx || !lastPos.current) return;
        const pos = getPos(e, canvas);
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        lastPos.current = pos;
    };

    const endDraw = () => { setIsDrawing(false); lastPos.current = null; };

    const getDataUrl = (): string => {
        if (tab === 'draw') {
            const canvas = canvasRef.current;
            if (!canvas) return '';
            return canvas.toDataURL('image/png');
        }
        // Type tab — render text to a canvas
        const off = document.createElement('canvas');
        off.width = 480;
        off.height = 120;
        const ctx = off.getContext('2d')!;
        ctx.clearRect(0, 0, off.width, off.height);
        ctx.font = `60px '${typedFont}', cursive`;
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name || 'Signature', 240, 60);
        return off.toDataURL('image/png');
    };

    const handleConfirm = () => {
        const dataUrl = getDataUrl();
        onConfirm(dataUrl, name);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 20H7L3 16l9.5-9.5" /><path d="m13 7 3-3 4 4-3 3" /><path d="m7.5 13.5 3 3" />
                        </svg>
                        <h2 className="text-sm font-bold text-gray-800">Add Signature</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                {/* Signer name */}
                <div className="px-5 pt-4">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Signer Name</label>
                    <input
                        type="text" value={name} onChange={e => setName(e.target.value)}
                        placeholder="Your name…"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800"
                    />
                </div>

                {/* Tabs */}
                <div className="flex gap-1 px-5 pt-4">
                    {(['draw', 'type'] as Tab[]).map(t => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                            {t}
                        </button>
                    ))}
                </div>

                {/* Draw tab */}
                {tab === 'draw' && (
                    <div className="px-5 pt-3">
                        <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50 relative cursor-crosshair select-none">
                            <canvas
                                ref={canvasRef} width={480} height={140}
                                className="w-full block"
                                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                            />
                            <button onClick={clearCanvas} className="absolute top-2 right-2 text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded bg-white border border-gray-200 shadow-sm">Clear</button>
                            <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-gray-400 pointer-events-none">Draw your signature above</p>
                        </div>
                    </div>
                )}

                {/* Type tab */}
                {tab === 'type' && (
                    <div className="px-5 pt-3 space-y-3">
                        <div className="border border-gray-200 rounded-xl bg-gray-50 h-28 flex items-center justify-center overflow-hidden">
                            <span style={{ fontFamily: `'${typedFont}', cursive`, fontSize: 48, color: '#1e293b', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {name || 'Your Name'}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {FONTS.map(f => (
                                <button key={f} onClick={() => setTypedFont(f)}
                                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${typedFont === f ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                                    style={{ fontFamily: `'${f}', cursive` }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        {/* Load Google Fonts */}
                        <link rel="preconnect" href="https://fonts.googleapis.com" />
                        <link href={`https://fonts.googleapis.com/css2?family=${FONTS.map(f => f.replace(/ /g, '+')).join('&family=')}&display=swap`} rel="stylesheet" />
                    </div>
                )}

                {/* Footer */}
                <div className="flex gap-2 px-5 py-4 mt-2 border-t border-gray-100">
                    <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors">Cancel</button>
                    <button onClick={handleConfirm} className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors shadow-md">
                        Place Signature
                    </button>
                </div>
            </div>
        </div>
    );
};
