/**
 * Markup Layers store — persisted to localStorage.
 * A "layer" is simply a named tag (pdfmaxLayer) that each Fabric object can carry.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MarkupLayer {
    id: string;       // unique key (same as name for simplicity)
    name: string;
    visible: boolean;
    color: string;    // swatch color shown in the layers panel
    locked: boolean;  // locked layers prevent selection/modification
}

const DEFAULT_LAYER: MarkupLayer = {
    id: 'default',
    name: 'Default',
    visible: true,
    color: '#6366f1',
    locked: false,
};

interface LayerState {
    layers: MarkupLayer[];
    activeLayerId: string;
    addLayer: (name: string, color?: string) => void;
    removeLayer: (id: string) => void;
    toggleVisible: (id: string) => void;
    toggleLocked: (id: string) => void;
    renameLayer: (id: string, newName: string) => void;
    setActiveLayer: (id: string) => void;
    setLayerColor: (id: string, color: string) => void;
}

export const useLayerStore = create<LayerState>()(
    persist(
        (set, get) => ({
            layers: [DEFAULT_LAYER],
            activeLayerId: 'default',

            addLayer: (name, color = '#94a3b8') => {
                const id = `layer-${Date.now()}`;
                const layer: MarkupLayer = { id, name, visible: true, color, locked: false };
                set((s) => ({ layers: [...s.layers, layer], activeLayerId: id }));
                // Tell engine about the new visibility state
                window.dispatchEvent(new CustomEvent('pdfmax:layers-changed', { detail: get().layers }));
            },

            removeLayer: (id) => {
                if (id === 'default') return; // can't delete the default layer
                set((s) => ({
                    layers: s.layers.filter((l) => l.id !== id),
                    activeLayerId: s.activeLayerId === id ? 'default' : s.activeLayerId,
                }));
                window.dispatchEvent(new CustomEvent('pdfmax:layers-changed', { detail: get().layers }));
            },

            toggleVisible: (id) => {
                set((s) => ({
                    layers: s.layers.map((l) => l.id === id ? { ...l, visible: !l.visible } : l),
                }));
                window.dispatchEvent(new CustomEvent('pdfmax:layers-changed', { detail: get().layers }));
            },

            toggleLocked: (id) => {
                set((s) => ({
                    layers: s.layers.map((l) => l.id === id ? { ...l, locked: !l.locked } : l),
                }));
                window.dispatchEvent(new CustomEvent('pdfmax:layers-changed', { detail: get().layers }));
            },

            renameLayer: (id, newName) => {
                set((s) => ({
                    layers: s.layers.map((l) => l.id === id ? { ...l, name: newName } : l),
                }));
            },

            setActiveLayer: (id) => set({ activeLayerId: id }),

            setLayerColor: (id, color) => {
                set((s) => ({
                    layers: s.layers.map((l) => l.id === id ? { ...l, color } : l),
                }));
            },
        }),
        { name: 'pdfmax:layers' }
    )
);
