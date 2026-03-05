'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCollabStore } from '@/store/useCollabStore';
import {
    listProjects, createProject, deleteProject,
    listFiles, uploadFile, getFileUrl, deleteFile,
    listSessions, createSession,
} from '@/lib/studioApi';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Project, ProjectFile, Session } from '@pdfmax/shared';

// ─── Icon helpers ──────────────────────────────────────────────────────────
const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
    </svg>
);

type Tab = 'projects' | 'files' | 'sessions';

export function StudioPanel() {
    const {
        reviewer,
        projects, setProjects,
        activeProject, setActiveProject,
        projectFiles, setProjectFiles,
        activeFile, setActiveFile,
        sessions, setSessions,
        activeSession, setActiveSession,
    } = useCollabStore();

    const [tab, setTab] = useState<Tab>('projects');
    const [loading, setLoading] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');
    const [addingProject, setAddingProject] = useState(false);
    const [newSessionName, setNewSessionName] = useState('');
    const [addingSession, setAddingSession] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const configured = isSupabaseConfigured();

    // Load projects
    const refreshProjects = useCallback(async () => {
        setLoading(true);
        const data = await listProjects();
        setProjects(data);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (configured) refreshProjects();
    }, [configured]);

    // Load files when project selected
    useEffect(() => {
        if (!activeProject) return;
        listFiles(activeProject.id).then(setProjectFiles);
    }, [activeProject?.id]);

    // Load sessions when file selected
    useEffect(() => {
        if (!activeFile) return;
        listSessions(activeFile.id).then(setSessions);
    }, [activeFile?.id]);

    const handleCreateProject = async () => {
        if (!newProjectName.trim() || !reviewer) return;
        const p = await createProject(newProjectName.trim(), newProjectDesc.trim(), reviewer.id);
        if (p) {
            setProjects([p, ...projects]);
            setNewProjectName('');
            setNewProjectDesc('');
            setAddingProject(false);
        }
    };

    const handleOpenFile = async (file: ProjectFile) => {
        setActiveFile(file);
        setTab('sessions');
        // Download and open PDF in viewer
        const url = await getFileUrl(file.storage_path);
        if (url) {
            const res = await fetch(url);
            const blob = await res.blob();
            const f = new File([blob], file.name, { type: 'application/pdf' });
            const dt = new DataTransfer();
            dt.items.add(f);
            window.dispatchEvent(new CustomEvent('pdfmax:open-file', { detail: { file: f } }));
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeProject || !reviewer) return;
        setLoading(true);
        const pf = await uploadFile(activeProject.id, file, reviewer.id);
        if (pf) setProjectFiles([pf, ...projectFiles]);
        setLoading(false);
        e.target.value = '';
    };

    const handleStartSession = async () => {
        if (!activeFile || !reviewer) return;
        const name = newSessionName.trim() || `Session ${new Date().toLocaleDateString()}`;
        const s = await createSession(activeFile.id, name, reviewer.id);
        if (s) {
            setSessions([s, ...sessions]);
            setActiveSession(s);
            setNewSessionName('');
            setAddingSession(false);
        }
    };

    const handleJoinSession = (s: Session) => {
        setActiveSession(s);
    };

    if (!configured) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
                    fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" />
                    <line x1="6" x2="6" y1="1" y2="4" /><line x1="10" x2="10" y1="1" y2="4" /><line x1="14" x2="14" y1="1" y2="4" />
                </svg>
                <p className="text-xs text-gray-500 font-medium">Studio requires Supabase</p>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                    Add <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                    <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
                    <code className="bg-gray-100 px-1 rounded">.env.local</code> to enable.
                </p>
            </div>
        );
    }

    if (!reviewer) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
                <p className="text-xs text-gray-500">Set your identity in the toolbar first (Collaborate button).</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full text-sm">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 shrink-0 bg-white">
                {(['projects', 'files', 'sessions'] as Tab[]).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        disabled={t === 'files' && !activeProject || t === 'sessions' && !activeFile}
                        className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${tab === t ? 'text-indigo-600 border-b-2 border-indigo-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* ── PROJECTS ── */}
            {tab === 'projects' && (
                <div className="flex-1 overflow-y-auto">
                    <div className="p-2 border-b border-gray-100">
                        {addingProject ? (
                            <div className="flex flex-col gap-1.5">
                                <input
                                    autoFocus
                                    placeholder="Project name…"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setAddingProject(false); }}
                                    className="w-full text-xs border border-indigo-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                                <input
                                    placeholder="Description (optional)"
                                    value={newProjectDesc}
                                    onChange={e => setNewProjectDesc(e.target.value)}
                                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none"
                                />
                                <div className="flex gap-1">
                                    <button onClick={handleCreateProject} className="flex-1 py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700">Create</button>
                                    <button onClick={() => setAddingProject(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200">Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setAddingProject(true)}
                                className="w-full text-xs py-1.5 border-2 border-dashed border-gray-300 rounded text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors font-semibold"
                            >
                                + New Project
                            </button>
                        )}
                    </div>

                    {loading && <div className="p-4 text-center text-xs text-gray-400">Loading…</div>}

                    {!loading && projects.length === 0 && (
                        <div className="p-4 text-center text-xs text-gray-400">No projects yet.</div>
                    )}

                    {projects.map(p => (
                        <div
                            key={p.id}
                            className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 cursor-pointer group transition-colors ${activeProject?.id === p.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                }`}
                            onClick={() => { setActiveProject(p); setTab('files'); }}
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold ${activeProject?.id === p.id ? 'bg-indigo-600' : 'bg-gray-400 group-hover:bg-indigo-400'
                                }`}>
                                {p.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-xs text-gray-800 truncate">{p.name}</p>
                                {p.description && <p className="text-[10px] text-gray-400 truncate">{p.description}</p>}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); deleteProject(p.id); setProjects(projects.filter(x => x.id !== p.id)); }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-red-400 transition-all"
                                title="Delete project"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ── FILES ── */}
            {tab === 'files' && activeProject && (
                <div className="flex-1 overflow-y-auto">
                    <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex-1 truncate font-semibold">{activeProject.name}</span>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 font-semibold flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                            Upload
                        </button>
                        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
                    </div>

                    {loading && <div className="p-4 text-center text-xs text-gray-400">Uploading…</div>}

                    {!loading && projectFiles.length === 0 && (
                        <div className="p-4 text-center text-xs text-gray-400">No files yet. Upload a PDF to get started.</div>
                    )}

                    {projectFiles.map(f => (
                        <div
                            key={f.id}
                            className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 cursor-pointer group transition-colors ${activeFile?.id === f.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                }`}
                            onClick={() => handleOpenFile(f)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-xs text-gray-800 truncate">{f.name}</p>
                                <p className="text-[10px] text-gray-400">v{f.version} · {new Date(f.uploaded_at).toLocaleDateString()}</p>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); deleteFile(f); setProjectFiles(projectFiles.filter(x => x.id !== f.id)); }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-red-400 transition-all"
                                title="Delete file"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ── SESSIONS ── */}
            {tab === 'sessions' && activeFile && (
                <div className="flex-1 overflow-y-auto">
                    <div className="p-2 border-b border-gray-100">
                        {addingSession ? (
                            <div className="flex gap-1">
                                <input
                                    autoFocus
                                    placeholder={`Session ${new Date().toLocaleDateString()}…`}
                                    value={newSessionName}
                                    onChange={e => setNewSessionName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleStartSession(); if (e.key === 'Escape') setAddingSession(false); }}
                                    className="flex-1 text-xs border border-indigo-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                                <button onClick={handleStartSession} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700">Start</button>
                                <button onClick={() => setAddingSession(false)} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200">✕</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setAddingSession(true)}
                                className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded font-semibold hover:bg-indigo-700 transition-colors"
                            >
                                + Start New Session
                            </button>
                        )}
                    </div>

                    {sessions.length === 0 && (
                        <div className="p-4 text-center text-xs text-gray-400">No sessions yet for this file.</div>
                    )}

                    {sessions.map(s => (
                        <div
                            key={s.id}
                            className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 group transition-colors ${activeSession?.id === s.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                }`}
                        >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'open' ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-xs text-gray-800 truncate">{s.name ?? 'Session'}</p>
                                <p className="text-[10px] text-gray-400">{s.status === 'open' ? 'Open' : 'Closed'} · {new Date(s.created_at).toLocaleDateString()}</p>
                            </div>
                            {s.status === 'open' && (
                                <button
                                    onClick={() => handleJoinSession(s)}
                                    className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${activeSession?.id === s.id
                                            ? 'bg-green-600 text-white'
                                            : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                                        }`}
                                >
                                    {activeSession?.id === s.id ? '● Active' : 'Join'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
