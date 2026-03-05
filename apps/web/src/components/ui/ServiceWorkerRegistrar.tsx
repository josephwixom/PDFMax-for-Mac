'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker in production.
 * Safe no-op in development or when SW is not supported.
 */
export const ServiceWorkerRegistrar = () => {
    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
        // Registered in both dev and production so the PWA install button works in dev
        if (process.env.NODE_ENV === 'development') {
            console.log('[SW] Dev mode — registering service worker for PWA install testing');
        }

        navigator.serviceWorker
            .register('/sw.js', { scope: '/' })
            .then((reg) => {
                console.log('[SW] Registered, scope:', reg.scope);

                // Check for updates on each page load
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New version available — optionally notify user
                            console.log('[SW] New version installed — reload to update');
                        }
                    });
                });
            })
            .catch((err) => console.warn('[SW] Registration failed:', err));
    }, []);

    return null;
};
