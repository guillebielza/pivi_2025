// sw.js — Hace que Pivi se pueda instalar como app y abra aunque no haya conexión.
// Primero intenta la versión de internet (así los cambios llegan al momento)
// y, si no hay conexión, usa la copia guardada en el móvil.
// Los puntos NO pasan por aquí: la sincronización con Supabase va directa a la red.
// Cambia el número de versión cuando añadas o quites archivos de la lista.
const CACHE = 'pivi-v1';
const FILES = [
  './', './index.html', './retos.html',
  './quiz.html', './wordle.html', './memory.html', './missing.html',
  './simon.html', './reflejos.html', './atrapa.html',
  './theme.css', './styles.css', './retos.css', './quiz.css', './wordle.css',
  './memory.css', './missing.css', './simon.css', './reflejos.css', './atrapa.css',
  './pivi-core.js', './cloud-config.js', './pivi-config.js', './pivi-dev.js',
  './pivi-ledger.js', './cloud-sync.js', './points-policy.js', './app.js', './retos.js',
  './quiz.js', './wordle.js', './memory.js', './missing.js',
  './simon.js', './reflejos.js', './atrapa.js',
  './recompensas.json', './preguntas.json', './words-es5.txt',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // uno a uno: si falta algún archivo, el resto se guarda igual
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))
  )));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase, fuentes…: directo a la red
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
