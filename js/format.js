/* CapitalFlow - ein Zahlenformat fuer die ganze App
 *
 * Vorher stand dieselbe Sache in vier Schreibweisen nebeneinander:
 * "€+182.40", "+€182.40", "€ -250.00", "−€7.80". Jetzt laeuft jeder
 * Betrag, jede Prozentzahl und jede Kennzahl durch diese drei Funktionen:
 *
 *     cfGeld(-250)                      −250,00 €
 *     cfGeld(182.4, { vorzeichen: true }) +182,40 €
 *     cfGeld(1.5, { waehrung: '$' })    1,50 $
 *     cfProz(62.5)                      62,5 %
 *     cfZahl(1.567, 2)                  1,57
 *
 * Minus ist das echte Minuszeichen (−), nicht der Bindestrich - es steht
 * gleich breit wie das Plus, und Spalten mit Ergebnissen bleiben buendig.
 * Zwischen Zahl und Einheit steht ein geschuetztes Leerzeichen, damit
 * "250,00" und "€" nie auf zwei Zeilen landen.
 */
(function () {
    'use strict';

    const MINUS = '−';
    const NBSP = ' ';

    function betrag(z, stellen, min) {
        return Math.abs(z).toLocaleString('de-DE', {
            minimumFractionDigits: min === undefined ? stellen : min,
            maximumFractionDigits: stellen,
        });
    }

    function zeichen(z, stellen, mitPlus) {
        if (Number(Math.abs(z).toFixed(stellen)) === 0) return mitPlus ? '+' : '';
        return z < 0 ? MINUS : (mitPlus ? '+' : '');
    }

    /** Geld. opt: vorzeichen (immer + oder −), stellen (2), waehrung ('€'). */
    function cfGeld(n, opt) {
        opt = opt || {};
        const z = Number(n);
        if (!Number.isFinite(z)) return '—';
        const s = opt.stellen === undefined ? 2 : opt.stellen;
        return zeichen(z, s, opt.vorzeichen) + betrag(z, s) + NBSP + (opt.waehrung || '€');
    }

    /** Zahl ohne Einheit. opt: vorzeichen, min (Mindest-Nachkommastellen). */
    function cfZahl(n, stellen, opt) {
        opt = opt || {};
        const z = Number(n);
        if (!Number.isFinite(z)) return '—';
        const s = stellen === undefined ? 2 : stellen;
        return zeichen(z, s, opt.vorzeichen) + betrag(z, s, opt.min);
    }

    /** Prozent, deutsch mit Abstand: "62,5 %". */
    function cfProz(n, stellen, opt) {
        const t = cfZahl(n, stellen === undefined ? 1 : stellen, opt);
        return t === '—' ? t : t + NBSP + '%';
    }

    window.cfGeld = cfGeld;
    window.cfZahl = cfZahl;
    window.cfProz = cfProz;
})();
