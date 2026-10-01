/* ==========================================================================
   Grossansicht fuer Karten in Analytics

   Ein Klick auf das Equity-Diagramm, den Win/Loss-Ring oder eine Karte aus
   "Was deine Zahlen sagen" oeffnet sie gross in einem Fenster. Diagramme
   werden dort neu gezeichnet (eine Kopie einer Canvas waere leer), Tabellen
   und Text werden kopiert.

   Kein Eingriff in die Karten selbst: ein Klick-Handler am Dokument und ein
   kleiner Knopf, der beim Laden in die Karten gesetzt wird.
   ========================================================================== */
(function () {
    'use strict';

    const WAEHLER = '#analytics .aus-karte, #analytics .dashboard-section';

    function istVergroesserbar(karte) {
        if (!karte) return false;
        if (karte.classList.contains('aus-karte')) return true;
        // Bei den grossen Analytics-Karten nur die mit Diagramm
        return !!karte.querySelector('canvas');
    }

    function knopfSetzen() {
        document.querySelectorAll(WAEHLER).forEach(function (k) {
            if (!istVergroesserbar(k) || k.querySelector(':scope > .cf-gross-knopf')) return;
            if (getComputedStyle(k).position === 'static') k.style.position = 'relative';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cf-gross-knopf';
            b.setAttribute('aria-label', 'Vergrößern');
            b.title = 'Vergrößern';
            b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
            k.appendChild(b);
            k.classList.add('cf-vergroesserbar');
        });
    }

    let offen = null;   // { dialog, charts: [] }

    function schliessen() {
        if (!offen) return;
        offen.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
        const d = offen.dialog;
        offen = null;
        if (d.open) d.close();
        d.remove();
    }

    function oeffnen(karte) {
        schliessen();
        const d = document.createElement('dialog');
        d.className = 'cf-dialog cf-gross';
        d.setAttribute('aria-label', 'Großansicht');
        const kopf = document.createElement('div');
        kopf.className = 'cf-gross-kopf';
        const zu = document.createElement('button');
        zu.type = 'button';
        zu.className = 'cf-knopf cf-knopf--leise cf-knopf--klein cf-gross-zu';
        zu.textContent = 'Schließen';
        zu.addEventListener('click', schliessen);
        kopf.appendChild(zu);

        const inhalt = karte.cloneNode(true);
        inhalt.classList.remove('cf-vergroesserbar');
        inhalt.removeAttribute('style');
        inhalt.classList.add('cf-gross-inhalt');
        inhalt.querySelectorAll('.cf-gross-knopf').forEach(function (b) { b.remove(); });
        // Doppelte IDs vermeiden: die Kopie darf nichts vom Original "stehlen"
        inhalt.querySelectorAll('[id]').forEach(function (e) { e.id = e.id + '--gross'; });

        // Diagramme neu zeichnen
        const alt = karte.querySelectorAll('canvas');
        const neu = inhalt.querySelectorAll('canvas');
        const charts = [];
        const plaene = [];
        alt.forEach(function (c, i) {
            const ch = window.Chart && Chart.getChart ? Chart.getChart(c) : null;
            const ziel = neu[i];
            if (!ziel) return;
            const rahmen = document.createElement('div');
            rahmen.className = 'cf-gross-diagramm';
            const leinwand = document.createElement('canvas');
            rahmen.appendChild(leinwand);
            // Der alte Rahmen um die Canvas (feste Hoehe) wird ersetzt
            const huelle = ziel.parentElement && ziel.parentElement !== inhalt && ziel.parentElement.children.length === 1
                ? ziel.parentElement : ziel;
            huelle.replaceWith(rahmen);
            if (ch) plaene.push({ leinwand: leinwand, ch: ch });
        });

        d.appendChild(kopf);
        d.appendChild(inhalt);
        document.body.appendChild(d);
        d.addEventListener('click', function (e) { if (e.target === d) schliessen(); });
        d.addEventListener('close', function () { if (offen && offen.dialog === d) schliessen(); });
        d.showModal();

        plaene.forEach(function (p) {
            const cfg = p.ch.config;
            const daten = JSON.parse(JSON.stringify(cfg.data, function (k, v) { return typeof v === 'function' ? undefined : v; }));
            // Farben, die als Funktion (Verlauf) hinterlegt sind, uebernehmen
            (cfg.data.datasets || []).forEach(function (ds, i) {
                ['backgroundColor', 'borderColor'].forEach(function (f) {
                    if (typeof ds[f] === 'function' && daten.datasets[i]) daten.datasets[i][f] = ds[f];
                });
            });
            const optionen = Object.assign({}, cfg.options, { responsive: true, maintainAspectRatio: false, animation: false });
            try {
                charts.push(new Chart(p.leinwand, { type: cfg.type, data: daten, options: optionen, plugins: cfg.plugins || [] }));
            } catch (e) { /* Diagramm fehlt dann in der Grossansicht, der Rest bleibt */ }
        });
        offen = { dialog: d, charts: charts };
    }

    document.addEventListener('click', function (e) {
        const karte = e.target.closest && e.target.closest(WAEHLER);
        if (!karte || !istVergroesserbar(karte)) return;
        // Klicks auf Bedienelemente in der Karte gehoeren denen
        if (!e.target.closest('.cf-gross-knopf') && e.target.closest('button, a, input, select, textarea, label')) return;
        oeffnen(karte);
    });

    // Karten entstehen erst beim Oeffnen von Analytics: beobachten statt raten
    function beobachten() {
        const a = document.getElementById('analytics');
        if (!a) return;
        knopfSetzen();
        new MutationObserver(function () { knopfSetzen(); }).observe(a, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beobachten);
    else beobachten();

    window.cfGross = { oeffnen: oeffnen, schliessen: schliessen };
})();
