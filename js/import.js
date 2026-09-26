/* CapitalFlow - Trade-Republic-Import
 *
 * Was der Transaktionsexport hergibt, Stand der Datei vom September 2026:
 *
 *   datetime, date, account_type, category, type, asset_class, name,
 *   symbol, shares, price, amount, fee, tax, currency, original_amount,
 *   original_currency, fx_rate, description, transaction_id,
 *   counterparty_name, counterparty_iban, payment_reference, mcc_code
 *
 * Drei Dinge machen die Datei brauchbarer, als sie aussieht:
 *
 *   1. Bei einem Knock-Out steht der BASISPREIS im Feld name, zusammen
 *      mit der Richtung: "Long 70,5213 $". Beides muss also niemand
 *      abtippen.
 *   2. In description steht der Basiswert im Klartext:
 *      "Open End Turbo auf CLOUDFLARE INC. A DL-,001".
 *   3. Kaeufe haben positive, Verkaeufe negative Stueckzahlen. Wer sie
 *      je Wertpapier aufaddiert, sieht am Nulldurchgang, wo eine
 *      Position zu Ende war - auch bei Teilkaeufen.
 *
 * Was die Datei NICHT hergibt: Stop, These, Setup - und den Kurs des
 * Basiswerts zum Zeitpunkt des Trades. Hebel und KO-Abstand lassen sich
 * fuer importierte Trades deshalb nicht rechnen. Sie bleiben leer statt
 * geschaetzt zu werden.
 *
 * PRIVATES: counterparty_name, counterparty_iban, payment_reference und
 * mcc_code werden hier nicht einmal gelesen. In der Datei stehen Namen,
 * IBANs und jede Kartenzahlung - das hat in einem Trading-Journal
 * nichts zu suchen und geht nicht in die Datenbank.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------- CSV

    /**
     * Zeichenweiser CSV-Leser.
     *
     * Kein Aufteilen an Kommas: die description-Spalte enthaelt selbst
     * Kommas ("A DL-,001, quantity: 25"), und Produktnamen deutsche
     * Dezimalkommas. Wer hier split(',') benutzt, verschiebt ab der
     * ersten Beschreibung alle Spalten.
     */
    function csvLesen(text) {
        const zeilen = [];
        let feld = '', zeile = [], inAnf = false;
        const s = String(text).replace(/^﻿/, '');

        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inAnf) {
                if (c === '"') {
                    if (s[i + 1] === '"') { feld += '"'; i++; }
                    else inAnf = false;
                } else feld += c;
                continue;
            }
            if (c === '"') { inAnf = true; continue; }
            if (c === ',') { zeile.push(feld); feld = ''; continue; }
            if (c === '\r') continue;
            if (c === '\n') { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; continue; }
            feld += c;
        }
        if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
        if (!zeilen.length) return [];

        const kopf = zeilen[0].map(function (k) { return k.trim(); });
        return zeilen.slice(1)
            .filter(function (z) { return z.length > 1; })
            .map(function (z) {
                const o = {};
                kopf.forEach(function (k, i) { o[k] = z[i] !== undefined ? z[i] : ''; });
                return o;
            });
    }

    function zahl(v) {
        if (v === '' || v === null || v === undefined) return null;
        const n = parseFloat(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }
    function z0(v) { const n = zahl(v); return n === null ? 0 : n; }

    // ------------------------------------------------- Produkt erkennen

    // "Long 70,5213 $" / "Short 128,4 EUR"
    const NAME_RE = /^(Long|Short)\s+([\d.,]+)\s*(\S*)$/i;

    // "Buy trade DE000HS2WZ37 Open End Turbo auf CLOUDFLARE INC., quantity: 25"
    const DESC_RE = /^(?:Buy|Sell) trade \S+\s+(.*?),\s*quantity:/i;
    const AUF_RE = /^(.*?)\s+auf\s+(.+)$/i;

    /**
     * Strukturiert, was in name und description steht.
     * Unsicheres bleibt null - erfundene Werte waeren schlimmer als
     * fehlende, weil sie spaeter niemand mehr als falsch erkennt.
     */
    function produktAusZeile(r) {
        const roh = { art: 'aktie', richtung: null, strike: null,
                      basiswert: null, produkttyp: null, wkn: null };

        const desc = String(r.description || '');
        const m = DESC_RE.exec(desc);
        const text = m ? m[1].trim() : null;

        if (r.asset_class !== 'DERIVATIVE') {
            roh.basiswert = (r.name || '').trim() || text;
            return roh;
        }

        const nm = NAME_RE.exec(String(r.name || '').trim());
        if (nm) {
            roh.richtung = nm[1].toLowerCase();
            roh.strike = zahl(nm[2]);
        }

        if (text) {
            const a = AUF_RE.exec(text);
            if (a) { roh.produkttyp = a[1].trim(); roh.basiswert = a[2].trim(); }
            else roh.basiswert = text;
        }

        // Turbo, Open End Turbo, Best Turbo, Mini Future -> Knock-out.
        // Faktor-Zertifikate haben keinen Basispreis und werden hier
        // bewusst nicht als Knock-out durchgewunken.
        const typ = (roh.produkttyp || '').toLowerCase();
        if (/faktor/.test(typ)) roh.art = 'faktor';
        else if (/turbo|knock|mini future/.test(typ)) roh.art = 'knockout';
        else if (/optionsschein|warrant/.test(typ)) roh.art = 'optionsschein';
        else roh.art = 'knockout';   // DERIVATIVE ohne erkannten Typ

        // Deutsche Emittenten-ISIN: DE000 + sechsstellige WKN + Pruefziffer
        const isin = String(r.symbol || '').trim().toUpperCase();
        if (/^DE000[A-Z0-9]{6}\d$/.test(isin)) roh.wkn = isin.slice(5, 11);

        return roh;
    }

    /**
     * Kuerzt den Klartextnamen des Basiswerts auf etwas Lesbares.
     * "AST SPACEMOBIL.A DL-,0001" -> "AST SPACEMOBIL."
     * Der Rest ist Gattungs- und Nennwertgeklingel aus den Boersendaten.
     */
    function basiswertKurz(name) {
        if (!name) return null;
        let s = String(name).trim();
        s = s.replace(/\s+(DL|EO|SF|YC|NK|SK)[-\s.,][^\s]*.*$/i, '');
        s = s.replace(/\s+(INH|NA|O\.N\.|ON|REG\.S|A|B|C)$/i, '');
        return s.trim() || String(name).trim();
    }

    // -------------------------------------------------------- Rundreisen

    /**
     * Baut aus Einzelbuchungen Positionen.
     *
     * Je Wertpapier werden die Stueckzahlen aufaddiert. Solange die
     * Summe ungleich null ist, laeuft die Position; beim Nulldurchgang
     * ist sie zu Ende. Damit werden auch Teilkaeufe und Teilverkaeufe
     * zu EINEM Trade zusammengefasst - in dieser Datei betrifft das
     * fast die Haelfte.
     *
     * Preise werden mit der Stueckzahl gewichtet gemittelt, nicht
     * einfach gemittelt: wer 10 Stueck zu 1 EUR und 90 zu 2 EUR kauft,
     * hat 1,90 bezahlt und nicht 1,50.
     */
    function rundreisen(zeilen) {
        const nach = {};
        zeilen.forEach(function (r) {
            const k = r.symbol || r.name || '?';
            (nach[k] = nach[k] || []).push(r);
        });

        const fertig = [], offen = [], altbestand = [];
        Object.keys(nach).forEach(function (k) {
            const rs = nach[k].slice().sort(function (a, b) {
                return String(a.datetime).localeCompare(String(b.datetime));
            });

            let lauf = 0, teil = [];
            rs.forEach(function (r) {
                const s = z0(r.shares);

                // Verkauf ohne passenden Kauf im Zeitraum.
                //
                // Der Export beginnt an einem Stichtag. Wer davor schon
                // Stuecke im Depot hatte und sie jetzt verkauft, erzeugt
                // eine negative Laufsumme - ohne diesen Zweig wuerde
                // daraus eine "offene Position" mit minus sieben Stueck,
                // und aus der rechnet die App einen Einstiegspreis.
                if (s < 0 && lauf < 1e-9) { altbestand.push(r); return; }

                // Teilweise gedeckt: 11 Stueck im Zeitraum gekauft, 21
                // verkauft. Die Zeile wird anteilig geteilt - nur der
                // gedeckte Teil gehoert zur Rundreise. Wer die ganze
                // Zeile nimmt, bucht den Erloes fuer 21 Stueck gegen die
                // Kosten von 11 und meldet einen Traumgewinn.
                if (s < 0 && -s > lauf + 1e-9) {
                    const anteil = lauf / -s;
                    teil.push(Object.assign({}, r, {
                        shares: String(-lauf),
                        amount: String(z0(r.amount) * anteil),
                        fee: String(z0(r.fee) * anteil),
                    }));
                    altbestand.push(Object.assign({}, r, {
                        shares: String(s + lauf),
                        amount: String(z0(r.amount) * (1 - anteil)),
                    }));
                    lauf = 0;
                    fertig.push(teil); teil = [];
                    return;
                }

                lauf += s;
                teil.push(r);
                if (Math.abs(lauf) < 1e-9) { fertig.push(teil); teil = []; }
            });
            if (teil.length) offen.push(teil);
        });
        return { fertig: fertig, offen: offen, altbestand: altbestand };
    }

    /**
     * Gruppiert Basiswerte, die vermutlich dasselbe meinen.
     *
     * In der Datei heisst derselbe Wert je nach Quelle unterschiedlich:
     * die Aktie als "AST SpaceMobile", der Knock-out darauf als
     * "AST SPACEMOBIL.A DL-,0001". Ungeprueft landen beide als
     * getrennte Basiswerte in der gemeinsamen Instrumententabelle, und
     * die Statistik zerfaellt in zwei Haelften.
     *
     * Automatisch zusammenfuehren waere falsch - zwei Werte koennen
     * aehnlich heissen und verschieden sein. Deshalb nur ein Vorschlag,
     * ueber den der Nutzer entscheidet.
     */
    const RAUSCH = /\b(INC|CORP|CORPORATION|LTD|LIMITED|PLC|AG|SE|NV|SA|ADR|CL|CLASS|THE|HOLDING|HOLDINGS|GROUP|CO|COMPANY|TECHNOLOGIES|TECHNOLOGY)\b/g;

    function kennung(name) {
        return String(name || '')
            .toUpperCase()
            .replace(/[.,+&\-\/]/g, ' ')
            .replace(RAUSCH, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8);
    }

    function aehnlicheBasiswerte(namen) {
        const gruppen = {};
        namen.forEach(function (n) {
            const k = kennung(n);
            if (!k) return;
            (gruppen[k] = gruppen[k] || []).push(n);
        });
        return Object.keys(gruppen)
            .filter(function (k) { return gruppen[k].length > 1; })
            .map(function (k) { return gruppen[k].slice().sort(); });
    }

    function bauen(teil, abgeschlossen) {
        const ein = teil.filter(function (r) { return z0(r.shares) > 0; });
        const aus = teil.filter(function (r) { return z0(r.shares) < 0; });
        if (!ein.length) return null;

        const stkEin = ein.reduce(function (s, r) { return s + z0(r.shares); }, 0);
        const stkAus = aus.reduce(function (s, r) { return s - z0(r.shares); }, 0);
        const kosten = ein.reduce(function (s, r) { return s - z0(r.amount); }, 0);
        const erloes = aus.reduce(function (s, r) { return s + z0(r.amount); }, 0);
        const gebuehren = teil.reduce(function (s, r) { return s + Math.abs(z0(r.fee)); }, 0);

        const p = produktAusZeile(ein[0]);
        const preisEin = stkEin > 0 ? kosten / stkEin : null;
        const preisAus = stkAus > 0 ? erloes / stkAus : null;

        // Schluessel gegen doppelten Import: die TR-Transaktions-IDs
        // aller Buchungen dieses Trades, sortiert. Wer denselben
        // Zeitraum zweimal exportiert, traegt den Trade nicht zweimal
        // ein - die Datenbank lehnt ihn ab.
        const ids = teil.map(function (r) { return r.transaction_id || ''; })
            .filter(Boolean).sort();

        const t = {
            importKey: ids.length ? ids.join('|').slice(0, 300) : null,
            isin: ein[0].symbol || null,
            wkn: p.wkn,
            art: p.art,
            produkttyp: p.produkttyp,
            basiswert: basiswertKurz(p.basiswert),
            basiswertRoh: p.basiswert,
            richtung: p.richtung || 'long',
            strike: p.strike,
            stueck: stkEin,
            preisEin: preisEin,
            preisAus: preisAus,
            einsatz: kosten,
            erloes: abgeschlossen ? erloes : null,
            gebuehren: gebuehren,
            // Netto: Gebuehren gehen vom Ergebnis ab. Bei zweistelligen
            // Positionen sind zwei Euro Ordergebuehr schnell ein Drittel
            // des Gewinns - wer sie weglaesst, misst sich schoen.
            pnl: abgeschlossen ? (erloes - kosten - gebuehren) : null,
            pnlProzent: (abgeschlossen && kosten > 0)
                ? ((erloes - kosten - gebuehren) / kosten) * 100 : null,
            geoeffnet: ein[0].datetime || ein[0].date,
            geschlossen: abgeschlossen && aus.length
                ? aus[aus.length - 1].datetime || aus[aus.length - 1].date : null,
            teilkaeufe: ein.length,
            teilverkaeufe: aus.length,
            offen: !abgeschlossen,
            restStueck: abgeschlossen ? 0 : stkEin - stkAus,
        };
        return t;
    }

    // ------------------------------------------------------ Geldverkehr

    // Nur echte Ein- und Auszahlungen. Kartenzahlungen, Zinsen und
    // Saveback tauchen im Bericht auf, wandern aber nicht ins Journal -
    // sie gehoeren nicht zum Handelsergebnis und wuerden die
    // Kapitalkurve verzerren.
    const GELD = {
        TRANSFER_INSTANT_INBOUND: 'einzahlung',
        TRANSFER_INBOUND: 'einzahlung',
        TRANSFER_INSTANT_OUTBOUND: 'auszahlung',
        TRANSFER_OUTBOUND: 'auszahlung',
    };

    // --------------------------------------------------------- Analyse

    window.cfImportAnalysieren = function (text) {
        const zeilen = csvLesen(text);
        if (!zeilen.length) {
            return { ok: false, grund: 'Die Datei enthält keine lesbaren Zeilen.' };
        }
        const pflicht = ['datetime', 'category', 'type', 'shares', 'amount'];
        const fehlend = pflicht.filter(function (k) { return !(k in zeilen[0]); });
        if (fehlend.length) {
            return { ok: false, grund: 'Das sieht nicht nach einem '
                + 'Trade-Republic-Transaktionsexport aus. Es fehlen die Spalten: '
                + fehlend.join(', ') + '.' };
        }

        const handel = zeilen.filter(function (r) {
            return r.category === 'TRADING'
                && (r.type === 'BUY' || r.type === 'SELL');
        });
        const r = rundreisen(handel);
        const altStueck = r.altbestand.reduce(function (s, x) {
            return s + Math.abs(z0(x.shares)); }, 0);

        const trades = [], positionen = [];
        r.fertig.forEach(function (teil) {
            const t = bauen(teil, true);
            if (t) trades.push(t);
        });
        r.offen.forEach(function (teil) {
            const t = bauen(teil, false);
            if (t) positionen.push(t);
        });

        const sortieren = function (a, b) {
            return String(a.geoeffnet).localeCompare(String(b.geoeffnet));
        };
        trades.sort(sortieren);
        positionen.sort(sortieren);

        const buchungen = [];
        const ignoriert = {};
        zeilen.forEach(function (row) {
            if (row.category !== 'CASH') return;
            const art = GELD[row.type];
            if (!art) { ignoriert[row.type] = (ignoriert[row.type] || 0) + 1; return; }
            const betrag = z0(row.amount);
            if (!betrag) return;
            buchungen.push({
                art: art,
                betrag: Math.abs(betrag),
                datum: row.date,
                // Bewusst ohne Namen und IBAN aus der Datei
                notiz: art === 'einzahlung' ? 'Einzahlung (TR-Import)'
                                            : 'Auszahlung (TR-Import)',
            });
        });

        const namen = Array.from(new Set(trades.concat(positionen)
            .map(function (t) { return t.basiswert; })
            .filter(Boolean))).sort();

        // Was der Nutzer wissen muss, bevor er zustimmt
        const hinweise = [];
        const mitStrike = trades.concat(positionen)
            .filter(function (t) { return t.art !== 'aktie' && t.strike; }).length;
        const zert = trades.concat(positionen)
            .filter(function (t) { return t.art !== 'aktie'; }).length;
        if (zert) {
            hinweise.push(zert + ' Hebelprodukt(e) erkannt, bei ' + mitStrike
                + ' davon steht der Basispreis im Produktnamen und wird übernommen.');
            hinweise.push('Hebel und KO-Abstand bleiben leer: dafür müsste bekannt '
                + 'sein, wo der Basiswert beim Kauf stand, und das steht nicht in '
                + 'der Datei. Kannst du pro Trade nachtragen.');
        }
        const teilweise = trades.filter(function (t) {
            return t.teilkaeufe > 1 || t.teilverkaeufe > 1; }).length;
        if (teilweise) {
            hinweise.push(teilweise + ' Trade(s) bestehen aus mehreren Teilkäufen '
                + 'oder -verkäufen. Sie werden zu je einem Trade zusammengefasst, '
                + 'die Preise mit der Stückzahl gewichtet gemittelt.');
        }
        if (positionen.length) {
            hinweise.push(positionen.length + ' Position(en) sind noch offen und '
                + 'landen unter „Offene Positionen", nicht im Journal.');
        }
        if (r.altbestand.length) {
            hinweise.push(r.altbestand.length + ' Verkauf/Verkäufe ('
                + altStueck.toFixed(2).replace(/\.?0+$/, '') + ' Stück) haben keinen '
                + 'Kauf im Exportzeitraum — die Stücke lagen vorher schon im Depot. '
                + 'Sie werden übersprungen; für diese Trades bräuchte es einen '
                + 'Export ab einem früheren Datum.');
        }
        const gebSumme = trades.reduce(function (s, t) { return s + t.gebuehren; }, 0);
        if (gebSumme > 0) {
            hinweise.push('Ordergebühren von ' + gebSumme.toFixed(2) + ' € sind vom '
                + 'Ergebnis abgezogen — die meisten Journale lassen sie weg.');
        }
        const ignoriertListe = Object.keys(ignoriert).map(function (k) {
            return ignoriert[k] + '× ' + k; });
        if (ignoriertListe.length) {
            hinweise.push('Nicht übernommen: ' + ignoriertListe.join(', ')
                + '. Kartenzahlungen und Zinsen gehören nicht zum Handelsergebnis.');
        }
        const doppelt = aehnlicheBasiswerte(namen);
        if (doppelt.length) {
            hinweise.push(doppelt.length + '× steht derselbe Basiswert vermutlich '
                + 'unter zwei Namen in der Datei (z.B. „'
                + doppelt[0].join('" und „') + '"). Getrennt gelassen wäre deine '
                + 'Statistik pro Wert halbiert — vor dem Übernehmen zusammenführen.');
        }
        hinweise.push('Namen, IBANs und Verwendungszwecke aus der Datei werden '
            + 'nicht gespeichert.');

        return {
            ok: true,
            zeilen: zeilen.length,
            trades: trades,
            positionen: positionen,
            buchungen: buchungen,
            hinweise: hinweise,
            altbestand: r.altbestand.length,
            basiswerte: namen,
            // Fuer Aktien und ETFs steht die ISIN des Basiswerts selbst
            // in der Datei - der eindeutigste Schluessel, den es gibt.
            // Bei Zertifikaten ist symbol die ISIN des SCHEINS, nicht
            // die des Basiswerts; dort bleibt nur der Name.
            isinFuer: (function () {
                const o = {};
                trades.concat(positionen).forEach(function (t) {
                    if (t.art === 'aktie' && t.basiswert && t.isin) {
                        o[t.basiswert] = t.isin;
                    }
                });
                return o;
            })(),
            zusammenfuehren: aehnlicheBasiswerte(namen),
        };
    };

    window.cfImportCsvLesen = csvLesen;
})();

/* CapitalFlow - Trade-Republic-Import, Oberflaeche und Schreibweg
 *
 * Getrennt vom Parser darueber: der laesst sich ohne Browser pruefen,
 * das hier braucht die Seite.
 */
(function () {
    'use strict';

    let analyse = null;        // letzter Bericht
    let tickerFeld = {};       // Dateiname des Basiswerts -> Kuerzel

    function el(id) { return document.getElementById(id); }
    function status(t) { const e = el('trImportStatus'); if (e) e.textContent = t || ''; }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function eur(n) {
        return (n === null || n === undefined) ? '—'
            : n.toLocaleString('de-DE', { minimumFractionDigits: 2,
                                          maximumFractionDigits: 2 }) + ' €';
    }

    /* ------------------------------------------------------------------
     * Startbestand an Kuerzeln
     *
     * Kein Lookup-Dienst: OpenFIGI und Konsorten kosten Schluessel,
     * Wartezeit und eine Abhaengigkeit, die irgendwann wegbricht. Der
     * eigentliche Speicher ist die gemeinsame instruments-Tabelle -
     * was ein Nutzer einmal zuordnet, findet jeder Import danach
     * automatisch, auch bei anderen Nutzern.
     *
     * Diese Liste ist nur der Anschub, damit der allererste Import
     * nicht bei null anfaengt. Sie deckt, was im Discord gehandelt
     * wird; alles andere fragt einmal nach und merkt es sich dann.
     *
     * Schluessel ist die normalisierte Form aus kennung(): Grossbuch-
     * staben, ohne Rechtsformen, auf acht Zeichen gekuerzt. Dadurch
     * treffen "AST SpaceMobile" und "AST SPACEMOBIL.A" denselben
     * Eintrag.
     * ---------------------------------------------------------------- */
    const START = {
        'AST SPAC': 'ASTS',  'HIMS HER': 'HIMS',  'META PLA': 'META',
        'CLOUDFLA': 'NET',   'COREWEAV': 'CRWV',  'CIPHER M': 'CIFR',
        'ORACLE':   'ORCL',  'BROADCOM': 'AVGO',  'BAIDU':    'BIDU',
        'COINBASE': 'COIN',  'DRAFTKIN': 'DKNG',  'INTUIT':   'INTU',
        'IREN':     'IREN',  'MP MATER': 'MP',    'NOVO NOR': 'NVO',
        'ONDAS':    'ONDS',  'ROCKET L': 'RKLB',  'SERVICEN': 'NOW',
        'SOFI':     'SOFI',  'NVIDIA':   'NVDA',  'TESLA':    'TSLA',
        'APPLE':    'AAPL',  'AMAZON':   'AMZN',  'MICROSOF': 'MSFT',
        'ALPHABET': 'GOOGL', 'PALANTIR': 'PLTR',  'ADVANCED': 'AMD',
        'MICRON':   'MU',    'NETFLIX':  'NFLX',  'RHEINMET': 'RHM',
        'SIEMENS':  'SIE',   'SAP':      'SAP',
    };

    /* Fonds heissen fast gleich und sind trotzdem verschieden:
       "Core MSCI World" und "Core MSCI EM IMI" fallen ueber den Namen
       auf denselben Schluessel und waeren damit derselbe Wert. Bei
       ihnen entscheidet deshalb die ISIN, die in der Datei steht. */
    const START_ISIN = {
        'IE00B4L5Y983': 'IWDA',   // iShares Core MSCI World
        'IE00BKM4GZ66': 'EIMI',   // iShares Core MSCI EM IMI
        'IE00B4L5YC18': 'IEMA',   // iShares Core MSCI EM
        'IE00B5BMR087': 'CSPX',   // iShares Core S&P 500
        'IE00B4NCWG09': 'SSLN',   // iShares Physical Silver
        'IE00B4ND3602': 'SGLN',   // iShares Physical Gold
    };

    /**
     * Vorschlag fuer das Kuerzel eines Basiswerts.
     *
     * Bewusst grob: das erste bedeutungstragende Wort, gekuerzt. Wichtig
     * ist nicht, dass es das richtige Boersenkuerzel traegt, sondern
     * dass zwei Schreibweisen desselben Werts denselben Vorschlag
     * bekommen - dann fallen sie beim Import von allein zusammen.
     */
    function normal(name) {
        return String(name || '').toUpperCase()
            .replace(/[^A-Z0-9 ]/g, ' ')
            .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|PLC|AG|SE|NV|SA|ADR|CL|CLASS|THE|HOLDINGS?|GROUP|CO|COMPANY|TECHNOLOGIES|TECHNOLOGY)\b/g, ' ')
            .replace(/\s+/g, ' ').trim();
    }

    function vorschlag(name, isin) {
        const i = String(isin || '').toUpperCase();
        if (START_ISIN[i]) return START_ISIN[i];
        const n = normal(name);
        // Erst der volle Schluessel, dann nur das erste Wort. Ohne den
        // zweiten Versuch geht "BAIDU A ADR" leer aus: das "A" bleibt
        // stehen und der Schluessel heisst "BAIDU A".
        if (START[n.slice(0, 8)]) return START[n.slice(0, 8)];
        const erstes = (n.split(' ')[0] || 'WERT').slice(0, 8);
        if (START[erstes]) return START[erstes];
        return erstes;
    }

    /**
     * Fragt die gemeinsame Instrumententabelle nach bereits bekannten
     * Zuordnungen - erst ueber die ISIN, dann ueber den Namen.
     *
     * Das ist der Teil, der mit der Zeit besser wird: jeder Nutzer, der
     * einmal "CLOUDFLARE INC." auf NET setzt, erspart es allen
     * folgenden. Faellt die Abfrage aus, bleibt der Startbestand -
     * der Import laeuft weiter, nur mit gröberen Vorschlägen.
     */
    async function bekannteKuerzel(namen, isinFuer) {
        const treffer = {};
        if (!window.cfDb) return treffer;
        try {
            const { data, error } = await window.cfDb
                .from('instruments').select('symbol, name, isin');
            if (error || !data) return treffer;

            const nachIsin = {}, nachName = {};
            data.forEach(function (i) {
                if (i.isin) nachIsin[String(i.isin).toUpperCase()] = i.symbol;
                if (i.name) nachName[normal(i.name).slice(0, 8)] = i.symbol;
                if (i.symbol) nachName[normal(i.symbol).slice(0, 8)] =
                    nachName[normal(i.symbol).slice(0, 8)] || i.symbol;
            });
            namen.forEach(function (n) {
                const isin = (isinFuer[n] || '').toUpperCase();
                if (isin && nachIsin[isin]) { treffer[n] = nachIsin[isin]; return; }
                const k = normal(n).slice(0, 8);
                if (nachName[k]) treffer[n] = nachName[k];
            });
        } catch (e) { /* Vorschlaege sind nie kritisch */ }
        return treffer;
    }

    window.cfTrImportWaehlen = function () {
        const e = el('trImportInput');
        if (e) { e.value = ''; e.click(); }
    };

    window.cfTrImportGelesen = function (input) {
        const datei = input && input.files && input.files[0];
        if (!datei) return;
        status('Datei wird gelesen…');
        const leser = new FileReader();
        leser.onload = function () {
            try { bericht(window.cfImportAnalysieren(String(leser.result))); }
            catch (e) { status('Fehler beim Lesen: ' + e.message); }
        };
        leser.onerror = function () { status('Datei konnte nicht gelesen werden.'); };
        leser.readAsText(datei, 'utf-8');
    };

    function bericht(a) {
        analyse = a;
        const ziel = el('trImportBericht');
        const btn = el('trImportBtn');
        if (!ziel) return;
        ziel.style.display = 'block';

        if (!a.ok) {
            ziel.innerHTML = '<div class="zert-warnung" style="display:block;">'
                + esc(a.grund) + '</div>';
            if (btn) btn.style.display = 'none';
            status('');
            return;
        }

        const gewinner = a.trades.filter(function (t) { return t.pnl > 0; }).length;
        const summe = a.trades.reduce(function (s, t) { return s + t.pnl; }, 0);
        const geb = a.trades.reduce(function (s, t) { return s + t.gebuehren; }, 0);

        let h = '<div class="zert-ergebnis" style="margin:0 0 14px;">'
            + kachel('Trades', a.trades.length, a.trades.length
                ? gewinner + ' im Plus' : 'keine gefunden')
            + kachel('Offene Positionen', a.positionen.length, '')
            + kachel('Ergebnis', eur(summe), 'nach Gebühren',
                     summe >= 0 ? 'gut' : 'rot')
            + kachel('Gebühren', eur(geb), a.trades.length
                ? eur(geb / a.trades.length) + ' je Trade' : '', 'warn')
            + '</div>';

        // Kuerzel je Basiswert. Gleiche Vorschlaege fuehren zwei
        // Schreibweisen automatisch zusammen.
        tickerFeld = {};
        if (a.basiswerte.length) {
            h += '<div style="margin-bottom:12px;">'
              + '<div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:4px;">'
              + 'Kürzel je Basiswert</div>'
              + '<p style="margin:0 0 10px;color:#64748b;font-size:11px;line-height:1.55;">'
              + 'In der Datei steht nur der Klarname. Zwei Zeilen mit demselben '
              + 'Kürzel werden zu einem Basiswert — so gehören Aktie und '
              + 'Knock-out darauf zusammen.</p>'
              + '<div style="display:grid;gap:6px;max-height:210px;overflow-y:auto;'
              + 'padding-right:4px;">';
            a.basiswerte.forEach(function (n, i) {
                tickerFeld[n] = vorschlag(n, (a.isinFuer || {})[n]);
                h += '<div style="display:flex;gap:8px;align-items:center;">'
                  + '<span style="flex:1;color:#94a3b8;font-size:11.5px;'
                  + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
                  + esc(n) + '</span>'
                  + '<input type="text" data-basiswert="' + esc(n) + '" '
                  + 'value="' + esc(tickerFeld[n]) + '" maxlength="12" '
                  + 'oninput="cfTrImportKuerzel(this)" '
                  + 'style="width:96px;background:rgba(168,85,247,0.08);'
                  + 'border:1px solid rgba(168,85,247,0.2);border-radius:7px;'
                  + 'padding:6px 9px;color:#f1f5f9;font-size:12px;'
                  + 'font-family:Inter,sans-serif;text-transform:uppercase;">'
                  + '</div>';
            });
            h += '</div></div>';
        }

        if (a.hinweise.length) {
            h += '<div style="background:rgba(56,189,248,0.06);'
              + 'border:1px solid rgba(56,189,248,0.18);border-radius:10px;'
              + 'padding:12px 14px;"><ul style="margin:0;padding-left:16px;'
              + 'color:#a5b4c4;font-size:11.5px;line-height:1.65;">'
              + a.hinweise.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('')
              + '</ul></div>';
        }

        ziel.innerHTML = h;
        if (btn) btn.style.display = (a.trades.length || a.positionen.length
            || a.buchungen.length) ? 'block' : 'none';
        status('Nichts wurde gespeichert. Erst „Übernehmen" schreibt.');

        // Bekanntes nachtragen. Laeuft im Hintergrund, damit der Bericht
        // sofort dasteht - die Felder fuellen sich einen Moment spaeter
        // nach, und was schon zugeordnet war, muss niemand neu tippen.
        bekannteKuerzel(a.basiswerte, a.isinFuer || {}).then(function (t) {
            let n = 0;
            Object.keys(t).forEach(function (name) {
                tickerFeld[name] = t[name];
                const f = document.querySelector(
                    '#trImportBericht input[data-basiswert="' + name.replace(/"/g, '\\"') + '"]');
                if (f) { f.value = t[name]; f.style.borderColor = 'rgba(34,197,94,0.45)'; }
                n++;
            });
            if (n) status(n + ' Kürzel aus deinen vorhandenen Basiswerten '
                + 'übernommen (grün umrandet). Nichts wurde gespeichert.');
        });
    }

    function kachel(label, wert, zusatz, klasse) {
        return '<div class="zert-kachel ' + (klasse || '') + '">'
            + '<div class="zert-kachel-label">' + esc(label) + '</div>'
            + '<div class="zert-kachel-wert">' + esc(wert) + '</div>'
            + (zusatz ? '<div class="zert-kachel-zusatz">' + esc(zusatz) + '</div>' : '')
            + '</div>';
    }

    window.cfTrImportKuerzel = function (input) {
        const n = input.getAttribute('data-basiswert');
        tickerFeld[n] = String(input.value || '').toUpperCase().trim();
    };

    // ------------------------------------------------------- Schreiben

    /**
     * Schreibt den Import in einem Rutsch.
     *
     * Bewusst NICHT ueber cfDbTradeNeu: das laedt nach jeder Zeile den
     * gesamten Datenbestand neu. Bei 36 Trades waeren das 36 volle
     * Ladevorgaenge und eine Minute Wartezeit. Hier wird gesammelt
     * geschrieben und einmal am Ende nachgeladen.
     */
    window.cfTrImportUebernehmen = async function () {
        if (!analyse || !analyse.ok) return;
        const db = window.cfDb;
        if (!db) { status('Keine Verbindung zur Datenbank.'); return; }

        const btn = el('trImportBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Läuft…'; }

        try {
            const sitzung = await window.cfSitzung();
            if (!sitzung) throw new Error('Nicht angemeldet.');
            const nutzer = sitzung.user.id;

            // --- Basiswerte
            status('Basiswerte anlegen…');
            const symbolFuer = {};
            const idFuer = {};
            for (const name of analyse.basiswerte) {
                const sym = (tickerFeld[name]
                    || vorschlag(name, (analyse.isinFuer || {})[name])).toUpperCase();
                symbolFuer[name] = sym;
                if (idFuer[sym]) continue;
                const { data, error } = await db.from('instruments')
                    .select('id').ilike('symbol', sym).maybeSingle();
                if (error) throw new Error('Basiswert suchen: ' + error.message);
                if (data) { idFuer[sym] = data.id; continue; }
                const { data: neu, error: f2 } = await db.from('instruments')
                    .insert({ symbol: sym, name: name, created_by: nutzer })
                    .select('id').single();
                if (f2) throw new Error('Basiswert anlegen: ' + f2.message);
                idFuer[sym] = neu.id;
            }

            // --- Produkte
            status('Produkte anlegen…');
            const produktFuer = {};
            for (const t of analyse.trades.concat(analyse.positionen)) {
                if (t.art === 'aktie' || !t.strike || !t.isin) continue;
                if (produktFuer[t.isin]) continue;
                const { data } = await db.from('products')
                    .select('id').eq('isin', t.isin).maybeSingle();
                if (data) { produktFuer[t.isin] = data.id; continue; }
                const { data: neu, error } = await db.from('products').insert({
                    instrument_id: idFuer[symbolFuer[t.basiswert]] || null,
                    kind: t.art, direction: t.richtung,
                    isin: t.isin, wkn: t.wkn || null,
                    strike: t.strike, ratio: 1,
                    // Bei Turbos ohne Stop-Loss-Puffer ist die Schwelle
                    // der Basispreis. "Best Turbo" hat einen Puffer, den
                    // die Datei nicht nennt - dann bleibt sie leer,
                    // statt eine falsche Schwelle zu behaupten.
                    ko_barrier: /best/i.test(t.produkttyp || '') ? null : t.strike,
                    created_by: nutzer,
                }).select('id').single();
                if (error) throw new Error('Produkt anlegen: ' + error.message);
                produktFuer[t.isin] = neu.id;
            }

            // --- Trades und Positionen
            const zeilen = [];
            analyse.trades.forEach(function (t) {
                zeilen.push({
                    user_id: nutzer,
                    instrument_id: idFuer[symbolFuer[t.basiswert]] || null,
                    product_id: produktFuer[t.isin] || null,
                    status: 'geschlossen',
                    direction: t.richtung,
                    entry_price: t.preisEin,
                    exit_price: t.preisAus,
                    quantity: t.stueck,
                    position_size: t.einsatz,
                    leverage: 1,
                    fees: t.gebuehren,
                    pnl: Math.round(t.pnl * 100) / 100,
                    pnl_percent: t.pnlProzent !== null
                        ? Math.round(t.pnlProzent * 100) / 100 : null,
                    notes: t.produkttyp ? t.produkttyp + (t.strike
                        ? ' · Basispreis ' + t.strike : '') : null,
                    opened_at: t.geoeffnet,
                    closed_at: t.geschlossen,
                    source: 'import',
                    // Ohne Stop und These ist der Trade unvollstaendig -
                    // und soll auch so aussehen, sonst traegt sie niemand
                    // nach und die Auswertung bleibt leer.
                    incomplete: true,
                    import_key: t.importKey,
                });
            });
            analyse.positionen.forEach(function (t) {
                zeilen.push({
                    user_id: nutzer,
                    instrument_id: idFuer[symbolFuer[t.basiswert]] || null,
                    product_id: produktFuer[t.isin] || null,
                    status: 'offen',
                    direction: t.richtung,
                    entry_price: t.preisEin,
                    quantity: t.restStueck,
                    position_size: t.einsatz,
                    leverage: 1,
                    fees: t.gebuehren,
                    notes: t.produkttyp ? t.produkttyp + (t.strike
                        ? ' · Basispreis ' + t.strike : '') : null,
                    opened_at: t.geoeffnet,
                    source: 'import',
                    incomplete: true,
                    import_key: t.importKey,
                });
            });

            // In Haeppchen, sonst laeuft die Anfrage ins Zeitlimit.
            // upsert mit ignoreDuplicates: schon importierte Trades
            // werden uebersprungen statt den ganzen Import abzubrechen.
            let geschrieben = 0;
            for (let i = 0; i < zeilen.length; i += 25) {
                const teil = zeilen.slice(i, i + 25);
                status('Trades schreiben… ' + (i + teil.length) + '/' + zeilen.length);
                const { data, error } = await db.from('trades')
                    .upsert(teil, { onConflict: 'user_id,import_key',
                                    ignoreDuplicates: true })
                    .select('id');
                if (error) throw new Error('Trades schreiben: ' + error.message);
                geschrieben += (data || []).length;
            }

            // --- Ein- und Auszahlungen
            let buchungen = 0;
            if (analyse.buchungen.length) {
                status('Ein- und Auszahlungen…');
                const vorhanden = await db.from('transactions')
                    .select('kind, amount, booked_at');
                const schon = new Set((vorhanden.data || []).map(function (b) {
                    return b.kind + '|' + Number(b.amount).toFixed(2) + '|' + b.booked_at;
                }));
                const neu = analyse.buchungen.filter(function (b) {
                    return !schon.has(b.art + '|' + b.betrag.toFixed(2) + '|' + b.datum);
                }).map(function (b) {
                    return { user_id: nutzer, kind: b.art, amount: b.betrag,
                             booked_at: b.datum, note: b.notiz };
                });
                for (let i = 0; i < neu.length; i += 50) {
                    const { error } = await db.from('transactions')
                        .insert(neu.slice(i, i + 50));
                    if (error) throw new Error('Buchungen: ' + error.message);
                }
                buchungen = neu.length;
            }

            status('Neu laden…');
            const r = await window.cfDatenLaden();
            if (r && r.ok && typeof window.cfAnsichtenAufbauen === 'function') {
                window.cfAnsichtenAufbauen();
            }

            const doppelt = zeilen.length - geschrieben;
            status('✅ ' + geschrieben + ' übernommen'
                + (doppelt > 0 ? ', ' + doppelt + ' waren schon da' : '')
                + (buchungen ? ', ' + buchungen + ' Buchungen' : '') + '.');
            if (btn) btn.style.display = 'none';
            if (typeof showToast === 'function') {
                showToast('✅ ' + geschrieben + ' Trades importiert');
            }
        } catch (e) {
            console.error('TR-Import:', e);
            status('❌ ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Übernehmen'; }
        }
    };
})();
