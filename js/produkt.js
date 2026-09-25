/* CapitalFlow - Zertifikate im Trade-Formular
 *
 * Verbindet den Rechenkern (zertifikate.js) mit dem Formular. Zwei
 * Aufgaben:
 *   1. Die Felder umbeschriften, je nachdem was gehandelt wurde.
 *   2. Bei jeder Eingabe neu rechnen und anzeigen.
 *
 * Der wichtigste Unterschied zur bisherigen Logik steht in preisSinn():
 * bei einem Zertifikat sind Ein- und Ausstiegspreis die Preise des
 * ZERTIFIKATS in Euro. Der Hebel steckt dann schon im Preis drin - wer
 * ihn noch einmal multipliziert, bekommt eine P&L, die nichts mit dem
 * Depot zu tun hat.
 */
(function () {
    'use strict';

    const AKTIE = 'aktie';

    function el(id) { return document.getElementById(id); }
    function wert(id) { const e = el(id); return e ? e.value : ''; }
    function zahl(v) { return window.cfZert ? window.cfZert.zahl(v) : parseFloat(v); }

    function art() {
        const e = el('produktArt');
        return e && e.value ? e.value : AKTIE;
    }

    function istZertifikat() { return art() !== AKTIE; }

    function richtung() {
        const e = el('direction');
        return (e && e.value === 'short') ? 'short' : 'long';
    }

    // ------------------------------------------------------ Beschriftung

    /**
     * Die Felder heissen bei einem Zertifikat anders, weil sie etwas
     * anderes bedeuten. "Entry Preis" ist bei einer Aktie der Kurs, bei
     * einem Knock-Out der Preis des Scheins - zwei voellig verschiedene
     * Zahlen im selben Feld. Ohne klare Beschriftung tippt jeder etwas
     * anderes hinein und die Auswertung ist wertlos.
     */
    function beschriften() {
        const a = art();
        const zert = a !== AKTIE;

        const t = { entry: 'Entry Preis ($)', exit: 'Exit Preis ($)',
                    pos: 'Position (€)', ticker: '' };
        if (zert) {
            t.entry = 'Kaufpreis Zertifikat (€)';
            t.exit = 'Verkaufspreis Zertifikat (€)';
            t.pos = 'Einsatz (€)';
            t.ticker = 'Basiswert, z.B. NVDA';
        }

        const le = el('entryPriceLabel'); if (le) le.textContent = t.entry;
        const lx = el('exitPriceLabel'); if (lx) lx.textContent = t.exit;
        const lp = el('positionSizeLabel'); if (lp) lp.textContent = t.pos;
        const tz = el('tickerZusatz'); if (tz) tz.textContent = t.ticker;

        // Der Hebel wird bei Zertifikaten gerechnet, nicht getippt.
        const lg = el('leverageGruppe');
        if (lg) lg.style.display = zert ? 'none' : '';
        // Der Stop liegt beim Zertifikat auf dem Basiswert - es gibt ein
        // eigenes Feld dafuer, das hier waere doppelt und mehrdeutig.
        const sg = el('stopLossGruppe');
        if (sg) sg.style.display = zert ? 'none' : '';

        const block = el('zertBlock');
        if (block) block.style.display = zert ? '' : 'none';

        const ko = el('zertFelderKo');
        const fa = el('zertFelderFaktor');
        if (ko) ko.style.display = a === 'knockout' ? '' : 'none';
        if (fa) fa.style.display = a === 'faktor' ? '' : 'none';

        // Aufgeld, Wechselkurs und Basispreis ergeben nur beim
        // Knock-Out Sinn - ein Faktor-Zertifikat hat keinen Basispreis.
        ['zRatioGruppe', 'zFxGruppe', 'zStrikeGruppe'].forEach(function (id) {
            const g = el(id);
            if (g) g.style.display = a === 'faktor' ? 'none' : '';
        });

        const ti = el('zertTitel');
        if (ti) ti.textContent = a === 'faktor'
            ? 'Angaben zum Faktor-Zertifikat' : 'Angaben zum Knock-Out';

        tickerEinsetzen();
    }

    /**
     * Setzt den eingetippten Ticker in die Beschriftungen.
     *
     * "Wo stand NVDA, als du gekauft hast?" ist eine Frage, die man ohne
     * Nachdenken beantwortet. "Kurs Basiswert beim Einstieg" muss man
     * erst uebersetzen - und genau dort werden Euro und Dollar
     * vertauscht.
     */
    function tickerEinsetzen() {
        const roh = wert('ticker').trim().toUpperCase();
        const name = roh || 'der Basiswert';
        const hat = Boolean(roh);

        const gt = el('zertGruppeTitel');
        if (gt) gt.textContent = hat ? 'Wo stand ' + name + '?'
                                     : 'Wo stand der Basiswert?';

        // Nur den Namen austauschen, den Zusatz stehen lassen - sonst
        // verschwindet mit jeder Ticker-Eingabe der Hinweis, dass die
        // Felder leer bleiben duerfen.
        const paare = [
            ['lblBasisEin', (hat ? name : 'Basiswert') + ' beim Kauf'],
            ['lblBasisAus', (hat ? name : 'Basiswert') + ' beim Verkauf'],
            ['lblBasisEinF', (hat ? name : 'Basiswert') + ' beim Kauf'],
            ['lblBasisAusF', (hat ? name : 'Basiswert') + ' beim Verkauf'],
        ];
        paare.forEach(function (pr) {
            const e = el(pr[0]);
            if (!e) return;
            const zusatz = e.querySelector('.feld-zusatz');
            e.textContent = pr[1] + ' ';
            if (zusatz) e.appendChild(zusatz);
        });
    }

    // ---------------------------------------------------------- Eingaben

    /**
     * Sammelt alles, was der Rechenkern braucht. Gibt auch bei einer
     * Aktie ein vollstaendiges Objekt zurueck, damit die Aufrufer keine
     * Sonderfaelle brauchen.
     */
    function eingaben() {
        const a = art();
        const einsatz = zahl(wert('positionSize'));

        if (a === 'faktor') {
            return {
                art: a, richtung: richtung(),
                faktor: zahl(wert('zFaktor')),
                kurs: zahl(wert('zBasisEinF')),
                kursAus: zahl(wert('zBasisAusF')),
                preis: zahl(wert('entryPrice')),
                preisAus: zahl(wert('exitPrice')),
                stop: zahl(wert('zStopF')),
                einsatz: einsatz,
                wkn: wert('zWkn').trim().toUpperCase() || null,
                emittent: wert('zEmittent').trim() || null,
            };
        }
        if (a === 'knockout') {
            // Basispreis und KO-Schwelle sind bei den ueblichen
            // Trade-Republic-Produkten dieselbe Zahl. Die Ergaenzung
            // passiert hier und nicht erst im Rechenkern, damit auch
            // Pruefung und Speicherung dieselbe Sicht haben - sonst
            // meldet die Pruefung ein fehlendes Feld, das die Rechnung
            // laengst gefuellt hat.
            const strikeRoh = zahl(wert('zStrike'));
            const koRoh = zahl(wert('zKo'));
            const basis = {
                art: a, richtung: richtung(),
                kurs: zahl(wert('zBasisEin')),
                kursAus: zahl(wert('zBasisAus')),
                strike: strikeRoh !== null ? strikeRoh : koRoh,
                ko: koRoh !== null ? koRoh : strikeRoh,
                preis: zahl(wert('entryPrice')),
                preisAus: zahl(wert('exitPrice')),
                stop: zahl(wert('zStop')),
                ratio: zahl(wert('zRatio')),
                fx: zahl(wert('zFx')),
                hebelAngezeigt: zahl(wert('zHebelTr')),
                einsatz: einsatz,
                wkn: wert('zWkn').trim().toUpperCase() || null,
                emittent: wert('zEmittent').trim() || null,
            };

            // Trade Republic zeigt beim Schein Hebel und Knockout-Preis,
            // aber nicht, wo der Basiswert gerade steht - und im
            // Nachhinein schon gar nicht. Aus diesen beiden Zahlen laesst
            // er sich zurueckrechnen, ohne Wechselkurs und ohne
            // Bezugsverhaeltnis. Deshalb darf das Kursfeld leer bleiben.
            //
            // Reihenfolge: was der Nutzer selbst eingetragen hat, gilt.
            // Danach der Weg ueber den Hebel, zuletzt der ueber den
            // Preis - der braucht ein Bezugsverhaeltnis, das TR bei
            // Knock-Outs nicht ausweist.
            basis.kursGerechnet = false;
            basis.kursAusGerechnet = false;
            basis.kursQuelle = 'eingetippt';
            if (window.cfZert) {
                if (basis.kurs === null) {
                    const h = window.cfZert.basiswertAusHebel(basis);
                    if (h.ok) {
                        basis.kurs = h.wert;
                        basis.kursGerechnet = true;
                        basis.kursQuelle = 'hebel';
                    } else {
                        const r = window.cfZert.basiswertAusPreis(basis);
                        if (r.ok) {
                            basis.kurs = r.wert;
                            basis.kursGerechnet = true;
                            basis.kursQuelle = 'preis';
                        }
                    }
                }
                // Der angezeigte Hebel gilt nur fuer den Moment des
                // Kaufs - fuer den Ausstieg hilft nur der Preisweg.
                if (basis.kursAus === null) {
                    const r = window.cfZert.basiswertAusPreis(basis, 'aus');
                    if (r.ok) { basis.kursAus = r.wert; basis.kursAusGerechnet = true; }
                }
            }
            return basis;
        }
        return {
            art: AKTIE, richtung: richtung(),
            kurs: zahl(wert('entryPrice')),
            kursAus: zahl(wert('exitPrice')),
            stop: zahl(wert('stopLoss')),
            einsatz: einsatz,
        };
    }

    // ----------------------------------------------------------- Anzeige

    function nz(x, n) {
        return (Math.round(x * Math.pow(10, n)) / Math.pow(10, n))
            .toLocaleString('de-DE', { minimumFractionDigits: n,
                                       maximumFractionDigits: n });
    }

    function kachel(label, wertText, zusatz, klasse) {
        return '<div class="zert-kachel ' + (klasse || '') + '">'
             + '<div class="zert-kachel-label">' + label + '</div>'
             + '<div class="zert-kachel-wert">' + wertText + '</div>'
             + (zusatz ? '<div class="zert-kachel-zusatz">' + zusatz + '</div>' : '')
             + '</div>';
    }

    /** Fehlende Eingabe: Kachel bleibt stehen und nennt den Grund. */
    function leer(label, grund) {
        return kachel(label, '—', grund || 'Angabe fehlt', 'leer');
    }

    function kontostand() {
        try {
            return typeof getAccountBalance === 'function'
                ? getAccountBalance() : null;
        } catch (e) { return null; }
    }

    function rechnenUndZeigen() {
        const ziel = el('zertErgebnis');
        const warnEl = el('zertWarnung');
        if (!ziel || !window.cfZert) return;
        if (!istZertifikat()) { ziel.innerHTML = ''; return; }

        const p = eingaben();
        const Z = window.cfZert;
        const teile = [];

        // --- Hebel
        // Wo stand der Basiswert? Bei errechnetem Kurs gehoert die Zahl
        // sichtbar hin - der Nutzer soll gegenpruefen koennen, ob sie
        // zum Chart passt, statt ihr blind zu vertrauen.
        if (p.art === 'knockout' && p.kurs !== null && p.kursGerechnet) {
            const t = el('ticker');
            const name = (t && t.value.trim().toUpperCase()) || 'Basiswert';
            teile.push(kachel(name + ' beim Kauf', nz(p.kurs, 2) + ' $',
                p.kursQuelle === 'hebel'
                    ? 'aus Hebel und Knockout-Preis gerechnet'
                    : 'aus dem Scheinpreis gerechnet'));
        }

        const h = Z.hebel(p);
        if (h.ok) {
            const eng = h.wert >= 25;
            let zusatz = 'im Moment des Einstiegs';
            if (p.art === 'faktor') zusatz = 'täglich neu angesetzt';
            else if (h.quelle === 'preis') zusatz = 'auf dein eingesetztes Geld';
            else if (p.kursQuelle === 'hebel') zusatz = 'von Trade Republic übernommen';
            else zusatz = 'ohne Aufgeld — echter Hebel liegt etwas tiefer';
            teile.push(kachel('Echter Hebel', nz(h.wert, 1) + '×', zusatz,
                eng ? 'warn' : ''));
        } else {
            teile.push(leer('Echter Hebel', h.grund));
        }

        if (p.art === 'knockout') {
            // --- Abstand zur Schwelle
            const k = Z.koAbstand(p);
            if (k.ok) {
                const pz = k.wert.prozent;
                const kl = pz < 5 ? 'rot' : (pz < 10 ? 'warn' : 'gut');
                teile.push(kachel('Abstand zur KO-Schwelle',
                    nz(pz, 1) + ' %', 'entspricht ' + nz(k.wert.absolut, 2)
                    + ' im Basiswert', kl));
            } else {
                teile.push(leer('Abstand zur KO-Schwelle', k.grund));
            }

            // --- Aufgeld
            //
            // Nur sinnvoll, wenn der Kurs des Basiswerts wirklich bekannt
            // ist. Wurde er aus dem Preis zurueckgerechnet, steckt das
            // Aufgeld im gerechneten Kurs und kaeme zwangslaeufig als
            // 0,0 % heraus - eine Zahl, die nichts sagt, aber echt
            // aussieht.
            const a = p.kursGerechnet
                ? { ok: false, grund: 'Dafür bräuchte es Bezugsverhältnis '
                    + 'und den echten Kurs des Basiswerts.' }
                : Z.aufgeld(p);
            // Ohne Bezugsverhaeltnis nicht rechenbar, und Trade Republic
            // weist bei Knock-Outs keines aus. Eine Kachel, die praktisch
            // immer leer bleibt, ist kein Hinweis mehr, sondern Moebel -
            // deshalb faellt sie ganz weg statt einen Strich zu zeigen.
            if (a.ok) {
                teile.push(kachel('Aufgeld', nz(a.wert.prozent, 1) + ' %',
                    'Finanzierung über dem inneren Wert',
                    a.wert.prozent > 5 ? 'warn' : ''));
            }
        }

        if (p.art === 'faktor') {
            const pf = Z.pfadeffekt(p);
            if (pf.ok) {
                const e = pf.wert.effektProzent;
                teile.push(kachel('Pfadeffekt',
                    (e >= 0 ? '+' : '') + nz(e, 1) + ' %',
                    'Basiswert ' + (pf.wert.basisProzent >= 0 ? '+' : '')
                    + nz(pf.wert.basisProzent, 1) + ' % → erwartet '
                    + (pf.wert.erwartetProzent >= 0 ? '+' : '')
                    + nz(pf.wert.erwartetProzent, 1) + ' %, bekommen '
                    + (pf.wert.tatsaechlichProzent >= 0 ? '+' : '')
                    + nz(pf.wert.tatsaechlichProzent, 1) + ' %',
                    e < -2 ? 'rot' : (e > 2 ? 'gut' : '')));
            } else {
                teile.push(leer('Pfadeffekt', pf.grund));
            }
        }

        // --- Risiko aus dem Stop
        const r = (p.stop !== null && p.stop !== undefined)
            ? Z.risiko(p, p.stop) : { ok: false, grund: 'Kein Stop angegeben' };
        if (r.ok) {
            const kb = kontostand();
            const anteil = (kb && kb > 0) ? (r.wert.euro / kb) * 100 : null;
            let zusatz = nz(r.wert.prozent, 1) + ' % vom Einsatz';
            if (anteil !== null) zusatz += ' · ' + nz(anteil, 1) + ' % vom Konto';
            if (r.wert.naeherung) zusatz += ' · Näherung, siehe Hinweis';
            teile.push(kachel('Risiko bei deinem Stop',
                nz(r.wert.euro, 2) + ' €', zusatz,
                r.wert.totalverlust ? 'rot'
                    : (anteil !== null && anteil > 2 ? 'warn' : 'gut')));
        } else {
            teile.push(leer('Risiko bei deinem Stop', r.grund));
        }

        ziel.innerHTML = teile.join('');

        // --- Warnungen: vertauschte Zahlen, Stop jenseits der Schwelle
        const hinweise = Z.pruefen(p).slice();
        // Ohne Wechselkurs rechnet die Ableitung mit 1. Bei einem
        // US-Wert liegt der Kurs dann rund zehn Prozent daneben - und
        // zwar ohne dass irgendetwas unplausibel aussieht.
        if (p.art === 'knockout' && p.kursGerechnet
                && p.kursQuelle === 'preis' && !p.fx) {
            hinweise.push('Kein Wechselkurs angegeben — gerechnet wird mit 1. '
                + 'Bei US-Werten trag EUR/USD ein, sonst stimmt der Kurs nicht.');
        }
        if (r.ok && r.wert.hinweis) hinweise.push(r.wert.hinweis);
        if (r.ok && r.wert.naeherung) {
            hinweise.push('Beim Faktor-Zertifikat ist das Risiko eine '
                + 'Näherung: der Faktor wird jeden Abend neu angesetzt, '
                + 'über mehrere Tage weicht das ab.');
        }
        if (warnEl) {
            if (hinweise.length) {
                warnEl.innerHTML = '<strong>Prüf das nochmal:</strong><ul><li>'
                    + hinweise.join('</li><li>') + '</li></ul>';
                warnEl.style.display = '';
            } else {
                warnEl.style.display = 'none';
                warnEl.innerHTML = '';
            }
        }
    }

    // ------------------------------------------------- Fuer das Speichern

    /**
     * Was beim Speichern eines Trades zusaetzlich mitgeschrieben wird.
     * Gibt null zurueck, wenn es eine normale Aktie war.
     */
    window.cfProduktDaten = function () {
        if (!istZertifikat() || !window.cfZert) return null;
        const p = eingaben();
        const Z = window.cfZert;
        const h = Z.hebel(p);
        const k = Z.koAbstand(p);
        return {
            art: p.art,
            richtung: p.richtung,
            wkn: p.wkn || null,
            emittent: p.emittent || null,
            strike: p.strike !== undefined ? p.strike : null,
            ko: p.ko !== undefined ? p.ko : null,
            ratio: p.ratio !== undefined ? p.ratio : null,
            faktor: p.faktor !== undefined ? p.faktor : null,
            basisEin: p.kurs,
            basisAus: p.kursAus,
            basisStop: p.stop,
            hebelEffektiv: h.ok ? Math.round(h.wert * 100) / 100 : null,
            koAbstandProzent: k.ok ? Math.round(k.wert.prozent * 100) / 100 : null,
        };
    };

    /** Der Rechenkern-Blick auf das Formular, fuer andere Module. */
    window.cfProduktEingaben = eingaben;
    window.cfProduktArt = art;

    /**
     * Was vor dem Speichern stimmen muss. Leere Pflichtfelder werden
     * hier abgefangen, damit kein halber Zertifikatstrade im Journal
     * landet, der sich spaeter nicht auswerten laesst.
     */
    window.cfProduktPruefen = function () {
        if (!istZertifikat() || !window.cfZert) return [];
        const p = eingaben();
        const m = [];
        if (p.art === 'knockout') {
            if (p.kurs === null) {
                m.push('Trag den Hebel ein, den TR beim Kauf angezeigt hat — '
                     + 'oder direkt, wo der Basiswert stand.');
            }
            // strike und ko fuellen sich in eingaben() gegenseitig auf -
            // eine der beiden Zahlen genuegt.
            if (p.strike === null && p.ko === null) {
                m.push('Es fehlt die KO-Schwelle.');
            }
        }
        if (p.art === 'faktor' && p.faktor === null) m.push('Faktor fehlt.');
        return m.concat(window.cfZert.pruefen(p));
    };

    // ------------------------------------------------------------ Aufbau

    function toggleKlick(e) {
        const btn = e.target.closest('.produkt-btn');
        if (!btn) return;
        e.preventDefault();
        const gruppe = btn.parentElement;
        gruppe.querySelectorAll('.produkt-btn').forEach(function (b) {
            b.classList.toggle('active', b === btn);
        });
        const ziel = el(gruppe.getAttribute('data-target'));
        if (ziel) ziel.value = btn.getAttribute('data-art');
        beschriften();
        rechnenUndZeigen();
    }

    function start() {
        const gruppe = document.querySelector('.produkt-toggle');
        if (!gruppe) return;
        gruppe.addEventListener('click', toggleKlick);

        // Jede Eingabe im Formular kann das Ergebnis aendern - auch die
        // Richtung und der Einsatz, die ausserhalb des Blocks stehen.
        const form = el('tradeForm');
        if (form) {
            form.addEventListener('input', function (e) {
                if (e.target && e.target.id === 'ticker') tickerEinsetzen();
                rechnenUndZeigen();
            });
            form.addEventListener('click', function (e) {
                if (e.target.closest('.direction-btn')) {
                    // Der Klick setzt den Wert erst danach
                    setTimeout(rechnenUndZeigen, 0);
                }
            });
            form.addEventListener('reset', function () {
                setTimeout(function () {
                    gruppe.querySelectorAll('.produkt-btn').forEach(function (b, i) {
                        b.classList.toggle('active', i === 0);
                    });
                    const ziel = el('produktArt');
                    if (ziel) ziel.value = AKTIE;
                    beschriften();
                    rechnenUndZeigen();
                }, 0);
            });
        }
        beschriften();
        rechnenUndZeigen();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
