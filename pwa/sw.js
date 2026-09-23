const CACHE_NAME = 'vuel-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne jamais intercepter les appels vers l'API back-end (ni le WebSocket) — on veut
  // toujours des données fraîches, jamais une réponse mise en cache par erreur.
  if (url.origin !== self.location.origin) return;

  // Pages HTML (navigation, ex: index.html) : réseau d'abord, cache seulement en
  // repli si hors ligne. Ça évite de servir une vieille version en cache pendant
  // le développement — le point qui posait problème avec la stratégie précédente.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Autres fichiers du shell (icônes, manifest, etc.) : cache d'abord, réseau en
  // repli, avec mise à jour silencieuse du cache.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});

// ============================================================
// PUSH "comme WhatsApp" — reçu même app/onglet fermé, tant que le
// Service Worker reste enregistré par le navigateur (miroir de
// PushDeliveryService.sendWebPush côté back-end, qui envoie ce payload JSON).
// ============================================================
self.addEventListener('push', (event) => {
  let payload = { title: 'Vuel', body: '', type: '', data: {} };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // Payload non-JSON (ne devrait jamais arriver, PushDeliveryService envoie
    // toujours du JSON.stringify) — on affiche quand même une notif minimale
    // plutôt que de silencieusement ne rien montrer.
    payload.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Vuel', {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: payload.data || {},
      tag: payload.type || undefined, // regroupe les notifs du même type au lieu d'empiler
    }),
  );
});

// Au tap sur la notification système : ramène un onglet Vuel déjà ouvert au
// premier plan s'il y en a un, sinon en ouvre un nouveau — jamais deux
// fenêtres qui s'accumulent à chaque notification tapée.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    }),
  );
});
