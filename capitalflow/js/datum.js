/* CapitalFlow - Datumsfeld im eigenen Stil
 *
 * Das Datumsfeld des Browsers sieht in jedem Browser anders aus: hell-
 * blau markierte Abschnitte beim Tippen, ein grauer Systemkalender, in
 * englischen Browsern "mm/dd/yyyy". Hier wird jedes input[type=date]
 * beim Laden ersetzt durch:
 *
 *   - ein Textfeld fuer TT.MM.JJJJ (tippen geht weiter, auch "5.11.26"
 *     oder "05112026"),
 *   - einen Knopf, der einen Kalender im App-Stil oeffnet.
 *
 * Das urspruengliche Feld bleibt als verstecktes Feld mit derselben id
 * stehen und haelt den Wert weiter als JJJJ-MM-TT. Der restliche Code
 * liest und setzt also genau wie vorher .value - auch Zuweisungen von
 * aussen aktualisieren die Anzeige.
 */
(function () {
    'use strict';

    const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
                    'August', 'September', 'Oktober', 'November', 'Dezember'];
    const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const WERT = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    const zwei = function (n) { return String(n).padStart(2, '0'); };
    function alsIso(d) { return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate()); }
    function ausIso(s) {
        const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    function alsDe(d) { return zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear(); }

    /** "5.11.2026", "05.11.26", "05112026" -> Datum, sonst null */
    function lesen(t) {
        t = String(t || '').trim();
        let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
        if (!m) {
            const z = t.match(/^(\d{2})(\d{2})(\d{4})$/);
            if (z) m = [t, z[1], z[2], z[3]];
        }
        if (!m) return null;
        let j = +m[3];
        if (j < 100) j += 2000;
        const d = new Date(j, +m[2] - 1, +m[1]);
        return d.getFullYear() === j && d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? d : null;
    }

    const SVG_KAL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"/></svg>';
    const SVG_LINKS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
    const SVG_RECHTS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

    let offen = null;          // das gerade offene Feld

    function aufbauen(feld) {
        if (feld.dataset.cfDatum) return;
        feld.dataset.cfDatum = '1';

        const huelle = document.createElement('div');
        huelle.className = 'cf-datum';
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'cf-datum-text';
        text.id = feld.id + 'Anzeige';
        text.placeholder = 'TT.MM.JJJJ';
        text.inputMode = 'numeric';
        text.autocomplete = 'off';
        text.maxLength = 10;
        if (feld.required) text.required = true;
        const knopf = document.createElement('button');
        knopf.type = 'button';
        knopf.className = 'cf-datum-knopf';
        knopf.setAttribute('aria-label', 'Kalender öffnen');
        knopf.setAttribute('aria-expanded', 'false');
        knopf.innerHTML = SVG_KAL;
        const pop = document.createElement('div');
        pop.className = 'cf-datum-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Datum wählen');
        pop.hidden = true;

        document.querySelectorAll('label[for="' + feld.id + '"]').forEach(function (l) { l.htmlFor = text.id; });
        feld.parentNode.insertBefore(huelle, feld);
        feld.type = 'hidden';
        feld.required = false;
        huelle.append(text, knopf, pop, feld);

        let ansicht = new Date();

        function anzeigen() {
            const d = ausIso(WERT.get.call(feld));
            if (document.activeElement !== text || d) text.value = d ? alsDe(d) : '';
            huelle.classList.remove('cf-datum-fehler');
        }

        // .value von aussen setzen aktualisiert die Anzeige mit
        Object.defineProperty(feld, 'value', {
            configurable: true,
            get: function () { return WERT.get.call(this); },
            set: function (v) { WERT.set.call(this, v); anzeigen(); },
        });

        function melden() {
            feld.dispatchEvent(new Event('input', { bubbles: true }));
            feld.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function waehlen(d) {
            WERT.set.call(feld, d ? alsIso(d) : '');
            text.value = d ? alsDe(d) : '';
            huelle.classList.remove('cf-datum-fehler');
            melden();
        }

        function zeichnen() {
            const j = ansicht.getFullYear(), m = ansicht.getMonth();
            const erster = new Date(j, m, 1);
            const versatz = (erster.getDay() + 6) % 7;
            const start = new Date(j, m, 1 - versatz);
            const gewaehlt = WERT.get.call(feld);
            const heute = alsIso(new Date());
            let tage = '';
            for (let i = 0; i < 42; i++) {
                const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                const iso = alsIso(d);
                const kl = ['cf-datum-tag'];
                if (d.getMonth() !== m) kl.push('cf-datum-fremd');
                if (iso === heute) kl.push('cf-datum-heute');
                if (iso === gewaehlt) kl.push('cf-datum-gewaehlt');
                tage += '<button type="button" class="' + kl.join(' ') + '" data-iso="' + iso + '"'
                    + (iso === gewaehlt ? ' aria-pressed="true"' : '')
                    + ' aria-label="' + d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear() + '">'
                    + d.getDate() + '</button>';
            }
            pop.innerHTML = '<div class="cf-datum-kopf">'
                + '<button type="button" class="cf-datum-pfeil" data-schritt="-1" aria-label="Voriger Monat">' + SVG_LINKS + '</button>'
                + '<span class="cf-datum-monat">' + MONATE[m] + ' ' + j + '</span>'
                + '<button type="button" class="cf-datum-pfeil" data-schritt="1" aria-label="Nächster Monat">' + SVG_RECHTS + '</button>'
                + '</div><div class="cf-datum-raster">'
                + TAGE.map(function (t) { return '<span class="cf-datum-wt">' + t + '</span>'; }).join('')
                + tage + '</div><div class="cf-datum-fuss">'
                + '<button type="button" class="cf-datum-aktion" data-aktion="leer">Löschen</button>'
                + '<button type="button" class="cf-datum-aktion" data-aktion="heute">Heute</button></div>';
        }

        function auf() {
            if (offen && offen !== zu) offen();
            ansicht = ausIso(WERT.get.call(feld)) || new Date();
            ansicht = new Date(ansicht.getFullYear(), ansicht.getMonth(), 1);
            zeichnen();
            pop.hidden = false;
            knopf.setAttribute('aria-expanded', 'true');
            huelle.classList.add('cf-datum-offen');
            offen = zu;
            const ziel = pop.querySelector('.cf-datum-gewaehlt') || pop.querySelector('.cf-datum-heute');
            if (ziel) ziel.focus({ preventScroll: true });
        }
        function zu() {
            pop.hidden = true;
            knopf.setAttribute('aria-expanded', 'false');
            huelle.classList.remove('cf-datum-offen');
            if (offen === zu) offen = null;
        }

        knopf.addEventListener('click', function () { pop.hidden ? auf() : zu(); });
        pop.addEventListener('click', function (e) {
            e.stopPropagation();
            const p = e.target.closest('[data-schritt]');
            if (p) {
                ansicht = new Date(ansicht.getFullYear(), ansicht.getMonth() + (+p.dataset.schritt), 1);
                zeichnen();
                return;
            }
            const t = e.target.closest('[data-iso]');
            if (t) { waehlen(ausIso(t.dataset.iso)); zu(); text.focus(); return; }
            const a = e.target.closest('[data-aktion]');
            if (a) { waehlen(a.dataset.aktion === 'heute' ? new Date() : null); zu(); text.focus(); }
        });
        pop.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); zu(); knopf.focus(); return; }
            const t = e.target.closest('[data-iso]');
            const schritt = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
            if (!t || !schritt) return;
            e.preventDefault();
            const d = ausIso(t.dataset.iso);
            d.setDate(d.getDate() + schritt);
            if (d.getMonth() !== ansicht.getMonth()) { ansicht = new Date(d.getFullYear(), d.getMonth(), 1); zeichnen(); }
            const neu = pop.querySelector('[data-iso="' + alsIso(d) + '"]');
            if (neu) neu.focus();
        });

        text.addEventListener('input', function (e) {
            e.stopPropagation();
            const t = text.value.trim();
            const d = lesen(t);
            if (!t) { WERT.set.call(feld, ''); melden(); return; }
            if (d) { WERT.set.call(feld, alsIso(d)); huelle.classList.remove('cf-datum-fehler'); melden(); }
        });
        text.addEventListener('blur', function () {
            const t = text.value.trim();
            if (!t) return;
            const d = lesen(t);
            if (d) { text.value = alsDe(d); huelle.classList.remove('cf-datum-fehler'); }
            else huelle.classList.add('cf-datum-fehler');
        });
        text.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); auf(); }
            if (e.key === 'Escape' && !pop.hidden) zu();
        });

        const form = feld.form;
        if (form) form.addEventListener('reset', function () { setTimeout(anzeigen, 0); });
        anzeigen();
    }

    document.addEventListener('mousedown', function (e) {
        if (offen && !e.target.closest('.cf-datum')) offen();
    });
    document.addEventListener('focusin', function (e) {
        if (offen && !e.target.closest('.cf-datum-offen')) offen();
    });

    window.cfDatumAufbauen = aufbauen;
    function alle() { document.querySelectorAll('input[type="date"]').forEach(aufbauen); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alle);
    else alle();
})();

/* Mausrad ueber einem Zahlenfeld mit Fokus aendert in Chrome den Wert -
 * beim Scrollen durchs Formular wird so aus 100 still 98. Das Feld gibt
 * den Fokus ab, die Seite scrollt normal weiter. */
document.addEventListener('wheel', function (e) {
    const a = document.activeElement;
    if (a && a.type === 'number' && e.target === a) a.blur();
}, { passive: true });
