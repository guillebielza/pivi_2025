// sw.js — Hace que Pivi se pueda instalar como app y abra aunque no haya conexión.
// Primero intenta la versión de internet (así los cambios llegan al momento)
// y, si no hay conexión, usa la copia guardada en el móvil.
// Los puntos NO pasan por aquí: la sincronización con Supabase va directa a la red.
// Cambia el número de versión cuando añadas o quites archivos de la lista.
const CACHE = 'pivi-v6';
const FILES = [
  './', './index.html', './retos.html', './premios.html', './recuerdos.html',
  './quiz.html', './wordle.html', './memory.html', './missing.html',
  './simon.html', './reflejos.html', './atrapa.html', './muro.html', './vuelo.html',
  './theme.css', './styles.css', './retos.css', './quiz.css', './wordle.css',
  './memory.css', './missing.css', './simon.css', './reflejos.css', './atrapa.css', './muro.css', './vuelo.css',
  './pivi-core.js', './cloud-config.js', './pivi-config.js', './pivi-dev.js',
  './pivi-ledger.js', './cloud-sync.js', './points-policy.js', './app.js', './retos.js', './recuerdos.js', './recuerdos.css', './pivi-premios.js', './premios.js', './premios.css',
  './quiz.js', './wordle.js', './memory.js', './missing.js',
  './simon.js', './reflejos.js', './atrapa.js', './muro.js', './vuelo.js',
  './recompensas.json', './preguntas.json', './words-es5.txt', './words-sol5.txt',
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

// Con cobertura muy mala la red puede tardar muchísimo sin llegar a fallar:
// si en NET_WAIT_MS no ha respondido y hay copia guardada, se usa la copia
// (la descarga sigue por detrás y actualiza la copia para la próxima vez).
const NET_WAIT_MS = 3500;

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase, fuentes…: directo a la red

  const network = fetch(req).then(r => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return r;
  });
  e.waitUntil(network.catch(() => {}));

  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { fromCache(req).then(finish); }, NET_WAIT_MS);
    network
      .then(r => { clearTimeout(timer); finish(r); })
      .catch(() => {
        clearTimeout(timer);
        fromCache(req).then(hit => { if (hit) finish(hit); else finish(Response.error()); });
      });
  }));
});
