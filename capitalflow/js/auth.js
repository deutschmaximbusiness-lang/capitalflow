/* CapitalFlow - Anmeldung ueber Discord
 *
 * Ablauf:
 *   1. "Mit Discord anmelden"  -> Supabase leitet zu Discord und zurueck
 *   2. Konto existiert, ist aber gesperrt (profiles.activated = false)
 *   3. Nutzer gibt seinen Access Key ein -> einladung_einloesen()
 *   4. Freigeschaltet, App startet
 *
 * Die Sperre sitzt in der Datenbank, nicht hier. Diese Datei entscheidet
 * nur, was angezeigt wird - wer die Oberflaeche austrickst, bekommt vom
 * Server trotzdem keine Zeile.
 */
(function () {
    'use strict';

    const ELEMENTE = {};
    let nutzer = null;      // Supabase-Nutzer
    let profil = null;      // Zeile aus profiles

    // onAuthStateChange feuert mehrfach (INITIAL_SESSION, SIGNED_IN,
    // TOKEN_REFRESHED) und zustandPruefen laeuft zusaetzlich beim Start.
    // Ohne diese Sperren wuerde die App mehrfach hochgefahren - und das
    // Fenster fuer alte Daten kaeme nach jedem Schliessen erneut.
    let appLaeuft = false;
    let pruefungLaeuft = false;
    let datenGefragt = false;

    function el(id) {
        if (!(id in ELEMENTE)) ELEMENTE[id] = document.getElementById(id);
        return ELEMENTE[id];
    }

    function meldung(text, typ) {
        if (typeof showToast === 'function') showToast(text, typ);
        else console.log(text);
    }

    // ---------------------------------------------------------- Ansichten

    function zeige(panel) {
        ['authPanelLogin', 'authPanelKey', 'authPanelAdmin'].forEach(function (id) {
            const e = el(id);
            if (e) e.style.display = (id === panel) ? 'flex' : 'none';
        });
    }

    // Verstecken und Anzeigen muessen exakt dieselben Elemente treffen.
    // Die Seite hat ZWEI Elemente mit der Klasse .container - eines um
    // die SVG-Symbole, eines um die Tabs. Wer alle versteckt, aber nur
    // das erste zurueckholt, hat eine App mit leeren Tabs.
    function alleBereiche() {
        return document.querySelectorAll('.navbar, .sidebar, .container');
    }

    function loginScreenAn() {
        const s = el('loginScreen');
        if (s) { s.classList.remove('hidden'); s.style.opacity = '1'; }
        alleBereiche().forEach(function (e) { e.style.display = 'none'; });
        const a = el('adminPanel');
        if (a) a.classList.add('hidden');
    }

    function appAn() {
        const s = el('loginScreen');
        if (s) s.classList.add('hidden');
        alleBereiche().forEach(function (e) {
            // Die Navbar ist ein Flex-Container, der Rest normale Bloecke.
            // Inline-Stil entfernen statt setzen waere sauberer, aber
            // app.js setzt an anderer Stelle ebenfalls inline - dann
            // gewaenne dort der alte Wert.
            e.style.display = e.classList.contains('navbar') ? 'flex' : 'block';
        });
    }

    // ------------------------------------------------- Alte Daten retten
    //
    // Bis zur Umstellung auf die Datenbank liegen die Trades weiter im
    // localStorage, getrennt nach dem alten Access Key. Nach dem
    // Discord-Login lautet die Kennung aber die Nutzer-ID - ohne diesen
    // Schritt waere das Journal ploetzlich leer, und das sieht aus wie
    // Datenverlust.
    // Merkt sich, welcher Ablageort zu diesem Konto gehoert.
    const ABLAGE = 'capitalflow_ablage::';

    function ablageFuer(uid) {
        const gemerkt = window.cfRawStorage.get(ABLAGE + uid);
        return gemerkt || uid;
    }

    /**
     * Liefert den Ablageort fuer diesen Nutzer.
     *
     * Frueher wurden die Daten vom alten Access Key auf die Nutzer-ID
     * KOPIERT. Das war falsch: Screenshots liegen als Base64 im Speicher,
     * das Kopieren verdoppelt alles, und der Browser bricht mit
     * QuotaExceededError ab - stillschweigend, weil der Fehler nirgends
     * abgefangen wurde. Ergebnis: leeres Journal, und beim naechsten Laden
     * dieselbe Frage von vorn.
     *
     * Kopiert wird jetzt gar nichts mehr. Die Daten bleiben liegen, wo sie
     * sind, und die App merkt sich nur, welcher Ort zu diesem Konto
     * gehoert. Kostet null Speicher und kann nicht fehlschlagen.
     */
    function ablageWaehlen(uid) {
        const roh = window.cfRawStorage;
        if (!roh) return uid;

        // Schon einmal entschieden
        const gemerkt = roh.get(ABLAGE + uid);
        if (gemerkt) return gemerkt;

        // Unter der Nutzer-ID liegt bereits etwas
        try {
            const schon = JSON.parse(roh.get('trades::' + uid) || '[]');
            if (Array.isArray(schon) && schon.length > 0) return uid;
        } catch (e) { /* weiter */ }

        const orte = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const m = k && k.match(/^trades::(.+)$/);
            if (!m || m[1] === uid) continue;
            let n = 0;
            try { n = (JSON.parse(roh.get(k) || '[]') || []).length; }
            catch (e) { n = 0; }
            if (n > 0) orte.push({ ort: m[1], anzahl: n });
        }

        if (orte.length === 0) return uid;

        if (orte.length === 1) {
            roh.set(ABLAGE + uid, orte[0].ort);
            return orte[0].ort;
        }

        // Mehrere: nicht raten, sondern fragen. Bis dahin das leere,
        // eigene Fach benutzen - nie ein fremdes.
        orte.sort(function (a, b) { return b.anzahl - a.anzahl; });
        frageWelcheDaten(orte, uid);
        return uid;
    }

    function frageWelcheDaten(orte, uid) {
        if (datenGefragt) return;
        // "Später entscheiden" gilt bis zum Schliessen des Fensters -
        // bei jedem Neuladen erneut zu fragen waere Belaestigung, es
        // ganz zu vergessen waere Datenverlust
        if (sessionStorage.getItem('capitalflow_altdaten_spaeter') === '1') return;
        datenGefragt = true;

        const box = el('altdatenListe');
        const modal = el('altdatenModal');
        if (!box || !modal) return;

        box.innerHTML = orte.map(function (o) {
            const kurz = o.ort.length > 14
                ? o.ort.slice(0, 6) + '…' + o.ort.slice(-4) : o.ort;
            return '<button class="altdaten-wahl" data-ort="' + o.ort + '">'
                 + '<span class="altdaten-kennung">' + kurz + '</span>'
                 + '<span class="altdaten-anzahl">' + o.anzahl + ' Trades</span></button>';
        }).join('');

        box.querySelectorAll('.altdaten-wahl').forEach(function (b) {
            b.addEventListener('click', function () {
                // Nur den Zeiger setzen - die Daten bleiben, wo sie sind
                window.cfRawStorage.set(ABLAGE + uid, b.dataset.ort);
                modal.style.display = 'none';
                setTimeout(function () { location.reload(); }, 400);
            });
        });

        // Erst zeigen, wenn die App steht - sonst liegt das Fenster
        // ueber einem halb aufgebauten Bildschirm
        setTimeout(function () { modal.style.display = 'flex'; }, 700);
    }

    window.cfAltdatenSpaeter = function () {
        const m = el('altdatenModal');
        if (m) m.style.display = 'none';
        try { sessionStorage.setItem('capitalflow_altdaten_spaeter', '1'); }
        catch (e) { /* egal */ }
        meldung('Du kannst die Daten später über "Daten" einspielen', 'info');
    };

    // ------------------------------------------------ Kennzeichen oben rechts
    //
    // Zeigt Discord-Name und Profilbild statt des Key-Namens. Der Key
    // selbst taucht nirgends mehr auf - er ist nach der Freischaltung
    // ohnehin verbraucht, und in Screenshots hat er nichts zu suchen.
    function badgeSetzen() {
        const badge = el('sessionBadge');
        if (!badge) return;

        const meta = (nutzer && nutzer.user_metadata) || {};
        const name = (profil && profil.name)
            || meta.full_name || meta.name || meta.user_name
            || (nutzer && nutzer.email) || 'Verbunden';
        const bild = (profil && profil.avatar_url) || meta.avatar_url || '';

        const n = el('sessionName');
        if (n) n.textContent = name;

        const img = el('sessionAvatar');
        const punkt = el('sessionDot');
        if (img) {
            if (bild) {
                img.src = bild;
                img.style.display = 'block';
                // Faellt das Bild aus (geloeschter Avatar, kein Netz),
                // auf den gruenen Punkt zurueck statt auf ein Platzhalterbild
                img.onerror = function () {
                    img.style.display = 'none';
                    if (punkt) punkt.style.display = 'block';
                };
                if (punkt) punkt.style.display = 'none';
            } else {
                img.style.display = 'none';
                if (punkt) punkt.style.display = 'block';
            }
        }

        // Der abgeschnittene Key war die Notloesung, solange es keine
        // Konten gab. Jetzt gibt es welche.
        const sep = el('sessionSep');
        const key = el('sessionKey');
        if (sep) sep.style.display = 'none';
        if (key) key.style.display = 'none';

        badge.style.display = 'flex';
    }

    // ------------------------------------------------------ App starten

    function appStarten() {
        if (appLaeuft) { badgeSetzen(); return; }
        appLaeuft = true;

        // Der Ablageort ist nicht zwingend die Nutzer-ID: wer vorher mit
        // einem Access Key gearbeitet hat, dessen Daten liegen weiter
        // unter dessen Kennung. Verschoben wird nichts.
        const kennung = ablageWaehlen(nutzer.id);

        // Discord-Name hat Vorrang vor dem Namen aus der Einladung: so
        // heisst man ueberall gleich wie im Server, aus dem man kommt.
        const meta = (nutzer && nutzer.user_metadata) || {};
        const name = (profil && profil.name) || meta.full_name || meta.name
            || meta.user_name || (profil && profil.invite_name) || 'Verbunden';

        window.cfRawStorage.set('capitalflow_current_key', kennung);
        window.cfRawStorage.set('capitalflow_current_name', name);
        localStorage.setItem('capitalflow_logged_in', 'true');

        appAn();
        ansichtenAufbauen();

        let bestand = [];
        try { bestand = JSON.parse(localStorage.getItem('trades')) || []; }
        catch (e) { /* egal */ }

        if (typeof showWelcome === 'function') {
            showWelcome(name, bestand.length > 0);
        }
        badgeSetzen();

        // Hinweis nur, wenn die Daten aus einem frueheren Zugang stammen
        if (kennung !== nutzer.id && bestand.length > 0) {
            setTimeout(function () {
                meldung('✅ ' + bestand.length + ' Trades aus deinem '
                        + 'bisherigen Zugang', 'success');
            }, 1400);
        }

        // Datenbank nachholen und die Ansichten ein zweites Mal aufbauen.
        // Erst zeigen, dann aktualisieren: die App steht sofort da, statt
        // den Nutzer auf eine Netzantwort warten zu lassen. Der erste
        // Aufbau zeigt den Zwischenspeicher, der zweite die Wahrheit.
        if (typeof window.cfDatenLaden === 'function') {
            window.cfDatenLaden().then(function (r) {
                if (!r.ok) {
                    if (r.grund === 'ungesicherte') {
                        // Im Browser liegt mehr als in der Datenbank -
                        // bis die Schreibwege umgestellt sind, hat der
                        // lokale Stand Vorrang
                        meldung('⚠️ ' + r.lokal + ' Einträge sind noch nicht '
                                + 'in der Datenbank – bitte über Daten → '
                                + 'Sicherung herunterladen', 'error');
                        return;
                    }
                    console.warn('Daten konnten nicht geladen werden:', r.grund);
                    meldung('⚠️ Zeige den letzten Stand – Datenbank nicht erreichbar',
                            'error');
                    return;
                }
                ansichtenAufbauen();
            });
        }
    }

    // Wird auch von js/speichern.js gebraucht, nach jeder Aenderung
    window.cfAnsichtenAufbauen = ansichtenAufbauen;

    function ansichtenAufbauen() {
        [window.loadTrades, window.loadPositions, window.loadTransactions,
         window.loadSetups, window.loadDashboard, window.loadAnalytics,
         window.loadCalendar].forEach(function (fn) {
            try { if (typeof fn === 'function') fn(); }
            catch (err) { console.error('Ansicht fehlgeschlagen:', err); }
        });
    }

    // ------------------------------------------------------ Zustand pruefen

    async function profilLaden() {
        const { data, error } = await window.cfDb
            .from('profiles')
            .select('id, name, invite_name, activated, avatar_url')
            .eq('id', nutzer.id)
            .maybeSingle();
        if (error) {
            console.error('Profil konnte nicht geladen werden:', error);
            return null;
        }
        return data;
    }

    async function zustandPruefen() {
        if (pruefungLaeuft) return;
        pruefungLaeuft = true;
        try {
            await pruefen();
        } finally {
            pruefungLaeuft = false;
        }
    }

    async function pruefen() {
        const { data } = await window.cfDb.auth.getSession();
        nutzer = data && data.session ? data.session.user : null;

        if (!nutzer) {
            profil = null;
            loginScreenAn();
            zeige('authPanelLogin');
            return;
        }

        profil = await profilLaden();

        // Das Profil entsteht per Trigger. Bei der allerersten Anmeldung
        // kann die Abfrage schneller sein als der Trigger - einmal kurz
        // warten, statt den Nutzer auf einen Fehler laufen zu lassen.
        if (!profil) {
            await new Promise(function (r) { setTimeout(r, 900); });
            profil = await profilLaden();
        }

        if (profil && profil.activated) {
            appStarten();
            return;
        }

        loginScreenAn();

        const meta = nutzer.user_metadata || {};
        const n = el('authDiscordName');
        if (n) n.textContent = (profil && profil.name) || meta.full_name
            || meta.name || meta.user_name || nutzer.email || 'Discord-Konto';

        const bild = (profil && profil.avatar_url) || meta.avatar_url || '';
        const img = el('authDiscordAvatar');
        if (img) {
            if (bild) {
                img.src = bild;
                img.style.display = 'block';
                img.onerror = function () { img.style.display = 'none'; };
            } else {
                img.style.display = 'none';
            }
        }

        zeige('authPanelKey');
        const feld = el('inviteKeyInput');
        if (feld) setTimeout(function () { feld.focus(); }, 120);
    }

    // ---------------------------------------------------------- Aktionen

    async function discordAnmelden() {
        const btn = el('discordLoginBtn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

        // Zurueck genau auf diese Seite, ohne Query-Anhaengsel
        const ziel = window.location.origin + window.location.pathname;
        const { error } = await window.cfDb.auth.signInWithOAuth({
            provider: 'discord',
            options: { redirectTo: ziel },
        });

        if (error) {
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
            meldung('❌ Anmeldung fehlgeschlagen: ' + error.message, 'error');
        }
    }

    async function keyEinloesen() {
        const feld = el('inviteKeyInput');
        const btn = el('redeemBtn');
        const key = (feld && feld.value || '').trim();
        if (!key) { meldung('❌ Bitte deinen Access Key eingeben', 'error'); return; }

        if (btn) { btn.disabled = true; btn.textContent = 'Prüfe…'; }

        // Nur der Hash verlaesst den Browser, nie der Key selbst
        const hash = sha256Hex(key);
        const { data, error } = await window.cfDb
            .rpc('einladung_einloesen', { hash: hash });

        if (btn) { btn.disabled = false; btn.textContent = 'Freischalten'; }

        if (error) {
            meldung('❌ Fehler: ' + error.message, 'error');
            return;
        }
        if (!data || !data.ok) {
            const grund = (data && data.grund) || 'ungueltig';
            meldung(grund === 'bereits verwendet'
                ? '❌ Dieser Key gehört bereits zu einem anderen Konto'
                : '❌ Access Key ungültig', 'error');
            if (feld) feld.value = '';
            return;
        }

        if (feld) feld.value = '';
        profil = await profilLaden();
        appStarten();
    }

    window.cfAbmelden = async function () {
        try { await window.cfDb.auth.signOut(); } catch (e) { /* weiter */ }

        // Sicherheitsnetz: scheitert signOut (kein Netz, abgelaufenes
        // Token), bliebe die Sitzung im Speicher liegen und man waere
        // nach dem Neuladen sofort wieder angemeldet.
        try {
            Object.keys(localStorage)
                .filter(function (k) { return k.indexOf('capitalflow_auth') === 0; })
                .forEach(function (k) { window.cfRawStorage.remove(k); });
        } catch (e) { /* weiter */ }

        window.cfRawStorage.remove('capitalflow_current_key');
        window.cfRawStorage.remove('capitalflow_current_name');
        localStorage.removeItem('capitalflow_logged_in');
        sessionStorage.removeItem('capitalflow_altdaten_spaeter');
        window.location.reload();
    };

    // ------------------------------------------------------------- Start

    function verdrahten() {
        const d = el('discordLoginBtn');
        if (d) d.addEventListener('click', discordAnmelden);

        const r = el('redeemBtn');
        if (r) r.addEventListener('click', keyEinloesen);

        const f = el('inviteKeyInput');
        if (f) f.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') keyEinloesen();
        });

        const ab = el('keyLogoutBtn');
        if (ab) ab.addEventListener('click', window.cfAbmelden);

        // Admin laeuft weiter ueber den alten Pfad in app.js
        const auf = el('showAdminBtn');
        if (auf) auf.addEventListener('click', function () { zeige('authPanelAdmin'); });
        const zu = el('backFromAdminBtn');
        if (zu) zu.addEventListener('click', function () { zeige('authPanelLogin'); });
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!window.cfDb) {
            console.error('[CapitalFlow] Keine Datenbankverbindung - '
                + 'Anmeldung nicht moeglich.');
            return;
        }
        verdrahten();
        loginScreenAn();
        zeige('authPanelLogin');

        // Nach der Rueckkehr von Discord steht das Token in der URL.
        // onAuthStateChange feuert dann mit SIGNED_IN.
        window.cfDb.auth.onAuthStateChange(function (ereignis) {
            if (ereignis === 'SIGNED_IN' || ereignis === 'INITIAL_SESSION'
                || ereignis === 'TOKEN_REFRESHED') {
                zustandPruefen();
            }
        });

        zustandPruefen();
    });
})();
