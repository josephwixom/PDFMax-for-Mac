'use client';

import React, { useState, useRef } from 'react';
import { Comment, Reviewer } from '@pdfmax/shared';
import { useCollabStore } from '@/store/useCollabStore';

interface CommentsPanelProps {
    /** The selected Fabric object (has a `pdfmax_comments` custom property) */
    fabricObj: any;
    /** Callback to fire after adding a comment so the engine can persist it */
    onAddComment: (comment: Comment) => void;
}

function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
}

function getInitials(name: string) {
    return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

export const CommentsPanel = ({ fabricObj, onAddComment }: CommentsPanelProps) => {
    const reviewer = useCollabStore(s => s.reviewer);
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const comments: Comment[] = fabricObj?.pdfmax_comments ?? [];

    const handleAdd = () => {
        if (!text.trim() || !reviewer) return;
        const comment: Comment = {
            id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
            text: text.trim(),
            author: reviewer,
            createdAt: new Date().toISOString(),
        };
        // Store into Fabric object's custom property
        const existing: Comment[] = fabricObj.pdfmax_comments ?? [];
        fabricObj.set({ pdfmax_comments: [...existing, comment] });
        fabricObj.canvas?.requestRenderAll();
        onAddComment(comment);
        setText('');
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                Comments {comments.length > 0 && <span className="text-blue-500 font-bold">{comments.length}</span>}
            </div>

            {/* Thread */}
            {comments.length === 0 ? (
                <p className="text-gray-400 text-xs italic">No comments yet</p>
            ) : (
                <div className="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1">
                    {comments.map(c => (
                        <div key={c.id} className="flex gap-2 items-start">
                            <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5"
                                style={{ background: c.author.color }}
                                title={c.author.name}
                            >
                                {getInitials(c.author.name)}
                            </div>
                            <div className="flex-1">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-xs font-medium text-gray-800">{c.author.name}</span>
                                    <span className="text-[10px] text-gray-400">{formatRelativeTime(c.createdAt)}</span>
                                </div>
                                <p className="text-xs text-gray-700 leading-relaxed">{c.text}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Input */}
            {reviewer ? (
                <div className="flex gap-1.5 items-end mt-1">
                    <textarea
                        ref={inputRef}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
                        placeholder="Add a comment…"
                        rows={2}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!text.trim()}
                        className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
                    >
                        ↑
                    </button>
                </div>
            ) : (
                <p className="text-gray-400 text-xs italic">Set your identity in Collaborate to add comments.</p>
            )}
        </div>
    );
};
