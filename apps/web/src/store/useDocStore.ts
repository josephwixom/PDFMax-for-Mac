import { create } from 'zustand';

interface DocState {
    fileName: string;
    totalPages: number;
    currentPage: number;
    setFileName: (name: string) => void;
    setTotalPages: (n: number) => void;
    setCurrentPage: (n: number) => void;
}

export const useDocStore = create<DocState>((set) => ({
    fileName: 'sample.pdf',
    totalPages: 0,
    currentPage: 1,
    setFileName: (name) => set({ fileName: name }),
    setTotalPages: (n) => set({ totalPages: n }),
    setCurrentPage: (n) => set({ currentPage: n }),
}));
