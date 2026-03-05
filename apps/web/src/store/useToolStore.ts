import { create } from 'zustand';
import { MarkupType } from '@pdfmax/shared';

type AnyTool = MarkupType | 'select' | 'pan';

interface ToolState {
    activeTool: AnyTool;
    setActiveTool: (tool: AnyTool) => void;

    // Basic styling
    strokeColor: string;
    setStrokeColor: (color: string) => void;
    strokeWidth: number;
    setStrokeWidth: (width: number) => void;
    fillColor: string;
    setFillColor: (color: string) => void;
    opacity: number;
    setOpacity: (opacity: number) => void;

    // Zoom — shared so Toolbar can display it
    zoom: number;
    setZoom: (zoom: number) => void;
}

export const useToolStore = create<ToolState>((set) => ({
    activeTool: 'select',
    setActiveTool: (tool) => set({ activeTool: tool }),

    strokeColor: '#ef4444',
    setStrokeColor: (color) => set({ strokeColor: color }),

    strokeWidth: 3,
    setStrokeWidth: (width) => set({ strokeWidth: width }),

    fillColor: 'transparent',
    setFillColor: (color) => set({ fillColor: color }),

    opacity: 1,
    setOpacity: (opacity) => set({ opacity }),

    zoom: 1.0,
    setZoom: (zoom) => set({ zoom }),
}));
