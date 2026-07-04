// Minimal service worker: makes the app installable (Add to Home Screen).
// No caching — the app always talks to the network directly.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
