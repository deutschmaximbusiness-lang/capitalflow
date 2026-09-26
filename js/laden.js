/* CapitalFlow - Daten aus der Datenbank in die App holen
 *
 * Die Anzeige liest weiterhin synchron aus dem localStorage. Das komplett
 * auf async umzubauen hiesse, jede Renderfunktion anzufassen - viel
 * Fläche für wenig Gewinn. Stattdessen wird der localStorage zum reinen
 * Zwischenspeicher: beim Start einmal aus der Datenbank füllen, danach
 * arbeitet die Oberfläche wie bisher.
 *
 * Die Wahrheit liegt ab jetzt in der Datenbank. Was hier im Browser
 * steht, ist eine Kopie, die beim nächsten Start neu geholt wird.
 */
(function () {
    'use strict';

    const roh = function () { return window.cfRawStorage; };

    function schreiben(key, wert) {
        const kennung = roh().get('capitalflow_current_key');
        if (!kennung) return;
        roh().set(key + '::' + kennung, JSON.stringify(wert));
    }

    /**
     * Signierte Adresse für einen Screenshot.
     *
     * Der Bucket ist privat, eine direkte URL funktioniert also nicht.
     * Die Signatur läuft nach einer Stunde ab - das reicht, weil beim
     * nächsten Start ohnehin neu geladen wird. Die Oberfläche setzt den
     * Wert in ein img-Tag, und dem ist egal, ob dort Base64 oder eine
     * Adresse steht.
     */
    async function bildAdresse(pfad) {
        if (!pfad) return null;
        try {
            const { data, error } = await window.cfDb.storage
                .from('screenshots').createSignedUrl(pfad, 3600);
            return error ? null : (data && data.signedUrl) || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Zeitstempel aus der Datenbank in das Format, das die Oberflaeche
     * ueberall erwartet: TT.MM.JJJJ.
     *
     * Vorher kam hier das ISO-Datum zurueck. Sechs Stellen in app.js
     * zerlegen t.date mit split('.') - bei "2026-05-11" ergibt das ein
     * einziges Stueck, daraus wird ein ungueltiges Datum, und das
     * Ergebnis ist NaN. Sichtbar wurde das als leerer P&L-Kalender und
     * als Wochentagsstatistik ohne Zahlen. Kein Fehler in der Konsole,
     * nur Striche in der Oberflaeche.
     *
     * Dieselbe Falle wie bei der Migration: die App schreibt de-DE,
     * die Datenbank liefert ISO, und niemand uebersetzt dazwischen.
     */
    function datumNur(iso) {
        if (!iso) return '';
        const s = String(iso).slice(0, 10);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? m[3] + '.' + m[2] + '.' + m[1] : s;
    }

    function zaehle(key) {
        try {
            const w = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(w) ? w.length : 0;
        } catch (e) { return 0; }
    }

    // ------------------------------------------------- Rückübersetzung

    function komma(v) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Baut aus Trade- und Produktzeile wieder das Objekt, das die
     * Oberflaeche kennt. Ohne product_id bleibt produkt null - dann ist
     * es eine normale Aktie und alles rechnet wie bisher.
     */
    function alsProdukt(z) {
        const p = z.products;
        if (!p) return null;
        return {
            art: p.kind || 'knockout',
            richtung: p.direction || z.direction || 'long',
            wkn: p.wkn || null,
            emittent: p.issuer || null,
            strike: komma(p.strike),
            ko: komma(p.ko_barrier),
            ratio: komma(p.ratio),
            faktor: komma(p.factor),
            basisEin: komma(z.underlying_entry),
            basisAus: komma(z.underlying_exit),
            basisStop: komma(z.underlying_stop),
            hebelEffektiv: komma(z.leverage_effective),
            koAbstandProzent: komma(z.ko_distance_percent),
        };
    }

    function alsTrade(z, symbol, bild) {
        const einstieg = parseFloat(z.entry_price) || 0;
        const groesse = parseFloat(z.position_size) || 0;
        return {
            id: z.id,
            ticker: symbol || '—',
            direction: z.direction || 'long',
            entryPrice: einstieg,
            exitPrice: parseFloat(z.exit_price) || 0,
            stopLoss: parseFloat(z.stop_loss) || 0,
            positionSize: groesse,
            leverage: parseFloat(z.leverage) || 1,
            pnl: parseFloat(z.pnl) || 0,
            pnlPercent: parseFloat(z.pnl_percent) || 0,
            risk: parseFloat(z.risk_amount) || 0,
            reason: z.thesis || '',
            setupType: '',
            errorType: z.error_type || '',
            notes: z.notes || '',
            screenshot: bild,
            date: datumNur(z.closed_at || z.opened_at),
            produkt: alsProdukt(z),
        };
    }

    function alsPosition(z, symbol, bild) {
        return {
            id: z.id,
            ticker: symbol || '—',
            direction: z.direction === 'short' ? 'short' : 'long',
            entry: parseFloat(z.entry_price) || 0,
            size: parseFloat(z.position_size) || 0,
            thesis: z.thesis || '',
            screenshot: bild,
            dateOpened: z.opened_at,
            produkt: alsProdukt(z),
        };
    }

    function alsGeschlossen(z, symbol, bild) {
        return Object.assign(alsPosition(z, symbol, bild), {
            exitPrice: parseFloat(z.exit_price) || 0,
            exitReason: z.exit_reason || '',
            pnl: parseFloat(z.pnl) || 0,
            pnlPercent: parseFloat(z.pnl_percent) || 0,
            dateClosed: z.closed_at,
        });
    }

    // ------------------------------------------------------- Laden

    window.cfDatenLaden = async function () {
        if (!window.cfDb) return { ok: false, grund: 'keine Verbindung' };

        try {
            const [t, tx, su] = await Promise.all([
                window.cfDb.from('trades')
                    // products mitladen: ohne Basispreis und Schwelle
                    // laesst sich der Hebel nach einem Neuladen nicht
                    // mehr zeigen, und das Abzeichen in der Liste waere
                    // nach jedem Reload weg.
                    .select('*, instruments(symbol), products(*)')
                    .order('opened_at', { ascending: true }),
                window.cfDb.from('transactions')
                    .select('*').order('booked_at', { ascending: true }),
                window.cfDb.from('setups')
                    .select('*, instruments(symbol)')
                    .order('created_at', { ascending: false }),
            ]);

            for (const a of [t, tx, su]) {
                if (a.error) throw new Error(a.error.message);
            }

            const zeilen = t.data || [];

            // Signierte Adressen im Bündel holen, nicht nacheinander -
            // bei hundert Trades wären das sonst hundert Wartezeiten
            const bilder = {};
            await Promise.all(zeilen
                .filter(function (z) { return z.screenshot_path; })
                .map(async function (z) {
                    bilder[z.id] = await bildAdresse(z.screenshot_path);
                }));

            const sym = function (z) {
                return z.instruments && z.instruments.symbol;
            };

            // Schutz, solange die Schreibwege noch nicht umgestellt sind:
            // Liegen im Browser mehr Einträge als in der Datenbank, wurde
            // dort etwas erfasst, das noch nicht oben ist. Dann NICHT
            // überschreiben - sonst verschwindet es beim nächsten Start
            // spurlos. Lieber ein veralteter Stand als gelöschte Arbeit.
            const lokalTrades = zaehle('trades');
            const lokalOffen = zaehle('positions');
            const dbOffen = zeilen.filter(function (z) {
                return z.status === 'offen';
            }).length;
            const dbGeschlossen = zeilen.length - dbOffen;

            if (lokalTrades > dbGeschlossen || lokalOffen > dbOffen) {
                return {
                    ok: false,
                    grund: 'ungesicherte',
                    lokal: lokalTrades + lokalOffen,
                    datenbank: zeilen.length,
                };
            }

            const trades = [], positionen = [], geschlossene = [];
            zeilen.forEach(function (z) {
                const bild = bilder[z.id] || null;
                if (z.status === 'offen') {
                    positionen.push(alsPosition(z, sym(z), bild));
                    return;
                }
                // Alle abgeschlossenen Runden kommen ins Journal - das
                // ist der Kern der Umstellung. Vorher lagen sie teils in
                // closedPositions und fehlten in jeder Auswertung.
                trades.push(alsTrade(z, sym(z), bild));
                // Zusätzlich in die Portfolio-Ansicht, wenn sie dort
                // hergekommen sind (erkennbar am Schliessungsgrund)
                if (z.exit_reason) {
                    geschlossene.push(alsGeschlossen(z, sym(z), bild));
                }
            });

            schreiben('trades', trades);
            schreiben('positions', positionen);
            schreiben('closedPositions', geschlossene);
            schreiben('transactions', (tx.data || []).map(function (z) {
                return {
                    id: z.id,
                    type: z.kind === 'auszahlung' ? 'withdrawal' : 'deposit',
                    amount: parseFloat(z.amount) || 0,
                    date: datumNur(z.booked_at),
                    note: z.note || '',
                };
            }));
            schreiben('setups', (su.data || []).map(function (z) {
                return {
                    id: z.id,
                    ticker: (z.instruments && z.instruments.symbol) || '—',
                    direction: z.direction,
                    entryFrom: parseFloat(z.entry_from) || 0,
                    entryTo: parseFloat(z.entry_to) || 0,
                    stop: parseFloat(z.stop_loss) || 0,
                    target: parseFloat(z.target) || 0,
                    ko: komma(z.ko_barrier),
                    // Mit Knockout-Preis ergibt sich der Hebel aus
                    // Einstieg und Schwelle - getippt wird er nicht mehr.
                    leverage: (function () {
                        const ein = (parseFloat(z.entry_from) + parseFloat(z.entry_to)) / 2;
                        const ko = parseFloat(z.ko_barrier);
                        if (!(ein > 0) || !(ko > 0)) return 1;
                        const abstand = z.direction === 'short' ? ko - ein : ein - ko;
                        return abstand > 0 ? Math.round((ein / abstand) * 100) / 100 : 1;
                    })(),
                    thesis: z.thesis || '',
                    screenshot: null,
                    status: ({ beobachten: 'watching', bereit: 'ready',
                               eingestiegen: 'entered', verworfen: 'discarded'
                             })[z.status] || 'watching',
                    created: z.created_at,
                    updated: z.updated_at,
                };
            }));

            return {
                ok: true,
                trades: trades.length,
                offen: positionen.length,
                geschlossen: geschlossene.length,
                transaktionen: (tx.data || []).length,
                setups: (su.data || []).length,
            };

        } catch (e) {
            console.error('Laden aus der Datenbank:', e);
            return { ok: false, grund: e.message };
        }
    };
})();
