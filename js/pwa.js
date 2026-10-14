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
    window.cfIstInstalliert = istInstalliert;

    // Handys ohne Installations-Dialog des Browsers (iPhone/iPad immer,
    // Android z.B. in Firefox oder wenn Chrome noch nicht so weit ist):
    // Knopf trotzdem zeigen und erklaeren, wie es von Hand geht.
    const ua = navigator.userAgent;
    const istIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const istAndroid = /Android/i.test(ua);
    const istHandy = istIos || istAndroid || /Mobi/i.test(ua);

    function anleitung() {
        let schritte, titel = 'App installieren';
        if (istIos) {
            schritte = ['Tippe auf das <b>Teilen</b>-Symbol <span class="cf-inst-symbol">' + TEILEN + '</span> (in Safari unten, in Chrome oben)',
                        'Scrolle etwas nach unten und wähle <b>„Zum Home-Bildschirm“</b>',
                        'Tippe auf <b>Hinzufügen</b>'];
        } else if (istAndroid) {
            schritte = ['Tippe oben rechts auf das Menü <span class="cf-inst-symbol">⋮</span>',
                        'Wähle <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b>',
                        'Bestätige mit <b>Installieren</b>'];
        } else {
            schritte = ['Öffne CapitalFlow in <b>Chrome</b> oder <b>Edge</b>',
                        'Klicke rechts in der Adresszeile auf das Installieren-Symbol',
                        'Bestätige mit <b>Installieren</b>'];
        }
        const alt = document.getElementById('cfInstAnleitung');
        if (alt) alt.remove();
        const box = document.createElement('div');
        box.id = 'cfInstAnleitung';
        box.className = 'cf-inst';
        box.innerHTML = '<div class="cf-inst-box" role="dialog" aria-modal="true" aria-labelledby="cfInstTitel">'
            + '<img src="' + ((document.querySelector('link[rel="apple-touch-icon"]') || {}).href || 'img/capitalflow-icon-180.png') + '" alt="" width="64" height="64">'
            + '<h3 id="cfInstTitel">' + titel + '</h3>'
            + '<p>Dann startet CapitalFlow wie eine normale App vom Home-Bildschirm, im Vollbild und mit Benachrichtigungen.</p>'
            + '<ol>' + schritte.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'
            + '<button type="button" class="cf-inst-ok">Verstanden</button></div>';
        document.body.appendChild(box);
        const zu = function () { box.remove(); document.removeEventListener('keydown', taste); };
        const taste = function (e) { if (e.key === 'Escape') zu(); };
        box.addEventListener('click', function (e) { if (e.target === box || e.target.closest('.cf-inst-ok')) zu(); });
        document.addEventListener('keydown', taste);
        box.querySelector('.cf-inst-ok').focus();
    }
    const TEILEN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';

    const STIL = '.cf-inst{position:fixed;inset:0;z-index:9999;display:grid;place-items:end center;padding:16px;background:rgba(5,4,10,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:cfInstRein .25s ease both}'
        + '.cf-inst-box{width:100%;max-width:420px;padding:28px 24px 22px;border-radius:24px;text-align:center;color:#F4F4F5;font-family:Inter,system-ui,sans-serif;background:linear-gradient(160deg,rgba(36,26,62,.98),rgba(16,13,26,.98));border:1px solid rgba(167,139,250,.25);box-shadow:0 30px 80px -20px rgba(124,92,240,.55);animation:cfInstHoch .35s cubic-bezier(.2,.7,.2,1) both}'
        + '.cf-inst-box img{border-radius:16px;box-shadow:0 12px 30px -10px rgba(192,132,252,.7)}'
        + '.cf-inst-box h3{margin:14px 0 6px;font-size:19px;font-weight:700}'
        + '.cf-inst-box p{margin:0 0 18px;color:#A1A1AA;font-size:14px;line-height:1.5}'
        + '.cf-inst-box ol{margin:0 0 20px;padding:0;list-style:none;counter-reset:s;text-align:left;display:grid;gap:10px}'
        + '.cf-inst-box li{counter-increment:s;display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-size:14px;line-height:1.45}'
        + '.cf-inst-box li::before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:linear-gradient(135deg,#7C5CF0,#C084FC);color:#fff}'
        + '.cf-inst-box b{color:#fff}'
        + '.cf-inst-symbol{display:inline-grid;place-items:center;vertical-align:middle;min-width:24px;height:24px;padding:0 4px;margin-left:4px;border-radius:7px;background:rgba(124,92,240,.25);color:#E9D5FF}'
        + '.cf-inst-ok{width:100%;min-height:46px;border:0;border-radius:999px;font:inherit;font-size:15px;font-weight:600;color:#fff;cursor:pointer;background:linear-gradient(135deg,#7C5CF0,#A855F7);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 10px 30px -8px rgba(168,85,247,.85)}'
        + '.cf-inst-ok:focus-visible{outline:2px solid #C084FC;outline-offset:3px}'
        + '@media(min-width:600px){.cf-inst{place-items:center}}'
        + '@keyframes cfInstRein{from{opacity:0}}@keyframes cfInstHoch{from{opacity:0;transform:translateY(24px)}}'
        + '@media(prefers-reduced-motion:reduce){.cf-inst,.cf-inst-box{animation:none}}';
    const stil = document.createElement('style');
    stil.textContent = STIL;
    document.head.appendChild(stil);

    window.cfInstallieren = function () {
        if (!installEvent) { anleitung(); return; }
        installEvent.prompt();
        installEvent.userChoice.finally(function () {
            installEvent = null;
            zeigen(false);
        });
    };

    function start() {
        // Auf dem Handy immer anbieten, solange nicht installiert - auch
        // ohne Dialog des Browsers (dann mit Anleitung)
        zeigen(!istInstalliert() && (!!installEvent || istHandy));
        // In der installierten App die Leiste "Early Access - Phase 1/4"
        // etwas schmaler ziehen, damit oben nichts gedraengt wirkt
        if (istInstalliert()) document.body.classList.add('pwa-installed');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
