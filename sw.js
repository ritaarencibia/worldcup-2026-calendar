/* Minimal service worker for the World Cup 2026 calendar.
 * Goal: open instantly and work offline, while still showing fresh results
 * when there's a connection. Strategy: precache the app shell on install, then
 * serve every GET network-first and fall back to the cache when offline. */
'use strict';

const CACHE = 'wc2026-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/teams.js',
  './data/matches.js',
  './data/results.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => { /* a missing asset must not block install */ })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
