/* CapitalFlow - Rechenkern fuer Hebelprodukte
 *
 * Grundsatz dieser Datei: fehlende Eingaben fuehren zu fehlenden
 * Ausgaben, nie zu falschen. Jede Funktion gibt entweder
 * { ok: true, wert: <Zahl> } zurueck oder { ok: false, grund: '<Text>' }.
 * Die Oberflaeche zeigt dann einen Strich statt einer erfundenen Zahl.
 *
 * Warum das noetig ist: bisher tippt der Nutzer einen Hebel ins
 * Formular. Bei einem Knock-Out ist der Hebel aber keine Eigenschaft
 * des Produkts, sondern eine Momentaufnahme - er steigt, je naeher der
 * Kurs an die Schwelle kommt. Ein Zertifikat mit "Hebel 10" beim Kauf
 * hat bei halbiertem Abstand Hebel 20. Wer die 10 ins Journal
 * schreibt, wertet spaeter Unsinn aus.
 *
 * Waehrungen: Basispreis, KO-Schwelle und Kurs des Basiswerts muessen
 * in derselben Waehrung stehen (bei US-Werten also alle in Dollar).
 * Der Wechselkurs kuerzt sich in Hebel und Risiko vollstaendig heraus -
 * deshalb braucht diese Datei ihn nirgends. Ein Feld weniger, eine
 * Fehlerquelle weniger.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------ Hilfen

    /** Akzeptiert auch "1,35" - auf deutschen Tastaturen der Normalfall. */
    function zahl(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (v === null || v === undefined) return null;
        const s = String(v).trim().replace(',', '.');
        if (s === '') return null;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
    }

    function ok(wert) { return { ok: true, wert: wert }; }
    function nein(grund) { return { ok: false, wert: null, grund: grund }; }

    const ARTEN = ['aktie', 'knockout', 'faktor', 'optionsschein'];

    /**
     * Bringt eine Formulareingabe in eine einheitliche Form.
     *
     * kurs        Kurs des Basiswerts beim Einstieg
     * kursAus     Kurs des Basiswerts beim Ausstieg
     * strike      Basispreis des Zertifikats
     * ko          Knock-out-Schwelle (bei klassischen KOs gleich strike)
     * preis       Preis des Zertifikats in Euro beim Einstieg
     * preisAus    Preis des Zertifikats in Euro beim Ausstieg
     * faktor      nur bei Faktor-Zertifikaten
     */
    function lesen(p) {
        p = p || {};
        const art = ARTEN.indexOf(p.art) !== -1 ? p.art : 'aktie';
        // Bei den klassischen Knock-Outs von Trade Republic sind
        // Basispreis und KO-Schwelle dieselbe Zahl. Deshalb reicht eine
        // von beiden - die andere wird daraus gefuellt. Wer ein Produkt
        // mit Stop-Loss-Puffer hat, traegt beide ein.
        const strike = zahl(p.strike);
        const ko = zahl(p.ko);
        return {
            art: art,
            richtung: p.richtung === 'short' ? 'short' : 'long',
            kurs: zahl(p.kurs),
            kursAus: zahl(p.kursAus),
            strike: strike !== null ? strike : ko,
            ko: ko !== null ? ko : strike,
            preis: zahl(p.preis),
            preisAus: zahl(p.preisAus),
            faktor: zahl(p.faktor),
            einsatz: zahl(p.einsatz),
        };
    }

    // ------------------------------------------------------ Plausibilitaet

    /**
     * Prueft, ob die Zahlen zueinander passen.
     *
     * Das ist kein Formalismus: ein Long-Knockout mit Basispreis ueber
     * dem Kurs ist bereits ausgeknockt. Wer das eintippt, hat eine
     * Ziffer vertauscht - und wuerde ohne diese Pruefung einen
     * negativen Hebel angezeigt bekommen.
     */
    function pruefen(roh) {
        const p = lesen(roh);
        const m = [];
        if (p.art === 'aktie') return m;

        if (p.art === 'faktor') {
            if (p.faktor === null) m.push('Faktor fehlt.');
            else if (p.faktor <= 0) m.push('Der Faktor muss groesser als 0 sein.');
            return m;
        }

        if (p.kurs === null) m.push('Kurs des Basiswerts fehlt.');
        if (p.strike === null) m.push('Basispreis fehlt.');
        if (p.kurs === null || p.strike === null) return m;

        if (p.richtung === 'long') {
            if (p.strike >= p.kurs) {
                m.push('Basispreis liegt ueber dem Kurs - bei einem Long waere '
                     + 'das Zertifikat wertlos. Zahlen vertauscht?');
            }
            if (p.ko !== null && p.ko >= p.kurs) {
                m.push('Die KO-Schwelle liegt schon ueber dem Einstiegskurs.');
            }
            if (p.ko !== null && p.ko < p.strike) {
                m.push('Die KO-Schwelle liegt unter dem Basispreis. Bei einem '
                     + 'Long ist sie gleich hoch oder hoeher.');
            }
        } else {
            if (p.strike <= p.kurs) {
                m.push('Basispreis liegt unter dem Kurs - bei einem Short waere '
                     + 'das Zertifikat wertlos. Zahlen vertauscht?');
            }
            if (p.ko !== null && p.ko <= p.kurs) {
                m.push('Die KO-Schwelle liegt schon unter dem Einstiegskurs.');
            }
            if (p.ko !== null && p.ko > p.strike) {
                m.push('Die KO-Schwelle liegt ueber dem Basispreis. Bei einem '
                     + 'Short ist sie gleich hoch oder niedriger.');
            }
        }
        return m;
    }

    // ------------------------------------------------------------- Hebel

    /**
     * Innerer Wert je Basiswert-Einheit, vor Bezugsverhaeltnis.
     * Long:  Kurs - Basispreis      Short: Basispreis - Kurs
     */
    function innererWert(p, kurs) {
        const k = kurs === undefined ? p.kurs : kurs;
        if (k === null || p.strike === null) return null;
        return p.richtung === 'long' ? k - p.strike : p.strike - k;
    }

    /**
     * Tatsaechlicher Hebel beim Einstieg.
     *
     *     Hebel = Kurs Basiswert / innerer Wert
     *
     * Beispiel: NVDA bei 180, Basispreis 165. Innerer Wert 15, Hebel 12.
     * Faellt NVDA um 1 Prozent (1,80 Dollar), verliert das Zertifikat
     * 1,80 von 15 - also 12 Prozent. Das ist der Hebel, und er gilt nur
     * fuer diesen Moment.
     *
     * Bezugsverhaeltnis und Wechselkurs stehen in Zaehler und Nenner
     * und kuerzen sich weg. Deshalb kommt diese Rechnung mit zwei
     * Zahlen aus, die in der Trade-Republic-App direkt ablesbar sind.
     */
    function hebel(roh) {
        const p = lesen(roh);
        if (p.art === 'aktie') return ok(1);
        if (p.art === 'faktor') {
            return p.faktor ? ok(p.faktor) : nein('Faktor fehlt.');
        }
        const fehler = pruefen(roh);
        if (fehler.length) return nein(fehler[0]);

        const iw = innererWert(p);
        if (iw === null) return nein('Kurs oder Basispreis fehlt.');
        if (iw <= 0) return nein('Das Zertifikat hat keinen inneren Wert mehr.');

        // Wenn Bezugsverhaeltnis und bezahlter Preis vorliegen, ist der
        // Hebel auf das eingesetzte GELD rechenbar:
        //
        //     Hebel = (Kurs x Bezugsverhaeltnis) / (Preis x Wechselkurs)
        //
        // Der Unterschied ist das Aufgeld. Wer 1,50 fuer einen Schein
        // zahlt, dessen innerer Wert 1,36 betraegt, hat nicht Hebel 12
        // sondern 11 - die Differenz ist Finanzierung, die mitlaeuft und
        // nicht mithebelt. Diese Zahl ist die ehrlichere, deshalb hat
        // sie Vorrang.
        const ratio = zahl(roh && roh.ratio);
        const fx = zahl(roh && roh.fx) || 1;
        if (ratio !== null && ratio > 0 && p.preis !== null && p.preis > 0) {
            const aufGeld = (p.kurs * ratio) / (p.preis * fx);
            if (aufGeld > 0) {
                return { ok: true, wert: aufGeld, quelle: 'preis' };
            }
        }
        return { ok: true, wert: p.kurs / iw, quelle: 'basispreis' };
    }

    /**
     * Aufgeld: was ueber dem inneren Wert bezahlt wird.
     *
     * Das ist die Finanzierung, die der Emittent einpreist - bei einem
     * Long steigt der Basispreis taeglich. Ueber Wochen frisst das
     * Rendite, und genau das sieht in keinem Broker-Depot jemand.
     *
     * Braucht als einzige Rechnung hier das Bezugsverhaeltnis und den
     * Wechselkurs, weil Zertifikatspreis (Euro) und innerer Wert
     * (Waehrung des Basiswerts) sonst nicht vergleichbar sind.
     */
    function aufgeld(roh) {
        const p = lesen(roh);
        const ratio = zahl(roh && roh.ratio);
        const fx = zahl(roh && roh.fx) || 1;
        if (p.art !== 'knockout' && p.art !== 'optionsschein') {
            return nein('Aufgeld gibt es nur bei Knock-Outs und Optionsscheinen.');
        }
        if (p.preis === null) return nein('Preis des Zertifikats fehlt.');
        if (ratio === null || ratio <= 0) return nein('Bezugsverhaeltnis fehlt.');
        const iw = innererWert(p);
        if (iw === null || iw <= 0) return nein('Kein innerer Wert.');

        const bezahlt = (p.preis * fx) / ratio;   // je Basiswert-Einheit
        const auf = bezahlt - iw;
        return ok({ absolut: auf, prozent: (auf / iw) * 100 });
    }

    /**
     * Kurs des Basiswerts aus dem angezeigten Hebel zurueckrechnen.
     *
     * Der bequemste Weg, weil Trade Republic beim Schein genau zwei
     * Zahlen zeigt, die hier gebraucht werden: Hebel und Knockout-Preis.
     * Ein Bezugsverhaeltnis weist TR bei Knock-Outs nicht aus.
     *
     *     Long:   Hebel = Kurs / (Kurs - Basispreis)
     *             -> Kurs = Hebel x Basispreis / (Hebel - 1)
     *     Short:  Hebel = Kurs / (Basispreis - Kurs)
     *             -> Kurs = Hebel x Basispreis / (Hebel + 1)
     *
     * Wechselkurs und Bezugsverhaeltnis kuerzen sich heraus - es braucht
     * also weder das eine noch das andere.
     *
     * Grenze: der Hebel, den TR anzeigt, gilt fuer den Moment des
     * Hinsehens. Wer einen Trade von vorletzter Woche nachtraegt, kann
     * ihn nicht mehr nachschlagen. Fuers Mitschreiben beim Einstieg ist
     * er dagegen die eine Zahl, die man ohnehin vor Augen hat.
     */
    function basiswertAusHebel(roh) {
        const p = lesen(roh);
        const L = zahl(roh && roh.hebelAngezeigt);
        if (L === null) return nein('Kein Hebel angegeben.');
        if (p.strike === null) return nein('KO-Schwelle fehlt.');
        if (p.richtung === 'long' && L <= 1) {
            return nein('Ein Long-Knock-Out hat immer Hebel groesser als 1.');
        }
        if (L <= 0) return nein('Der Hebel muss groesser als 0 sein.');

        const kurs = p.richtung === 'long'
            ? (L * p.strike) / (L - 1)
            : (L * p.strike) / (L + 1);
        if (!(kurs > 0)) return nein('Ergibt keinen sinnvollen Kurs.');
        return ok(kurs);
    }

    /**
     * Kurs des Basiswerts aus dem Zertifikatspreis zurueckrechnen.
     *
     * Der eigentliche Punkt dieser Datei. Trade Republic zeigt in der
     * Abrechnung nur, was der Schein gekostet hat - wo NVDA in diesem
     * Moment stand, steht nirgends und laesst sich hinterher nicht mehr
     * nachschlagen. Basispreis und Bezugsverhaeltnis aendern sich dagegen
     * nie und stehen jederzeit in den Produktdetails.
     *
     *     Long:   Kurs = Basispreis + (Preis x Wechselkurs) / Bezugsverh.
     *     Short:  Kurs = Basispreis - (Preis x Wechselkurs) / Bezugsverh.
     *
     * Ungenauigkeit: im Preis steckt das Aufgeld, der errechnete Kurs
     * faellt deshalb minimal zu hoch aus. Bei ueblichen Laufzeiten sind
     * das Bruchteile eines Prozents - deutlich weniger als der Fehler,
     * den ein geschaetzter Kurs machen wuerde.
     */
    function basiswertAusPreis(roh, welcher) {
        const p = lesen(roh);
        const ratio = zahl(roh && roh.ratio);
        const fx = zahl(roh && roh.fx) || 1;
        const preis = welcher === 'aus' ? p.preisAus : p.preis;

        if (p.strike === null) return nein('Basispreis oder KO-Schwelle fehlt.');
        if (ratio === null || ratio <= 0) return nein('Bezugsverhaeltnis fehlt.');
        if (preis === null || preis <= 0) return nein('Preis des Zertifikats fehlt.');

        const je = (preis * fx) / ratio;
        const kurs = p.richtung === 'long' ? p.strike + je : p.strike - je;
        if (!(kurs > 0)) return nein('Ergibt keinen sinnvollen Kurs.');
        return ok(kurs);
    }

    /**
     * Bezugsverhaeltnis aus dem bezahlten Preis zurueckrechnen.
     *
     * Trade Republic zeigt es nicht immer prominent. Wer Kurs,
     * Basispreis und den bezahlten Preis hat, kommt ohne aus - mit dem
     * Vorbehalt, dass das Aufgeld darin steckt und das Ergebnis
     * deshalb leicht zu klein ausfaellt.
     */
    function ratioSchaetzen(roh) {
        const p = lesen(roh);
        const fx = zahl(roh && roh.fx) || 1;
        if (p.preis === null) return nein('Preis des Zertifikats fehlt.');
        const iw = innererWert(p);
        if (iw === null || iw <= 0) return nein('Kein innerer Wert.');
        return ok((p.preis * fx) / iw);
    }

    // ------------------------------------------------------- KO-Abstand

    /**
     * Wie weit der Basiswert laufen darf, bis alles weg ist.
     *
     * Das ist die Zahl, die im Journal fehlt. Ein Trade mit 4 Prozent
     * Abstand zur Schwelle ist etwas voellig anderes als einer mit 20 -
     * auch wenn beide am Ende dasselbe Plus zeigen. Ohne diese Spalte
     * laesst sich nicht erkennen, ob jemand gut war oder nur Glueck
     * hatte.
     */
    function koAbstand(roh) {
        const p = lesen(roh);
        if (p.art !== 'knockout') return nein('Nur Knock-Outs haben eine Schwelle.');
        if (p.kurs === null) return nein('Kurs des Basiswerts fehlt.');
        if (p.ko === null) return nein('KO-Schwelle fehlt.');
        if (p.kurs <= 0) return nein('Kurs muss groesser als 0 sein.');

        const abstand = p.richtung === 'long' ? p.kurs - p.ko : p.ko - p.kurs;
        if (abstand <= 0) return nein('Die Schwelle ist bereits erreicht.');
        return ok({ absolut: abstand, prozent: (abstand / p.kurs) * 100 });
    }

    // ---------------------------------------------------------- Risiko

    /**
     * Euro-Risiko aus einem Stop auf dem Basiswert.
     *
     * Der Stop gehoert auf den Chart des Basiswerts, nicht auf den
     * Zertifikatspreis - dort wuerde man ihn nie ablesen koennen. Diese
     * Funktion rechnet ihn um.
     *
     * Entscheidend ist der Sonderfall: liegt der Stop jenseits der
     * Schwelle, ist das Risiko nicht "der gerechnete Betrag", sondern
     * der komplette Einsatz. Genau hier rechnet die alte Formel
     * (Hebel mal Kursabstand) falsch - sie kann ueber 100 Prozent
     * Verlust ausweisen, und sie verschweigt, dass der Stop nie
     * ausgeloest haette, weil das Produkt vorher tot war.
     */
    function risiko(roh, stopKurs) {
        const p = lesen(roh);
        const stop = zahl(stopKurs);
        if (stop === null) return nein('Stop fehlt.');
        if (p.einsatz === null || p.einsatz <= 0) return nein('Einsatz fehlt.');

        if (p.art === 'aktie') {
            if (p.kurs === null || p.kurs <= 0) return nein('Einstiegskurs fehlt.');
            const bewegung = p.richtung === 'long'
                ? (p.kurs - stop) / p.kurs : (stop - p.kurs) / p.kurs;
            if (bewegung <= 0) return nein('Der Stop liegt auf der falschen Seite.');
            return ok({
                euro: p.einsatz * bewegung,
                prozent: bewegung * 100,
                totalverlust: false,
            });
        }

        if (p.art === 'faktor') {
            if (p.kurs === null || p.kurs <= 0) return nein('Einstiegskurs fehlt.');
            if (!p.faktor) return nein('Faktor fehlt.');
            const bewegung = p.richtung === 'long'
                ? (p.kurs - stop) / p.kurs : (stop - p.kurs) / p.kurs;
            if (bewegung <= 0) return nein('Der Stop liegt auf der falschen Seite.');
            // Der Faktor wirkt taeglich neu. Ueber einen Tag stimmt die
            // einfache Multiplikation, ueber mehrere nicht - deshalb ist
            // das eine Naeherung und wird auch so beschriftet.
            const verlust = Math.min(bewegung * p.faktor, 1);
            return ok({
                euro: p.einsatz * verlust,
                prozent: verlust * 100,
                totalverlust: verlust >= 1,
                naeherung: true,
            });
        }

        // Knock-Out und Optionsschein
        const fehler = pruefen(roh);
        if (fehler.length) return nein(fehler[0]);

        const iwEin = innererWert(p);
        if (iwEin === null || iwEin <= 0) return nein('Kein innerer Wert beim Einstieg.');

        const ausgeknockt = p.art === 'knockout' && p.ko !== null
            && (p.richtung === 'long' ? stop <= p.ko : stop >= p.ko);
        if (ausgeknockt) {
            return ok({
                euro: p.einsatz, prozent: 100, totalverlust: true,
                hinweis: 'Der Stop liegt jenseits der KO-Schwelle. Das Produkt '
                       + 'verfaellt vorher - der Stop loest nie aus.',
            });
        }

        const iwStop = innererWert(p, stop);
        if (iwStop === null || iwStop <= 0) {
            return ok({ euro: p.einsatz, prozent: 100, totalverlust: true });
        }
        const anteil = 1 - (iwStop / iwEin);
        if (anteil <= 0) return nein('Der Stop liegt auf der falschen Seite.');
        return ok({
            euro: p.einsatz * anteil,
            prozent: anteil * 100,
            totalverlust: false,
        });
    }

    // ------------------------------------------------------ Pfadeffekt

    /**
     * Was ein Faktor-Zertifikat anders gemacht hat als "Faktor mal Kurs".
     *
     * Ein Faktor 5 wird jeden Abend neu aufgesetzt. Bewegt sich der
     * Basiswert 10 Prozent runter und am naechsten Tag 11,1 Prozent
     * hoch, steht er wieder am Ausgangspunkt - das Zertifikat aber bei
     * minus 22 Prozent. Dieser Verlust taucht in keiner Abrechnung als
     * Posten auf, er ist einfach weg.
     *
     * Umgekehrt gilt dasselbe: in einem sauberen Trend arbeitet der
     * Zinseszins fuer dich, und das Zertifikat schlaegt das einfache
     * Vielfache. Die Zahl ist also kein Verlust, sondern ein Effekt -
     * und sie enthaelt auch Gebuehren und Finanzierung, die sich davon
     * nicht trennen lassen.
     */
    function pfadeffekt(roh) {
        const p = lesen(roh);
        if (p.art !== 'faktor') return nein('Nur bei Faktor-Zertifikaten.');
        if (!p.faktor) return nein('Faktor fehlt.');
        if (p.kurs === null || p.kursAus === null)
            return nein('Kurs des Basiswerts beim Ein- und Ausstieg noetig.');
        if (p.preis === null || p.preisAus === null)
            return nein('Preis des Zertifikats beim Ein- und Ausstieg noetig.');
        if (p.kurs <= 0 || p.preis <= 0) return nein('Kurse muessen groesser als 0 sein.');

        const basis = ((p.kursAus - p.kurs) / p.kurs)
                    * (p.richtung === 'short' ? -1 : 1);
        const tatsaechlich = (p.preisAus - p.preis) / p.preis;
        const erwartet = basis * p.faktor;

        return ok({
            basisProzent: basis * 100,
            erwartetProzent: erwartet * 100,
            tatsaechlichProzent: tatsaechlich * 100,
            effektProzent: (tatsaechlich - erwartet) * 100,
        });
    }

    // --------------------------------------------------- Gesamtbericht

    /**
     * Alles, was sich aus den vorhandenen Zahlen sagen laesst.
     * Nicht Berechenbares steht als Grund drin, nicht als Zahl.
     */
    function bericht(roh, stopKurs) {
        return {
            fehler: pruefen(roh),
            hebel: hebel(roh),
            koAbstand: koAbstand(roh),
            aufgeld: aufgeld(roh),
            risiko: stopKurs !== undefined && stopKurs !== null && stopKurs !== ''
                ? risiko(roh, stopKurs) : nein('Kein Stop angegeben.'),
            pfadeffekt: pfadeffekt(roh),
        };
    }

    const api = {
        zahl: zahl,
        pruefen: pruefen,
        hebel: hebel,
        aufgeld: aufgeld,
        ratioSchaetzen: ratioSchaetzen,
        basiswertAusHebel: basiswertAusHebel,
        basiswertAusPreis: basiswertAusPreis,
        koAbstand: koAbstand,
        risiko: risiko,
        pfadeffekt: pfadeffekt,
        bericht: bericht,
    };

    if (typeof window !== 'undefined') window.cfZert = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
