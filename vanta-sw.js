// Vanta Drift offline helper. It keeps a copy of the game, its 3D engine, icons and fonts on the device,
// so the game opens with no connection. It only handles Vanta Drift's own files; every other game on this site is left alone.
const CACHE = 'vanta-drift-v28';
const CORE = [
  'vanta-drift.html',
  'vanta-drift.webmanifest',
  'img/favicon.png',
  'img/apple-touch-icon.png',
  'img/icon-512.png',
  'vendor/three/build/three.min.js',
  'vendor/three/examples/js/shaders/CopyShader.js',
  'vendor/three/examples/js/postprocessing/EffectComposer.js',
  'vendor/three/examples/js/postprocessing/ShaderPass.js',
  'vendor/three/examples/js/postprocessing/RenderPass.js',
  'vendor/three/examples/js/shaders/LuminosityHighPassShader.js',
  'vendor/three/examples/js/postprocessing/UnrealBloomPass.js',
  'vendor/three/examples/js/environments/RoomEnvironment.js'
];
const BASE = new URL('./', self.location).href;
const MINE = CORE.map(p => new URL(p, BASE).href);
const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vanta-drift-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url), href = u.origin + u.pathname;
  const game = href === MINE[0];
  if (!game && !MINE.includes(href) && !isFont(u)) return;   // not ours: the browser handles it as normal

  if (game) {
    // the game page: try the network first so updates arrive, fall back to the saved copy when offline
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(MINE[0], copy)); }
      return res;
    }).catch(() => caches.match(MINE[0])));
    return;
  }
  // engine, icons and fonts: use the saved copy, fetch and save it if missing
  e.respondWith(caches.match(req, { ignoreSearch: !isFont(u) }).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
