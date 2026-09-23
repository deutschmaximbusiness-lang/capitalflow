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
            if (e) e.style.display = (id === panel) ? 'block' : 'none';
        });
    }

    function loginScreenAn() {
        const s = el('loginScreen');
        if (s) { s.classList.remove('hidden'); s.style.opacity = '1'; }
        document.querySelectorAll('.navbar, .sidebar, .container')
            .forEach(function (e) { e.style.display = 'none'; });
        const a = el('adminPanel');
        if (a) a.classList.add('hidden');
    }

    function appAn() {
        const s = el('loginScreen');
        if (s) s.classList.add('hidden');
        const nav = document.querySelector('.navbar');
        const side = document.querySelector('.sidebar');
        const cont = document.querySelector('.container');
        if (nav) nav.style.display = 'flex';
        if (side) side.style.display = 'block';
        if (cont) cont.style.display = 'block';
    }

    // ------------------------------------------------- Alte Daten retten
    //
    // Bis zur Umstellung auf die Datenbank liegen die Trades weiter im
    // localStorage, getrennt nach dem alten Access Key. Nach dem
    // Discord-Login lautet die Kennung aber die Nutzer-ID - ohne diesen
    // Schritt waere das Journal ploetzlich leer, und das sieht aus wie
    // Datenverlust.
    function alteDatenUebernehmen(neueKennung) {
        const BEREICHE = ['trades', 'positions', 'closedPositions',
                          'transactions', 'setups'];
        const roh = window.cfRawStorage;
        if (!roh) return 0;

        // Vorhandene Daten nicht ueberschreiben
        try {
            const schon = JSON.parse(roh.get('trades::' + neueKennung) || '[]');
            if (Array.isArray(schon) && schon.length > 0) return 0;
        } catch (e) { /* weiter */ }

        const fremdeKennungen = new Set();
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const m = k && k.match(/^trades::(.+)$/);
            if (m && m[1] !== neueKennung) fremdeKennungen.add(m[1]);
        }

        // Nur bei genau einer alten Kennung uebernehmen. Bei mehreren
        // haben verschiedene Leute denselben Browser benutzt - dann waere
        // jede Wahl geraten, und fremde Trades im eigenen Journal sind
        // schlimmer als ein leeres Journal.
        if (fremdeKennungen.size !== 1) return 0;
        const alt = Array.from(fremdeKennungen)[0];

        let uebernommen = 0;
        BEREICHE.forEach(function (b) {
            const wert = roh.get(b + '::' + alt);
            if (!wert) return;
            roh.set(b + '::' + neueKennung, wert);
            try {
                const liste = JSON.parse(wert);
                if (Array.isArray(liste)) uebernommen += liste.length;
            } catch (e) { /* egal */ }
        });
        return uebernommen;
    }

    // ------------------------------------------------------ App starten

    function appStarten() {
        const kennung = nutzer.id;
        const name = (profil && (profil.invite_name || profil.name)) || 'Verbunden';

        window.cfRawStorage.set('capitalflow_current_key', kennung);
        window.cfRawStorage.set('capitalflow_current_name', name);
        localStorage.setItem('capitalflow_logged_in', 'true');

        const gerettet = alteDatenUebernehmen(kennung);

        appAn();
        [window.loadTrades, window.loadPositions, window.loadTransactions,
         window.loadSetups, window.loadDashboard, window.loadAnalytics,
         window.loadCalendar].forEach(function (fn) {
            try { if (typeof fn === 'function') fn(); }
            catch (err) { console.error('Ansicht fehlgeschlagen:', err); }
        });

        let bestand = [];
        try { bestand = JSON.parse(localStorage.getItem('trades')) || []; }
        catch (e) { /* egal */ }

        if (typeof showWelcome === 'function') {
            showWelcome(name, bestand.length > 0);
        }
        if (typeof renderSessionBadge === 'function') renderSessionBadge();

        if (gerettet > 0) {
            setTimeout(function () {
                meldung('✅ ' + gerettet + ' Einträge aus deinem bisherigen '
                        + 'Zugang übernommen', 'success');
            }, 1400);
        }
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
        const n = el('authDiscordName');
        if (n) n.textContent = (profil && profil.name)
            || (nutzer.user_metadata && nutzer.user_metadata.full_name)
            || nutzer.email || 'Discord-Konto';
        zeige('authPanelKey');
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
        try { await window.cfDb.auth.signOut(); } catch (e) { /* egal */ }
        window.cfRawStorage.remove('capitalflow_current_key');
        window.cfRawStorage.remove('capitalflow_current_name');
        localStorage.removeItem('capitalflow_logged_in');
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
