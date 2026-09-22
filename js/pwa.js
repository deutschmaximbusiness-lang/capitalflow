/* CapitalFlow - Installation als Desktop-App
 *
 * Meldet den Service Worker an und zeigt den Installieren-Knopf, sobald
 * der Browser die App als installierbar erkennt. Nach der Installation
 * laeuft CapitalFlow in einem eigenen Fenster ohne Adressleiste und
 * ohne Tabs - wie ein normales Programm.
 */
(function () {
    'use strict';

    // Service Worker braucht https oder localhost. Beim Oeffnen per
    // file:// (Doppelklick auf index.html) gibt es keinen - dann still
    // aussteigen statt eine Fehlermeldung zu werfen.
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () {
                /* ohne Service Worker laeuft die App ganz normal weiter */
            });
        });
    }

    let installEvent = null;

    function istInstalliert() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: window-controls-overlay)').matches
            || window.navigator.standalone === true;
    }

    // Zwei Knoepfe: einer in der Navbar (nach dem Login), einer auf dem
    // Login-Screen - die Navbar ist vorher ausgeblendet, und gerade ein
    // neuer Besucher soll installieren koennen, bevor er einen Key hat.
    const KNOEPFE = ['pwaInstallBtn', 'pwaInstallBtnLogin'];

    function zeigen(an) {
        KNOEPFE.forEach(function (id) {
            const b = document.getElementById(id);
            if (b) b.style.display = an ? 'inline-flex' : 'none';
        });
    }

    // Feuert nur, wenn der Browser die App wirklich installieren kann
    // (https, Manifest, Service Worker). Chrome und Edge: ja.
    // Firefox am Desktop: nein, dort bleibt der Knopf aus.
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        installEvent = e;
        if (!istInstalliert()) zeigen(true);
    });

    window.addEventListener('appinstalled', function () {
        installEvent = null;
        zeigen(false);
    });

    window.cfInstallieren = function () {
        if (!installEvent) return;
        installEvent.prompt();
        installEvent.userChoice.finally(function () {
            installEvent = null;
            zeigen(false);
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        zeigen(false);
        // In der installierten App die Leiste "Early Access - Phase 1/4"
        // etwas schmaler ziehen, damit oben nichts gedraengt wirkt
        if (istInstalliert()) document.body.classList.add('pwa-installed');
    });
})();
