/* CapitalFlow Krypto Terminal - Handelssitzungen
 *
 * Asien (Tokio), London und New York, jeweils in ihrer eigenen Zeitzone
 * gerechnet. Damit stimmen die Zeiten automatisch, wenn London oder New
 * York auf Sommer-/Winterzeit wechseln (die Umstellungen liegen nicht
 * am selben Tag wie in Deutschland). Tokio hat keine Sommerzeit.
 *
 * Wochenende: Die Sitzungen gibt es nur Montag bis Freitag (Ortszeit der
 * jeweiligen Boerse). Krypto laeuft durch, die Sitzungen zeigen, wann die
 * grossen Finanzplaetze aktiv sind.
 *
 * Diese Datei liegt zweimal im Projekt: js/sessions.js (Browser) und
 * supabase/functions/terminal-push/sessions.js (Push-Server). Beide
 * muessen gleich sein - ein Test prueft das.
 */
(function (wurzel) {
    'use strict';

    const SESSIONS = [
        { id: 'asien', name: 'Asien', ort: 'Tokio', zone: 'Asia/Tokyo', von: [9, 0], bis: [18, 0], zeichen: '🌏' },
        { id: 'london', name: 'London', ort: 'London', zone: 'Europe/London', von: [8, 0], bis: [16, 30], zeichen: '🇬🇧' },
        { id: 'newyork', name: 'New York', ort: 'New York', zone: 'America/New_York', von: [9, 30], bis: [16, 0], zeichen: '🇺🇸' },
    ];
    const TAG = 86400000;

    const formate = {};
    function format(zone) {
        if (!formate[zone]) {
            formate[zone] = new Intl.DateTimeFormat('en-US', {
                timeZone: zone, hourCycle: 'h23', weekday: 'short',
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
        }
        return formate[zone];
    }
    const WT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    // Ortszeit in einer Zone: { j, m, t, std, min, wt }
    function ortszeit(ms, zone) {
        const teile = {};
        format(zone).formatToParts(new Date(ms)).forEach(function (p) { teile[p.type] = p.value; });
        return { j: +teile.year, m: +teile.month, t: +teile.day, std: +teile.hour % 24, min: +teile.minute, sek: +teile.second, wt: WT[teile.weekday] };
    }
    // Abstand der Zone zu UTC in ms zum Zeitpunkt ms
    function versatz(ms, zone) {
        const o = ortszeit(ms, zone);
        return Date.UTC(o.j, o.m - 1, o.t, o.std, o.min, o.sek) - Math.floor(ms / 1000) * 1000;
    }
    // Ortszeit (Datum + Uhrzeit in der Zone) -> UTC-Millisekunden
    function zeitpunkt(j, m, t, std, min, zone) {
        const roh = Date.UTC(j, m - 1, t, std, min);
        let ms = roh - versatz(roh, zone);
        ms = roh - versatz(ms, zone);
        return ms;
    }

    // Alle Sitzungen einer Session, die das Zeitfenster [ab, bis] beruehren
    function termine(s, ab, bis) {
        const aus = [];
        for (let ms = ab - 2 * TAG; ms <= bis + TAG; ms += TAG) {
            const o = ortszeit(ms, s.zone);
            if (o.wt === 0 || o.wt === 6) continue;
            const start = zeitpunkt(o.j, o.m, o.t, s.von[0], s.von[1], s.zone);
            const ende = zeitpunkt(o.j, o.m, o.t, s.bis[0], s.bis[1], s.zone);
            if (ende > ab && start < bis && !aus.some(function (x) { return x.start === start; })) aus.push({ start: start, ende: ende });
        }
        return aus.sort(function (a, b) { return a.start - b.start; });
    }

    /**
     * Stand jeder Session zum Zeitpunkt jetzt:
     * { id, name, ..., offen, start, ende (wenn offen), naechste (wenn zu) }
     */
    function stand(jetzt) {
        jetzt = jetzt || Date.now();
        return SESSIONS.map(function (s) {
            const liste = termine(s, jetzt - TAG, jetzt + 8 * TAG);
            const jetztOffen = liste.find(function (x) { return x.start <= jetzt && jetzt < x.ende; });
            const naechste = liste.find(function (x) { return x.start > jetzt; });
            return Object.assign({}, s, {
                offen: !!jetztOffen,
                start: jetztOffen ? jetztOffen.start : null,
                ende: jetztOffen ? jetztOffen.ende : null,
                naechste: naechste ? naechste.start : null,
            });
        });
    }

    /**
     * Fuer den Push-Server: Welche Session hat in den letzten fensterMs
     * begonnen? Liefert [{ session, start, tag }] - tag ist das Ortsdatum
     * der Boerse (fuer "nur einmal pro Tag senden").
     */
    function gestartet(jetzt, fensterMs) {
        return SESSIONS.map(function (s) {
            const t = termine(s, jetzt - fensterMs, jetzt).find(function (x) { return x.start <= jetzt && x.start > jetzt - fensterMs; });
            if (!t) return null;
            const o = ortszeit(t.start, s.zone);
            return { session: s, start: t.start, ende: t.ende, tag: o.j + '-' + String(o.m).padStart(2, '0') + '-' + String(o.t).padStart(2, '0') };
        }).filter(Boolean);
    }

    const api = { SESSIONS: SESSIONS, stand: stand, termine: termine, gestartet: gestartet, ortszeit: ortszeit, zeitpunkt: zeitpunkt };
    wurzel.cfSessions = api;
})(typeof window !== 'undefined' ? window : globalThis);
