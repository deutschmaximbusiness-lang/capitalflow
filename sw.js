/* CapitalFlow Service Worker
 *
 * Zwei Strategien:
 *   - App-Dateien (html/css/js): Netz zuerst, Cache nur als Notfall.
 *     Damit landet jedes Update sofort bei allen Nutzern. Cache-first
 *     waere hier ein Fehler - Nutzer haengen sonst wochenlang auf alten
 *     Versionen fest, ohne es zu merken.
 *   - Bilder und Schriften: Cache zuerst, die aendern sich praktisch nie.
 *
 * Bei jedem Release CACHE_VERSION hochzaehlen.
 */

const CACHE_VERSION = 'cf-v9';
const CACHE_APP = CACHE_VERSION + '-app';
const CACHE_ASSETS = CACHE_VERSION + '-assets';

// Wird bei der Installation vorgeladen, damit die App auch beim ersten
// Offline-Start vollstaendig ist
const PRECACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/keys.js',
    './js/app.js',
    './js/pwa.js',
    './js/vendor/chart.min.js',
    './js/vendor/supabase.js',
    './js/supabase.js',
    './js/daten.js',
    './js/db.js',
    './js/migration.js',
    './js/laden.js',
    './js/speichern.js',
    './js/auth.js',
    './manifest.json',
    './img/capitalflow-icon.png',
    './img/capitalflow-icon-192.png',
    './img/capitalflow-icon-180.png',
    './img/capitalflow-icon-32.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_APP)
            // addAll bricht komplett ab, wenn eine einzige Datei fehlt -
            // deshalb einzeln, damit ein fehlendes Icon nicht alles kippt
            .then((cache) => Promise.all(
                PRECACHE.map((url) => cache.add(url).catch(() => null))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => !k.startsWith(CACHE_VERSION))
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

function istAsset(url) {
    return /\.(png|jpg|jpeg|svg|gif|webp|woff2?|ttf)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Chart.js und die Schriften liegen auf fremden Hosts. Ohne die im
    // Cache zeigt die installierte App offline leere Charts - also
    // einmal holen und behalten. Beide Hosts senden CORS-Header, die
    // Antwort ist also brauchbar und nicht "opaque".
    if (url.origin !== self.location.origin) {
        const extern = /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
        if (!extern.test(url.hostname)) return;
        event.respondWith(
            caches.match(req).then((hit) => hit || fetch(req).then((res) => {
                if (res.ok) {
                    const kopie = res.clone();
                    caches.open(CACHE_ASSETS).then((c) => c.put(req, kopie));
                }
                return res;
            }).catch(() => hit))
        );
        return;
    }

    // --- Bilder und Schriften: Cache zuerst
    if (istAsset(url)) {
        event.respondWith(
            caches.match(req).then((hit) => hit || fetch(req).then((res) => {
                if (res.ok) {
                    const kopie = res.clone();
                    caches.open(CACHE_ASSETS).then((c) => c.put(req, kopie));
                }
                return res;
            }))
        );
        return;
    }

    // --- App-Dateien: Netz zuerst.
    // cache: 'no-cache' ist hier entscheidend: ohne das darf der Browser
    // aus seinem eigenen HTTP-Cache antworten (GitHub Pages erlaubt zehn
    // Minuten), und der Worker legt die veraltete Antwort dann auch noch
    // ab. "Netz zuerst" waere damit nur ein Versprechen.
    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then((res) => {
                if (res.ok) {
                    const kopie = res.clone();
                    caches.open(CACHE_APP).then((c) => c.put(req, kopie));
                }
                return res;
            })
            .catch(() => caches.match(req).then(
                // Bei Navigation ohne Netz die Startseite aus dem Cache,
                // sonst zeigt der Browser seine Dino-Seite
                (hit) => hit || (req.mode === 'navigate'
                    ? caches.match('./index.html')
                    : undefined)
            ))
    );
});
