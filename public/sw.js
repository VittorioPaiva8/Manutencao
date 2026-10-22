// Service worker: guarda a tela e o SDK do Firebase para o app abrir sem internet.
// Ao mudar index.html ou app.js, aumente a VERSAO para os celulares baixarem a nova.
const VERSAO = 'chk-v8';
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const ARQUIVOS = [
  './', './index.html', './app.js', './vendor/qrcode.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  '/__/firebase/init.json',
  SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO)
    .then(c => Promise.all(ARQUIVOS.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const proprio = url.origin === location.origin;
  const estatico = url.href.startsWith(SDK) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!proprio && !estatico) return; // Firestore e login vão direto para a rede

  if (proprio && (req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.json'))) {
    // Rede primeiro (pega atualizações), cache se estiver offline.
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
    return;
  }
  // Cache primeiro para SDK, fontes e ícones.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
    return r;
  })));
});

// Toque no aviso (OS nova, requerimento urgente): abre o app que já está aberto ou um novo.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => 'focus' in x);
    return c ? c.focus() : self.clients.openWindow('./');
  }));
});
