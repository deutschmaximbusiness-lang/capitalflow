/* CapitalFlow - Auswertungen, die es sonst nirgends gibt
 *
 * Der Test fuer jede Kennzahl hier: aendert diese Zahl, was jemand
 * naechsten Montag anders macht? Was das nicht besteht, ist Dekoration.
 *
 * Drei Auswertungen, alle aus vorhandenen Daten, keine neuen
 * Eingabefelder:
 *
 *   1. Haltedauer. Fuer Swing-Trader die wichtigste Gruppierung - und
 *      die einzige, die zeigt, ob jemand seine Verlierer laufen laesst.
 *   2. Hebel gegen ohne Hebel. Trefferquote und Ergebnis getrennt.
 *   3. Gebuehren je Monat. Was der "kostenlose" Broker kostet.
 *
 * Die KO-Abstands-Auswertung liegt als View in der Datenbank, bleibt
 * aber leer, solange Trades keinen Hebel tragen. Sie wird deshalb nur
 * gezeigt, wenn es Zeilen gibt - eine leere Tabelle sieht aus wie ein
 * Fehler.
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function eur(n) {
        const z = parseFloat(n) || 0;
        return (z >= 0 ? '+' : '−') + '€' + Math.abs(z)
            .toLocaleString('de-DE', { minimumFractionDigits: 2,
                                       maximumFractionDigits: 2 });
    }
    function farbe(n) { return (parseFloat(n) || 0) >= 0 ? '#4ade80' : '#f87171'; }

    function lokal(key) {
        try {
            const w = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(w) ? w : [];
        } catch (e) { return []; }
    }

    /** Haltedauer in Tagen, null wenn nicht bestimmbar. */
    function tage(t) {
        if (!t.geoeffnet || !t.geschlossen) return null;
        const a = new Date(t.geoeffnet).getTime();
        const b = new Date(t.geschlossen).getTime();
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return (b - a) / 86400000;
    }

    const STUFEN = [
        { bis: 1,        name: 'unter 1 Tag' },
        { bis: 3,        name: '1 bis 3 Tage' },
        { bis: 7,        name: '3 Tage bis 1 Woche' },
        { bis: 21,       name: '1 bis 3 Wochen' },
        { bis: Infinity, name: 'über 3 Wochen' },
    ];

    function kennzahlen(liste) {
        const n = liste.length;
        const gewinner = liste.filter(function (t) { return t.pnl > 0; }).length;
        const summe = liste.reduce(function (s, t) { return s + (parseFloat(t.pnl) || 0); }, 0);
        return {
            n: n,
            quote: n ? (gewinner / n) * 100 : 0,
            summe: summe,
            schnitt: n ? summe / n : 0,
        };
    }

    // --------------------------------------------------------- Tabelle

    function tabelle(kopf, zeilen) {
        if (!zeilen.length) return '';
        return '<div class="aus-tabelle"><table><thead><tr>'
            + kopf.map(function (k, i) {
                return '<th' + (i ? ' class="rechts"' : '') + '>' + esc(k) + '</th>';
              }).join('')
            + '</tr></thead><tbody>'
            + zeilen.map(function (z) {
                return '<tr' + (z.hervor ? ' class="hervor"' : '') + '>'
                    + z.zellen.map(function (c, i) {
                        return '<td' + (i ? ' class="rechts"' : '')
                            + (c.farbe ? ' style="color:' + c.farbe + ';font-weight:600;"' : '')
                            + '>' + c.text + '</td>';
                      }).join('') + '</tr>';
              }).join('')
            + '</tbody></table></div>';
    }

    function karte(titel, frage, inhalt, fussnote) {
        return '<section class="aus-karte">'
            + '<h3 class="aus-titel">' + esc(titel) + '</h3>'
            + '<p class="aus-frage">' + esc(frage) + '</p>'
            + inhalt
            + (fussnote ? '<p class="aus-fuss">' + fussnote + '</p>' : '')
            + '</section>';
    }

    // ------------------------------------------------------ Haltedauer

    function haltedauer(trades) {
        const mit = trades.filter(function (t) { return tage(t) !== null; });
        if (mit.length < 3) {
            return karte('Haltedauer',
                'Verlieren deine Trades, je länger du sie hältst?',
                '<p class="aus-leer">Dafür braucht es Trades mit Kauf- und '
                + 'Verkaufszeitpunkt. Der Trade-Republic-Import bringt beides mit.</p>');
        }

        const gruppen = STUFEN.map(function (s) {
            return { name: s.name, bis: s.bis, liste: [] };
        });
        mit.forEach(function (t) {
            const d = tage(t);
            for (const g of gruppen) { if (d < g.bis) { g.liste.push(t); break; } }
        });

        const gefuellt = gruppen.filter(function (g) { return g.liste.length; });
        const schlimmste = gefuellt.reduce(function (a, b) {
            return kennzahlen(b.liste).summe < kennzahlen(a.liste).summe ? b : a;
        }, gefuellt[0]);

        const zeilen = gefuellt.map(function (g) {
            const k = kennzahlen(g.liste);
            return {
                hervor: g === schlimmste && k.summe < 0,
                zellen: [
                    { text: esc(g.name) },
                    { text: String(k.n) },
                    { text: k.quote.toFixed(0) + ' %' },
                    { text: eur(k.summe), farbe: farbe(k.summe) },
                    { text: eur(k.schnitt), farbe: farbe(k.schnitt) },
                ],
            };
        });

        const k = kennzahlen(schlimmste.liste);
        const fuss = (k.summe < 0)
            ? 'Deine Trades über <strong>' + esc(schlimmste.name) + '</strong> '
              + 'kosten dich ' + eur(k.summe) + ' bei ' + k.quote.toFixed(0)
              + ' % Trefferquote. Wenn der Rest im Plus steht, liegt das Problem '
              + 'nicht an der Auswahl, sondern am Loslassen.'
            : null;

        return karte('Haltedauer',
            'Verlieren deine Trades, je länger du sie hältst?',
            tabelle(['Gehalten', 'Trades', 'Treffer', 'Ergebnis', 'Ø je Trade'], zeilen),
            fuss);
    }

    // --------------------------------------------- Hebel gegen ohne

    function hebelVergleich(trades) {
        const mitHebel = trades.filter(function (t) {
            return typeof istHebelTrade === 'function' ? istHebelTrade(t)
                : (t.produkt && t.produkt.art && t.produkt.art !== 'aktie');
        });
        const ohne = trades.filter(function (t) { return mitHebel.indexOf(t) === -1; });
        if (!mitHebel.length || !ohne.length) {
            return karte('Mit Hebel gegen ohne',
                'Bringt der Hebel dir tatsächlich mehr?',
                '<p class="aus-leer">Dafür braucht es beides im Journal — '
                + 'Hebelprodukte und normale Käufe.</p>');
        }

        const reihe = function (name, liste) {
            const k = kennzahlen(liste);
            const dauer = liste.map(tage).filter(function (d) { return d !== null; });
            const mittel = dauer.length
                ? dauer.reduce(function (a, b) { return a + b; }, 0) / dauer.length : null;
            return { zellen: [
                { text: name },
                { text: String(k.n) },
                { text: k.quote.toFixed(0) + ' %' },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: mittel === null ? '—' : mittel.toFixed(1) + ' T.' },
            ] };
        };

        const kh = kennzahlen(mitHebel);
        const fuss = (kh.quote >= 50 && kh.summe < 0)
            ? 'Du triffst bei Hebelprodukten in <strong>' + kh.quote.toFixed(0)
              + ' %</strong> der Fälle richtig und verlierst trotzdem '
              + eur(kh.summe) + '. Das heißt: die wenigen Verlierer sind '
              + 'größer als die vielen Gewinner. Ein Stop-Problem, kein '
              + 'Auswahlproblem.'
            : null;

        return karte('Mit Hebel gegen ohne',
            'Bringt der Hebel dir tatsächlich mehr?',
            tabelle(['', 'Trades', 'Treffer', 'Ergebnis', 'Ø gehalten'],
                    [reihe('Hebelprodukte', mitHebel), reihe('Aktien und Fonds', ohne)]),
            fuss);
    }

    // ------------------------------------------------------ Gebuehren

    async function gebuehren() {
        if (!window.cfDb) return '';
        const { data, error } = await window.cfDb
            .from('auswertung_gebuehren').select('*').limit(12);
        if (error || !data || !data.length) return '';

        const zeilen = data.map(function (m) {
            return { zellen: [
                { text: new Date(m.monat).toLocaleDateString('de-DE',
                    { month: 'long', year: 'numeric' }) },
                { text: String(m.trades) },
                { text: '−€' + Number(m.gebuehren).toFixed(2), farbe: '#fbbf24' },
                { text: eur(m.pnl_netto), farbe: farbe(m.pnl_netto) },
                { text: m.prozent_vom_einsatz !== null
                    ? Number(m.prozent_vom_einsatz).toFixed(2) + ' %' : '—' },
            ] };
        });

        const summe = data.reduce(function (s, m) { return s + Number(m.gebuehren); }, 0);
        const anzahl = data.reduce(function (s, m) { return s + Number(m.trades); }, 0);
        const fuss = anzahl
            ? 'Zusammen <strong>' + summe.toFixed(2).replace('.', ',') + ' €</strong> '
              + 'auf ' + anzahl + ' Trades, also '
              + (summe / anzahl).toFixed(2).replace('.', ',') + ' € je Runde. '
              + 'Bei Positionen um 250 € ist das rund ein Prozent, das du erst '
              + 'wieder hereinholen musst, bevor überhaupt etwas übrig bleibt.'
            : null;

        return karte('Was dich der Broker kostet',
            'Trade Republic wirbt mit „kostenlos“ — was zahlst du wirklich?',
            tabelle(['Monat', 'Trades', 'Gebühren', 'Ergebnis netto', 'vom Einsatz'],
                    zeilen),
            fuss);
    }

    // ----------------------------------------------------- KO-Abstand

    async function koAbstand() {
        if (!window.cfDb) return '';
        const { data, error } = await window.cfDb
            .from('auswertung_ko_abstand').select('*');
        // Leer heisst: keine Trades mit Hebelangabe. Eine leere Tabelle
        // sieht aus wie ein Fehler - dann lieber gar nichts zeigen.
        if (error || !data || !data.length) return '';

        const zeilen = data.map(function (g) {
            return { zellen: [
                { text: esc(g.gruppe) },
                { text: String(g.trades) },
                { text: g.hebel_schnitt !== null
                    ? Number(g.hebel_schnitt).toFixed(1) + '×' : '—' },
                { text: Number(g.trefferquote).toFixed(0) + ' %' },
                { text: eur(g.pnl_summe), farbe: farbe(g.pnl_summe) },
            ] };
        });

        return karte('Abstand zur KO-Schwelle',
            'Zahlen sich knappe Abstände aus — oder frisst ein Totalverlust alles davor?',
            tabelle(['Abstand beim Einstieg', 'Trades', 'Ø Hebel', 'Treffer', 'Ergebnis'],
                    zeilen),
            'Je knapper der Abstand, desto größer der Hebel — und desto öfter '
            + 'der Totalverlust. Diese Tabelle sagt dir, wo bei dir die Grenze liegt.');
    }

    // ----------------------------------------------------------- Bau

    window.cfAuswertungAufbauen = async function () {
        const ziel = document.getElementById('cfAuswertung');
        if (!ziel) return;

        const trades = lokal('trades').filter(function (t) {
            return t && Number.isFinite(parseFloat(t.pnl));
        });
        if (!trades.length) { ziel.innerHTML = ''; return; }

        // Erst das, was ohne Netz geht - damit sofort etwas dasteht
        ziel.innerHTML = '<h2 class="aus-ueberschrift">Was deine Zahlen sagen</h2>'
            + '<div class="aus-raster">'
            + haltedauer(trades)
            + hebelVergleich(trades)
            + '</div>';

        try {
            const [g, k] = await Promise.all([gebuehren(), koAbstand()]);
            if (g || k) {
                ziel.querySelector('.aus-raster').innerHTML += g + k;
            }
        } catch (e) { /* Auswertungen sind nie kritisch */ }
    };
})();
