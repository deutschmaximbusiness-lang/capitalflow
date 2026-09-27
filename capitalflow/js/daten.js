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

    /**
     * "Daten" ist jetzt ein eigener Tab, kein Fenster mehr.
     *
     * Der Knopf oben rechts schaltet dorthin um. Die alten Namen bleiben
     * bestehen, damit die Aufrufe im Markup weiter funktionieren - nur
     * tun sie etwas anderes.
     *
     * Grund fuer den Umzug: in dem Fenster standen Sicherung,
     * Wiederherstellung, Migration, der Import samt Kuerzeltabelle fuer
     * 25 Basiswerte und das Loeschen. Ein Fenster, durch das man
     * scrollen muss, findet niemand - und der Import ist das Erste, was
     * ein neuer Nutzer braucht.
     */
    window.cfDatenModalAuf = function () {
        if (typeof handleTabChange === 'function') handleTabChange('daten');
        const nav = document.querySelector('.nav-item[data-tab="daten"]');
        if (nav) nav.scrollIntoView({ block: 'nearest' });
    };

    window.cfDatenModalZu = function () {
        if (typeof handleTabChange === 'function') handleTabChange('dashboard');
    };

    /**
     * Zeigt den Migrationsblock nur, wenn es lokal ueberhaupt etwas zu
     * uebertragen gibt. Stand vorher im Oeffnen des Fensters und ist
     * beim Umzug in den Tab dort gelandet, wo der Tab aufgerufen wird.
     */
    window.cfMigrationsblockPruefen = function () {
        const block = document.getElementById('migrationBlock');
        if (!block) return;
        const etwasDa = ['trades', 'positions', 'closedPositions',
                         'transactions', 'setups']
            .some(function (k) { return lesen(k).length > 0; });
        if (window.cfDb && etwasDa && typeof window.cfMigrationBericht === 'function') {
            block.style.display = 'block';
            window.cfMigrationBericht();
        } else {
            block.style.display = 'none';
        }
    };
})();

/* CapitalFlow - Daten loeschen
 *
 * Zwei Stufen. Die Arbeit macht die Datenbankfunktion daten_loeschen()
 * in 05_loeschen.sql - hier stehen nur die Rueckfragen davor und das
 * Aufraeumen der Screenshots danach, die im Storage liegen und nicht in
 * der Datenbank.
 */
(function () {
    'use strict';

    function el(id) { return document.getElementById(id); }
    function status(t) { const e = el('loeschStatus'); if (e) e.textContent = t || ''; }

    /**
     * Screenshots des Nutzers aus dem Storage entfernen.
     *
     * Sie liegen unter <uid>/... und gehen bei einer Datenbank-Loeschung
     * nicht mit. Wer sie stehen laesst, hat geloeschte Trades, deren
     * Bilder noch auf dem Server liegen - bei einer Loeschanfrage nach
     * Artikel 17 waere das die Haelfte der Arbeit.
     */
    async function screenshotsWeg() {
        try {
            const s = await window.cfSitzung();
            if (!s) return 0;
            const ordner = s.user.id;
            let weg = 0;
            // In Seiten, der Storage liefert nicht alles auf einmal
            for (let runde = 0; runde < 20; runde++) {
                const { data, error } = await window.cfDb.storage
                    .from('screenshots').list(ordner, { limit: 100 });
                if (error || !data || !data.length) break;
                const pfade = data.map(function (f) { return ordner + '/' + f.name; });
                const { error: f2 } = await window.cfDb.storage
                    .from('screenshots').remove(pfade);
                if (f2) break;
                weg += pfade.length;
                if (data.length < 100) break;
            }
            return weg;
        } catch (e) { return 0; }
    }

    async function loeschen(nurImport) {
        if (!window.cfDb) { status('Keine Verbindung zur Datenbank.'); return; }
        const btns = document.querySelectorAll('#loeschBlock button');
        btns.forEach(function (b) { b.disabled = true; });
        try {
            status('Wird gelöscht…');
            const { data, error } = await window.cfDb
                .rpc('daten_loeschen', { nur_import: nurImport });
            if (error) throw new Error(error.message);

            let bilder = 0;
            if (!nurImport) {
                status('Screenshots entfernen…');
                bilder = await screenshotsWeg();
            }

            // Zwischenspeicher im Browser mitnehmen, sonst taucht alles
            // beim naechsten Laden wieder auf
            ['trades', 'positions', 'closedPositions', 'setups', 'transactions']
                .forEach(function (k) {
                    try { localStorage.setItem(k, '[]'); } catch (e) {}
                });

            const r = data || {};
            status('✅ Gelöscht: ' + (r.trades || 0) + ' Trades'
                + (nurImport ? ' (nur importierte)'
                    : ', ' + (r.setups || 0) + ' Setups, '
                      + (r.transaktionen || 0) + ' Buchungen'
                      + (bilder ? ', ' + bilder + ' Screenshots' : '')) + '.');

            const r2 = await window.cfDatenLaden();
            if (r2 && r2.ok && typeof window.cfAnsichtenAufbauen === 'function') {
                window.cfAnsichtenAufbauen();
            }
            if (typeof showToast === 'function') showToast('🗑️ Daten gelöscht');
        } catch (e) {
            console.error('Löschen:', e);
            status('❌ ' + e.message);
        } finally {
            btns.forEach(function (b) { b.disabled = false; });
            const f = el('loeschBestaetigung');
            if (f) f.value = '';
            window.cfLoeschPruefen();
        }
    }

    /** Der Knopf für "alles" bleibt gesperrt, bis LÖSCHEN dasteht. */
    window.cfLoeschPruefen = function () {
        const f = el('loeschBestaetigung');
        const b = el('loeschAllesBtn');
        if (!f || !b) return;
        // Nur disabled setzen - Aussehen macht das Stylesheet.
        // Inline-Styles hier haben vorher die Regeln aus .btn-gefahr
        // ueberschrieben, und der Knopf sah im gesperrten Zustand
        // genauso aus wie im freigegebenen.
        b.disabled = f.value.trim().toUpperCase() !== 'LÖSCHEN';
    };

    window.cfLoeschImporte = function () {
        if (!window.confirm('Alle importierten Trades löschen?\n\n'
            + 'Von Hand eingetragene Trades, Setups und Buchungen bleiben.\n'
            + 'Das lässt sich nicht rückgängig machen.')) return;
        loeschen(true);
    };

    window.cfLoeschAlles = function () {
        if (!window.confirm('Wirklich ALLE deine Daten löschen?\n\n'
            + 'Trades, Positionen, Setups, Buchungen und Screenshots.\n'
            + 'Dein Konto bleibt bestehen, die Daten sind weg.\n\n'
            + 'Hast du vorher eine Sicherung heruntergeladen?')) return;
        loeschen(false);
    };
})();
