/* ==========================================================================
   CapitalFlow Basis-JS (M6a)

   Gegenstueck zu css/basis.css fuer alles, was CSS nicht kann:
   - KO-Zone aus dem Abstand bestimmen und die KO-Anzeige als HTML bauen
   - Chart.js-Vorgaben im neuen Look (pro Diagramm, NICHT global - die
     bestehenden Diagramme der App bleiben unberuehrt, bis sie umgestellt werden)

   Legt nur window.cfBasis an. Keine Seiteneffekte beim Laden.
   ========================================================================== */
(function () {
    'use strict';

    // Canvas kann keine CSS-Variablen lesen, deshalb stehen die Werte hier
    // noch einmal. test_basis.mjs prueft, dass sie mit basis.css uebereinstimmen.
    const FARBEN = {
        seite: '#0F1218', karte: '#161A22', erhoben: '#1D222C',
        rand: '#2A303C', randFeld: '#3A4252', gitter: '#232834',
        text: '#E7EAF0', text2: '#A3ACBB', textLeise: '#848D9D',
        gewinnFlaeche: '#12A38F', verlustFlaeche: '#E5484D', warnungFlaeche: '#C98500',
        serie1: '#3987E5', serie2: '#D4A5FF',
    };
    const SCHRIFT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

    // ------------------------------------------------------------ KO-Zone
    // Eine Stelle fuer die Schwellen. Aenderung hier aendert App und Styleguide.
    const KO = { nah: 5, eng: 10, skala: 20 };
    const ZONE_TEXT = {
        nah: 'Nah an der Schwelle', eng: 'Eng', sicher: 'Genug Luft', getroffen: 'Schwelle erreicht',
    };

    function koZone(prozent) {
        if (prozent === null || prozent === undefined || !Number.isFinite(prozent)) return null;
        if (prozent <= 0) return 'getroffen';
        if (prozent < KO.nah) return 'nah';
        if (prozent < KO.eng) return 'eng';
        return 'sicher';
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Deutsche Zahl. Ab 1000 ohne Nachkommastellen (Indexpunkte), darunter immer 2 (Preise).
    function zahl(n, stellen) {
        if (n === null || n === undefined || !Number.isFinite(n)) return '–';
        const s = stellen !== undefined ? stellen : (Math.abs(n) >= 1000 ? 0 : 2);
        return n.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s });
    }

    function prozentText(p) {
        return p.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
    }

    /* KO-Anzeige als HTML.
       d = { prozent, ko, kurs, einheit }  - prozent wie aus cfZert.koAbstand().wert.prozent
       Ist die Schwelle erreicht (prozent <= 0 oder null bei bekanntem KO), zeigt
       die Anzeige das ausdruecklich statt eines leeren Balkens. */
    function koAnzeige(d) {
        d = d || {};
        const einheit = d.einheit ? ' ' + esc(d.einheit) : '';
        const zone = koZone(d.prozent) || 'getroffen';
        const p = zone === 'getroffen' ? 0 : d.prozent;
        const anteil = Math.max(0, Math.min(1, p / KO.skala));
        const wert = zone === 'getroffen' ? 'KO' : prozentText(p);
        const aria = zone === 'getroffen'
            ? 'KO-Schwelle erreicht'
            : prozentText(p).replace(' %', ' Prozent') + ' Abstand zur KO-Schwelle';
        return '<div class="cf-ko" data-zone="' + zone + '" style="--cf-ko-anteil:' + anteil.toFixed(4) + '">' +
            '<div class="cf-ko-kopf"><span class="cf-ko-wert">' + wert + '</span>' +
            '<span class="cf-ko-zone">' + ZONE_TEXT[zone] + '</span></div>' +
            '<div class="cf-ko-skala" role="img" aria-label="' + esc(aria) + '">' +
            '<span class="cf-ko-fuellung"></span><span class="cf-ko-schwelle"></span></div>' +
            '<div class="cf-ko-fuss"><span>KO <b>' + zahl(d.ko) + einheit + '</b></span>' +
            '<span>Kurs <b>' + zahl(d.kurs) + einheit + '</b></span></div>' +
            '</div>';
    }

    // ------------------------------------------------------------ Diagramme
    const FORMATE = {
        eur: n => zahl(n, 0) + ' €',
        eurGenau: n => zahl(n, 2) + ' €',
        eurVorzeichen: n => (n > 0 ? '+' : n < 0 ? '−' : '') +
            Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
        prozent: n => n.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %',
        r: n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' R',
    };
    function formatVon(f) { return typeof f === 'function' ? f : (FORMATE[f] || FORMATE.eur); }

    function istObjekt(x) { return x && typeof x === 'object' && !Array.isArray(x); }
    function mischen(ziel, quelle) {
        if (!istObjekt(quelle)) return ziel;
        for (const k of Object.keys(quelle)) {
            if (istObjekt(quelle[k]) && istObjekt(ziel[k])) mischen(ziel[k], quelle[k]);
            else ziel[k] = quelle[k];
        }
        return ziel;
    }

    function wenigBewegung() {
        return typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /* Beschriftet Werte direkt im Diagramm:
       - Linie: letzter Wert jeder Serie rechts neben dem Linienende,
         Beschriftungen, die sich beruehren wuerden, werden auseinandergeschoben.
       - Balken: Wert neben dem Balkenende.
       Die gezeichneten Kaesten landen in chart.$cfBeschriftungen (fuer Tests). */
    const wertePlugin = {
        id: 'cfWerte',
        afterDatasetsDraw(chart) {
            // Rohe Optionen lesen: Chart.js wuerde eine Format-Funktion sonst als
            // "scriptable option" mit einem Kontext-Objekt aufrufen.
            const roh = (chart.config.options && chart.config.options.plugins) || {};
            const o = roh.cfWerte || {};
            const fmt = formatVon(o.format);
            const ctx = chart.ctx;
            const kaesten = [];
            ctx.save();
            ctx.font = '500 12px ' + SCHRIFT;
            ctx.textBaseline = 'middle';
            if (chart.config.type === 'line') {
                const marken = [];
                chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (meta.hidden || !meta.data.length) return;
                    const letzter = meta.data[meta.data.length - 1];
                    const w = ds.data[ds.data.length - 1];
                    marken.push({ y: letzter.y, x: letzter.x + 8, text: fmt(w), farbe: i === 0 ? FARBEN.text : FARBEN.text2 });
                });
                marken.sort((a, b) => a.y - b.y);
                const ABSTAND = 16;
                for (let i = 1; i < marken.length; i++) {
                    if (marken[i].y - marken[i - 1].y < ABSTAND) {
                        const mitte = (marken[i].y + marken[i - 1].y) / 2;
                        marken[i - 1].y = mitte - ABSTAND / 2;
                        marken[i].y = mitte + ABSTAND / 2;
                    }
                }
                marken.forEach(m => {
                    ctx.fillStyle = m.farbe;
                    ctx.textAlign = 'left';
                    ctx.fillText(m.text, m.x, m.y);
                    const b = ctx.measureText(m.text).width;
                    kaesten.push({ text: m.text, x: m.x, y: m.y - 7, w: b, h: 14 });
                });
            } else if (chart.config.type === 'bar') {
                const quer = chart.options.indexAxis === 'y';
                chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (meta.hidden) return;
                    meta.data.forEach((bar, j) => {
                        const w = ds.data[j];
                        const text = fmt(w);
                        const b = ctx.measureText(text).width;
                        ctx.fillStyle = FARBEN.text;
                        let x, y;
                        if (quer) {
                            // positiv: rechts vom Balken; negativ: rechts von der Nulllinie
                            x = w >= 0 ? bar.x + 8 : bar.base + 8;
                            y = bar.y;
                            ctx.textAlign = 'left';
                            ctx.fillText(text, x, y);
                            kaesten.push({ text, x, y: y - 7, w: b, h: 14 });
                        } else {
                            x = bar.x; y = (w >= 0 ? bar.y - 10 : bar.y + 10);
                            ctx.textAlign = 'center';
                            ctx.fillText(text, x, y);
                            kaesten.push({ text, x: x - b / 2, y: y - 7, w: b, h: 14 });
                        }
                    });
                });
            }
            ctx.restore();
            chart.$cfBeschriftungen = kaesten;
        },
    };

    /* Optionen fuer ein Diagramm im neuen Look.
       art: 'linie' | 'balken-quer'
       einstellungen: { format, extra }  - extra wird tief eingemischt. */
    function diagrammOptionen(art, einstellungen) {
        einstellungen = einstellungen || {};
        const fmt = formatVon(einstellungen.format);
        const quer = art === 'balken-quer';
        const achse = {
            color: FARBEN.textLeise,
            font: { family: SCHRIFT, size: 11 },
        };
        const o = {
            responsive: true,
            maintainAspectRatio: false,
            animation: wenigBewegung() ? false : { duration: 250 },
            layout: { padding: { right: quer ? 88 : 72, top: 8 } },
            interaction: quer ? { mode: 'nearest', axis: 'y', intersect: false } : { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },        // Legende steht als HTML (.cf-legende) darueber
                cfWerte: { format: einstellungen.format || 'eur' },
                tooltip: {
                    backgroundColor: FARBEN.erhoben,
                    borderColor: FARBEN.randFeld,
                    borderWidth: 1,
                    titleColor: FARBEN.text,
                    bodyColor: FARBEN.text2,
                    titleFont: { family: SCHRIFT, size: 13, weight: '600' },
                    bodyFont: { family: SCHRIFT, size: 13 },
                    padding: 10,
                    cornerRadius: 6,
                    caretSize: 0,
                    boxWidth: 8, boxHeight: 8, boxPadding: 4,
                    usePointStyle: true,
                    callbacks: {
                        label: c => ' ' + (c.dataset.label ? c.dataset.label + ': ' : '') +
                            fmt(quer ? c.parsed.x : c.parsed.y),
                    },
                },
            },
            elements: {
                line: { borderWidth: 2, tension: 0, borderJoinStyle: 'round', fill: false },
                point: { radius: 0, hitRadius: 8, hoverRadius: 4, hoverBorderWidth: 2, hoverBorderColor: FARBEN.karte },
                bar: { borderRadius: 3, borderSkipped: false },
            },
            scales: quer ? {
                x: { display: false, grace: '5%' },
                y: { grid: { display: false, drawBorder: false }, ticks: Object.assign({}, achse, { color: FARBEN.text2, font: { family: SCHRIFT, size: 12 } }) },
            } : {
                x: { grid: { display: false, drawBorder: false },
                     ticks: Object.assign({ maxRotation: 0, autoSkip: true, maxTicksLimit: 4 }, achse) },
                y: { grid: { color: FARBEN.gitter, drawBorder: false, drawTicks: false },
                     ticks: Object.assign({ padding: 8, maxTicksLimit: 4, callback: v => fmt(v) }, achse) },
            },
        };
        return mischen(o, einstellungen.extra);
    }

    /* Datensatz fuer Serie 1 oder 2. Mehr als zwei gibt es absichtlich nicht. */
    function serie(nr, label, daten) {
        if (nr !== 1 && nr !== 2) throw new Error('Hoechstens zwei Serien pro Diagramm (Designsprache).');
        const farbe = nr === 1 ? FARBEN.serie1 : FARBEN.serie2;
        return {
            label: label, data: daten,
            borderColor: farbe, backgroundColor: farbe,
            pointBackgroundColor: farbe, pointHoverBackgroundColor: farbe,
            borderDash: nr === 2 ? [5, 4] : [],
        };
    }

    /* Balken, bei denen das Vorzeichen die Aussage ist: gruen/rot. */
    function ergebnisFarben(daten) {
        return daten.map(w => w >= 0 ? FARBEN.gewinnFlaeche : FARBEN.verlustFlaeche);
    }

    const api = {
        FARBEN, SCHRIFT, KO, ZONE_TEXT,
        koZone, koAnzeige, zahl,
        diagrammOptionen, serie, ergebnisFarben, wertePlugin, formate: FORMATE,
    };
    if (typeof window !== 'undefined') window.cfBasis = api;
})();
