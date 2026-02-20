/// <reference lib="webworker" />

/**
 * Procura PWA Service Worker
 * Provides offline caching and PWA functionality for the web version
 */

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'procura-pwa-v1';

// Assets to cache for offline use
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Skip waiting to activate immediately
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    // Claim all clients immediately
    self.clients.claim();
});

const SHARE_CACHE = 'share-target-cache';

// Fetch event - handle share target POST and serve cached GET responses
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // ---- Web Share Target: intercept POST to /_share-target ----
    if (request.method === 'POST' && url.pathname === '/_share-target') {
        event.respondWith(handleShareTarget(request));
        return;
    }

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip chrome-extension and other non-http requests
    if (!request.url.startsWith('http')) {
        return;
    }

    // Skip API requests - these should always go to network
    if (request.url.includes('/api/') ||
        request.url.includes('generativelanguage.googleapis.com') ||
        request.url.includes('sync.php')) {
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((networkResponse) => {
                // Cache successful responses for static assets
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }

                return networkResponse;
            });
        })
    );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});

/**
 * Handle Web Share Target POST requests from the OS share sheet.
 * Stores shared text and files in a dedicated cache so the React app can read them on mount.
 */
async function handleShareTarget(request: Request): Promise<Response> {
    try {
        const formData = await request.formData();
        const cache = await caches.open(SHARE_CACHE);

        // Store text fields as a JSON blob
        const textPayload: Record<string, string> = {};
        for (const key of ['title', 'text', 'url']) {
            const value = formData.get(key);
            if (value && typeof value === 'string') {
                textPayload[key] = value;
            }
        }
        await cache.put(
            new Request('/_share-target/text'),
            new Response(JSON.stringify(textPayload), {
                headers: { 'Content-Type': 'application/json' },
            })
        );

        // Store shared files
        const files = formData.getAll('media');
        const fileMetadata: Array<{ name: string; type: string; size: number; cacheKey: string }> = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file instanceof File) {
                const cacheKey = `/_share-target/file-${i}`;
                await cache.put(
                    new Request(cacheKey),
                    new Response(file, {
                        headers: {
                            'Content-Type': file.type || 'application/octet-stream',
                            'X-File-Name': encodeURIComponent(file.name),
                            'X-File-Size': String(file.size),
                        },
                    })
                );
                fileMetadata.push({
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    cacheKey,
                });
            }
        }

        // Store file manifest so the app knows how many files to read
        await cache.put(
            new Request('/_share-target/manifest'),
            new Response(JSON.stringify(fileMetadata), {
                headers: { 'Content-Type': 'application/json' },
            })
        );

        console.log(`[SW] Share target received: ${Object.keys(textPayload).length} text fields, ${fileMetadata.length} files`);

        // Redirect to the app with a marker query param
        return Response.redirect('/?share-target', 303);
    } catch (err) {
        console.error('[SW] Share target error:', err);
        return Response.redirect('/', 303);
    }
}

export { };
