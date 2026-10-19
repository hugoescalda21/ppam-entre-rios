// Service worker de PPAM Entre Ríos: guarda la página y Firebase para que abra rápido y también sin señal.
const CACHE = 'ppam-v53';
const SDK = 'ppam-sdk-10.13.2';   // Firebase (gstatic): misma versión = mismo archivo, se guarda una vez para abrir sin señal
const SDK_URLS = ['app', 'auth', 'firestore'].map(n => `https://www.gstatic.com/firebasejs/10.13.2/firebase-${n}-compat.js`);
const ASSETS = ['./', './index.html', './app.js?v=51', './coord.js?v=51', './app.css?v=51', './firebase-config.js?v=51', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png', './icon-64.png'];
self.addEventListener('install', (e) => { e.waitUntil(Promise.all([caches.open(CACHE).then(c => c.addAll(ASSETS)), caches.open(SDK).then(c => Promise.all(SDK_URLS.map(u => c.match(u).then(r => r || fetch(u, { mode: 'no-cors' }).then(n => c.put(u, n)))))).catch(() => {})])); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ppam-') && !k.startsWith('ppam-fotos') && k !== SDK && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'GET' && u.origin === 'https://www.gstatic.com' && u.pathname.startsWith('/firebasejs/10.13.2/')) {
    e.respondWith(caches.open(SDK).then(c => c.match(e.request).then(r => r || fetch(e.request).then(n => { if (n.ok || n.type === 'opaque') c.put(e.request, n.clone()); return n; }))));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Primero la red (así siempre ves la última versión); si no hay conexión, lo guardado.
  // cache: 'no-cache' = siempre pregunta al servidor si hay algo nuevo (si no cambió, la respuesta es mínima).
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
