/**
 * Native bridge — Capacitor (iOS) or Electron (macOS desktop).
 * All functions are no-ops / browser-fallbacks when running in a plain browser.
 */

import { Capacitor } from '@capacitor/core';
import { getElectronAPI } from './useElectron';

export const isNative = () => Capacitor.isNativePlatform();
export const isIOS = () => Capacitor.getPlatform() === 'ios';

// ─── File Sharing ─────────────────────────────────────────────────────────────

/**
 * Share/export a blob (e.g. exported PDF).
 * Priority: Electron native save → Capacitor iOS share sheet → browser link download.
 */
export async function shareFile(blob: Blob, filename: string): Promise<void> {
    // ── Electron: use native save dialog ─────────────────────────────────────────
    const electronAPI = getElectronAPI();
    if (electronAPI) {
        const base64 = await blobToBase64(blob);
        await electronAPI.saveFile({ filename, data: base64 });
        return;
    }

    if (isNative()) {
        const { Share } = await import('@capacitor/share');
        const { Filesystem, Directory } = await import('@capacitor/filesystem');

        // Write to temp file
        const base64 = await blobToBase64(blob);
        const result = await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Cache,
        });

        await Share.share({
            title: filename,
            url: result.uri,
            dialogTitle: 'Save or share PDF',
        });

        // Clean up temp file after a delay
        setTimeout(async () => {
            try { await Filesystem.deleteFile({ path: filename, directory: Directory.Cache }); }
            catch { /* ignore */ }
        }, 30_000);
    } else {
        // Web fallback
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

/**
 * Save a blob to the iOS Files app (user-accessible location).
 */
export async function saveToFiles(blob: Blob, filename: string): Promise<boolean> {
    if (!isNative()) return false;
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
    });
    return true;
}

// ─── Haptics ─────────────────────────────────────────────────────────────────

export async function hapticLight(): Promise<void> {
    if (!isNative()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
}

export async function hapticMedium(): Promise<void> {
    if (!isNative()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
}

// ─── Apple Pencil pressure mapping ───────────────────────────────────────────

/**
 * Map Apple Pencil pressure (0–1) to a stroke width.
 * Pencil events come in as PointerEvent with `pressure` property.
 * The Fabric.js freehand tool can consume this via the `mouse:down` event.
 */
export function pencilPressureToWidth(
    pressure: number,
    minWidth = 1,
    maxWidth = 8
): number {
    const clamped = Math.max(0, Math.min(1, pressure));
    return minWidth + clamped * (maxWidth - minWidth);
}

/**
 * Install a pointer-event listener that enriches PointerEvents with
 * Apple Pencil tilt/pressure metadata and fires `pdfmax:pencil-move`
 * custom events that the canvas tools can consume.
 */
export function installApplePencilListener(container: HTMLElement): () => void {
    const onPointerMove = (e: PointerEvent) => {
        if (e.pointerType !== 'pen') return;
        window.dispatchEvent(new CustomEvent('pdfmax:pencil-move', {
            detail: {
                pressure: e.pressure,
                tiltX: e.tiltX,
                tiltY: e.tiltY,
                width: pencilPressureToWidth(e.pressure),
            },
        }));
    };
    container.addEventListener('pointermove', onPointerMove);
    return () => container.removeEventListener('pointermove', onPointerMove);
}

// ─── Status bar ──────────────────────────────────────────────────────────────

export async function setStatusBarDark(): Promise<void> {
    if (!isNative()) return;
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1e1b4b' });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
