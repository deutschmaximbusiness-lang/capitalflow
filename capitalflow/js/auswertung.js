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
        return window.cfGeld(parseFloat(n) || 0, { vorzeichen: true });
    }
    function farbe(n) { return (parseFloat(n) || 0) >= 0 ? '#4ade80' : '#FB7185'; }

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
                    { text: window.cfProz(k.quote, 0) },
                    { text: eur(k.summe), farbe: farbe(k.summe) },
                    { text: eur(k.schnitt), farbe: farbe(k.schnitt) },
                ],
            };
        });

        const k = kennzahlen(schlimmste.liste);
        const fuss = (k.summe < 0)
            ? 'Deine Trades über <strong>' + esc(schlimmste.name) + '</strong> '
              + 'kosten dich ' + eur(k.summe) + ' bei ' + window.cfProz(k.quote, 0)
              + ' Trefferquote. Wenn der Rest im Plus steht, liegt das Problem '
              + 'nicht an der Auswahl, sondern am Loslassen.'
            : null;

        return karte('Haltedauer',
            'Verlieren deine Trades, je länger du sie hältst?',
            tabelle(['Gehalten', 'Trades', 'Treffer', 'Ergebnis', 'Ø'], zeilen),
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
                { text: window.cfProz(k.quote, 0) },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: mittel === null ? '—' : window.cfZahl(mittel, 1) + ' T.' },
            ] };
        };

        const kh = kennzahlen(mitHebel);
        const fuss = (kh.quote >= 50 && kh.summe < 0)
            ? 'Du triffst bei Hebelprodukten in <strong>' + window.cfProz(kh.quote, 0)
              + '</strong> der Fälle richtig und verlierst trotzdem '
              + eur(kh.summe) + '. Das heißt: die wenigen Verlierer sind '
              + 'größer als die vielen Gewinner. Ein Stop-Problem, kein '
              + 'Auswahlproblem.'
            : null;

        return karte('Mit Hebel gegen ohne',
            'Bringt der Hebel dir tatsächlich mehr?',
            tabelle(['', 'Trades', 'Treffer', 'Ergebnis', 'Ø Dauer'],
                    [reihe('Hebelprodukte', mitHebel), reihe('Aktien, Fonds', ohne)]),
            fuss);
    }

    // ------------------------------------------------- Playbook (M3)

    function rVon(t) {
        if (typeof window.tradeR === 'function') return window.tradeR(t);
        const r = parseFloat(t.rMultiple);
        if (Number.isFinite(r)) return r;
        const risk = parseFloat(t.risk);
        return risk > 0 ? (parseFloat(t.pnl) || 0) / risk : null;
    }
    function schnittR(liste) {
        const rs = liste.map(rVon).filter(function (r) { return r !== null && Number.isFinite(r); });
        return rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : null;
    }
    function rText(r) {
        return r === null ? '—' : window.cfZahl(r, 2, { vorzeichen: true }) + ' R';
    }
    function rFarbe(r) { return r === null ? null : farbe(r); }

    // Unter dieser Zahl je Gruppe ist ein Unterschied eher Zufall als Muster
    const WENIG = 20;
    function wenigHinweis(n) {
        return n < WENIG
            ? ' <span class="aus-wenig">Noch ' + n + ' Trades – ab etwa ' + WENIG
              + ' wird daraus ein Muster, vorher kann es Zufall sein.</span>'
            : '';
    }

    function playbook() {
        return window.cfPlaybook || null;
    }

    /** Ergebnis je Strategie, dazu die Trades ohne Strategie. */
    function nachStrategie(trades) {
        const pb = playbook();
        const strategien = pb ? pb.strategien() : [];
        if (!strategien.length) return '';
        const mit = trades.filter(function (t) { return t.strategyId; });
        if (!mit.length) {
            return karte('Nach Strategie', 'Welche deiner Strategien verdient Geld?',
                '<p class="aus-leer">Noch kein Trade mit Strategie. Wähle sie im Journal '
                + 'beim Eintragen aus – dann steht hier, welche funktioniert.</p>');
        }
        const zeilen = [];
        let beste = null;
        strategien.forEach(function (s) {
            const liste = trades.filter(function (t) { return String(t.strategyId) === s.id; });
            if (!liste.length) return;
            const k = kennzahlen(liste);
            const r = schnittR(liste);
            if (!beste || k.summe > beste.summe) beste = { name: s.name, summe: k.summe, n: k.n };
            zeilen.push({ zellen: [
                { text: esc(s.name) + (s.archiviert ? ' <span class="aus-leise">(archiviert)</span>' : '') },
                { text: String(k.n) },
                { text: window.cfProz(k.quote, 0) },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: rText(r), farbe: rFarbe(r) },
            ] });
        });
        const ohne = trades.filter(function (t) { return !t.strategyId; });
        if (ohne.length) {
            const k = kennzahlen(ohne);
            const r = schnittR(ohne);
            zeilen.push({ zellen: [
                { text: '<span class="aus-leise">Ohne Strategie</span>' },
                { text: String(k.n) },
                { text: window.cfProz(k.quote, 0) },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: rText(r), farbe: rFarbe(r) },
            ] });
        }
        const kOhne = ohne.length ? kennzahlen(ohne) : null;
        let fuss = null;
        if (kOhne && kOhne.summe < 0 && kennzahlen(mit).summe > 0) {
            fuss = 'Mit Strategie stehst du im Plus, ohne Strategie bei <strong>' + eur(kOhne.summe)
                + '</strong>. Die Trades ohne Plan kosten dich das Geld, das die anderen verdienen.';
        } else if (beste && zeilen.length > 2) {
            fuss = 'Am meisten bringt <strong>' + esc(beste.name) + '</strong> (' + eur(beste.summe) + ').';
        }
        if (mit.length < WENIG) fuss = (fuss ? fuss : '') + wenigHinweis(mit.length);
        return karte('Nach Strategie', 'Welche deiner Strategien verdient Geld?',
            tabelle(['Strategie', 'Trades', 'Treffer', 'Ergebnis', 'Ø R'], zeilen), fuss);
    }

    /**
     * Was Regelbrueche kosten. Vergleicht Trades, bei denen alle
     * Pflichtregeln abgehakt waren, mit denen, bei denen mindestens eine
     * offen blieb - und zeigt die Regeln, deren Bruch am meisten kostet.
     */
    function regelbrueche(trades) {
        const pb = playbook();
        if (!pb || !pb.strategien().length) return '';
        const karteStrat = {};
        const regelInfo = {};
        pb.strategien().forEach(function (s) {
            karteStrat[s.id] = s;
            s.regeln.forEach(function (r) { regelInfo[s.id + '|' + r.id] = { text: r.text, gruppe: r.gruppe, strategie: s.name }; });
        });
        const bewertet = trades.filter(function (t) {
            return t.strategyId && pb.regelStand(t, karteStrat[String(t.strategyId)] || null);
        });
        if (!bewertet.length) {
            return karte('Was dich Regelbrüche kosten', 'Lohnt es sich, deine Regeln einzuhalten?',
                '<p class="aus-leer">Hak im Journal beim Eintragen ab, welche Regeln du '
                + 'eingehalten hast – dann steht hier, welche Regel dich wie viel kostet.</p>');
        }
        const sauber = [], gebrochen = [];
        bewertet.forEach(function (t) {
            const st = pb.regelStand(t, karteStrat[String(t.strategyId)] || null);
            (st.erfuellt === st.von ? sauber : gebrochen).push(t);
        });
        const reihe = function (name, liste) {
            const k = kennzahlen(liste);
            const r = liste.length ? schnittR(liste) : null;
            return { zellen: [
                { text: name },
                { text: String(k.n) },
                { text: liste.length ? window.cfProz(k.quote, 0) : '—' },
                { text: liste.length ? eur(k.summe) : '—', farbe: liste.length ? farbe(k.summe) : null },
                { text: rText(r), farbe: rFarbe(r) },
            ] };
        };
        let inhalt = tabelle(['', 'Trades', 'Treffer', 'Ergebnis', 'Ø R'],
            [reihe('Alle Regeln eingehalten', sauber), reihe('Mindestens eine gebrochen', gebrochen)]);

        // Welche Regel kostet am meisten, wenn sie gebrochen wird
        const jeRegel = {};
        bewertet.forEach(function (t) {
            const m = t.regelnErfuellt || {};
            Object.keys(m).forEach(function (id) {
                const info = regelInfo[String(t.strategyId) + '|' + id];
                if (!info || info.gruppe === 'bonus' || m[id] === true) return;
                const key = String(t.strategyId) + '|' + id;
                (jeRegel[key] = jeRegel[key] || { info: info, liste: [] }).liste.push(t);
            });
        });
        const teuer = Object.keys(jeRegel).map(function (k) {
            const e = jeRegel[k];
            return { info: e.info, k: kennzahlen(e.liste), r: schnittR(e.liste) };
        }).sort(function (a, b) { return a.k.summe - b.k.summe; }).slice(0, 5);
        if (teuer.length) {
            const mehrere = pb.strategien().filter(function (s) {
                return bewertet.some(function (t) { return String(t.strategyId) === s.id; });
            }).length > 1;
            inhalt += '<h4 class="aus-unter">Welche Regel du am teuersten brichst</h4>'
                + tabelle(['Regel', 'Gebrochen', 'Ergebnis', 'Ø R'], teuer.map(function (x) {
                    return { zellen: [
                        { text: esc(x.info.text) + (mehrere ? ' <span class="aus-leise">(' + esc(x.info.strategie) + ')</span>' : '') },
                        { text: x.k.n + '×' },
                        { text: eur(x.k.summe), farbe: farbe(x.k.summe) },
                        { text: rText(x.r), farbe: rFarbe(x.r) },
                    ] };
                }));
        }

        let fuss = null;
        const rS = schnittR(sauber), rG = schnittR(gebrochen);
        if (rS !== null && rG !== null && rS > rG) {
            fuss = 'Hältst du dich an alle Regeln, holst du im Schnitt <strong>' + rText(rS)
                + '</strong> pro Trade, sonst <strong>' + rText(rG) + '</strong>. '
                + 'Ein Trade mit gebrochener Regel bringt dir also rund ' + window.cfZahl(rS - rG, 2) + ' R weniger.';
        } else if (rS !== null && rG !== null) {
            fuss = 'Gebrochene Regeln schneiden bei dir bisher nicht schlechter ab. Entweder ist die '
                + 'Regel nicht wichtig – oder du hattest Glück. Mit mehr Trades zeigt sich, was davon stimmt.';
        }
        if (bewertet.length < WENIG) fuss = (fuss ? fuss : '') + wenigHinweis(bewertet.length);
        return karte('Was dich Regelbrüche kosten', 'Lohnt es sich, deine Regeln einzuhalten?', inhalt, fuss);
    }

    /** Fehlertyp aus dem Journal: was kosten Emotion, Strategie- und Regelfehler? */
    function fehlerkosten(trades) {
        const typen = ['Emotional', 'Strategie', 'Regelbruch'];
        const mitFehler = trades.filter(function (t) { return typen.indexOf(t.errorType) >= 0; });
        if (!mitFehler.length) return '';
        const zeilen = typen.map(function (typ) {
            const liste = trades.filter(function (t) { return t.errorType === typ; });
            if (!liste.length) return null;
            const k = kennzahlen(liste);
            const r = schnittR(liste);
            return { k: k, zeile: { zellen: [
                { text: esc(typ) },
                { text: String(k.n) },
                { text: window.cfProz(k.quote, 0) },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: rText(r), farbe: rFarbe(r) },
            ] } };
        }).filter(Boolean);
        const ohneFehler = trades.filter(function (t) { return typen.indexOf(t.errorType) < 0; });
        if (ohneFehler.length) {
            const k = kennzahlen(ohneFehler);
            const r = schnittR(ohneFehler);
            zeilen.push({ k: k, zeile: { zellen: [
                { text: '<span class="aus-leise">Kein Fehler</span>' },
                { text: String(k.n) },
                { text: window.cfProz(k.quote, 0) },
                { text: eur(k.summe), farbe: farbe(k.summe) },
                { text: rText(r), farbe: rFarbe(r) },
            ] } });
        }
        const summe = kennzahlen(mitFehler).summe;
        const fuss = summe < 0
            ? 'Trades mit Fehler haben dich zusammen <strong>' + eur(summe) + '</strong> gekostet.'
            : null;
        return karte('Was dich Fehler kosten', 'Wie teuer sind die Trades, bei denen du einen Fehler eingetragen hast?',
            tabelle(['Fehler', 'Trades', 'Treffer', 'Ergebnis', 'Ø R'], zeilen.map(function (z) { return z.zeile; })),
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
                // Kurzer Monatsname: "September 2026" sprengt die
                // Spalte und erzwingt eine Querleiste.
                { text: new Date(m.monat).toLocaleDateString('de-DE',
                    { month: 'short', year: '2-digit' }) },
                { text: String(m.trades) },
                { text: window.cfGeld(-Number(m.gebuehren)), farbe: '#fbbf24' },
                { text: eur(m.pnl_netto), farbe: farbe(m.pnl_netto) },
                { text: m.prozent_vom_einsatz !== null
                    ? window.cfProz(Number(m.prozent_vom_einsatz), 2) : '—' },
            ] };
        });

        const summe = data.reduce(function (s, m) { return s + Number(m.gebuehren); }, 0);
        const anzahl = data.reduce(function (s, m) { return s + Number(m.trades); }, 0);
        const fuss = anzahl
            ? 'Zusammen <strong>' + window.cfGeld(summe) + '</strong> '
              + 'auf ' + anzahl + ' Trades, also '
              + window.cfGeld(summe / anzahl) + ' je Runde. '
              + 'Bei Positionen um 250 € ist das rund ein Prozent, das du erst '
              + 'wieder hereinholen musst, bevor überhaupt etwas übrig bleibt.'
            : null;

        return karte('Was dich der Broker kostet',
            'Trade Republic wirbt mit „kostenlos“ — was zahlst du wirklich?',
            tabelle(['Monat', 'Trades', 'Gebühren', 'Netto', '% Einsatz'],
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
                    ? window.cfZahl(Number(g.hebel_schnitt), 1) + '×' : '—' },
                { text: window.cfProz(Number(g.trefferquote), 0) },
                { text: eur(g.pnl_summe), farbe: farbe(g.pnl_summe) },
            ] };
        });

        return karte('Abstand zur KO-Schwelle',
            'Zahlen sich knappe Abstände aus — oder frisst ein Totalverlust alles davor?',
            tabelle(['Abstand', 'Trades', 'Ø Hebel', 'Treffer', 'Ergebnis'],
                    zeilen),
            'Je knapper der Abstand, desto größer der Hebel — und desto öfter '
            + 'der Totalverlust. Diese Tabelle sagt dir, wo bei dir die Grenze liegt.');
    }

    // ----------------------------------------------------------- Bau

    // Was aus der Datenbank kam (Gebuehren, KO-Abstand), fuer den naechsten
    // Tabwechsel. Ohne das kamen diese zwei Karten bei JEDEM Wechsel erst
    // nach der Netzanfrage dazu und schoben alles darunter nach unten.
    let netzZuletzt = { schluessel: null, html: '' };

    // Direkt ins Raster, ohne Huelle - die Regel "letzte Karte bei
    // ungerader Anzahl volle Breite" zaehlt die Kinder des Rasters.
    function netzEinsetzen(raster, html) {
        if (!raster) return;
        raster.querySelectorAll('[data-netz]').forEach(function (e) { e.remove(); });
        if (!html) return;
        const t = document.createElement('template');
        t.innerHTML = html;
        Array.prototype.forEach.call(t.content.children, function (e) { e.setAttribute('data-netz', ''); });
        raster.appendChild(t.content);
    }

    window.cfAuswertungAufbauen = async function () {
        const ziel = document.getElementById('cfAuswertung');
        if (!ziel) return;

        const trades = lokal('trades').filter(function (t) {
            return t && Number.isFinite(parseFloat(t.pnl));
        });
        if (!trades.length) { ziel.innerHTML = ''; return; }

        const schluessel = trades.length + '|' + trades.reduce(function (s, t) {
            return s + (parseFloat(t.pnl) || 0);
        }, 0).toFixed(2);
        const gemerkt = netzZuletzt.schluessel === schluessel ? netzZuletzt.html : '';

        // Erst das, was ohne Netz geht (plus das zuletzt Geholte) - damit
        // sofort alles dasteht
        ziel.innerHTML = '<h2 class="aus-ueberschrift">Was deine Zahlen sagen</h2>'
            + '<div class="aus-raster">'
            + nachStrategie(trades)
            + regelbrueche(trades)
            + fehlerkosten(trades)
            + haltedauer(trades)
            + hebelVergleich(trades)
            + '</div>';
        const raster = ziel.querySelector('.aus-raster');
        netzEinsetzen(raster, gemerkt);

        try {
            const [g, k] = await Promise.all([gebuehren(), koAbstand()]);
            const neu = (g || '') + (k || '');
            netzZuletzt = { schluessel: schluessel, html: neu };
            // Nur anfassen, wenn sich etwas geaendert hat - sonst wuerde
            // jeder Wechsel die Karten neu aufbauen
            if (neu !== gemerkt && raster.isConnected) netzEinsetzen(raster, neu);
        } catch (e) { /* Auswertungen sind nie kritisch */ }
    };
})();
