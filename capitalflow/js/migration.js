/* CapitalFlow - Daten in die Datenbank übertragen
 *
 * Läuft genau einmal pro Konto. Die Reihenfolge ist wichtig:
 * erst Instrumente (darauf zeigen die Trades), dann Screenshots in den
 * Storage, dann die Zeilen selbst.
 *
 * Vorher wird geprüft, ob das Konto schon Daten hat. Eine Migration, die
 * man versehentlich zweimal startet, wäre sonst ein doppeltes Journal -
 * und das merkt man erst Wochen später an falschen Statistiken.
 */
(function () {
    'use strict';

    function meldung(text, typ) {
        if (typeof showToast === 'function') showToast(text, typ);
    }

    function fortschritt(text) {
        const e = document.getElementById('migrationStatus');
        if (e) e.textContent = text;
    }

    /** data:-URL in einen Blob wandeln, ohne Umweg über den Server. */
    function alsBlob(dataUrl) {
        const [kopf, daten] = String(dataUrl).split(',');
        if (!daten) return null;
        const typ = (kopf.match(/data:([^;]+)/) || [, 'image/png'])[1];
        try {
            const roh = atob(daten);
            const bytes = new Uint8Array(roh.length);
            for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
            return new Blob([bytes], { type: typ });
        } catch (e) {
            return null;
        }
    }

    function endung(blob) {
        return ({ 'image/png': 'png', 'image/jpeg': 'jpg',
                  'image/webp': 'webp', 'image/gif': 'gif'
                })[blob.type] || 'png';
    }

    // ------------------------------------------------------- Schritte

    /**
     * Instrumente anlegen oder finden.
     *
     * Die Tabelle ist gemeinsam: ein Basiswert, den jemand anders schon
     * angelegt hat, wird mitbenutzt statt ein zweites Mal geschrieben.
     * Deshalb erst lesen, dann nur die fehlenden anlegen.
     */
    async function instrumenteSichern(symbole, uid) {
        const karte = {};
        if (symbole.length === 0) return karte;

        const { data: vorhanden, error: leseFehler } = await window.cfDb
            .from('instruments').select('id, symbol').in('symbol', symbole);
        if (leseFehler) throw new Error('Instrumente lesen: ' + leseFehler.message);

        (vorhanden || []).forEach(function (i) {
            karte[String(i.symbol).toUpperCase()] = i.id;
        });

        const fehlend = symbole.filter(function (s) { return !karte[s]; });
        if (fehlend.length === 0) return karte;

        const { data: neu, error } = await window.cfDb
            .from('instruments')
            .insert(fehlend.map(function (s) {
                return { symbol: s, created_by: uid };
            }))
            .select('id, symbol');
        if (error) throw new Error('Instrumente anlegen: ' + error.message);

        (neu || []).forEach(function (i) {
            karte[String(i.symbol).toUpperCase()] = i.id;
        });
        return karte;
    }

    /** Screenshot in den Storage, gibt den Pfad zurück. */
    async function screenshotHoch(dataUrl, uid, nr) {
        const blob = alsBlob(dataUrl);
        if (!blob) return null;
        const pfad = uid + '/migration-' + Date.now() + '-' + nr + '.' + endung(blob);
        const { error } = await window.cfDb.storage
            .from('screenshots').upload(pfad, blob, { contentType: blob.type });
        if (error) {
            // Ein fehlender Screenshot darf die Migration nicht abbrechen -
            // der Trade ist wichtiger als sein Bild
            console.warn('Screenshot übersprungen:', error.message);
            return null;
        }
        return pfad;
    }

    // -------------------------------------------------------- Ablauf

    window.cfMigrationStarten = async function () {
        const knopf = document.getElementById('migrationBtn');
        if (knopf) { knopf.disabled = true; knopf.textContent = 'Läuft…'; }

        const fertig = function (text, typ) {
            if (knopf) { knopf.disabled = false; knopf.textContent = 'Daten übertragen'; }
            fortschritt(text);
            if (typ) meldung(text, typ);
        };

        try {
            const sitzung = await window.cfSitzung();
            if (!sitzung) { fertig('❌ Nicht angemeldet', 'error'); return; }
            const uid = sitzung.user.id;

            // --- Schutz vor doppelter Ausführung
            fortschritt('Prüfe, ob schon Daten vorhanden sind…');
            const { count, error: zaehlFehler } = await window.cfDb
                .from('trades').select('id', { count: 'exact', head: true });
            if (zaehlFehler) throw new Error('Bestand prüfen: ' + zaehlFehler.message);
            if (count > 0) {
                fertig('❌ In der Datenbank liegen bereits ' + count
                       + ' Trades. Die Übertragung würde sie verdoppeln.', 'error');
                return;
            }

            const eintraege = window.cfMigrationDaten();
            const bericht = window.cfMigrationPruefen();
            const gute = eintraege.filter(function (e, i) {
                return !bericht.problematisch.some(function (p) { return p.nr === i; });
            });

            if (gute.length === 0) {
                fertig('Nichts zu übertragen.', 'error');
                return;
            }

            // --- Instrumente
            fortschritt('Lege Basiswerte an…');
            const symbole = Array.from(new Set(gute
                .map(function (e) { return e.symbol; })
                .filter(Boolean)));
            const karte = await instrumenteSichern(symbole, uid);

            // --- Screenshots
            const mitBild = gute.filter(function (e) {
                return typeof e.screenshot === 'string' && e.screenshot.length > 40;
            });
            for (let i = 0; i < mitBild.length; i++) {
                fortschritt('Lade Screenshot ' + (i + 1) + ' von ' + mitBild.length + '…');
                mitBild[i].screenshot_path = await screenshotHoch(
                    mitBild[i].screenshot, uid, i);
            }

            // --- Zeilen
            const trades = [], transaktionen = [], setups = [];
            gute.forEach(function (e) {
                const z = Object.assign({ user_id: uid }, e.zeile);
                if (e.screenshot_path) z.screenshot_path = e.screenshot_path;

                if (e.quelle === 'transactions') { transaktionen.push(z); return; }
                if (e.quelle === 'setups') {
                    z.instrument_id = karte[e.symbol] || null;
                    setups.push(z); return;
                }
                z.instrument_id = karte[e.symbol] || null;
                // Setup-Text aus der alten Welt als Notiz erhalten, bis das
                // Playbook in M3 daraus echte Strategien macht
                if (e.setup_text) {
                    z.notes = (z.notes ? z.notes + '\n\n' : '') + 'Setup: ' + e.setup_text;
                }
                trades.push(z);
            });

            const schreiben = async function (tabelle, zeilen) {
                if (zeilen.length === 0) return 0;
                fortschritt('Schreibe ' + zeilen.length + ' × ' + tabelle + '…');
                const { error } = await window.cfDb.from(tabelle).insert(zeilen);
                if (error) throw new Error(tabelle + ': ' + error.message);
                return zeilen.length;
            };

            const a = await schreiben('trades', trades);
            const b = await schreiben('transactions', transaktionen);
            const c = await schreiben('setups', setups);

            window.cfRawStorage.set('capitalflow_migriert::' + uid,
                                    new Date().toISOString());

            const uebersprungen = bericht.problematisch.length;
            fertig('✅ Übertragen: ' + a + ' Trades, ' + b + ' Transaktionen, '
                   + c + ' Setups'
                   + (uebersprungen ? '  ·  ' + uebersprungen + ' übersprungen' : ''),
                   'success');

        } catch (e) {
            console.error(e);
            fertig('❌ ' + e.message, 'error');
        }
    };

    /** Bericht im Daten-Fenster anzeigen. */
    window.cfMigrationBericht = function () {
        const b = window.cfMigrationPruefen();
        const kasten = document.getElementById('migrationBericht');
        if (!kasten) return;

        const zeile = function (k, v) {
            return '<div style="display:flex;justify-content:space-between;'
                 + 'padding:6px 0;border-bottom:1px solid rgba(168,85,247,0.08);">'
                 + '<span style="color:#94a3b8;font-size:12px;">' + k + '</span>'
                 + '<span style="color:#e9d5ff;font-size:12px;font-weight:700;">'
                 + v + '</span></div>';
        };

        let html = zeile('Überträgt', b.uebernehmbar + ' Einträge')
                 + zeile('Basiswerte', b.instrumente.join(', ') || '–');
        if (b.screenshots.anzahl) {
            html += zeile('Screenshots', b.screenshots.anzahl + ' ('
                        + (b.screenshots.bytes / 1048576).toFixed(1) + ' MB)');
        }
        if (b.problematisch.length) {
            html += zeile('Wird übersprungen', b.problematisch.length + ' Einträge');
            html += '<div style="margin-top:8px;color:#fca5a5;font-size:11px;'
                 + 'line-height:1.6;">'
                 + b.problematisch.slice(0, 5).map(function (p) {
                       return '· ' + p.symbol + ': ' + p.gruende.join(', ');
                   }).join('<br>')
                 + (b.problematisch.length > 5 ? '<br>· …' : '') + '</div>';
        }
        if (b.hinweise.length) {
            html += '<div style="margin-top:12px;color:#94a3b8;font-size:11px;'
                 + 'line-height:1.6;">' + b.hinweise.map(function (h) {
                       return '· ' + h;
                   }).join('<br>') + '</div>';
        }

        kasten.innerHTML = html;
        kasten.style.display = 'block';
        const knopf = document.getElementById('migrationBtn');
        if (knopf) knopf.style.display = b.uebernehmbar > 0 ? 'block' : 'none';
    };
})();
