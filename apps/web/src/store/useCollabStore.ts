import { create } from 'zustand';
import type { Project, ProjectFile, Session, SessionMarkup, Reviewer, MarkupStatus } from '@pdfmax/shared';

interface StudioState {
    // Collab identity
    reviewer: Reviewer | null;
    setReviewer: (r: Reviewer) => void;

    // Real-time presence
    peers: Reviewer[];
    setPeers: (peers: Reviewer[]) => void;
    isLive: boolean;
    setIsLive: (v: boolean) => void;

    // Studio - Projects
    projects: Project[];
    setProjects: (p: Project[]) => void;
    activeProject: Project | null;
    setActiveProject: (p: Project | null) => void;

    // Studio - Files
    projectFiles: ProjectFile[];
    setProjectFiles: (f: ProjectFile[]) => void;
    activeFile: ProjectFile | null;
    setActiveFile: (f: ProjectFile | null) => void;

    // Studio - Sessions
    sessions: Session[];
    setSessions: (s: Session[]) => void;
    activeSession: Session | null;
    setActiveSession: (s: Session | null) => void;

    // Studio - Markups
    sessionMarkups: SessionMarkup[];
    setSessionMarkups: (m: SessionMarkup[]) => void;
    addSessionMarkup: (m: SessionMarkup) => void;
    updateSessionMarkupStatus: (id: string, status: MarkupStatus) => void;
}

const stored = typeof window !== 'undefined' ? localStorage.getItem('pdfmax:reviewer') : null;
const initialReviewer: Reviewer | null = stored ? JSON.parse(stored) : null;

export const useCollabStore = create<StudioState>((set, get) => ({
    // Identity
    reviewer: initialReviewer,
    setReviewer: (r) => {
        if (typeof window !== 'undefined') localStorage.setItem('pdfmax:reviewer', JSON.stringify(r));
        set({ reviewer: r });
    },

    // Presence
    peers: [],
    setPeers: (peers) => set({ peers }),
    isLive: false,
    setIsLive: (v) => set({ isLive: v }),

    // Projects
    projects: [],
    setProjects: (projects) => set({ projects }),
    activeProject: null,
    setActiveProject: (p) => set({ activeProject: p, projectFiles: [], activeFile: null, sessions: [], activeSession: null }),

    // Files
    projectFiles: [],
    setProjectFiles: (f) => set({ projectFiles: f }),
    activeFile: null,
    setActiveFile: (f) => set({ activeFile: f, sessions: [], activeSession: null }),

    // Sessions
    sessions: [],
    setSessions: (s) => set({ sessions: s }),
    activeSession: null,
    setActiveSession: (s) => set({ activeSession: s }),

    // Markups
    sessionMarkups: [],
    setSessionMarkups: (m) => set({ sessionMarkups: m }),
    addSessionMarkup: (m) => set((state) => ({
        sessionMarkups: state.sessionMarkups.some(x => x.id === m.id)
            ? state.sessionMarkups.map(x => x.id === m.id ? m : x)
            : [...state.sessionMarkups, m],
    })),
    updateSessionMarkupStatus: (id, status) => set((state) => ({
        sessionMarkups: state.sessionMarkups.map(m => m.id === id ? { ...m, status } : m),
    })),
}));
