/* Eingeklappte Formulare (Journal, Portfolio, Setups)
 *
 * Oben in jedem Tab steht, was man sehen will: die eigenen Trades,
 * Positionen, Setups. Das Formular zum Eintragen liegt eingeklappt
 * darunter und geht auf Knopfdruck auf - direkt unter dem Knopf, damit
 * man nicht ans Ende einer langen Liste scrollen muss.
 *
 * Von selbst geht es auf, wenn
 *   - ein Eintrag bearbeitet wird (cfAufklapp.auf aus app.js),
 *   - die Liste leer ist und man den Knopf noch nicht selbst benutzt hat
 *     (cfAufklapp.leer) - ein leerer Tab mit zugeklapptem Formular
 *     hiesse "hier gibt es nichts zu tun".
 *
 * Nach dem Speichern klappt es wieder zu, damit der neue Eintrag oben in
 * der Liste sofort zu sehen ist.
 */
(function () {
    'use strict';

    // Wer den Knopf einmal selbst benutzt hat, dem klappt die App nichts
    // mehr ungefragt auf oder zu (nur fuer diese Sitzung).
    const vonHand = {};
    // Von cfAufklapp.leer geoeffnet und noch unberuehrt: nur dann darf es
    // auch von selbst wieder zugehen (etwa wenn die Daten aus der
    // Datenbank nachkommen). Getipptes wird nie weggeklappt.
    const vonSelbst = {};

    function knopfFuer(id) {
        return document.querySelector('.cf-auf-knopf[aria-controls="' + id + '"]');
    }

    function setze(id, offen, opt) {
        const huelle = document.getElementById(id);
        if (!huelle) return;
        opt = opt || {};
        const war = !huelle.hidden;
        huelle.hidden = !offen;
        const k = knopfFuer(id);
        if (k) {
            k.setAttribute('aria-expanded', offen ? 'true' : 'false');
            const t = k.querySelector('.cf-auf-text');
            if (t) t.textContent = offen ? (k.dataset.textOffen || 'Schließen') : (k.dataset.text || '');
        }
        if (offen && !war && !opt.still) {
            huelle.classList.remove('cf-aufklapp-neu');
            void huelle.offsetWidth;            // Animation neu starten
            huelle.classList.add('cf-aufklapp-neu');
        }
        if (offen && opt.fokus !== false && !opt.still) {
            const feld = document.getElementById(opt.fokus || huelle.dataset.fokus || '');
            const r = huelle.getBoundingClientRect();
            if (r.top < 70 || r.top > window.innerHeight * 0.6) {
                huelle.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (feld && opt.fokus !== null) setTimeout(function () { feld.focus({ preventScroll: true }); }, 60);
        }
    }

    document.addEventListener('input', function (e) {
        const h = e.target.closest && e.target.closest('.cf-aufklapp');
        if (h) vonSelbst[h.id] = false;
    });

    document.addEventListener('click', function (e) {
        const k = e.target.closest && e.target.closest('.cf-auf-knopf');
        if (!k) return;
        const id = k.getAttribute('aria-controls');
        const huelle = document.getElementById(id);
        if (!huelle) return;
        vonHand[id] = true;
        vonSelbst[id] = false;
        setze(id, huelle.hidden);
    });

    window.cfAufklapp = {
        auf: function (id, opt) { vonSelbst[id] = false; setze(id, true, opt); },
        zu: function (id) { setze(id, false); },
        istOffen: function (id) { const h = document.getElementById(id); return !!h && !h.hidden; },
        /** Nach dem Rendern einer Liste: leer -> Formular auf, solange
         *  niemand von Hand geklappt hat. Klappt still, ohne Fokus. */
        leer: function (id, istLeer) {
            if (vonHand[id]) return;
            const h = document.getElementById(id);
            if (!h) return;
            if (istLeer && h.hidden) { vonSelbst[id] = true; setze(id, true, { still: true }); }
            else if (!istLeer && !h.hidden && vonSelbst[id]) { vonSelbst[id] = false; setze(id, false); }
        },
        /** Nach erfolgreichem Speichern. */
        gespeichert: function (id) {
            vonSelbst[id] = false;
            setze(id, false);
        },
    };
})();
