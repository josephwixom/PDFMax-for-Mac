import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useToolStore } from './useToolStore';

export interface ToolPreset {
    id: string;
    name: string;
    tool: string;
    strokeColor: string;
    fillColor: string;
    strokeWidth: number;
    opacity: number;
}

interface ToolChestState {
    presets: ToolPreset[];
    addPreset: (name: string) => void;
    removePreset: (id: string) => void;
    applyPreset: (id: string) => void;
    renamePreset: (id: string, newName: string) => void;
}

export const useToolChestStore = create<ToolChestState>()(
    persist(
        (set, get) => ({
            presets: [],

            addPreset: (name: string) => {
                const { activeTool, strokeColor, fillColor, strokeWidth, opacity } = useToolStore.getState();
                const preset: ToolPreset = {
                    id: `preset-${Date.now()}`,
                    name,
                    tool: activeTool,
                    strokeColor,
                    fillColor,
                    strokeWidth,
                    opacity,
                };
                set((s) => ({ presets: [...s.presets, preset] }));
            },

            removePreset: (id: string) => {
                set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
            },

            applyPreset: (id: string) => {
                const preset = get().presets.find((p) => p.id === id);
                if (!preset) return;
                const store = useToolStore.getState();
                store.setActiveTool(preset.tool as any);
                store.setStrokeColor(preset.strokeColor);
                store.setFillColor(preset.fillColor);
                store.setStrokeWidth(preset.strokeWidth);
                store.setOpacity(preset.opacity);
            },

            renamePreset: (id: string, newName: string) => {
                set((s) => ({
                    presets: s.presets.map((p) => p.id === id ? { ...p, name: newName } : p),
                }));
            },
        }),
        { name: 'pdfmax:tool-chest' }
    )
);
