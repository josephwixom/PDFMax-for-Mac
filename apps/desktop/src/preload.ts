import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes a safe, typed API to the renderer (Next.js web app)
 * via contextBridge. Node.js is NOT directly accessible; only these
 * explicitly whitelisted methods are exposed.
 */

export interface ElectronAPI {
    /** Open a native PDF file picker. Returns file info + base64 data, or null if cancelled. */
    openFile: () => Promise<{ path: string; name: string; data: string } | null>;
    /** Save base64 PDF data via native save dialog. Returns saved path or false. */
    saveFile: (opts: { filename: string; data: string }) => Promise<string | false>;
    /** Show a native error dialog. */
    showError: (title: string, message: string) => Promise<void>;
    /** Is this running inside Electron? */
    isElectron: true;
    /** Listen for menu events dispatched from the main process */
    onMenu: (channel: MenuChannel, cb: (...args: unknown[]) => void) => () => void;
}

type MenuChannel =
    | 'menu:openFile'
    | 'menu:exportFile'
    | 'menu:print'
    | 'menu:undo'
    | 'menu:redo'
    | 'menu:deleteSelection'
    | 'menu:zoomIn'
    | 'menu:zoomOut'
    | 'menu:zoomReset'
    | 'menu:fitToWindow'
    | 'menu:firstPage'
    | 'menu:lastPage'
    | 'menu:keyboardHelp'
    | 'menu:helpCenter'
    | 'menu:preferences'
    | 'menu:tool';

const validMenuChannels: Set<string> = new Set([
    'menu:openFile', 'menu:exportFile', 'menu:print',
    'menu:undo', 'menu:redo', 'menu:deleteSelection',
    'menu:zoomIn', 'menu:zoomOut', 'menu:zoomReset', 'menu:fitToWindow',
    'menu:firstPage', 'menu:lastPage',
    'menu:keyboardHelp', 'menu:helpCenter', 'menu:preferences',
    'menu:tool',
]);

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    openFile: () => ipcRenderer.invoke('dialog:openFile'),

    saveFile: (opts: { filename: string; data: string }) =>
        ipcRenderer.invoke('dialog:saveFile', opts),

    showError: (title: string, message: string) =>
        ipcRenderer.invoke('dialog:showError', { title, message }),

    /**
     * Subscribe to a menu event from the Electron main process.
     * Returns an unsubscribe function (call it in useEffect cleanup).
     */
    onMenu: (channel: MenuChannel, cb: (...args: unknown[]) => void) => {
        if (!validMenuChannels.has(channel)) return () => { };
        const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
        ipcRenderer.on(channel, handler);
        // Return an unsubscribe function
        return () => ipcRenderer.removeListener(channel, handler);
    },
} satisfies ElectronAPI);
