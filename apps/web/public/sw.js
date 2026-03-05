// PDF Max — Service Worker
// Provides offline caching for the app shell, PDFs, and static assets.
// Auth calls to Supabase are always passed through (never cached).

const CACHE_VERSION = 'pdfmax-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PDF_CACHE = `${CACHE_VERSION}-pdf`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// App shell assets to pre-cache on install
const PRECACHE_ASSETS = [
    '/',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/icon-192.svg',
    '/icon-512.svg',
    '/apple-touch-icon.svg',
];

// ── Install: pre-cache the app shell ───────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing…');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE_ASSETS))
            .then(() => {
                console.log('[SW] Pre-cache complete');
                return self.skipWaiting();
            })
            .catch((err) => {
                // Non-fatal: if pre-cache fails (e.g. offline install), still activate
                console.warn('[SW] Pre-cache partial failure:', err);
                return self.skipWaiting();
            })
    );
});

// ── Activate: clean up old caches ─────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating…');
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k.startsWith('pdfmax-') && k !== STATIC_CACHE && k !== PDF_CACHE && k !== RUNTIME_CACHE)
                    .map((k) => {
                        console.log('[SW] Deleting old cache:', k);
                        return caches.delete(k);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ── Helpers ───────────────────────────────────────────────────────────
const isSupabase = (url) =>
    url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io');

const isPdf = (url) =>
    url.pathname.endsWith('.pdf') || url.searchParams.has('pdf');

const isNextStatic = (url) =>
    url.pathname.startsWith('/_next/static/');

const isImage = (url) =>
    /\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(url.pathname);

// ── Fetch: routing strategy ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle GET requests
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never cache Supabase auth/API calls — always go to network
    if (isSupabase(url)) return;

    // Skip non-same-origin requests (CDNs, external APIs) unless known safe
    if (url.origin !== self.location.origin && !isPdf(url) && !isNextStatic(url)) return;

    // PDF files: Cache-First (large, rarely change, critical for offline use)
    if (isPdf(url)) {
        event.respondWith(
            caches.open(PDF_CACHE).then(async (cache) => {
                const cached = await cache.match(request);
                if (cached) return cached;
                try {
                    const response = await fetch(request);
                    if (response.ok) cache.put(request, response.clone());
                    return response;
                } catch {
                    return new Response('PDF unavailable offline', { status: 503 });
                }
            })
        );
        return;
    }

    // Next.js static assets (JS, CSS, images): StaleWhileRevalidate
    // — serve from cache instantly, refresh in background
    if (isNextStatic(url) || isImage(url)) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(async (cache) => {
                const cached = await cache.match(request);
                const fetchPromise = fetch(request).then((response) => {
                    if (response.ok) cache.put(request, response.clone());
                    return response;
                }).catch(() => cached); // silently use cache on network error
                return cached ?? fetchPromise;
            })
        );
        return;
    }

    // Everything else (pages, API routes): NetworkFirst with cache fallback
    // — try network; if it fails (offline), serve from cache
    event.respondWith(
        fetch(request)
            .then((response) => {
                // Cache successful navigations for offline fallback
                if (response.ok && request.mode === 'navigate') {
                    caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone()));
                }
                return response;
            })
            .catch(async () => {
                // Offline fallback: try cache first, then the root page
                const cached = await caches.match(request);
                if (cached) return cached;
                // For navigations, fall back to cached root page
                if (request.mode === 'navigate') {
                    return caches.match('/') ?? new Response('Offline', { status: 503 });
                }
                return new Response('Offline', { status: 503 });
            })
    );
});
