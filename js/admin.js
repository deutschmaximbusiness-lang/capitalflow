/* CapitalFlow - Zugangsschluessel verwalten
 *
 * Ersetzt den Ablauf "Schluessel erzeugen, Zeile nach js/keys.js
 * kopieren, committen, pushen". Der Schluessel wird hier erzeugt, im
 * Browser gehasht, und nur der Hash geht an die Datenbank. Die
 * Freischaltung wirkt sofort - ohne Deploy.
 *
 * Der Schluessel selbst wird nirgends gespeichert. Nicht im
 * localStorage, nicht in der Datenbank, nicht in einer Variablen, die
 * den Aufruf ueberlebt. Er steht genau einmal auf dem Bildschirm. Geht
 * er verloren, wird ein neuer erzeugt und der alte gesperrt - das ist
 * kein Mangel, sondern der Grund, warum ein gestohlener Datenbankdump
 * niemandem Zugang verschafft.
 *
 * Wer Admin ist, entscheidet die Datenbank (profiles.is_admin), nicht
 * diese Datei. Der Bereich hier auszublenden ist Bequemlichkeit; die
 * Sperre sitzt in den Funktionen auf der anderen Seite.
 */
(function () {
    'use strict';

    let istAdmin = false;
    let geladen = false;

    function el(id) { return document.getElementById(id); }

    function meldung(t, typ) {
        if (typeof showToast === 'function') showToast(t, typ);
    }

    function text(s) {
        return (typeof escapeHtml === 'function')
            ? escapeHtml(String(s === null || s === undefined ? '' : s))
            : String(s === null || s === undefined ? '' : s);
    }

    function datum(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '—'
            : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit',
                                              year: 'numeric' });
    }

    // ------------------------------------------------------ Admin erkennen

    /**
     * Fragt die Datenbank, ob dieses Konto den Bereich sehen darf.
     *
     * Bewusst ueber das eigene Profil und nicht ueber eine Liste im
     * Quelltext: der bisherige Admin-Zugang war ein Hash in js/keys.js,
     * geprueft allein im Browser. Der lag oeffentlich auf GitHub, und
     * wer die Javascript-Datei im eigenen Browser aendert, kommt daran
     * vorbei. Dass er nur das Panel aufmachte und keine Daten, hat das
     * ertraeglich gemacht - gut war es nie.
     */
    window.cfAdminPruefen = async function () {
        istAdmin = false;
        const nav = document.querySelector('.nav-item[data-tab="admin"]');

        try {
            if (!window.cfDb || !window.cfSitzung) return false;
            const s = await window.cfSitzung();
            if (!s) return false;

            const { data, error } = await window.cfDb.from('profiles')
                .select('is_admin').eq('id', s.user.id).maybeSingle();
            if (error) throw error;
            istAdmin = Boolean(data && data.is_admin);
        } catch (e) {
            // Kein Adminrecht ist der Normalfall, kein Fehler. Nur wenn
            // die Abfrage selbst scheitert, gehoert das in die Konsole.
            console.warn('Adminrecht nicht ermittelbar:', e.message || e);
            istAdmin = false;
        }

        if (nav) nav.style.display = istAdmin ? '' : 'none';
        return istAdmin;
    };

    // -------------------------------------------------------- Neuer Schluessel

    async function anlegen() {
        const feld = el('adminName');
        const notizFeld = el('adminNotiz');
        const btn = el('adminAnlegenBtn');
        const name = (feld && feld.value || '').trim();

        if (!name) {
            meldung('Für wen ist der Schlüssel? Name eintragen.', 'error');
            if (feld) feld.focus();
            return;
        }

        let key;
        try {
            key = generateUserKey();
        } catch (e) {
            meldung('' + e.message, 'error');
            return;
        }

        const hash = sha256Hex(key);
        if (!/^[0-9a-f]{64}$/.test(hash)) {
            meldung('Der Hash sieht falsch aus — nichts angelegt.', 'error');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Lege an…'; }

        try {
            const { data, error } = await window.cfDb.rpc('einladung_anlegen', {
                hash: hash,
                name: name,
                note: (notizFeld && notizFeld.value || '').trim() || null,
            });
            if (error) throw new Error(error.message);
            if (!data || !data.ok) throw new Error('Unerwartete Antwort.');

            // Erst jetzt anzeigen. Waere der Schluessel vorher zu sehen,
            // koennte er bei einem Fehlschlag weitergegeben werden - und
            // die Person stuende vor einer Tuer ohne Schloss dahinter.
            zeigeSchluessel(name, key);
            if (feld) feld.value = '';
            if (notizFeld) notizFeld.value = '';
            await listeLaden();
        } catch (e) {
            meldung('' + e.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Schlüssel erzeugen'; }
        }
    }

    function zeigeSchluessel(name, key) {
        const box = el('adminNeuerKey');
        if (!box) return;
        const anzeige = window.cfSchluesselAnzeigen
            ? window.cfSchluesselAnzeigen(key) : key;

        box.innerHTML =
            '<div class="admin-key-karte">'
          +   '<div class="admin-key-warn">Dieser Schlüssel steht nur '
          +   'jetzt hier. Er wird nirgends gespeichert — auch nicht in '
          +   'der Datenbank. Kopier ihn, bevor du weiterklickst.</div>'
          +   '<div class="admin-key-label">Schlüssel für ' + text(name) + '</div>'
          +   '<div class="admin-key-wert" id="adminKeyWert">' + text(anzeige) + '</div>'
          +   '<button type="button" class="btn btn-primary admin-key-btn">'
          +     'Schlüssel kopieren</button>'
          +   '<div class="admin-key-hinweis">Weitergeben und einmal '
          +   'sagen: anmelden mit Discord, dann den Schlüssel eintragen. '
          +   'Bindestriche und Groß-/Kleinschreibung sind egal.</div>'
          + '</div>';

        const btn = box.querySelector('.admin-key-btn');
        if (btn) {
            btn.addEventListener('click', function () {
                navigator.clipboard.writeText(anzeige).then(function () {
                    meldung('Schlüssel kopiert');
                }, function () {
                    meldung('Kopieren ging nicht — markier ihn von Hand.',
                        'error');
                });
            });
        }
    }

    // -------------------------------------------------------------- Liste

    async function listeLaden() {
        const box = el('adminListe');
        if (!box) return;

        box.innerHTML = '<div class="admin-liste-leer">Lade…</div>';
        try {
            const { data, error } = await window.cfDb.rpc('einladungen_liste');
            if (error) throw new Error(error.message);
            zeichneListe(Array.isArray(data) ? data : []);
        } catch (e) {
            box.innerHTML = '<div class="admin-liste-leer">Liste konnte nicht '
                + 'geladen werden: ' + text(e.message) + '</div>';
        }
    }

    function zeichneListe(eintraege) {
        const box = el('adminListe');
        const zahl = el('adminZahl');
        if (!box) return;

        if (zahl) {
            const drin = eintraege.filter(function (e) {
                return e.used && !e.revoked;
            }).length;
            const offen = eintraege.filter(function (e) {
                return !e.used && !e.revoked;
            }).length;
            zahl.textContent = drin + ' drin · ' + offen + ' offen';
        }

        if (!eintraege.length) {
            box.innerHTML = '<div class="admin-liste-leer">Noch keine '
                + 'Schlüssel vergeben.</div>';
            return;
        }

        box.innerHTML = eintraege.map(function (e) {
            let stand, klasse;
            if (e.revoked) { stand = 'gesperrt'; klasse = 'gesperrt'; }
            else if (e.used) { stand = 'eingelöst ' + datum(e.used_at); klasse = 'drin'; }
            else { stand = 'noch nicht eingelöst'; klasse = 'offen'; }

            // Weicht der Discord-Name vom Namen auf der Einladung ab, ist
            // der Schluessel weitergegeben worden. Das ist kein Alarm,
            // aber es gehoert sichtbar hin - sonst faellt es nie auf.
            const fremd = e.used && e.konto && e.name
                && String(e.konto).toLowerCase().indexOf(
                    String(e.name).toLowerCase()) < 0;

            return '<div class="admin-zeile ' + klasse + '">'
                + '<div class="admin-zeile-text">'
                +   '<div class="admin-zeile-name">' + text(e.name)
                +     (e.note ? ' <span class="admin-zeile-notiz">'
                        + text(e.note) + '</span>' : '')
                +   '</div>'
                +   '<div class="admin-zeile-stand">' + text(stand)
                +     (e.konto ? ' · Discord: ' + text(e.konto) : '')
                +   '</div>'
                +   (fremd ? '<div class="admin-zeile-warn">Der Discord-Name '
                      + 'passt nicht zum Namen auf der Einladung — '
                      + 'möglicherweise weitergegeben.</div>' : '')
                + '</div>'
                + '<button type="button" class="admin-zeile-btn'
                +   (e.revoked ? ' auf' : '') + '" data-id="' + text(e.id)
                +   '" data-sperren="' + (e.revoked ? 'false' : 'true') + '">'
                +   (e.revoked ? 'Wieder freigeben' : 'Sperren')
                + '</button>'
                + '</div>';
        }).join('');
    }

    async function sperrenKlick(ev) {
        const btn = ev.target.closest('.admin-zeile-btn');
        if (!btn) return;

        const sperren = btn.getAttribute('data-sperren') === 'true';
        const name = btn.closest('.admin-zeile')
            .querySelector('.admin-zeile-name').textContent.trim();

        if (sperren && !window.confirm('Zugang für ' + name
                + ' sperren?\n\nDie Person fliegt sofort raus und kommt '
                + 'auch an ihre eigenen Daten nicht mehr. Die Daten '
                + 'bleiben erhalten.')) {
            return;
        }

        btn.disabled = true;
        try {
            const { data, error } = await window.cfDb.rpc('einladung_sperren', {
                id: btn.getAttribute('data-id'),
                sperren: sperren,
            });
            if (error) throw new Error(error.message);
            if (!data || !data.ok) throw new Error('Unerwartete Antwort.');
            meldung(sperren ? '' + name + ' gesperrt'
                            : '' + name + ' wieder freigegeben');
            await listeLaden();
        } catch (e) {
            meldung('' + e.message, 'error');
            btn.disabled = false;
        }
    }

    // ------------------------------------------------------------- Aufbau

    window.cfAdminOeffnen = async function () {
        if (!istAdmin) await window.cfAdminPruefen();
        if (!istAdmin) return;
        await listeLaden();
    };

    function start() {
        if (geladen) return;
        geladen = true;

        const btn = el('adminAnlegenBtn');
        if (btn) btn.addEventListener('click', anlegen);

        const feld = el('adminName');
        if (feld) {
            feld.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); anlegen(); }
            });
        }

        const liste = el('adminListe');
        if (liste) liste.addEventListener('click', sperrenKlick);

        // Ohne Adminrecht bleibt der Eintrag in der Seitenleiste weg.
        // Die eigentliche Sperre sitzt in der Datenbank - hier geht es
        // nur darum, niemandem einen Knopf zu zeigen, der nichts tut.
        const nav = document.querySelector('.nav-item[data-tab="admin"]');
        if (nav) nav.style.display = 'none';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
