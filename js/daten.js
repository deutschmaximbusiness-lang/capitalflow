/* CapitalFlow - Daten sichern und einspielen
 *
 * Muss vor der Umstellung auf ein Backend stehen: solange alles im
 * localStorage liegt, ist ein geleerter Browser-Cache ein Totalverlust.
 * Die Export-Datei ist gleichzeitig der Migrationsweg - beim ersten
 * Login gegen die Datenbank wird genau dieses Format hochgeladen.
 */
(function () {
    'use strict';

    const BEREICHE = [
        { key: 'trades',          label: 'Trades' },
        { key: 'positions',       label: 'Offene Positionen' },
        { key: 'closedPositions', label: 'Geschlossene Positionen' },
        { key: 'transactions',    label: 'Transaktionen' },
        { key: 'setups',          label: 'Setups' },
    ];

    // Hochzaehlen, sobald sich die Struktur der Daten aendert. Der Import
    // prueft das und verweigert Dateien aus einer neueren Version.
    const FORMAT = 1;

    function meldung(text, typ) {
        if (typeof showToast === 'function') showToast(text, typ);
        else console.log(text);
    }

    function lesen(key) {
        try {
            const roh = localStorage.getItem(key);
            const wert = roh ? JSON.parse(roh) : [];
            return Array.isArray(wert) ? wert : [];
        } catch (e) {
            return [];
        }
    }

    function angemeldet() {
        return !!(window.cfRawStorage
            && window.cfRawStorage.get('capitalflow_current_key'));
    }

    // ---------------------------------------------------------------- Export

    window.cfExportieren = function () {
        if (!angemeldet()) {
            meldung('❌ Bitte zuerst einloggen', 'error');
            return;
        }

        const daten = { format: FORMAT, app: 'CapitalFlow',
                        erstellt: new Date().toISOString() };
        let gesamt = 0;
        BEREICHE.forEach(function (b) {
            daten[b.key] = lesen(b.key);
            gesamt += daten[b.key].length;
        });

        if (gesamt === 0) {
            meldung('❌ Keine Daten zum Sichern vorhanden', 'error');
            return;
        }

        // Der Name des Keys kommt mit, damit man Sicherungen mehrerer
        // Nutzer auseinanderhalten kann - der Key selbst niemals.
        const name = (window.cfRawStorage.get('capitalflow_current_name') || 'export')
            .replace(/[^a-zA-Z0-9-_]/g, '');
        daten.nutzer = name;

        const datum = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(daten, null, 2)],
                              { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `capitalflow-${name}-${datum}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Ohne revoke bleibt der Blob bis zum Neuladen im Speicher
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

        meldung(`✅ ${gesamt} Einträge gesichert`, 'success');
    };

    // ---------------------------------------------------------------- Import

    let geladen = null;   // geprüfte Datei, wartet auf Ersetzen/Zusammenführen

    function pruefen(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj))
            return 'Das ist keine CapitalFlow-Sicherung.';
        if (obj.app !== 'CapitalFlow')
            return 'Das ist keine CapitalFlow-Sicherung.';
        if (typeof obj.format !== 'number')
            return 'Der Datei fehlt die Formatangabe.';
        if (obj.format > FORMAT)
            return 'Die Datei stammt aus einer neueren Version. Bitte die App aktualisieren.';
        const hatEtwas = BEREICHE.some(function (b) {
            return Array.isArray(obj[b.key]) && obj[b.key].length > 0;
        });
        if (!hatEtwas) return 'Die Datei enthält keine Einträge.';
        return null;
    }

    // Leere Platzhalter aussortieren - dieselbe Ursache wie die
    // Phantom-Trades: ein Datensatz ohne Ticker und ohne Preis ist kein
    // Trade, sondern Muell, der die Zaehler verfaelscht.
    function brauchbar(key, e) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
        if (key === 'transactions')
            return Number.isFinite(parseFloat(e.amount)) && parseFloat(e.amount) > 0;
        const ticker = typeof e.ticker === 'string' && e.ticker.trim() !== '';
        const preis = Number.isFinite(parseFloat(e.entryPrice !== undefined
            ? e.entryPrice : e.entry));
        return ticker || preis;
    }

    // Positionen haben keine id, deshalb ueber die Inhalte identifizieren
    function kennung(key, e) {
        if (e && e.id !== undefined && e.id !== null) return key + ':' + e.id;
        return [key, e.ticker, e.dateOpened || e.date || '',
                e.entry !== undefined ? e.entry : e.entryPrice].join('|');
    }

    window.cfImportWaehlen = function () {
        if (!angemeldet()) {
            meldung('❌ Bitte zuerst einloggen', 'error');
            return;
        }
        document.getElementById('datenImportInput').click();
    };

    window.cfImportGelesen = function (input) {
        const datei = input.files && input.files[0];
        input.value = '';                       // sonst feuert dieselbe Datei nie erneut
        if (!datei) return;

        const leser = new FileReader();
        leser.onerror = function () {
            meldung('❌ Datei konnte nicht gelesen werden', 'error');
        };
        leser.onload = function () {
            let obj;
            try {
                obj = JSON.parse(leser.result);
            } catch (e) {
                meldung('❌ Die Datei ist keine gültige JSON-Datei', 'error');
                return;
            }
            const fehler = pruefen(obj);
            if (fehler) { meldung('❌ ' + fehler, 'error'); return; }

            geladen = {};
            const zeilen = [];
            BEREICHE.forEach(function (b) {
                const liste = (Array.isArray(obj[b.key]) ? obj[b.key] : [])
                    .filter(function (e) { return brauchbar(b.key, e); });
                geladen[b.key] = liste;
                zeilen.push(`<div style="display:flex;justify-content:space-between;`
                    + `padding:7px 0;border-bottom:1px solid rgba(168,85,247,0.08);">`
                    + `<span style="color:#94a3b8;font-size:13px;">${b.label}</span>`
                    + `<span style="color:#e9d5ff;font-size:13px;font-weight:700;">`
                    + `${liste.length}</span></div>`);
            });

            const wann = obj.erstellt
                ? new Date(obj.erstellt).toLocaleDateString('de-DE')
                : 'unbekannt';
            document.getElementById('datenImportInfo').innerHTML =
                `<p style="margin:0 0 14px 0;color:#94a3b8;font-size:12px;">`
                + `Sicherung vom ${wann}</p>` + zeilen.join('');
            document.getElementById('datenImportAktionen').style.display = 'flex';
            document.getElementById('datenImportInfo').style.display = 'block';
        };
        leser.readAsText(datei);
    };

    window.cfImportAusfuehren = function (modus) {
        if (!geladen) return;

        let neu = 0, uebersprungen = 0;

        BEREICHE.forEach(function (b) {
            if (modus === 'ersetzen') {
                localStorage.setItem(b.key, JSON.stringify(geladen[b.key]));
                neu += geladen[b.key].length;
                return;
            }
            // Zusammenführen: vorhandene Einträge gewinnen, damit ein
            // versehentlich zweimal eingespielter Export nichts verdoppelt
            const vorhanden = lesen(b.key);
            const bekannt = new Set(vorhanden.map(function (e) {
                return kennung(b.key, e);
            }));
            geladen[b.key].forEach(function (e) {
                if (bekannt.has(kennung(b.key, e))) { uebersprungen++; return; }
                bekannt.add(kennung(b.key, e));
                vorhanden.push(e);
                neu++;
            });
            localStorage.setItem(b.key, JSON.stringify(vorhanden));
        });

        geladen = null;
        cfDatenModalZu();

        const text = modus === 'ersetzen'
            ? `✅ ${neu} Einträge eingespielt`
            : `✅ ${neu} neu, ${uebersprungen} bereits vorhanden`;
        meldung(text, 'success');

        // Neu laden ist hier das Ehrlichste: sonst zeigen Journal,
        // Analytics und Kalender weiter den alten Stand an, und genau
        // daraus sind die "Anzahl 2 bei leerem Journal"-Fehler entstanden.
        setTimeout(function () { location.reload(); }, 900);
    };

    // ----------------------------------------------------------------- Modal

    window.cfDatenModalAuf = function () {
        geladen = null;
        document.getElementById('datenImportInfo').style.display = 'none';
        document.getElementById('datenImportAktionen').style.display = 'none';
        document.getElementById('datenModal').style.display = 'flex';
    };

    window.cfDatenModalZu = function () {
        geladen = null;
        document.getElementById('datenModal').style.display = 'none';
    };
})();
