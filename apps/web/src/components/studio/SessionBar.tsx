'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCollabStore } from '@/store/useCollabStore';
import { closeSession } from '@/lib/studioApi';
import { useRealtimeSync } from '@/lib/useRealtimeSync';

export function SessionBar() {
    const { activeSession, activeFile, setActiveSession, reviewer, peers, isLive } = useCollabStore();
    const startRef = useRef<Date>(new Date());
    const [elapsed, setElapsed] = React.useState('0:00');
    const [attendeesOpen, setAttendeesOpen] = useState(false);
    const [markupsLocked, setMarkupsLocked] = useState(false);
    const attendeesRef = useRef<HTMLDivElement>(null);

    // Wire admin broadcast — only active when there IS a session
    const { broadcastAdmin } = useRealtimeSync({ sessionId: activeSession?.id ?? '' });

    useEffect(() => {
        if (!activeSession) return;
        startRef.current = new Date(activeSession.created_at);
        const tick = setInterval(() => {
            const sec = Math.floor((Date.now() - startRef.current.getTime()) / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            setElapsed(`${m}:${s.toString().padStart(2, '0')}`);
        }, 1000);
        return () => clearInterval(tick);
    }, [activeSession?.id]);

    // Close attendees popover on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (attendeesRef.current && !attendeesRef.current.contains(e.target as Node)) {
                setAttendeesOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (!activeSession) return null;

    const isHost = activeSession.created_by === reviewer?.id;
    const allParticipants = reviewer
        ? [reviewer, ...peers.filter(p => p.id !== reviewer.id)]
        : peers;

    const handleLeave = async () => { setActiveSession(null); };
    const handleClose = async () => {
        if (!activeSession) return;
        await closeSession(activeSession.id);
        setActiveSession(null);
    };
    const handleKick = (peerId: string) => {
        broadcastAdmin('kick-peer', peerId);
    };
    const handleToggleLock = () => {
        const next = !markupsLocked;
        setMarkupsLocked(next);
        broadcastAdmin(next ? 'session-locked' : 'session-unlocked');
        // Also apply locally
        window.dispatchEvent(new CustomEvent(next ? 'pdfmax:session-locked' : 'pdfmax:session-unlocked'));
    };

    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-950 border-b border-indigo-800 text-white text-sm shrink-0 z-10">
            {/* Live indicator */}
            <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>

            {/* Session name + file */}
            <div className="flex flex-col min-w-0">
                <span className="font-semibold leading-none truncate flex items-center gap-1.5">
                    {activeSession.name ?? 'Session'}
                    {isHost && (
                        <span className="text-[9px] font-bold bg-amber-500 text-gray-900 px-1.5 py-0.5 rounded-full leading-none">HOST</span>
                    )}
                </span>
                <span className="text-indigo-300 text-[10px] truncate">{activeFile?.name ?? ''} · {elapsed}</span>
            </div>

            {/* Attendees dropdown */}
            <div className="relative" ref={attendeesRef}>
                <button
                    onClick={() => setAttendeesOpen(o => !o)}
                    className="flex items-center -space-x-1.5 ml-1 cursor-pointer"
                    title="View attendees"
                >
                    {allParticipants.slice(0, 5).map((p) => (
                        <div
                            key={p.id}
                            className="w-6 h-6 rounded-full border-2 border-indigo-900 flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                            style={{ background: p.color }}
                            title={p.name}
                        >
                            {p.name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')}
                        </div>
                    ))}
                    {allParticipants.length > 5 && (
                        <div className="w-6 h-6 rounded-full border-2 border-indigo-900 bg-gray-600 flex items-center justify-center text-[9px]">
                            +{allParticipants.length - 5}
                        </div>
                    )}
                </button>

                {attendeesOpen && (
                    <div className="absolute top-full left-0 mt-2 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[220px]">
                        <p className="text-[10px] uppercase font-bold text-gray-500 tracking-widest px-3 pt-2.5 pb-1">Attendees ({allParticipants.length})</p>
                        {allParticipants.map(p => (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 group">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0" style={{ background: p.color }}>
                                    {p.name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')}
                                </div>
                                <span className="flex-1 text-xs text-gray-200 truncate">
                                    {p.name}
                                    {p.id === reviewer?.id && <span className="ml-1 text-indigo-400 text-[10px]">(you)</span>}
                                    {p.id === activeSession.created_by && <span className="ml-1 text-amber-400 text-[10px]">host</span>}
                                </span>
                                {/* Kick button — host only, not for self */}
                                {isHost && p.id !== reviewer?.id && (
                                    <button
                                        onClick={() => handleKick(p.id)}
                                        className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300 font-semibold px-1.5 py-0.5 rounded hover:bg-red-900/40 transition-all"
                                        title="Remove from session"
                                    >
                                        Kick
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1" />

            {/* Live status */}
            <span className="text-indigo-300 text-xs">
                {isLive ? '● Live' : '○ Connecting…'}
            </span>

            {/* Lock Markups toggle — host only */}
            {isHost && (
                <button
                    onClick={handleToggleLock}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors ${markupsLocked
                        ? 'bg-red-700 hover:bg-red-600 text-white'
                        : 'bg-indigo-800 hover:bg-indigo-700 text-indigo-200'
                        }`}
                    title={markupsLocked ? 'Unlock markups for all participants' : 'Lock markups (prevent others from drawing)'}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {markupsLocked
                            ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>
                            : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>
                        }
                    </svg>
                    {markupsLocked ? 'Locked' : 'Lock'}
                </button>
            )}

            {/* Close / Leave */}
            {isHost ? (
                <button
                    onClick={handleClose}
                    className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-xs font-semibold transition-colors"
                    title="Close session for all participants"
                >
                    Close Session
                </button>
            ) : (
                <button
                    onClick={handleLeave}
                    className="px-3 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs font-semibold transition-colors"
                >
                    Leave Session
                </button>
            )}
        </div>
    );
}
