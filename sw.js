'use strict';

/* Service worker тренажёра.
   Все пути относительные: приложение работает и из корня сайта, и из подпапки. */

const CACHE_PREFIX = 'devops-trainer-';
const CACHE_VERSION = 'v3';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

const PRECACHE_PATHS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/cards.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Request и Cache API требуют абсолютные URL: относительные пути
// разрешаем от расположения самого service worker (работает и в подпапке).
const PRECACHE = PRECACHE_PATHS.map((path) => new URL(path, self.location.href).href);

/* Ответ сервера кешируем только после проверки, что это действительно база карточек. */
async function fetchValidatedCards(url) {
  const response = await fetch(url, { cache: 'reload' });
  if (!response || !response.ok) {
    throw new Error('cards.json: HTTP ' + (response && response.status));
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('cards.json не является JSON: ' + err.message);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('cards.json: ожидался непустой массив');
  }
  const valid = data.every((card) => card
    && typeof card.id === 'string'
    && typeof card.question === 'string'
    && Array.isArray(card.options)
    && card.options.length >= 2
    && Number.isInteger(card.correct_index)
    && card.correct_index >= 0
    && card.correct_index < card.options.length);
  if (!valid) {
    throw new Error('cards.json: некорректные карточки');
  }
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      for (const url of PRECACHE) {
        const response = url.endsWith('cards.json')
          ? await fetchValidatedCards(url)
          : await fetch(url, { cache: 'reload' });
        if (!response || !response.ok) {
          throw new Error('не удалось загрузить ' + url + ' (HTTP ' + (response && response.status) + ')');
        }
        await cache.put(url, response);
      }
    } catch (err) {
      try {
        const diag = await caches.open('sw-diag');
        await diag.put(new URL('./diag.txt', self.location.href).href,
          new Response(String((err && err.stack) || err)));
      } catch (e) { /* ignore */ }
      throw err;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));

    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'READY', version: CACHE_VERSION }));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Оболочку приложения отдаём только для самого приложения,
    // остальные адреса (например, служебные страницы) идут в сеть.
    const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    if (!isShell) {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith((async () => {
      const cached = await caches.match('./index.html', { cacheName: CACHE_NAME })
        || await caches.match('./', { cacheName: CACHE_NAME });
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: CACHE_NAME });
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'PING' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION, cached: true });
  }
});
