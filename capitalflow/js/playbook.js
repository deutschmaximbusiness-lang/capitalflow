/* CapitalFlow - Playbook (M3)
 *
 * Eine Strategie ist hier: ein Name, Regeln in Gruppen (Kontext, Zone,
 * Signal, Ausstieg, Bonus) und Grenzen (Hebel, Risiko, Notbremse, Ziel,
 * Mindest-CRV, Abstand zu den Earnings).
 *
 * Im Journal waehlt man beim Eintragen die Strategie, hakt die Regeln ab
 * und sieht sofort, ob Hebel, Risiko und Positionsgroesse innerhalb der
 * eigenen Grenzen lagen. Gespeichert wird, welche Regeln eingehalten
 * wurden - daraus entsteht spaeter die Auswertung "was kostet mich
 * welcher Regelbruch".
 *
 * Ablage wie alles andere: lokal unter 'strategies' und 'playbook'
 * (Kapital), in der Datenbank in strategies und profiles.settings.
 */
(function () {
    'use strict';

    // ------------------------------------------------------- Grundlagen

    const STANDARD = {
        hebelMax: 3, risikoMax: 2, notbremse: 20,
        zielVon: 20, zielBis: 25, crvMin: 1.5, earningsTage: 7,
    };

    const GRUPPEN = [
        { key: 'kontext', titel: 'Kontext' },
        { key: 'zone', titel: 'Zone' },
        { key: 'signal', titel: 'Signal' },
        { key: 'ausstieg', titel: 'Ausstieg' },
        { key: 'bonus', titel: 'Bonus' },
    ];
    const GRUPPEN_KEYS = GRUPPEN.map(function (g) { return g.key; });

    /**
     * Vorlagen. Bewusst als Vorschlag zum Anpassen, nicht als feste
     * Strategie: wer sie uebernimmt, bekommt eine normale Strategie, die
     * er umschreiben kann.
     */
    const VORLAGEN = [
        {
            name: '200er + Fib 0,618 in Welle 2',
            beschreibung: 'Rücksetzer in Welle 2 auf den 200er SMA (Tag oder Woche), '
                + 'der mit dem 0,618-Retracement zusammenfällt. Eingestiegen wird erst, '
                + 'wenn im Tageschart Käufer sichtbar werden.',
            regeln: {
                kontext: ['Aktie befindet sich in Welle 2'],
                zone: ['Kurs am 200er SMA (Tag oder Woche)',
                       '0,618-Retracement liegt im selben Bereich'],
                signal: ['Umkehrkerze im Tageschart', 'Tagesschluss über der Zone',
                         'Volumen steigt'],
                ausstieg: ['Stop unter der Supportzone',
                           'Notbremse bei −20 % auf die Position eingehalten',
                           'Vor der Earnings-Woche geschlossen'],
                bonus: [],
            },
        },
        {
            name: 'Gleitende Durchschnitte als Support-Cluster',
            beschreibung: 'Der 50er SMA im Tageschart trifft auf den 50er oder 200er SMA '
                + 'im Wochenchart. Gekauft wird, wenn sich im Tageschart ein Docht bildet '
                + 'und Käufer eintreten.',
            regeln: {
                kontext: ['50er SMA (Tag) und 50er oder 200er SMA (Woche) liegen zusammen'],
                zone: ['Kurs im Bereich des Clusters'],
                signal: ['Docht im Tageschart – Käufer treten ein',
                         'Tagesschluss über der Zone'],
                ausstieg: ['Ausstieg bei Tagesschluss unter 0,786',
                           'Notbremse bei −20 % auf die Position eingehalten',
                           'Vor der Earnings-Woche geschlossen'],
                bonus: ['Anchored VWAP im selben Bereich', 'Volumen steigt'],
            },
        },
    ];

    function el(id) { return document.getElementById(id); }

    function esc(t) {
        return String(t === null || t === undefined ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function meldung(text, typ) {
        if (typeof showToast === 'function') showToast(text, typ);
    }

    function lesen(key, ersatz) {
        try {
            const roh = localStorage.getItem(key);
            return roh ? JSON.parse(roh) : ersatz;
        } catch (e) { return ersatz; }
    }

    function zahlOderNull(v) {
        if (v === '' || v === null || v === undefined) return null;
        const n = parseFloat(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }

    function neueUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        const b = new Uint8Array(16);
        window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-'
            + h.slice(16, 20) + '-' + h.slice(20);
    }

    function neueRegelId(belegt) {
        let id;
        do { id = 'r' + Math.random().toString(36).slice(2, 8); } while (belegt.has(id));
        belegt.add(id);
        return id;
    }

    // ------------------------------------------------------- Daten

    /** Bringt eine Strategie in die Form, mit der hier gerechnet wird. */
    function normalisieren(s) {
        if (!s || typeof s !== 'object' || !s.id) return null;
        const belegt = new Set();
        const regeln = (Array.isArray(s.regeln) ? s.regeln : []).map(function (r, i) {
            // Aeltere Zeilen hatten nur Texte (so beschreibt es 01_schema.sql)
            if (typeof r === 'string') r = { id: 'r' + i, gruppe: 'signal', text: r };
            if (!r || typeof r !== 'object') return null;
            const text = String(r.text || '').trim();
            if (!text) return null;
            let id = String(r.id || '');
            if (!id || belegt.has(id)) id = neueRegelId(belegt); else belegt.add(id);
            return {
                id: id,
                gruppe: GRUPPEN_KEYS.indexOf(r.gruppe) >= 0 ? r.gruppe : 'signal',
                text: text,
            };
        }).filter(Boolean);
        const g = s.grenzen && typeof s.grenzen === 'object' ? s.grenzen : {};
        const grenzen = {};
        Object.keys(STANDARD).forEach(function (k) { grenzen[k] = zahlOderNull(g[k]); });
        return {
            id: String(s.id),
            name: String(s.name || '').trim() || 'Ohne Namen',
            beschreibung: String(s.beschreibung || ''),
            regeln: regeln,
            grenzen: grenzen,
            archiviert: Boolean(s.archiviert),
            erstellt: s.erstellt || null,
        };
    }

    function strategien() {
        const l = lesen('strategies', []);
        return (Array.isArray(l) ? l : []).map(normalisieren).filter(Boolean);
    }

    function strategie(id) {
        if (!id) return null;
        return strategien().find(function (s) { return s.id === String(id); }) || null;
    }

    function alleSpeichern(liste) {
        localStorage.setItem('strategies', JSON.stringify(liste));
    }

    function einstellungen() {
        const e = lesen('playbook', {});
        return e && typeof e === 'object' && !Array.isArray(e) ? e : {};
    }

    function kapitalAuto() {
        try {
            if (typeof getTransactions === 'function' && getTransactions().length === 0) return null;
            const b = typeof getAccountBalance === 'function' ? getAccountBalance() : 0;
            return b > 0 ? b : null;
        } catch (e) { return null; }
    }

    /** Kapital fuer die Risikorechnung: selbst eingetragen oder gerechnet. */
    function kapital() {
        const eigen = zahlOderNull(einstellungen().kapital);
        if (eigen > 0) return { wert: eigen, quelle: 'eigen' };
        const auto = kapitalAuto();
        return auto ? { wert: auto, quelle: 'auto' } : null;
    }

    // ------------------------------------------------------- Regeln

    /**
     * Wie viele Pflichtregeln ein Trade eingehalten hat.
     *
     * Gezaehlt wird, was beim Speichern abgehakt oder offen war - nicht,
     * was heute in der Strategie steht. Wer spaeter eine Regel ergaenzt,
     * macht damit nicht alle alten Trades nachtraeglich schlechter.
     * Bonusregeln zaehlen nicht mit: sie sind keine Pflicht.
     */
    function regelStand(trade, s) {
        const m = trade && trade.regelnErfuellt;
        if (!m || typeof m !== 'object') return null;
        const gruppe = {};
        (s ? s.regeln : []).forEach(function (r) { gruppe[r.id] = r.gruppe; });
        let von = 0, erfuellt = 0;
        Object.keys(m).forEach(function (id) {
            if (gruppe[id] === 'bonus') return;
            von++;
            if (m[id] === true) erfuellt++;
        });
        return von ? { erfuellt: erfuellt, von: von } : null;
    }

    function tradeR(t) {
        const r = parseFloat(t.rMultiple);
        if (Number.isFinite(r)) return r;
        const risk = parseFloat(t.risk);
        return risk > 0 ? (parseFloat(t.pnl) || 0) / risk : null;
    }

    function statistik(s) {
        const trades = (lesen('trades', []) || []).filter(function (t) {
            return t && String(t.strategyId || '') === s.id;
        });
        const n = trades.length;
        const pnl = trades.reduce(function (a, t) { return a + (parseFloat(t.pnl) || 0); }, 0);
        const gewinner = trades.filter(function (t) { return (parseFloat(t.pnl) || 0) > 0; }).length;
        const rs = trades.map(tradeR).filter(function (r) { return r !== null; });
        const staende = trades.map(function (t) { return regelStand(t, s); }).filter(Boolean);
        const sumE = staende.reduce(function (a, x) { return a + x.erfuellt; }, 0);
        const sumV = staende.reduce(function (a, x) { return a + x.von; }, 0);
        return {
            n: n,
            pnl: pnl,
            trefferquote: n ? (gewinner / n) * 100 : null,
            r: rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : null,
            rAnzahl: rs.length,
            treue: sumV ? (sumE / sumV) * 100 : null,
        };
    }

    // ------------------------------------------------------- Anzeige im Tab

    function grenzenText(g) {
        const teile = [];
        if (g.hebelMax) teile.push(['Hebel', 'höchstens ' + cfZahl(g.hebelMax, 1, { min: 0 }) + 'x']);
        if (g.risikoMax) teile.push(['Risiko', 'höchstens ' + cfProz(g.risikoMax, 1, { min: 0 })]);
        if (g.notbremse) teile.push(['Notbremse', '−' + cfProz(g.notbremse, 1, { min: 0 }) + ' auf die Position']);
        if (g.zielVon || g.zielBis) {
            const von = g.zielVon || g.zielBis, bis = g.zielBis || g.zielVon;
            teile.push(['Ziel', von === bis
                ? '+' + cfProz(von, 1, { min: 0 })
                : '+' + cfZahl(von, 1, { min: 0 }) + '–' + cfProz(bis, 1, { min: 0 })]);
        }
        if (g.crvMin) teile.push(['Chance-Risiko', 'ab ' + cfZahl(g.crvMin, 1, { min: 0 }) + ' : 1']);
        if (g.earningsTage) teile.push(['Earnings', g.earningsTage + ' Tage vorher raus']);
        return teile;
    }

    function zahlZelle(titel, wert, klasse) {
        return '<div class="pb-zahl"><span class="pb-zahl-titel">' + titel + '</span>'
            + '<span class="pb-zahl-wert ' + (klasse || '') + '">' + wert + '</span></div>';
    }

    function karteHtml(s) {
        const st = statistik(s);
        const gruppenHtml = GRUPPEN.map(function (g) {
            const liste = s.regeln.filter(function (r) { return r.gruppe === g.key; });
            if (!liste.length) return '';
            return '<div class="pb-gruppe pb-gruppe-' + g.key + '"><h4>' + g.titel
                + (g.key === 'bonus' ? ' <span>keine Pflicht</span>' : '') + '</h4><ul>'
                + liste.map(function (r) { return '<li>' + esc(r.text) + '</li>'; }).join('')
                + '</ul></div>';
        }).join('');
        const grenzen = grenzenText(s.grenzen).map(function (t) {
            return '<li><span>' + t[0] + '</span>' + esc(t[1]) + '</li>';
        }).join('');
        const zahlen = st.n
            ? '<div class="pb-zahlen">'
                + zahlZelle('Trades', String(st.n))
                + zahlZelle('Trefferquote', cfProz(st.trefferquote, 0))
                + zahlZelle('Ergebnis', cfGeld(st.pnl, { vorzeichen: true }), st.pnl >= 0 ? 'pb-plus' : 'pb-minus')
                + zahlZelle('Ø Ergebnis in R', st.r === null ? '–' : cfZahl(st.r, 2, { vorzeichen: true }) + ' R')
                + zahlZelle('Regeln eingehalten', st.treue === null ? '–' : cfProz(st.treue, 0))
                + '</div>'
            : '<p class="pb-noch-nichts">Noch kein Trade mit dieser Strategie. Wähle sie im Journal beim Eintragen aus.</p>';
        return '<article class="pb-karte' + (s.archiviert ? ' pb-archiviert' : '') + '" data-id="' + esc(s.id) + '">'
            + '<header class="pb-karte-kopf"><h3>' + esc(s.name) + '</h3>'
            + '<div class="pb-aktionen">'
            + (s.archiviert
                ? '<button type="button" class="pb-knopf trade-edit" data-pb-aktion="zurueck">Wiederherstellen</button>'
                : '<button type="button" class="pb-knopf trade-edit" data-pb-aktion="bearbeiten">Bearbeiten</button>'
                  + '<button type="button" class="pb-knopf trade-edit" data-pb-aktion="archivieren">Archivieren</button>')
            + '<button type="button" class="pb-knopf trade-delete" data-pb-aktion="loeschen">Löschen</button>'
            + '</div></header>'
            + (s.beschreibung ? '<p class="pb-beschreibung">' + esc(s.beschreibung) + '</p>' : '')
            + (grenzen ? '<ul class="pb-grenzen">' + grenzen + '</ul>' : '')
            + (gruppenHtml ? '<div class="pb-gruppen">' + gruppenHtml + '</div>' : '')
            + zahlen
            + '</article>';
    }

    function leerHtml() {
        return '<div class="pb-leer">'
            + '<h3>Noch keine Strategie</h3>'
            + '<p>Fang mit einer Vorlage an und passe sie an – oder leg deine eigene an.</p>'
            + '<div class="pb-vorlagen">'
            + VORLAGEN.map(function (v, i) {
                return '<div class="pb-vorlage"><h4>' + esc(v.name) + '</h4><p>' + esc(v.beschreibung) + '</p>'
                    + '<button type="button" class="btn btn-secondary" data-pb-vorlage="' + i + '">Vorlage übernehmen</button></div>';
            }).join('')
            + '</div></div>';
    }

    function kapitalZeichnen() {
        const feld = el('pbKapital');
        const hinweis = el('pbKapitalHinweis');
        if (!feld || !hinweis) return;
        const eigen = zahlOderNull(einstellungen().kapital);
        if (document.activeElement !== feld) feld.value = eigen > 0 ? String(eigen) : '';
        const auto = kapitalAuto();
        let text = 'Daraus rechnet die App im Journal, wie viel Prozent ein Trade riskiert '
            + 'und wie groß die Position höchstens sein darf.';
        if (eigen > 0) text += ' Gerechnet wird mit ' + cfGeld(eigen) + '.';
        else if (auto) text += ' Leer lassen heißt: Einzahlungen plus Ergebnis, derzeit ' + cfGeld(auto) + '.';
        else text += ' Trag dein Kapital ein – ohne lässt sich das Risiko nur in Euro zeigen.';
        hinweis.textContent = text;
    }

    window.loadPlaybook = function () {
        const liste = el('pbListe');
        if (!liste) return;
        kapitalZeichnen();
        const alle = strategien();
        const aktiv = alle.filter(function (s) { return !s.archiviert; });
        const archiv = alle.filter(function (s) { return s.archiviert; });
        let html = aktiv.length ? aktiv.map(karteHtml).join('') : leerHtml();
        if (archiv.length) {
            html += '<details class="pb-archiv"><summary>Archiviert (' + archiv.length + ')</summary>'
                + archiv.map(karteHtml).join('') + '</details>';
        }
        liste.innerHTML = html;
        formularAuswahl();
    };

    // ------------------------------------------------------- Editor

    let inBearbeitung = null;     // id der Strategie im Editor oder null

    function editorFuellen(s) {
        el('pbEditorTitel').textContent = s && inBearbeitung ? 'Strategie bearbeiten' : 'Neue Strategie';
        el('pbName').value = s ? s.name : '';
        el('pbBeschreibung').value = s ? s.beschreibung : '';
        GRUPPEN_KEYS.forEach(function (g) {
            el('pbRegel-' + g).value = s
                ? s.regeln.filter(function (r) { return r.gruppe === g; })
                    .map(function (r) { return r.text; }).join('\n')
                : '';
        });
        const g = s ? s.grenzen : STANDARD;
        const setz = function (id, v) { el(id).value = v === null || v === undefined ? '' : String(v); };
        setz('pbHebelMax', g.hebelMax);
        setz('pbRisikoMax', g.risikoMax);
        setz('pbNotbremse', g.notbremse);
        setz('pbZielVon', g.zielVon);
        setz('pbZielBis', g.zielBis);
        setz('pbCrvMin', g.crvMin);
        setz('pbEarningsTage', g.earningsTage);
        fehler('');
        el('pbSpeichern').textContent = inBearbeitung ? 'Änderungen speichern' : 'Strategie speichern';
    }

    function fehler(text) {
        const f = el('pbFehler');
        if (!f) return;
        f.textContent = text;
        f.hidden = !text;
    }

    function editorAuf(s) {
        inBearbeitung = s ? s.id : null;
        editorFuellen(s || null);
        if (window.cfAufklapp) window.cfAufklapp.auf('pbEditorHuelle');
    }

    function editorZu() {
        inBearbeitung = null;
        editorFuellen(null);
        if (window.cfAufklapp) window.cfAufklapp.zu('pbEditorHuelle');
    }

    /**
     * Regeln aus den Textfeldern. Eine Zeile, die es vorher schon gab,
     * behaelt ihre id - sonst waeren die Haken alter Trades nach jedem
     * Bearbeiten keiner Regel mehr zuzuordnen.
     */
    function regelnAusEditor(alt) {
        const frei = (alt ? alt.regeln : []).slice();
        const belegt = new Set();
        const regeln = [];
        GRUPPEN_KEYS.forEach(function (g) {
            el('pbRegel-' + g).value.split('\n')
                .map(function (z) { return z.replace(/^\s*[-•*✓]\s*/, '').trim(); })
                .filter(Boolean)
                .forEach(function (text) {
                    const i = frei.findIndex(function (r) { return r.text === text; });
                    let id;
                    if (i >= 0 && !belegt.has(frei[i].id)) {
                        id = frei[i].id; belegt.add(id); frei.splice(i, 1);
                    } else {
                        (alt ? alt.regeln : []).forEach(function (r) { belegt.add(r.id); });
                        id = neueRegelId(belegt);
                    }
                    regeln.push({ id: id, gruppe: g, text: text.slice(0, 200) });
                });
        });
        return regeln;
    }

    function editorSpeichern(e) {
        if (e) e.preventDefault();
        const alle = strategien();
        const alt = inBearbeitung ? alle.find(function (s) { return s.id === inBearbeitung; }) : null;
        const name = el('pbName').value.trim();
        if (!name) { fehler('Gib der Strategie einen Namen.'); el('pbName').focus(); return; }
        const doppelt = alle.some(function (s) {
            return s.id !== inBearbeitung && s.name.toLowerCase() === name.toLowerCase();
        });
        if (doppelt) { fehler('Es gibt schon eine Strategie mit diesem Namen.'); el('pbName').focus(); return; }
        const regeln = regelnAusEditor(alt);
        if (!regeln.some(function (r) { return r.gruppe !== 'bonus'; })) {
            fehler('Trag mindestens eine Regel unter Kontext, Zone, Signal oder Ausstieg ein – '
                + 'sonst gibt es im Journal nichts abzuhaken.');
            el('pbRegel-kontext').focus();
            return;
        }
        const grenzen = {
            hebelMax: zahlOderNull(el('pbHebelMax').value),
            risikoMax: zahlOderNull(el('pbRisikoMax').value),
            notbremse: zahlOderNull(el('pbNotbremse').value),
            zielVon: zahlOderNull(el('pbZielVon').value),
            zielBis: zahlOderNull(el('pbZielBis').value),
            crvMin: zahlOderNull(el('pbCrvMin').value),
            earningsTage: zahlOderNull(el('pbEarningsTage').value),
        };
        const negativ = Object.keys(grenzen).some(function (k) { return grenzen[k] !== null && grenzen[k] < 0; });
        if (negativ) { fehler('Grenzen sind positive Zahlen. Die Notbremse −20 % trägst du als 20 ein.'); return; }
        if (grenzen.hebelMax !== null && grenzen.hebelMax < 1) { fehler('Der Hebel ist mindestens 1.'); return; }
        if (grenzen.risikoMax !== null && grenzen.risikoMax > 100) { fehler('Risiko pro Trade über 100 % geht nicht.'); return; }
        if (grenzen.zielVon !== null && grenzen.zielBis !== null && grenzen.zielBis < grenzen.zielVon) {
            fehler('„Ziel bis“ ist kleiner als „Ziel von“.'); return;
        }
        if (grenzen.earningsTage !== null) grenzen.earningsTage = Math.round(grenzen.earningsTage);

        const s = {
            id: alt ? alt.id : neueUuid(),
            name: name.slice(0, 80),
            beschreibung: el('pbBeschreibung').value.trim().slice(0, 600),
            regeln: regeln,
            grenzen: grenzen,
            archiviert: alt ? alt.archiviert : false,
            erstellt: alt ? alt.erstellt : new Date().toISOString(),
        };
        const neu = alt ? alle.map(function (x) { return x.id === s.id ? s : x; }) : alle.concat([s]);
        alleSpeichern(neu);
        if (window.cfDbStrategieSpeichern) window.cfDbStrategieSpeichern(s);
        meldung(alt ? 'Strategie geändert: ' + s.name : 'Strategie angelegt: ' + s.name);
        editorZu();
        window.loadPlaybook();
        if (typeof cfNavZahlen === 'function') cfNavZahlen();
    }

    function vorlageUebernehmen(i) {
        const v = VORLAGEN[i];
        if (!v) return;
        const alle = strategien();
        let name = v.name, n = 2;
        while (alle.some(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })) {
            name = v.name + ' ' + (n++);
        }
        const belegt = new Set();
        const regeln = [];
        GRUPPEN_KEYS.forEach(function (g) {
            (v.regeln[g] || []).forEach(function (text) {
                regeln.push({ id: neueRegelId(belegt), gruppe: g, text: text });
            });
        });
        const s = {
            id: neueUuid(), name: name, beschreibung: v.beschreibung, regeln: regeln,
            grenzen: Object.assign({}, STANDARD), archiviert: false,
            erstellt: new Date().toISOString(),
        };
        alleSpeichern(alle.concat([s]));
        if (window.cfDbStrategieSpeichern) window.cfDbStrategieSpeichern(s);
        meldung('Vorlage übernommen: ' + name + ' – passe sie unter „Bearbeiten“ an');
        window.loadPlaybook();
        if (typeof cfNavZahlen === 'function') cfNavZahlen();
    }

    function aktion(id, was) {
        const alle = strategien();
        const s = alle.find(function (x) { return x.id === id; });
        if (!s) return;
        if (was === 'bearbeiten') { editorAuf(s); return; }
        if (was === 'archivieren' || was === 'zurueck') {
            s.archiviert = was === 'archivieren';
            alleSpeichern(alle);
            if (window.cfDbStrategieSpeichern) window.cfDbStrategieSpeichern(s);
            meldung(s.archiviert ? s.name + ' archiviert – im Journal nicht mehr wählbar' : s.name + ' wiederhergestellt');
        }
        if (was === 'loeschen') {
            // Derselbe Dialog wie beim Loeschen eines Trades, nicht das
            // graue Browserfenster
            const n = statistik(s).n;
            loeschDialog('Strategie löschen?',
                '„' + s.name + '“ wird gelöscht.'
                + (n ? ' ' + n + ' Trade' + (n === 1 ? ' verliert' : 's verlieren')
                    + ' die Zuordnung und die abgehakten Regeln – Archivieren behält beides.' : ''),
                function () { loeschen(s); });
            return;
        }
        window.loadPlaybook();
        if (typeof cfNavZahlen === 'function') cfNavZahlen();
    }

    function loeschDialog(titel, text, ja) {
        const modal = el('deleteModal');
        const knopf = el('deleteConfirmBtn');
        if (!modal || !knopf) { if (window.confirm(titel + '\n\n' + text)) ja(); return; }
        el('deleteModalTitle').textContent = titel;
        el('deleteModalText').textContent = text;
        knopf.textContent = 'Ja, löschen';
        knopf.onclick = function () {
            modal.style.display = 'none';
            ja();
        };
        modal.style.display = 'flex';
        knopf.focus();
    }

    function loeschen(s) {
        const id = s.id;
        alleSpeichern(strategien().filter(function (x) { return x.id !== id; }));
        // Lokal dasselbe wie "on delete set null" in der Datenbank
        const trades = lesen('trades', []);
        if (Array.isArray(trades) && trades.some(function (t) { return t && t.strategyId === id; })) {
            localStorage.setItem('trades', JSON.stringify(trades.map(function (t) {
                return t && t.strategyId === id
                    ? Object.assign({}, t, { strategyId: null, regelnErfuellt: null }) : t;
            })));
        }
        if (window.cfDbLoeschen) window.cfDbLoeschen('strategies', id);
        if (inBearbeitung === id) editorZu();
        meldung('Strategie gelöscht');
        window.loadPlaybook();
        if (typeof cfNavZahlen === 'function') cfNavZahlen();
    }

    function kapitalSpeichern(e) {
        e.preventDefault();
        const roh = el('pbKapital').value.trim();
        const wert = zahlOderNull(roh);
        if (roh && !(wert > 0)) { meldung('Das Kapital muss größer als 0 sein.', 'error'); return; }
        const neu = Object.assign({}, einstellungen(), { kapital: wert > 0 ? Math.round(wert * 100) / 100 : null });
        localStorage.setItem('playbook', JSON.stringify(neu));
        if (window.cfDbPlaybookEinstellungen) window.cfDbPlaybookEinstellungen(neu);
        meldung(wert > 0 ? 'Kapital übernommen: ' + cfGeld(wert) : 'Kapital wird aus Einzahlungen und Ergebnis gerechnet');
        kapitalZeichnen();
        pruefungZeichnen();
    }

    // ------------------------------------------------------- Trade-Formular

    /**
     * Klappliste fuer eine Strategie - dieselbe wie beim Fehlertyp. Gibt
     * es zweimal: im Journal und im Setup-Formular.
     *
     * Archivierte Strategien stehen nur drin, wenn der Eintrag sie schon
     * hat - sonst verschwaende beim Bearbeiten die Zuordnung still.
     */
    function auswahl(cfg) {
        const api = {
            fuellen: function (behalten) {
                const sel = el(cfg.hidden), liste = el(cfg.liste);
                if (!sel || !liste) return false;
                const wert = behalten !== undefined ? behalten : sel.value;
                const sichtbar = strategien().filter(function (s) { return !s.archiviert || s.id === wert; });
                const option = function (id, name) {
                    return '<div class="custom-option" role="option" tabindex="-1" data-value="' + esc(id) + '">' + esc(name) + '</div>';
                };
                liste.innerHTML = option('', 'Keine Strategie') + sichtbar.map(function (s) {
                    return option(s.id, s.name + (s.archiviert ? ' (archiviert)' : ''));
                }).join('');
                const da = sichtbar.some(function (s) { return s.id === wert; });
                api.setzen(da ? wert : '');
                return da;
            },
            setzen: function (id) {
                const sel = el(cfg.hidden), liste = el(cfg.liste);
                if (!sel || !liste) return;
                sel.value = id || '';
                let text = 'Keine Strategie';
                liste.querySelectorAll('.custom-option').forEach(function (o) {
                    const an = o.getAttribute('data-value') === sel.value;
                    o.classList.toggle('selected', an);
                    o.setAttribute('aria-selected', an ? 'true' : 'false');
                    if (an) text = o.textContent;
                });
                const kopf = liste.closest('.custom-select').querySelector('.custom-select-value');
                if (kopf) kopf.textContent = text;
            },
            wert: function () { const sel = el(cfg.hidden); return sel ? sel.value : ''; },
            binden: function () {
                const liste = el(cfg.liste);
                if (!liste) return;
                const box = liste.closest('.custom-select');
                const kopf = box.querySelector('.custom-select-header');
                const nehmen = function (o) {
                    api.setzen(o.getAttribute('data-value'));
                    box.classList.remove('open');
                    if (cfg.beiWahl) cfg.beiWahl(api.wert());
                    kopf.focus();
                };
                liste.addEventListener('click', function (e) {
                    const o = e.target.closest('.custom-option');
                    if (!o) return;
                    e.stopPropagation();
                    nehmen(o);
                });
                // Mit der Tastatur: Pfeile wandern, Enter waehlt, Escape schliesst
                liste.addEventListener('keydown', function (e) {
                    const o = e.target.closest('.custom-option');
                    if (!o) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nehmen(o); }
                    else if (e.key === 'ArrowDown' && o.nextElementSibling) { e.preventDefault(); o.nextElementSibling.focus(); }
                    else if (e.key === 'ArrowUp' && o.previousElementSibling) { e.preventDefault(); o.previousElementSibling.focus(); }
                    else if (e.key === 'Escape') { box.classList.remove('open'); kopf.focus(); }
                });
                kopf.addEventListener('keydown', function (e) {
                    if (e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    box.classList.add('open');
                    const z = liste.querySelector('.selected') || liste.firstElementChild;
                    if (z) z.focus();
                });
            },
        };
        return api;
    }

    const journalAuswahl = auswahl({
        hidden: 'pbStrategie', liste: 'pbStrategieListe',
        beiWahl: function (id) { checklisteZeichnen(strategie(id)); },
    });
    const setupAuswahl = auswahl({
        hidden: 'suStrategie', liste: 'suStrategieListe',
        beiWahl: function () { if (typeof updateSetupsCrvPreview === 'function') updateSetupsCrvPreview(); },
    });

    function formularAuswahl(behalten) {
        const wert = behalten !== undefined ? behalten : journalAuswahl.wert();
        const da = journalAuswahl.fuellen(behalten);
        const leer = el('pbFormularLeer');
        if (leer) leer.hidden = strategien().some(function (s) { return !s.archiviert; });
        if (!da && wert) checklisteZeichnen(null);
        setupAuswahl.fuellen();
        const suLeer = el('suStrategieLeer');
        if (suLeer) suLeer.hidden = strategien().some(function (s) { return !s.archiviert; });
    }

    function auswahlSetzen(id) { journalAuswahl.setzen(id); }

    function checklisteZeichnen(s, haken) {
        const box = el('pbCheckliste');
        const earn = el('pbEarningsGruppe');
        if (!box) return;
        if (!s) {
            box.hidden = true; box.innerHTML = '';
            if (earn) earn.hidden = true;
            pruefungZeichnen();
            return;
        }
        haken = haken || {};
        box.innerHTML = GRUPPEN.map(function (g) {
            const liste = s.regeln.filter(function (r) { return r.gruppe === g.key; });
            if (!liste.length) return '';
            return '<fieldset class="pb-check-gruppe"><legend>' + g.titel
                + (g.key === 'bonus' ? ' <span>keine Pflicht</span>' : '') + '</legend>'
                + liste.map(function (r) {
                    return '<label class="pb-check-zeile"><input type="checkbox" class="pb-regel" value="'
                        + esc(r.id) + '"' + (haken[r.id] === true ? ' checked' : '') + '><span>'
                        + esc(r.text) + '</span></label>';
                }).join('') + '</fieldset>';
        }).join('') + '<p class="pb-check-stand" id="pbCheckStand"></p>';
        box.hidden = false;
        if (earn) earn.hidden = false;
        standZeichnen();
        pruefungZeichnen();
    }

    function standZeichnen() {
        const p = el('pbCheckStand');
        const s = strategie(el('pbStrategie') && el('pbStrategie').value);
        if (!p || !s) return;
        const pflicht = s.regeln.filter(function (r) { return r.gruppe !== 'bonus'; });
        const an = new Set(Array.from(document.querySelectorAll('#pbCheckliste .pb-regel:checked'))
            .map(function (c) { return c.value; }));
        const n = pflicht.filter(function (r) { return an.has(r.id); }).length;
        p.textContent = n + ' von ' + pflicht.length + ' Pflichtregeln eingehalten';
        p.classList.toggle('pb-voll', n === pflicht.length);
    }

    function datumAusDe(t) {
        const m = String(t || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
    }

    function datumKurz(d) {
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    /**
     * Die Pruefung gegen die Grenzen. Rechnet bei jeder Eingabe neu.
     * Nichts davon blockiert das Speichern - ein Journal haelt fest, was
     * passiert ist, auch wenn es gegen die eigenen Regeln war. Genau
     * diese Trades sind spaeter die lehrreichsten.
     */
    function pruefungen(s, w, k) {
        const g = s.grenzen;
        const aus = [];
        const geld = function (n) { return cfGeld(n); };
        const kurs = function (n) {
            return cfGeld(n, { waehrung: w.istZert ? '€' : '$', stellen: n < 10 ? 3 : 2 });
        };

        // Hebel
        if (g.hebelMax) {
            if (w.hebel) {
                aus.push(w.hebel > g.hebelMax + 1e-9
                    ? { art: 'warn', text: 'Hebel ' + cfZahl(w.hebel, 1, { min: 0 }) + 'x – erlaubt sind höchstens ' + cfZahl(g.hebelMax, 1, { min: 0 }) + 'x.' }
                    : { art: 'ok', text: 'Hebel ' + cfZahl(w.hebel, 1, { min: 0 }) + 'x – innerhalb deiner Grenze von ' + cfZahl(g.hebelMax, 1, { min: 0 }) + 'x.' });
            } else if (w.istZert) {
                aus.push({ art: 'info', text: 'Hebel unbekannt – trag Knockout-Preis und Basiswert ein, dann prüft die App ihn.' });
            }
        }

        // Risiko bis zum Stop
        if (w.risiko > 0) {
            if (k && g.risikoMax) {
                const proz = (w.risiko / k.wert) * 100;
                aus.push(proz > g.risikoMax + 1e-9
                    ? { art: 'warn', text: 'Risiko bis zum Stop ' + geld(w.risiko) + ' = ' + cfProz(proz, 1) + ' vom Kapital – erlaubt sind ' + cfProz(g.risikoMax, 1, { min: 0 }) + '.' }
                    : { art: 'ok', text: 'Risiko bis zum Stop ' + geld(w.risiko) + ' = ' + cfProz(proz, 1) + ' vom Kapital.' });
            } else {
                aus.push({ art: 'info', text: 'Risiko bis zum Stop: ' + geld(w.risiko) + (k ? '.' : ' – mit Kapital im Playbook auch in Prozent.') });
            }
        } else if (w.entry > 0 && w.size > 0) {
            aus.push({ art: 'info', text: 'Ohne Stop lässt sich das Risiko nicht rechnen – und kein Ergebnis in R.' });
        }

        // Positionsgroesse: so gross, dass die Notbremse genau das
        // erlaubte Risiko kostet
        if (k && g.risikoMax && g.notbremse && w.size > 0) {
            const max = k.wert * (g.risikoMax / 100) / (g.notbremse / 100);
            aus.push(w.size > max + 0.005
                ? { art: 'warn', text: 'Einsatz ' + geld(w.size) + ' – höchstens ' + geld(max) + ', damit die Notbremse bei −' + cfProz(g.notbremse, 1, { min: 0 }) + ' nicht mehr als ' + cfProz(g.risikoMax, 1, { min: 0 }) + ' kostet.' }
                : { art: 'ok', text: 'Einsatz ' + geld(w.size) + ' – passt (höchstens ' + geld(max) + ').' });
        }

        // Notbremse und Ziel als Kurse
        if (w.entry > 0 && (g.notbremse || g.zielVon || g.zielBis)) {
            const hebel = w.istZert ? 1 : (w.hebel || 1);
            const vz = !w.istZert && w.direction === 'short' ? -1 : 1;
            const preis = function (prozent) { return w.entry * (1 + vz * prozent / 100 / hebel); };
            if (g.notbremse) {
                const nb = preis(-g.notbremse);
                let text = 'Notbremse −' + cfProz(g.notbremse, 1, { min: 0 }) + ' auf die Position';
                text += w.istZert
                    ? ' = Scheinkurs ' + kurs(nb) + '.'
                    : (hebel > 1 ? ' = ' + cfProz(g.notbremse / hebel, 1) + ' auf die Aktie' : '') + ' = Kurs ' + kurs(nb) + '.';
                let art = 'info';
                if (!w.istZert && w.stop > 0) {
                    const stopWeiter = vz > 0 ? w.stop < nb : w.stop > nb;
                    if (stopWeiter) {
                        art = 'warn';
                        text += ' Dein Stop bei ' + kurs(w.stop) + ' liegt dahinter – die Notbremse greift zuerst.';
                    }
                }
                aus.push({ art: art, text: text });
            }
            if (g.zielVon || g.zielBis) {
                const von = g.zielVon || g.zielBis, bis = g.zielBis || g.zielVon;
                aus.push({ art: 'info', text: 'Ziel +' + (von === bis ? cfProz(von, 1, { min: 0 }) : cfZahl(von, 1, { min: 0 }) + '–' + cfProz(bis, 1, { min: 0 }))
                    + ' auf die Position = ' + (w.istZert ? 'Scheinkurs ' : 'Kurs ')
                    + (von === bis ? kurs(preis(von)) : kurs(preis(von)) + ' bis ' + kurs(preis(bis))) + '.' });
            }
        }

        // Ergebnis in R
        if (w.pnl !== null && w.risiko > 0) {
            const r = w.pnl / w.risiko;
            aus.push({ art: r >= 0 ? 'ok' : 'info', text: 'Ergebnis ' + cfGeld(w.pnl, { vorzeichen: true }) + ' = ' + cfZahl(r, 2, { vorzeichen: true }) + ' R.' });
        }

        // Earnings
        const earn = el('pbEarnings') && el('pbEarnings').value;
        if (earn && g.earningsTage !== null) {
            const e = new Date(earn + 'T00:00:00');
            const raus = datumAusDe(w.datum);
            if (!isNaN(e) && raus) {
                const grenze = new Date(e); grenze.setDate(grenze.getDate() - (g.earningsTage || 0));
                aus.push(raus >= grenze && raus <= e
                    ? { art: 'warn', text: 'Earnings am ' + datumKurz(e) + ' – geschlossen am ' + w.datum + ', also in den ' + g.earningsTage + ' Tagen davor. Deine Regel: vorher raus.' }
                    : raus > e
                        ? { art: 'warn', text: 'Earnings am ' + datumKurz(e) + ' lagen vor dem Verkauf am ' + w.datum + ' – die Position lief durch die Zahlen.' }
                        : { art: 'ok', text: 'Vor der Earnings-Woche geschlossen (Earnings am ' + datumKurz(e) + ').' });
            }
        }
        return aus;
    }

    const ZEICHEN = { ok: '✓', warn: '!', info: 'i' };

    function pruefungZeichnen() {
        const box = el('pbPruefung');
        if (!box) return;
        const s = strategie(el('pbStrategie') && el('pbStrategie').value);
        if (!s || typeof window.cfTradeFormWerte !== 'function') {
            box.hidden = true; box.innerHTML = '';
            return;
        }
        const liste = pruefungen(s, window.cfTradeFormWerte(), kapital());
        if (!liste.length) {
            box.hidden = false;
            box.innerHTML = '<p class="pb-pruef-leer">Kurse und Position eintragen – dann prüft die App deine Grenzen.</p>';
            return;
        }
        const warn = liste.filter(function (x) { return x.art === 'warn'; }).length;
        box.hidden = false;
        box.innerHTML = '<div class="pb-pruef-kopf">'
            + (warn ? warn + (warn === 1 ? ' Grenze überschritten' : ' Grenzen überschritten') : 'Innerhalb deiner Grenzen')
            + '</div><ul>' + liste.map(function (x) {
                return '<li class="pb-pruef-' + x.art + '"><span class="pb-pruef-zeichen" aria-hidden="true">'
                    + ZEICHEN[x.art] + '</span><span>' + esc(x.text) + '</span></li>';
            }).join('') + '</ul>';
        box.classList.toggle('pb-pruefung-warn', warn > 0);
    }

    let geplant = false;
    function spaeterPruefen() {
        if (geplant) return;
        geplant = true;
        requestAnimationFrame(function () { geplant = false; pruefungZeichnen(); });
    }

    window.cfPlaybookFormular = {
        lesen: function () {
            const sel = el('pbStrategie');
            const s = strategie(sel && sel.value);
            if (!s) return { strategyId: null, regelnErfuellt: null, earningsAm: null };
            const haken = {};
            const an = new Set(Array.from(document.querySelectorAll('#pbCheckliste .pb-regel:checked'))
                .map(function (c) { return c.value; }));
            s.regeln.forEach(function (r) { haken[r.id] = an.has(r.id); });
            const e = el('pbEarnings') && el('pbEarnings').value;
            return {
                strategyId: s.id,
                regelnErfuellt: haken,
                earningsAm: /^\d{4}-\d{2}-\d{2}$/.test(e || '') ? e : null,
            };
        },
        setzen: function (trade) {
            const id = trade && trade.strategyId ? String(trade.strategyId) : '';
            formularAuswahl(id);
            const s = strategie(el('pbStrategie').value);
            if (el('pbEarnings')) el('pbEarnings').value = trade && trade.earningsAm ? trade.earningsAm : '';
            checklisteZeichnen(s, trade && trade.regelnErfuellt);
        },
        zuruecksetzen: function () {
            auswahlSetzen('');
            if (el('pbEarnings')) el('pbEarnings').value = '';
            checklisteZeichnen(null);
            formularAuswahl('');
        },
    };

    // ------------------------------------------------------- Setups

    /** Stand der Pflichtregeln eines Setups. Nicht abgehakt = offen. */
    function setupStand(w, s) {
        const m = (w && w.regelnErfuellt) || {};
        const pflicht = s.regeln.filter(function (r) { return r.gruppe !== 'bonus'; });
        return { erfuellt: pflicht.filter(function (r) { return m[r.id] === true; }).length, von: pflicht.length };
    }

    function tageBis(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const heute = new Date(); heute.setHours(0, 0, 0, 0);
        return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - heute) / 86400000);
    }

    /**
     * Pruefung VOR dem Einstieg - hier ist sie am meisten wert. Im Journal
     * waere dieselbe Warnung nur noch die Erklaerung, warum es schiefging.
     */
    function setupPruefen(w, crv, hebel) {
        const s = strategie(w && w.strategyId);
        if (!s) return [];
        const g = s.grenzen;
        const aus = [];
        if (g.crvMin && crv !== null && crv !== undefined && crv < g.crvMin - 1e-9) {
            aus.push('Chance-Risiko 1 : ' + cfZahl(crv, 2) + ' – deine Strategie verlangt mindestens 1 : '
                + cfZahl(g.crvMin, 1, { min: 0 }) + '.');
        }
        if (g.hebelMax && hebel > g.hebelMax + 1e-9) {
            aus.push('Hebel ' + cfZahl(hebel, 1, { min: 0 }) + 'x – erlaubt sind höchstens '
                + cfZahl(g.hebelMax, 1, { min: 0 }) + 'x.');
        }
        const t = tageBis(w.earningsAm);
        if (t !== null && g.earningsTage !== null && t >= 0 && t <= g.earningsTage) {
            aus.push(t === 0 ? 'Earnings sind heute – laut deiner Regel kein Einstieg.'
                : 'Earnings in ' + t + (t === 1 ? ' Tag' : ' Tagen') + ' – laut deiner Regel kein Einstieg in den '
                  + g.earningsTage + ' Tagen davor.');
        }
        return aus;
    }

    function setupKarteHtml(w, offen) {
        const s = strategie(w && w.strategyId);
        if (!s) return '';
        const m = w.regelnErfuellt || {};
        const st = setupStand(w, s);
        const voll = st.von > 0 && st.erfuellt === st.von;
        const gruppen = GRUPPEN.map(function (g) {
            const liste = s.regeln.filter(function (r) { return r.gruppe === g.key; });
            if (!liste.length) return '';
            return '<div class="su-gruppe"><span class="su-gruppe-titel">' + g.titel
                + (g.key === 'bonus' ? ' <span>keine Pflicht</span>' : '') + '</span>'
                + liste.map(function (r) {
                    return '<label class="pb-check-zeile"><input type="checkbox" class="su-regel" data-setup="'
                        + esc(w.id) + '" value="' + esc(r.id) + '"' + (m[r.id] === true ? ' checked' : '') + '><span>'
                        + esc(r.text) + '</span></label>';
                }).join('') + '</div>';
        }).join('');
        return '<details class="su-regeln" data-setup="' + esc(w.id) + '"' + (offen ? ' open' : '') + '>'
            + '<summary><span class="pb-abzeichen">' + esc(s.name) + '</span>'
            + '<span class="pb-regel-abzeichen ' + (voll ? 'pb-voll' : 'pb-teil') + '">' + (voll ? '✓ ' : '')
            + st.erfuellt + '/' + st.von + ' Regeln</span>'
            + '<span class="su-regeln-auf">Abhaken</span></summary>'
            + '<div class="su-regeln-inhalt">' + gruppen
            + (voll ? '<p class="su-voll">Alle Pflichtregeln erfüllt – das Setup ist bereit.</p>' : '')
            + '</div></details>';
    }

    window.cfPlaybookSetup = {
        lesen: function () {
            const e = el('suEarnings') && el('suEarnings').value;
            return {
                strategyId: strategie(setupAuswahl.wert()) ? setupAuswahl.wert() : null,
                earningsAm: /^\d{4}-\d{2}-\d{2}$/.test(e || '') ? e : null,
            };
        },
        zuruecksetzen: function () {
            setupAuswahl.fuellen('');
            if (el('suEarnings')) el('suEarnings').value = '';
        },
        pruefen: setupPruefen,
        karte: setupKarteHtml,
        stand: function (w) { const s = strategie(w && w.strategyId); return s ? setupStand(w, s) : null; },
    };

    /** Strategie und Regeltreue auf der Trade-Karte. */
    window.cfPlaybookAbzeichen = function (trade) {
        const s = trade && trade.strategyId ? strategie(trade.strategyId) : null;
        if (!s) return '';
        const st = regelStand(trade, s);
        let regeln = '';
        if (st) {
            const voll = st.erfuellt === st.von;
            regeln = '<span class="pb-regel-abzeichen ' + (voll ? 'pb-voll' : 'pb-teil') + '" title="Pflichtregeln eingehalten">'
                + (voll ? '✓ ' : '') + st.erfuellt + '/' + st.von + ' Regeln</span>';
        }
        return '<span class="pb-abzeichen" title="Strategie">' + esc(s.name) + '</span>' + regeln;
    };

    window.cfPlaybook = {
        strategien: strategien,
        kapital: kapital,
        regelStand: regelStand,
        statistik: statistik,
        VORLAGEN: VORLAGEN,
    };

    // ------------------------------------------------------- Verdrahtung

    document.addEventListener('DOMContentLoaded', function () {
        const form = el('pbForm');
        if (form) form.addEventListener('submit', editorSpeichern);
        const abbr = el('pbAbbrechen');
        if (abbr) abbr.addEventListener('click', editorZu);
        const kf = el('pbKapitalForm');
        if (kf) kf.addEventListener('submit', kapitalSpeichern);

        // "Strategie anlegen" oeffnet immer einen leeren Editor - auch
        // wenn vorher eine andere Strategie darin stand
        const neuK = el('pbNeuKnopf');
        if (neuK) neuK.addEventListener('click', function () {
            if (inBearbeitung) { inBearbeitung = null; editorFuellen(null); }
        }, true);
        // Leerer Editor mit den Standardgrenzen - wer neu anfaengt, soll
        // nicht sieben Zahlen selbst eintippen muessen
        if (el('pbName')) editorFuellen(null);

        const liste = el('pbListe');
        if (liste) liste.addEventListener('click', function (e) {
            const v = e.target.closest('[data-pb-vorlage]');
            if (v) { vorlageUebernehmen(+v.getAttribute('data-pb-vorlage')); return; }
            const a = e.target.closest('[data-pb-aktion]');
            if (!a) return;
            const k = a.closest('.pb-karte');
            if (k) aktion(k.getAttribute('data-id'), a.getAttribute('data-pb-aktion'));
        });

        journalAuswahl.binden();
        setupAuswahl.binden();
        const check = el('pbCheckliste');
        if (check) check.addEventListener('change', standZeichnen);

        const tf = el('tradeForm');
        if (tf) {
            ['input', 'change', 'click'].forEach(function (t) { tf.addEventListener(t, spaeterPruefen); });
            // Zuruecksetzen raeumt auch Strategie, Haken und Earnings ab
            tf.addEventListener('reset', function () {
                setTimeout(function () { window.cfPlaybookFormular.zuruecksetzen(); }, 0);
            });
        }

        document.querySelectorAll('[data-pb-zum-playbook]').forEach(function (zum) {
            zum.addEventListener('click', function () {
                if (typeof handleTabChange === 'function') handleTabChange('playbook');
            });
        });
        const suE = el('suEarnings');
        if (suE) suE.addEventListener('change', function () {
            if (typeof updateSetupsCrvPreview === 'function') updateSetupsCrvPreview();
        });

        formularAuswahl('');
        window.loadPlaybook();
    });
})();
