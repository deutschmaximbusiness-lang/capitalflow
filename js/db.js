/* CapitalFlow - Übersetzung zwischen altem Format und Datenbank
 *
 * Das alte Format ist über Monate gewachsen und kennt drei getrennte
 * Töpfe: trades (Journal), positions (offen), closedPositions. Im
 * Schema liegt alles in einer Tabelle mit einer Statusspalte - das ist
 * der Grund, warum geschlossene Positionen künftig in der Statistik
 * auftauchen.
 *
 * Diese Datei macht die Übersetzung und kann sie im Trockenlauf
 * vorführen, ohne etwas zu schreiben.
 */
(function () {
    'use strict';

    // ---------------------------------------------------------- Hilfen

    function zahl(v) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    function text(v) {
        return (typeof v === 'string' && v.trim() !== '') ? v.trim() : null;
    }

    // normalizeTrade() in app.js ersetzt einen fehlenden Ticker durch
    // einen Gedankenstrich, damit die Anzeige nicht leer bleibt. Fuer die
    // Anzeige ist das richtig, als Basiswert waere es Muell - und die
    // Instrumententabelle ist gemeinsam und laesst sich nicht aufraeumen.
    const PLATZHALTER = ['—', '–', '-', '?', '', 'N/A', 'NA', 'UNBEKANNT', '--'];

    function symbol(v) {
        const s = text(v);
        if (!s) return null;
        const gross = s.toUpperCase();
        if (PLATZHALTER.indexOf(gross) !== -1) return null;
        // Ein Ticker besteht aus Buchstaben, Ziffern, Punkt und Bindestrich.
        // Alles andere ist keine Kennung, sondern eine Notiz.
        if (!/^[A-Z0-9.\-]{1,12}$/.test(gross)) return null;
        return gross;
    }

    function lesen(key) {
        try {
            const w = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(w) ? w : [];
        } catch (e) { return []; }
    }

    // Journal-Trades haben nur ein Datum im Format JJJJ-MM-TT.
    // Positionen haben vollständige Zeitstempel.
    function zeitpunkt(v, ersatz) {
        if (!v) return ersatz || null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? (ersatz || null) : d.toISOString();
    }

    function richtung(v) {
        const s = String(v || '').toLowerCase();
        return s === 'short' ? 'short' : 'long';
    }

    // ------------------------------------------------- Übersetzung

    /**
     * Journal-Trade -> Zeile in trades, status geschlossen.
     *
     * Ein Journal-Eintrag hat Einstieg UND Ausstieg, ist also per
     * Definition abgeschlossen. Er kennt aber nur EIN Datum - Öffnen und
     * Schließen fallen deshalb zusammen. Für die Haltedauer-Analyse aus
     * M3 heißt das: Alttrades tragen dort nichts bei. Sie nachträglich
     * zu erfinden wäre schlimmer als die Lücke.
     */
    function ausTrade(t) {
        const einstieg = zahl(t.entryPrice);
        const ausstieg = zahl(t.exitPrice);
        const groesse = zahl(t.positionSize);
        const hebel = zahl(t.leverage) || 1;
        const wann = zeitpunkt(t.date, new Date().toISOString());

        return {
            quelle: 'trades',
            symbol: symbol(t.ticker),
            zeile: {
                status: 'geschlossen',
                direction: richtung(t.direction),
                entry_price: einstieg,
                exit_price: ausstieg,
                stop_loss: zahl(t.stopLoss) || null,
                position_size: groesse,
                quantity: (groesse && einstieg) ? groesse / einstieg : null,
                leverage: hebel,
                pnl: zahl(t.pnl),
                pnl_percent: zahl(t.pnlPercent),
                risk_amount: zahl(t.risk),
                thesis: text(t.reason),
                notes: text(t.notes),
                error_type: text(t.errorType),
                opened_at: wann,
                closed_at: wann,
                source: 'manuell',
            },
            // setupType wird erst mit dem Playbook in M3 zu einer
            // Strategie - bis dahin als Notiz erhalten, nicht verwerfen
            setup_text: text(t.setupType),
            screenshot: t.screenshot || null,
        };
    }

    /**
     * Offene Position -> Zeile in trades, status offen.
     *
     * Positionen kennen keine Richtung. Sie werden als Long übernommen,
     * weil das Formular nie etwas anderes zuließ - aber der Nutzer muss
     * das wissen, deshalb taucht es im Bericht auf.
     */
    function ausPosition(p) {
        const einstieg = zahl(p.entry);
        const groesse = zahl(p.size);
        return {
            quelle: 'positions',
            symbol: symbol(p.ticker),
            zeile: {
                status: 'offen',
                direction: 'long',
                entry_price: einstieg,
                position_size: groesse,
                quantity: (groesse && einstieg) ? groesse / einstieg : null,
                leverage: 1,
                thesis: text(p.thesis),
                opened_at: zeitpunkt(p.dateOpened, new Date().toISOString()),
                source: 'manuell',
            },
            screenshot: p.screenshot || null,
        };
    }

    /** Geschlossene Position -> Zeile in trades, status geschlossen. */
    function ausClosed(p) {
        const einstieg = zahl(p.entry);
        const ausstieg = zahl(p.exitPrice);
        const groesse = zahl(p.size);
        return {
            quelle: 'closedPositions',
            symbol: symbol(p.ticker),
            zeile: {
                status: 'geschlossen',
                direction: 'long',
                entry_price: einstieg,
                exit_price: ausstieg,
                position_size: groesse,
                quantity: (groesse && einstieg) ? groesse / einstieg : null,
                leverage: 1,
                pnl: zahl(p.pnl),
                pnl_percent: zahl(p.pnlPercent),
                thesis: text(p.thesis),
                exit_reason: text(p.exitReason),
                opened_at: zeitpunkt(p.dateOpened, new Date().toISOString()),
                closed_at: zeitpunkt(p.dateClosed, new Date().toISOString()),
                source: 'manuell',
            },
            screenshot: p.screenshot || null,
        };
    }

    function ausTransaktion(t) {
        const betrag = zahl(t.amount);
        return {
            quelle: 'transactions',
            zeile: {
                kind: t.type === 'withdrawal' ? 'auszahlung' : 'einzahlung',
                amount: betrag !== null ? Math.abs(betrag) : null,
                booked_at: (text(t.date) || new Date().toISOString()).slice(0, 10),
                note: text(t.note),
            },
        };
    }

    function ausSetup(s) {
        return {
            quelle: 'setups',
            symbol: symbol(s.ticker),
            zeile: {
                direction: richtung(s.direction),
                entry_from: zahl(s.entryFrom),
                entry_to: zahl(s.entryTo),
                stop_loss: zahl(s.stop),
                target: zahl(s.target),
                thesis: text(s.thesis),
                status: ({ watching: 'beobachten', ready: 'bereit',
                           entered: 'eingestiegen', discarded: 'verworfen'
                         })[s.status] || 'beobachten',
            },
            screenshot: s.screenshot || null,
        };
    }

    // ------------------------------------------------------ Prüfung

    /**
     * Was die Datenbank ablehnen würde. Diese Regeln stehen so als
     * Constraint im Schema - hier werden sie vorher angewandt, damit
     * der Nutzer einen Bericht bekommt statt einer Fehlermeldung
     * mitten in der Migration.
     */
    function maengel(e) {
        const m = [];
        const z = e.zeile;

        if (e.quelle === 'transactions') {
            if (!(z.amount > 0)) m.push('Betrag fehlt oder ist nicht positiv');
            return m;
        }
        if (e.quelle === 'setups') {
            if (!e.symbol) m.push('kein Ticker');
            return m;
        }

        if (!e.symbol) m.push('kein Ticker');
        if (!(z.entry_price > 0)) m.push('Einstiegspreis fehlt oder ist 0');
        if (z.status === 'geschlossen' && !(z.exit_price > 0))
            m.push('geschlossen, aber ohne Ausstiegspreis');
        if (z.status === 'geschlossen' && !z.closed_at)
            m.push('geschlossen, aber ohne Schlussdatum');
        return m;
    }

    // -------------------------------------------------- Trockenlauf

    window.cfMigrationPruefen = function () {
        const eintraege = []
            .concat(lesen('trades').map(ausTrade))
            .concat(lesen('positions').map(ausPosition))
            .concat(lesen('closedPositions').map(ausClosed))
            .concat(lesen('transactions').map(ausTransaktion))
            .concat(lesen('setups').map(ausSetup));

        const bericht = {
            gesamt: eintraege.length,
            nachQuelle: {},
            uebernehmbar: 0,
            problematisch: [],
            instrumente: new Set(),
            screenshots: { anzahl: 0, bytes: 0 },
            hinweise: [],
        };

        eintraege.forEach(function (e, i) {
            bericht.nachQuelle[e.quelle] = (bericht.nachQuelle[e.quelle] || 0) + 1;
            if (e.symbol) bericht.instrumente.add(e.symbol);

            if (typeof e.screenshot === 'string' && e.screenshot.length > 40) {
                bericht.screenshots.anzahl++;
                // Base64 ist rund 4/3 der Rohgröße
                bericht.screenshots.bytes += Math.round(e.screenshot.length * 0.75);
            }

            const m = maengel(e);
            if (m.length) {
                bericht.problematisch.push({
                    nr: i, quelle: e.quelle,
                    symbol: e.symbol || '(ohne)', gruende: m,
                });
            } else {
                bericht.uebernehmbar++;
            }
        });

        const offene = lesen('positions').length;
        const alteTrades = lesen('trades').length;
        const geschl = lesen('closedPositions').length;

        if (offene > 0) {
            bericht.hinweise.push(
                offene + ' offene Position(en) werden als Long übernommen – '
                + 'das alte Formular kannte keine Richtung. Shorts musst du '
                + 'danach von Hand korrigieren.');
        }
        if (alteTrades > 0) {
            bericht.hinweise.push(
                alteTrades + ' Journal-Trades haben nur ein Datum. Öffnen und '
                + 'Schließen fallen zusammen, die Haltedauer-Analyse aus M3 '
                + 'kann sie deshalb nicht auswerten.');
        }
        if (geschl > 0) {
            bericht.hinweise.push(
                geschl + ' geschlossene Position(en) fließen künftig in '
                + 'Trefferquote, P&L und Equity-Kurve ein. Deine Statistik '
                + 'ändert sich dadurch – das ist die Korrektur eines Fehlers, '
                + 'kein neuer.');
        }
        if (bericht.screenshots.anzahl > 0) {
            bericht.hinweise.push(
                bericht.screenshots.anzahl + ' Screenshots ('
                + (bericht.screenshots.bytes / 1048576).toFixed(1)
                + ' MB) wandern in den Speicher der Datenbank und belegen '
                + 'danach keinen Platz mehr im Browser.');
        }

        bericht.instrumente = Array.from(bericht.instrumente).sort();
        return bericht;
    };

    // Für die spätere echte Migration
    window.cfMigrationDaten = function () {
        return []
            .concat(lesen('trades').map(ausTrade))
            .concat(lesen('positions').map(ausPosition))
            .concat(lesen('closedPositions').map(ausClosed))
            .concat(lesen('transactions').map(ausTransaktion))
            .concat(lesen('setups').map(ausSetup));
    };
})();
