/**
 * useElectron — React hook for integrating with the Electron desktop host.
 *
 * Returns null when running in a browser / Capacitor / web context.
 * Returns the typed ElectronAPI when running inside the Electron shell.
 *
 * Usage:
 *   const electron = useElectron();
 *   if (electron) {
 *     const file = await electron.openFile();
 *   }
 */
'use client';
import { useEffect, useRef } from 'react';

export interface ElectronAPI {
    isElectron: true;
    openFile: () => Promise<{ path: string; name: string; data: string } | null>;
    saveFile: (opts: { filename: string; data: string }) => Promise<string | false>;
    showError: (title: string, message: string) => Promise<void>;
    onMenu: (channel: string, cb: (...args: unknown[]) => void) => () => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

/** True when running inside Electron (both dev and packaged). */
export function isElectron(): boolean {
    return typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
}

/** Returns the ElectronAPI or null if not in Electron. */
export function getElectronAPI(): ElectronAPI | null {
    if (typeof window === 'undefined') return null;
    return window.electronAPI ?? null;
}

/**
 * Hook: subscribe to a native menu event from the Electron main process.
 * Automatically unsubscribes on unmount.
 *
 * @param channel  IPC channel name, e.g. 'menu:openFile'
 * @param handler  Callback to invoke when the menu item is clicked
 * @param deps     Optional dependency array (defaults to [])
 */
export function useElectronMenu(
    channel: string,
    handler: (...args: unknown[]) => void,
    deps: React.DependencyList = []
): void {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        const api = getElectronAPI();
        if (!api) return;
        const unsubscribe = api.onMenu(channel, (...args) => handlerRef.current(...args));
        return unsubscribe;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel, ...deps]);
}
