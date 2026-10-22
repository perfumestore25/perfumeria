// Cache para uso sin conexión cuando se usa como app web (PWA)
const CACHE = 'perfumeria-v3';
const ARCHIVOS = ['./', './index.html', './styles.css', './app.js', './importar.js', './nube.js', './config-nube.js', './logo.png', './logo-192.png',
  './manifest.webmanifest', './formato_inventario.xlsx', './lib/xlsx.full.min.js',
  './lib/firebase-app-compat.js', './lib/firebase-auth-compat.js', './lib/firebase-firestore-compat.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Red primero (para recibir actualizaciones) y caché si no hay conexión
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});
