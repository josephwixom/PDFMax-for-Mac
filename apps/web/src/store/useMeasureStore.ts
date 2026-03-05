'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScaleConfig, MeasureUnit } from '@pdfmax/shared';

interface MeasureStore {
    // Scale per page
    pageScales: Record<number, ScaleConfig>;
    setPageScale: (page: number, config: ScaleConfig) => void;
    clearPageScale: (page: number) => void;
    getPageScale: (page: number) => ScaleConfig | undefined;
    /** Call this whenever the visible page changes to restore the toolbar label. */
    restorePageScale: (page: number) => void;

    // Calibration UI state
    showCalibrationModal: boolean;
    pendingCalibration: { pageNumber: number; pixelLength: number } | null;
    openCalibrationModal: (pageNumber: number, pixelLength: number) => void;
    closeCalibrationModal: () => void;
    confirmCalibration: (realWorldLength: number, unit: MeasureUnit) => void;

    // Active scale label for toolbar display
    activePageScale: string;
    setActivePageScale: (label: string) => void;
}

export const useMeasureStore = create<MeasureStore>()(
    persist(
        (set, get) => ({
            pageScales: {},
            setPageScale: (page, config) =>
                set((s) => ({ pageScales: { ...s.pageScales, [page]: config } })),
            clearPageScale: (page) =>
                set((s) => {
                    const next = { ...s.pageScales };
                    delete next[page];
                    return { pageScales: next, activePageScale: 'Not calibrated' };
                }),
            getPageScale: (page) => get().pageScales[page],
            restorePageScale: (page) => {
                const scale = get().pageScales[page];
                set({ activePageScale: scale?.label ?? 'Not calibrated' });
            },

            showCalibrationModal: false,
            pendingCalibration: null,
            openCalibrationModal: (pageNumber, pixelLength) =>
                set({ showCalibrationModal: true, pendingCalibration: { pageNumber, pixelLength } }),
            closeCalibrationModal: () =>
                set({ showCalibrationModal: false, pendingCalibration: null }),
            confirmCalibration: (realWorldLength, unit) => {
                const { pendingCalibration, setPageScale, closeCalibrationModal } = get();
                if (!pendingCalibration) return;
                const pixelsPerUnit = pendingCalibration.pixelLength / realWorldLength;
                const label = `${realWorldLength}${unit} = drawn line`;
                setPageScale(pendingCalibration.pageNumber, { pixelsPerUnit, unit, label });
                set({ activePageScale: label });
                closeCalibrationModal();
                // Tell the engine to remove the drawn calibration line
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('pdfmax:scale-confirmed'));
                }
            },

            activePageScale: 'Not calibrated',
            setActivePageScale: (label) => set({ activePageScale: label }),
        }),
        {
            name: 'pdfmax-scales',
            // Persist scale data AND the toolbar label
            partialize: (s) => ({
                pageScales: s.pageScales,
                activePageScale: s.activePageScale,
            }),
        }
    )
);
