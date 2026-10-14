/* CapitalFlow Krypto Terminal - Oberflaeche, Zugang und Feed
 *
 * Zugang: angemeldet (dieselbe Sitzung wie die App), freigeschaltet und
 * VIP oder Admin. Die echte Sperre sitzt in der Datenbank (09_terminal.sql):
 * wer hier im Browser etwas umbiegt, bekommt trotzdem keinen Feed.
 *
 * Feed: Thesen mit Bild oder TradingView-Chart und eingebettete X-Posts.
 * Schreiben darf nur der Admin. Neue Beitraege kommen ueber Supabase
 * Realtime sofort bei allen an.
 */
(function () {
    'use strict';

    const el = function (id) { return document.getElementById(id); };
    const NB = ' ';

    function esc(t) {
        return String(t === null || t === undefined ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(text, fehler) {
        const t = el('tmToast');
        if (!t) return;
        t.textContent = text;
        t.classList.toggle('tm-toast-fehler', !!fehler);
        t.hidden = false;
        clearTimeout(toast.zeit);
        toast.zeit = setTimeout(function () { t.hidden = true; }, Math.max(3200, text.length * 60));
    }

    // ------------------------------------------------------------ Zugang

    let profil = null;

    function tor(text, knoepfe) {
        el('tmTorText').textContent = text;
        el('tmTorKnoepfe').hidden = !knoepfe;
        if (knoepfe) el('tmTor').setAttribute('data-stand', 'hinweis');
    }

    async function zugang() {
        if (!window.cfDb) { tor('Keine Verbindung zur Datenbank.', true); return false; }
        const s = await window.cfSitzung();
        if (!s) { tor('Melde dich zuerst in CapitalFlow an. Danach findest du das Terminal in der Seitenleiste.', true); return false; }
        const { data, error } = await window.cfDb.from('profiles')
            .select('*').eq('id', s.user.id).maybeSingle();
        if (error || !data) { tor('Dein Profil konnte nicht geladen werden.', true); return false; }
        if (!data.activated) { tor('Dein Zugang ist nicht freigeschaltet.', true); return false; }
        if (!(data.is_vip || data.is_admin)) {
            tor('Das Krypto Terminal ist für VIP-Member. Melde dich bei uns, wenn du dazugehören willst.', true);
            return false;
        }
        profil = data;
        return true;
    }

    // ------------------------------------------------------------ Ansicht

    function ansicht(welche) {
        document.querySelector('.tm-raster').setAttribute('data-ansicht', welche);
        try { localStorage.setItem('cf_tm_ansicht', welche); } catch (e) { /* egal */ }
        if (welche === 'feed') { neuGesehen(); }
        window.scrollTo({ top: 0 });
        document.querySelectorAll('.tm-umschalter [data-ansicht]').forEach(function (b) {
            b.setAttribute('aria-selected', b.getAttribute('data-ansicht') === welche ? 'true' : 'false');
        });
    }

    function segment(gruppe, wert, attr) {
        gruppe.querySelectorAll('button').forEach(function (b) {
            b.classList.toggle('aktiv', b.getAttribute(attr) === String(wert));
        });
    }

    // ------------------------------------------------------------ Kurse

    // Kursleiste aus der Coin-Liste bauen. Mausrad scrollt waagerecht.
    function kurseAufbauen() {
        const box = el('tmKurse');
        box.innerHTML = window.cfMarkt.NAMEN.map(function (c) {
            return '<div class="tm-kurs" data-coin="' + c + '">'
                + '<span class="tm-kurs-coin">' + c + '</span>'
                + '<span class="tm-kurs-preis">—</span>'
                + '<span class="tm-kurs-24h">—</span>'
                + '<span class="tm-kurs-funding" title="Funding Rate (Binance Perp)">—</span></div>';
        }).join('');
        el('tmMiniKurse').innerHTML = window.cfMarkt.NAMEN.map(function (c) {
            return '<div class="tm-mini" data-coin="' + c + '"><b>' + c + '</b><span class="tm-mini-preis">—</span><span class="tm-mini-24h">—</span></div>';
        }).join('');
        box.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || box.scrollWidth <= box.clientWidth) return;
            e.preventDefault();
            box.scrollLeft += e.deltaY;
        }, { passive: false });
        const rand = function () {
            const r = box.parentElement;
            r.classList.toggle('tm-mehr-links', box.scrollLeft > 4);
            r.classList.toggle('tm-mehr-rechts', box.scrollLeft + box.clientWidth < box.scrollWidth - 4);
        };
        box.addEventListener('scroll', rand, { passive: true });
        window.addEventListener('resize', rand);
        rand();
    }

    const zuletzt = {};
    function kursZeigen(coin, k) {
        const box = document.querySelector('.tm-kurs[data-coin="' + coin + '"]');
        if (!box || !(k.preis > 0)) return;
        const feld = box.querySelector('.tm-kurs-preis');
        const text = window.cfGeld(k.preis, { waehrung: '$', stellen: window.cfMarkt.COINS[coin].kursStellen });
        if (feld.textContent !== text) {
            feld.textContent = text;
            // Kurz gruen oder rot aufleuchten, je nach Richtung
            const vorher = zuletzt[coin];
            if (vorher) {
                feld.classList.remove('tm-hoch', 'tm-tief');
                void feld.offsetWidth;
                feld.classList.add(k.preis > vorher ? 'tm-hoch' : 'tm-tief');
            }
        }
        zuletzt[coin] = k.preis;
        if (coin === 'BTC') document.title = text + ' BTC – CapitalFlow Krypto Terminal';
        const mini = document.querySelector('.tm-mini[data-coin="' + coin + '"]');
        if (mini) {
            mini.querySelector('.tm-mini-preis').textContent = text;
            if (k.prozent !== null && Number.isFinite(k.prozent)) {
                const m = mini.querySelector('.tm-mini-24h');
                m.textContent = window.cfProz(k.prozent, 2, { vorzeichen: true });
                m.className = 'tm-mini-24h ' + (k.prozent >= 0 ? 'tm-plus' : 'tm-minus');
            }
        }
        if (k.prozent === null || !Number.isFinite(k.prozent)) return;
        const p = box.querySelector('.tm-kurs-24h');
        p.textContent = window.cfProz(k.prozent, 2, { vorzeichen: true });
        p.className = 'tm-kurs-24h ' + (k.prozent >= 0 ? 'tm-plus' : 'tm-minus');
    }
    function fundingZeigen(coin, f) {
        const box = document.querySelector('.tm-kurs[data-coin="' + coin + '"] .tm-kurs-funding');
        if (!box || !Number.isFinite(f.rate)) return;
        box.textContent = 'Funding ' + window.cfProz(f.rate * 100, 4, { vorzeichen: true });
        box.classList.toggle('tm-minus', f.rate < 0);
    }

    const QUELLEN = [['orderbuch', 'Orderbuch'], ['binance', 'Binance'], ['bybit', 'Bybit'], ['okx', 'OKX']];
    const letzte = {};
    function statusZeigen(s) {
        const live = el('tmLive');
        const an = QUELLEN.filter(function (q) { return s[q[0]] === 'live'; }).length;
        live.setAttribute('data-stand', an === QUELLEN.length ? 'live' : an ? 'teil' : 'aus');
        live.querySelector('b').textContent = an === QUELLEN.length ? 'Live' : an ? an + ' von ' + QUELLEN.length + ' live' : 'Getrennt';
        quellenZeigen(s);
    }
    // Pro Boerse: verbunden? letzte Liquidation wann? So sieht man sofort,
    // ob eine Quelle haengt oder es nur gerade ruhig ist.
    let quellenStand = {};
    function quellenZeigen(s) {
        if (s) quellenStand = s;
        const box = el('tmQuellen');
        if (!box) return;
        box.innerHTML = QUELLEN.slice(1).map(function (q) {
            const st = quellenStand[q[0]] || 'verbinde';
            const name = q[1] === 'Binance' ? 'Binance' : q[1];
            const t = letzte[name];
            return '<span class="tm-quelle-punkt" data-stand="' + st + '"><i aria-hidden="true"></i>' + name
                + '<em>' + (st !== 'live' ? (st === 'verbinde' ? 'verbindet' : st === 'fehler' ? 'Abo abgelehnt' : 'getrennt')
                    : t ? 'zuletzt ' + uhr(t).slice(0, 5) : 'verbunden') + '</em></span>';
        }).join('');
    }

    // -------------------------------------------------------- Orderbuch

    const stufen = {};
    const ZEILEN = 10;

    function buchAufbauen() {
        document.querySelectorAll('.tm-buch').forEach(function (karte) {
            const coin = karte.getAttribute('data-coin');
            const c = window.cfMarkt.COINS[coin];
            stufen[coin] = c.stufe;
            const g = karte.querySelector('.tm-stufen');
            g.innerHTML = c.stufen.map(function (s) {
                return '<button type="button" data-stufe="' + s + '"' + (s === c.stufe ? ' class="aktiv"' : '') + '>'
                    + window.cfZahl(s, s < 0.1 ? 2 : s < 1 ? 1 : 0, { min: 0 }) + '</button>';
            }).join('');
            g.addEventListener('click', function (e) {
                const b = e.target.closest('[data-stufe]');
                if (!b) return;
                stufen[coin] = +b.getAttribute('data-stufe');
                segment(g, b.getAttribute('data-stufe'), 'data-stufe');
            });
        });
    }

    function buchZeigen(coin, buch) {
        const karte = document.querySelector('.tm-buch[data-coin="' + coin + '"]');
        if (!karte) return;
        const stufe = stufen[coin];
        const g = window.cfMarkt.gruppieren(buch, stufe, ZEILEN);
        const k = window.cfMarkt.kennzahlen(buch);
        if (!k) return;
        const max = Math.max(g.bids.length ? g.bids[g.bids.length - 1].summe : 0,
                             g.asks.length ? g.asks[g.asks.length - 1].summe : 0) || 1;
        const nk = stufe < 0.1 ? 2 : stufe < 1 ? 1 : 0;
        const mk = window.cfMarkt.COINS[coin].mengeStellen;
        // Groesste Einzelstufe je Seite hervorheben - die "Wand"
        const wand = function (liste) { return liste.reduce(function (a, z) { return z.menge > a ? z.menge : a; }, 0); };
        const zeile = function (z, seite, groesste) {
            return '<div class="tm-buch-zeile tm-' + seite + (z.menge === groesste ? ' tm-wand' : '') + '">'
                + '<i style="width:' + Math.min(100, (z.summe / max) * 100).toFixed(1) + '%"></i>'
                + '<span>' + window.cfZahl(z.preis, nk) + '</span>'
                + '<span>' + window.cfZahl(z.menge, mk) + '</span>'
                + '<span>' + window.cfZahl(z.summe, mk) + '</span></div>';
        };
        const wa = wand(g.asks), wb = wand(g.bids);
        karte.querySelector('.tm-buch-asks').innerHTML = g.asks.slice().reverse().map(function (z) { return zeile(z, 'ask', wa); }).join('');
        karte.querySelector('.tm-buch-bids').innerHTML = g.bids.map(function (z) { return zeile(z, 'bid', wb); }).join('');
        karte.querySelector('.tm-buch-mitte').innerHTML = '<strong>' + window.cfZahl(k.mitte, window.cfMarkt.COINS[coin].preisStellen) + '</strong>'
            + '<span>Spread ' + window.cfZahl(k.spread, 2) + '</span>';
        karte.querySelector('.tm-druck-bid').style.width = (k.druck * 100).toFixed(1) + '%';
        karte.querySelector('.tm-druck-text').innerHTML = '<span class="tm-plus">Käufer ' + window.cfProz(k.druck * 100, 0) + '</span>'
            + '<span>Tiefe ±1' + NB + '%</span><span class="tm-minus">Verkäufer ' + window.cfProz((1 - k.druck) * 100, 0) + '</span>';
    }

    // ---------------------------------------------------- Liquidationen

    let liqZeit = 3600000, liqMin = 0, markt = null;

    function kurzGeld(n) {
        if (n >= 1e6) return window.cfZahl(n / 1e6, 2) + NB + 'Mio.' + NB + '$';
        if (n >= 1e3) return window.cfZahl(n / 1e3, 1) + NB + 'Tsd.' + NB + '$';
        return window.cfZahl(n, 0) + NB + '$';
    }
    function uhr(ms) {
        return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function liqStatsZeigen() {
        if (!markt) return;
        const box = el('tmLiqStats');
        box.innerHTML = window.cfMarkt.BUCH_NAMEN.map(function (coin) {
            const s = markt.liq.summen(coin, liqZeit);
            const gesamt = s.long + s.short;
            const anteil = gesamt ? (s.long / gesamt) * 100 : 50;
            return '<div class="tm-liq-coin">'
                + '<div class="tm-liq-kopf"><strong>' + coin + '</strong><span>' + s.anzahl + ' Liquidationen</span></div>'
                + '<div class="tm-liq-balken" role="img" aria-label="Longs ' + window.cfProz(anteil, 0) + ', Shorts ' + window.cfProz(100 - anteil, 0) + '">'
                +   '<span class="tm-liq-long" style="width:' + anteil.toFixed(1) + '%"></span></div>'
                + '<div class="tm-liq-zahlen">'
                +   '<div><span>Longs liquidiert</span><strong class="tm-minus">' + kurzGeld(s.long) + '</strong></div>'
                +   '<div><span>Shorts liquidiert</span><strong class="tm-plus">' + kurzGeld(s.short) + '</strong></div>'
                +   '<div><span>Größte' + (s.groesste ? ' <b class="' + (s.groesste.seite === 'long' ? 'tm-minus' : 'tm-plus') + '">' + (s.groesste.seite === 'long' ? 'Long' : 'Short') + '</b>' : '') + '</span><strong>' + (s.groesste ? kurzGeld(s.groesste.wert) : '—') + '</strong></div>'
                + '</div></div>';
        }).join('');
        quellenZeigen();
        el('tmLiqSeit').textContent = 'Binance, Bybit, OKX, gezählt seit ' + new Date(markt.liq.seit)
            .toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    function liqZeile(l) {
        const gross = l.wert >= 100000;
        return '<div class="tm-liq-zeile tm-liq-' + l.seite + (gross ? ' tm-liq-gross' : '') + '">'
            + '<span class="tm-liq-zeit">' + uhr(l.zeit) + '</span>'
            + '<span class="tm-liq-coinname">' + l.coin + '</span>'
            + '<span class="tm-liq-seite">' + (l.seite === 'long' ? 'Long' : 'Short') + '</span>'
            + '<span class="tm-liq-wert">' + kurzGeld(l.wert) + '</span>'
            + '<span class="tm-liq-preis">@ ' + window.cfZahl(l.preis, (window.cfMarkt.COINS[l.coin] || {}).kursStellen || 2) + '</span>'
            + '<span class="tm-liq-boerse">' + l.boerse + '</span></div>';
    }

    function liqListeZeigen() {
        if (!markt) return;
        const liste = markt.liq.liste.filter(function (l) { return l.wert >= liqMin; }).slice(0, 60);
        el('tmLiqListe').innerHTML = liste.length ? liste.map(liqZeile).join('')
            : '<p class="tm-leer">' + (liqMin ? 'Noch keine Liquidation in dieser Größe.' : 'Warte auf die erste Liquidation …') + '</p>';
    }

    function neueLiquidation(l) {
        letzte[l.boerse] = Date.now();
        if (l.wert < liqMin) return;
        const box = el('tmLiqListe');
        const leer = box.querySelector('.tm-leer');
        if (leer) box.innerHTML = '';
        box.insertAdjacentHTML('afterbegin', liqZeile(l));
        const neu = box.firstElementChild;
        neu.classList.add('tm-neu');
        while (box.children.length > 60) box.lastElementChild.remove();
    }

    // ------------------------------------------------ Liquidations-Heatmap

    const HEAT_SPALTEN = { 900000: 30, 3600000: 30, 14400000: 48 };
    let heatFenster = 3600000, heatDaten = null;

    // Farbe: Rot = mehr Longs liquidiert, Gruen = mehr Shorts, gemischt
    // geht zum neutralen Grau. Helligkeit = Volumen (log), damit eine
    // einzelne Riesen-Liquidation nicht alles andere ausblendet.
    const ROT = [251, 113, 133], GRUEN = [52, 211, 153], GRAU = [161, 161, 170];
    function heatFarbe(z, max) {
        const ges = z.long + z.short;
        if (!ges) return '';
        const d = (z.long - z.short) / ges;
        const pol = d >= 0 ? ROT : GRUEN, a = Math.abs(d);
        const c = pol.map(function (v, i) { return Math.round(GRAU[i] + (v - GRAU[i]) * a); });
        const st = Math.log10(1 + ges) / Math.log10(1 + Math.max(max, 1));
        return 'rgba(' + c.join(',') + ',' + (0.18 + 0.82 * st).toFixed(2) + ')';
    }

    let heatGruppe = 'coin';
    function heatZeigen() {
        if (!markt) return;
        const raster = heatGruppe === 'raster';
        el('tmHeatRaster').hidden = !raster;
        el('tmHeatKacheln').hidden = raster;
        if (raster) rasterZeigen(); else kachelnZeigen();
        gesamtZeigen();
    }

    // ------------------------------------------- Kacheln (Treemap)
    //
    // Squarified Treemap: Flaeche = liquidierter Betrag, Farbe = was
    // ueberwiegt (Rot: Longs, Gruen: Shorts, Grau: ausgeglichen).

    function squarify(werte, x, y, b, h) {
        const aus = [];
        const summe = werte.reduce(function (n, w) { return n + w.wert; }, 0);
        if (!summe) return aus;
        const skala = (b * h) / summe;
        let rest = werte.map(function (w) { return { w: w, flaeche: w.wert * skala }; });
        function schlechtestes(reihe, seite) {
            const s2 = reihe.reduce(function (n, r) { return n + r.flaeche; }, 0);
            let max = 0, min = Infinity;
            reihe.forEach(function (r) { max = Math.max(max, r.flaeche); min = Math.min(min, r.flaeche); });
            return Math.max((seite * seite * max) / (s2 * s2), (s2 * s2) / (seite * seite * min));
        }
        function legen(reihe) {
            const s2 = reihe.reduce(function (n, r) { return n + r.flaeche; }, 0);
            if (b >= h) {
                const breite = s2 / h; let yy = y;
                reihe.forEach(function (r) { const hh = r.flaeche / breite; aus.push({ w: r.w, x: x, y: yy, b: breite, h: hh }); yy += hh; });
                x += breite; b -= breite;
            } else {
                const hoehe = s2 / b; let xx = x;
                reihe.forEach(function (r) { const bb = r.flaeche / hoehe; aus.push({ w: r.w, x: xx, y: y, b: bb, h: hoehe }); xx += bb; });
                y += hoehe; h -= hoehe;
            }
        }
        let reihe = [];
        while (rest.length) {
            const seite = Math.min(b, h);
            const naechste = rest[0];
            if (!reihe.length || schlechtestes(reihe.concat([naechste]), seite) <= schlechtestes(reihe, seite)) {
                reihe.push(naechste); rest.shift();
            } else { legen(reihe); reihe = []; }
        }
        if (reihe.length) legen(reihe);
        return aus;
    }

    const K_ROT = [222, 62, 98], K_GRUEN = [14, 168, 120], K_GRAU = [72, 70, 92];
    function kachelFarbe(long, short) {
        const ges = long + short;
        const d = ges ? (long - short) / ges : 0;
        // Schon 60/40 soll klar farbig sein: Abstand zur Mitte verstaerkt
        const pol = d >= 0 ? K_ROT : K_GRUEN, a = Math.min(1, Math.sqrt(Math.abs(d)) * 1.15);
        return 'rgb(' + pol.map(function (v, i) { return Math.round(K_GRAU[i] + (v - K_GRAU[i]) * a); }).join(',') + ')';
    }

    let kachelDaten = {};
    function kachelnZeigen() {
        const box = el('tmHeatKacheln');
        const r = markt.liq.auswerten(heatFenster);
        const quelle = heatGruppe === 'boerse' ? r.boersen : r.coins;
        const werte = Object.keys(quelle).map(function (k) {
            const q = quelle[k];
            return { name: k, wert: q.long + q.short, long: q.long, short: q.short, anzahl: q.anzahl };
        }).filter(function (w) { return w.wert > 0; }).sort(function (a, b) { return b.wert - a.wert; });
        kachelDaten = { werte: werte, gesamt: r.long + r.short };
        const ges = r.long + r.short;
        el('tmHeatStand').textContent = ges ? kurzGeld(ges) + ' liquidiert, ' + r.anzahl + ' Liquidationen' : 'Warte auf Liquidationen …';
        if (!werte.length) { if (!box.querySelector('.tm-leer')) box.innerHTML = '<p class="tm-leer">Noch keine Liquidationen in diesem Zeitraum.</p>'; return; }
        const B = box.clientWidth || 800, H = box.clientHeight || 420;
        const rects = squarify(werte, 0, 0, B, H);
        // Vorhandene Kacheln weiterverwenden: nur Lage, Groesse und Farbe
        // aendern sich (weich per CSS), neue blenden einmal ein. Sonst
        // wuerde alle 2 s alles neu aufflackern.
        const leer = box.querySelector('.tm-leer');
        if (leer) leer.remove();
        const da = {};
        box.querySelectorAll('.tm-kachel').forEach(function (k) { da[k.getAttribute('data-name')] = k; });
        rects.forEach(function (q) {
            const w = q.w, gross = q.b > 150 && q.h > 100, mittel = q.b > 74 && q.h > 46, klein = q.b > 34 && q.h > 20;
            const lAnteil = Math.round((w.long / w.wert) * 100);
            const ueber = w.long >= w.short ? 'Long ' + lAnteil + ' %' : 'Short ' + (100 - lAnteil) + ' %';
            const groesse = gross ? Math.max(18, Math.min(42, Math.sqrt(q.b * q.h) / 6)) : 0;
            let k = da[w.name];
            if (!k) {
                k = document.createElement('div');
                k.setAttribute('data-name', w.name);
                box.appendChild(k);
            }
            delete da[w.name];
            k.className = 'tm-kachel' + (gross ? ' tm-kachel-gross' : mittel ? ' tm-kachel-mittel' : '');
            k.style.left = q.x.toFixed(1) + 'px'; k.style.top = q.y.toFixed(1) + 'px';
            k.style.width = q.b.toFixed(1) + 'px'; k.style.height = q.h.toFixed(1) + 'px';
            k.style.background = kachelFarbe(w.long, w.short);
            if (groesse) k.style.setProperty('--gr', groesse.toFixed(0) + 'px'); else k.style.removeProperty('--gr');
            const html = (klein ? '<b>' + esc(w.name) + '</b>' : '') + (mittel ? '<strong>' + kurzGeld(w.wert) + '</strong>' : '') + (gross ? '<span>' + ueber + '</span>' : '');
            if (k.innerHTML !== html) k.innerHTML = html;
        });
        Object.keys(da).forEach(function (n) { da[n].remove(); });
    }

    function kachelTipp(e) {
        const k = e.target.closest('.tm-kachel');
        const tipp = el('tmHeatTipp');
        if (!k) { tipp.hidden = true; return; }
        const w = (kachelDaten.werte || []).find(function (x) { return x.name === k.getAttribute('data-name'); });
        if (!w) { tipp.hidden = true; return; }
        tipp.innerHTML = '<strong>' + esc(w.name) + '</strong> <span>' + kurzGeld(w.wert) + ', ' + Math.round((w.wert / kachelDaten.gesamt) * 100) + ' % der Summe</span>'
            + '<div><em class="tm-minus">Longs ' + kurzGeld(w.long) + '</em><em class="tm-plus">Shorts ' + kurzGeld(w.short) + '</em></div>'
            + '<span>' + w.anzahl + (w.anzahl === 1 ? ' Liquidation' : ' Liquidationen') + '</span>';
        tipp.hidden = false;
        const karte = el('tmHeat').getBoundingClientRect(), r = k.getBoundingClientRect();
        tipp.style.left = Math.min(Math.max(r.left + r.width / 2 - karte.left, 110), karte.width - 110) + 'px';
        tipp.style.top = Math.max(r.top - karte.top + 18, 70) + 'px';
    }

    // ------------------------------------------- Gesamtliquidationen

    const GESAMT_FENSTER = [['15 Min', 900000], ['1 Std', 3600000], ['4 Std', 14400000], ['Seit Öffnen', 0]];
    function gesamtZeigen() {
        if (!markt) return;
        const kacheln = GESAMT_FENSTER.map(function (f) {
            let long = 0, short = 0;
            if (f[1]) { const r = markt.liq.auswerten(f[1]); long = r.long; short = r.short; }
            else markt.liq.liste.forEach(function (l) { if (l.seite === 'long') long += l.wert; else short += l.wert; });
            const ges = long + short, anteil = ges ? (long / ges) * 100 : 50;
            return '<div class="tm-gesamt-kachel">'
                + '<div class="tm-gesamt-kopf"><span>' + f[0] + '</span><strong>' + (ges ? kurzGeld(ges) : '—') + '</strong></div>'
                + '<dl><div><dt>Long</dt><dd class="tm-minus">' + kurzGeld(long) + '</dd></div><div><dt>Short</dt><dd class="tm-plus">' + kurzGeld(short) + '</dd></div></dl>'
                + '<span class="tm-gesamt-balken" role="img" aria-label="Long ' + Math.round(anteil) + ' %"><i style="width:' + anteil.toFixed(1) + '%"></i></span>'
                + '</div>';
        });
        el('tmGesamtFenster').innerHTML = kacheln.join('');

        const r = markt.liq.auswerten(14400000);
        const ges = r.long + r.short;
        if (!ges) { el('tmGesamtMehr').innerHTML = '<p class="tm-leer">Noch keine Liquidationen in den letzten 4 Std.</p>'; return; }
        const lP = (r.long / ges) * 100;
        const boersen = Object.keys(r.boersen).map(function (k) { return [k, r.boersen[k].long + r.boersen[k].short]; })
            .sort(function (a, b) { return b[1] - a[1]; });
        const g = r.groesste;
        el('tmGesamtMehr').innerHTML =
            '<p class="tm-gesamt-satz">In den letzten 4 Std. gesehen: <b>' + r.anzahl + ' Liquidationen</b> über zusammen <b>' + kurzGeld(ges) + '</b>.</p>'
            + '<div class="tm-gesamt-zeile"><span>Verteilung, 4 Std.</span></div>'
            + '<div class="tm-gesamt-vert"><span class="tm-minus">Long <b>' + window.cfProz(lP, 1) + '</b></span><span class="tm-plus">Short <b>' + window.cfProz(100 - lP, 1) + '</b></span></div>'
            + '<span class="tm-gesamt-balken tm-gesamt-balken-dick"><i style="width:' + lP.toFixed(1) + '%"></i></span>'
            + '<div class="tm-gesamt-zeile"><span>Größter Börsenanteil</span><b>' + esc(boersen[0][0]) + ' ' + window.cfProz((boersen[0][1] / ges) * 100, 1) + '</b></div>'
            + '<div class="tm-gesamt-zeile tm-gesamt-groesste"><span>Größte Liquidation, 4 Std.</span><strong>' + kurzGeld(g.wert) + '</strong></div>'
            + '<p class="tm-gesamt-detail">' + esc(g.boerse) + ', ' + g.coin + ' ' + (g.seite === 'long' ? 'Long' : 'Short') + ' @ '
            + window.cfZahl(g.preis, (window.cfMarkt.COINS[g.coin] || {}).kursStellen || 2) + ', ' + uhr(g.zeit).slice(0, 5) + ' Uhr</p>';
    }

    function rasterZeigen() {
        const coins = window.cfMarkt.NAMEN;
        const spalten = HEAT_SPALTEN[heatFenster];
        const r = markt.liq.raster(coins, heatFenster, spalten);
        heatDaten = r;
        const zeilen = coins.map(function (c) {
            const sm = r.summe[c], ges = sm.long + sm.short;
            const anteil = ges ? (sm.long / ges) * 100 : 50;
            return '<div class="tm-heat-zeile" data-coin="' + c + '">'
                + '<span class="tm-heat-coin">' + c + '</span>'
                + '<div class="tm-heat-zellen" style="--spalten:' + spalten + '">'
                + r.zellen[c].map(function (z, i) {
                    const f = heatFarbe(z, r.max);
                    return '<i data-i="' + i + '"' + (f ? ' style="background:' + f + '"' + (z.long + z.short >= r.max * 0.6 && r.max > 0 ? ' class="tm-heat-spitze"' : '') : '') + '></i>';
                }).join('')
                + '</div>'
                + '<span class="tm-heat-summe">' + (ges ? '<b>' + kurzGeld(ges) + '</b>'
                    + '<span class="tm-heat-ls" title="Longs ' + Math.round(anteil) + ' %"><i style="width:' + anteil.toFixed(0) + '%"></i></span>' : '<em>—</em>') + '</span>'
                + '</div>';
        }).join('');
        const zeit = function (ms) { return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
        el('tmHeatRaster').innerHTML = zeilen
            + '<div class="tm-heat-achse"><span></span><div><span>' + zeit(r.start) + '</span><span>' + zeit(r.start + (r.schritt * spalten) / 2) + '</span><span>jetzt</span></div><span></span></div>';
        const gesamt = coins.reduce(function (n, c) { return n + r.summe[c].long + r.summe[c].short; }, 0);
        el('tmHeatStand').textContent = gesamt ? kurzGeld(gesamt) + ' liquidiert, Binance, Bybit, OKX' : 'Warte auf Liquidationen …';
    }

    function heatTipp(e) {
        const zelle = e.target.closest('.tm-heat-zellen i');
        const tipp = el('tmHeatTipp');
        if (!zelle || !heatDaten) { tipp.hidden = true; return; }
        const coin = zelle.closest('.tm-heat-zeile').getAttribute('data-coin');
        const i = +zelle.getAttribute('data-i');
        const z = heatDaten.zellen[coin][i];
        const von = heatDaten.start + i * heatDaten.schritt;
        const uhrz = function (ms) { return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
        tipp.innerHTML = '<strong>' + coin + '</strong> <span>' + uhrz(von) + '–' + uhrz(von + heatDaten.schritt) + '</span>'
            + (z.anzahl ? '<div><em class="tm-minus">Longs ' + kurzGeld(z.long) + '</em><em class="tm-plus">Shorts ' + kurzGeld(z.short) + '</em></div>'
                + '<span>' + z.anzahl + (z.anzahl === 1 ? ' Liquidation' : ' Liquidationen') + '</span>'
                : '<div><span>Keine Liquidation</span></div>');
        tipp.hidden = false;
        const karte = el('tmHeat').getBoundingClientRect(), r = zelle.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2 - karte.left, 90), karte.width - 90);
        tipp.style.left = x + 'px';
        tipp.style.top = (r.top - karte.top - 8) + 'px';
    }

    // ----------------------------------------------- Liquidationshistorie
    //
    // Unten: Long-Liquidationen nach oben, Short nach unten (eine Achse,
    // Null in der Mitte). Darueber ein eigenes Feld mit der Kurslinie -
    // bewusst keine zweite Achse im selben Bild.

    const HIST = {
        3600000: { spalten: 30, kerze: '1m', kerzen: 60, text: '2 Min. je Balken' },
        14400000: { spalten: 24, kerze: '5m', kerzen: 48, text: '10 Min. je Balken' },
        43200000: { spalten: 24, kerze: '15m', kerzen: 48, text: '30 Min. je Balken' },
    };
    let histFenster = 3600000, histCoin = 'alle', histKerzen = [], histBild = null;
    const kerzenCache = {};

    function histCoinsAufbauen() {
        el('tmHistCoins').innerHTML = ['alle'].concat(window.cfMarkt.NAMEN).map(function (c) {
            return '<button type="button" class="tm-chip' + (c === histCoin ? ' aktiv' : '') + '" data-coin="' + c + '">' + (c === 'alle' ? 'Alle Coins' : c) + '</button>';
        }).join('');
    }

    async function histKerzenLaden() {
        histKerzenFehler = false;
        const coin = histCoin === 'alle' ? 'BTC' : histCoin;
        const h = HIST[histFenster];
        const key = coin + h.kerze;
        el('tmHistKursName').textContent = coin;
        const c = kerzenCache[key];
        if (c && Date.now() - c.zeit < 60000) { histKerzen = c.daten; histZeichnen(); return; }
        try {
            const daten = await window.cfMarkt.kerzenHolen(coin, h.kerze, h.kerzen);
            if (daten.length) kerzenCache[key] = { zeit: Date.now(), daten: daten };
            else histKerzenFehler = true;
            if ((histCoin === 'alle' ? 'BTC' : histCoin) === coin && HIST[histFenster].kerze === h.kerze) histKerzen = daten;
        } catch (e) { histKerzen = []; histKerzenFehler = true; }
        histZeichnen();
    }
    let histKerzenFehler = false;

    function histZeichnen() {
        if (!markt) return;
        const box = el('tmHistGrafik');
        const h = HIST[histFenster], n = h.spalten;
        const jetzt = Date.now(), start = jetzt - histFenster, schritt = histFenster / n;
        const eimer = [];
        for (let i = 0; i < n; i++) eimer.push({ long: 0, short: 0, anzahl: 0, von: start + i * schritt });
        let frueh = markt.liq.seit;
        markt.liq.alle().forEach(function (e) {
            const l = e.l;
            if (histCoin !== 'alle' && l.coin !== histCoin) return;
            if (l.alt && l.zeit < frueh) frueh = l.zeit;
            if (e.t < start || e.t > jetzt) return;
            const z = eimer[Math.min(n - 1, Math.floor((e.t - start) / schritt))];
            z[l.seite] += l.wert; z.anzahl++;
        });
        const B = Math.max(280, box.clientWidth || 800), H = 300;
        const L = 64, R = 70, oben = 8, kursH = 78, luecke = 18, balkenOben = oben + kursH + luecke, balkenH = H - balkenOben - 24;
        const mitte = balkenOben + balkenH / 2, breite = B - L - R, slot = breite / n;
        const max = Math.max(1, eimer.reduce(function (m, z) { return Math.max(m, z.long, z.short); }, 0));
        const y = function (v) { return (v / max) * (balkenH / 2 - 4); };
        const xZeit = function (t) { return L + ((t - start) / histFenster) * breite; };
        let svg = '';
        // Bereich ohne Daten (vor der fruehesten bekannten Liquidation)
        if (frueh > start) {
            const xf = Math.min(L + breite, xZeit(frueh));
            svg += '<rect class="tm-hist-leer" x="' + L + '" y="' + balkenOben + '" width="' + (xf - L).toFixed(1) + '" height="' + balkenH + '"/>'
                + (xf - L > 90 ? '<text class="tm-hist-leer-text" x="' + ((L + xf) / 2).toFixed(1) + '" y="' + (mitte + 4).toFixed(1) + '" text-anchor="middle">keine Daten</text>' : '');
        }
        // Gitter + Achse
        [max, max / 2, 0, max / 2, max].forEach(function (v, i) {
            const yy = balkenOben + 4 + (i * (balkenH - 8)) / 4;
            svg += '<line class="tm-hist-gitter' + (i === 2 ? ' tm-hist-null' : '') + '" x1="' + L + '" x2="' + (L + breite) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>'
                + '<text class="tm-hist-achse" x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + (i === 2 ? '0' : kurzGeld(v).replace(/\s\$$/, '').replace(/ \$$/, '')) + '</text>';
        });
        // Balken: Long nach oben (rot), Short nach unten (gruen)
        const bb = Math.max(2, Math.min(18, slot * 0.62));
        eimer.forEach(function (z, i) {
            const x = L + i * slot + (slot - bb) / 2;
            if (z.long) { const hh = Math.max(2, y(z.long)); svg += '<rect class="tm-hist-long" x="' + x.toFixed(1) + '" y="' + (mitte - hh).toFixed(1) + '" width="' + bb.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2"/>'; }
            if (z.short) { const hh = Math.max(2, y(z.short)); svg += '<rect class="tm-hist-short" x="' + x.toFixed(1) + '" y="' + mitte.toFixed(1) + '" width="' + bb.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2"/>'; }
        });
        // Kurslinie im eigenen Feld
        const k = histKerzen.filter(function (p) { return p.ende >= start; });
        if (k.length > 1) {
            let lo = Infinity, hi = -Infinity;
            k.forEach(function (p) { lo = Math.min(lo, p.preis); hi = Math.max(hi, p.preis); });
            const spanne = hi - lo || hi * 0.001 || 1;
            const yk = function (p) { return oben + 6 + (1 - (p - lo) / spanne) * (kursH - 12); };
            const punkte = k.map(function (p) { return Math.max(L, Math.min(L + breite, xZeit(Math.min(p.ende, jetzt)))).toFixed(1) + ',' + yk(p.preis).toFixed(1); });
            const coin = histCoin === 'alle' ? 'BTC' : histCoin, st = (window.cfMarkt.COINS[coin] || {}).kursStellen || 2;
            svg += '<rect class="tm-hist-kursfeld" x="' + L + '" y="' + oben + '" width="' + breite + '" height="' + kursH + '" rx="8"/>'
                + '<polyline class="tm-hist-kurs" points="' + punkte.join(' ') + '"/>'
                + '<text class="tm-hist-achse" x="' + (L + breite + 8) + '" y="' + (oben + 14) + '">' + window.cfZahl(hi, st) + '</text>'
                + '<text class="tm-hist-achse" x="' + (L + breite + 8) + '" y="' + (oben + kursH - 4) + '">' + window.cfZahl(lo, st) + '</text>';
        } else {
            svg += '<text class="tm-hist-leer-text" x="' + (L + breite / 2) + '" y="' + (oben + kursH / 2 + 4) + '" text-anchor="middle">' + (histKerzenFehler ? 'Kurs gerade nicht erreichbar' : 'Kurs wird geladen …') + '</text>';
        }
        // Zeitachse
        const zeit = function (ms) { return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
        [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
            const t = start + f * histFenster;
            svg += '<text class="tm-hist-achse" x="' + (L + f * breite).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + (f === 1 ? 'jetzt' : zeit(t)) + '</text>';
        });
        svg += '<line class="tm-hist-marke" id="tmHistMarke" x1="0" x2="0" y1="' + oben + '" y2="' + (balkenOben + balkenH) + '" visibility="hidden"/>';
        box.innerHTML = '<svg viewBox="0 0 ' + B + ' ' + H + '" width="' + B + '" height="' + H + '" role="img" aria-label="Liquidationshistorie">' + svg + '</svg>';
        histBild = { eimer: eimer, L: L, slot: slot, n: n, schritt: schritt, start: start, frueh: frueh };
        const sl = eimer.reduce(function (s2, z) { return s2 + z.long; }, 0), ss = eimer.reduce(function (s2, z) { return s2 + z.short; }, 0);
        el('tmHistStand').textContent = (sl + ss) ? 'Long ' + kurzGeld(sl) + ', Short ' + kurzGeld(ss) : 'Noch keine Liquidationen im Zeitraum';
        el('tmHistHinweis').textContent = h.text + '. Daten ab ' + zeit(Math.max(frueh, start)) + ' Uhr' + (frueh > markt.liq.seit - 1000 ? '' : ', vor dem Öffnen nur OKX') + '.';
    }

    function histTipp(e) {
        const tipp = el('tmHistTipp'), marke = document.getElementById('tmHistMarke');
        if (!histBild || !marke) return;
        const svgR = el('tmHistGrafik').querySelector('svg').getBoundingClientRect();
        const x = e.clientX - svgR.left;
        const i = Math.floor((x - histBild.L) / histBild.slot);
        if (i < 0 || i >= histBild.n) { tipp.hidden = true; marke.setAttribute('visibility', 'hidden'); return; }
        const z = histBild.eimer[i];
        const mx = histBild.L + (i + 0.5) * histBild.slot;
        marke.setAttribute('x1', mx); marke.setAttribute('x2', mx); marke.setAttribute('visibility', 'visible');
        const uhrz = function (ms) { return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
        const kerze = histKerzen.filter(function (k) { return k.t <= z.von + histBild.schritt; }).pop();
        const coin = histCoin === 'alle' ? 'BTC' : histCoin;
        tipp.innerHTML = '<strong>' + uhrz(z.von) + '–' + uhrz(z.von + histBild.schritt) + '</strong>'
            + (z.von + histBild.schritt < histBild.frueh ? '<div><span>keine Daten</span></div>'
                : '<div><em class="tm-minus">Longs ' + kurzGeld(z.long) + '</em><em class="tm-plus">Shorts ' + kurzGeld(z.short) + '</em></div>')
            + (kerze ? '<span>' + coin + ' ' + window.cfGeld(kerze.preis, { waehrung: '$', stellen: (window.cfMarkt.COINS[coin] || {}).kursStellen || 2 }) + '</span>' : '');
        tipp.hidden = false;
        const karte = el('tmHist').getBoundingClientRect();
        tipp.style.left = Math.min(Math.max(svgR.left - karte.left + (mx / svgR.width) * svgR.width, 110), karte.width - 110) + 'px';
        tipp.style.top = (svgR.top - karte.top + 30) + 'px';
    }

    // ------------------------------------------------------ Fear & Greed

    async function fng() {
        try {
            const d = await window.cfMarkt.fngHolen();
            if (!d || !d.heute) throw new Error('leer');
            const w = d.heute.wert;
            el('tmFngZahl').textContent = String(w);
            el('tmFngText').textContent = d.heute.text;
            // Zeiger auf dem Halbkreis: 0 links, 100 rechts
            const winkel = Math.PI * (1 - w / 100);
            const z = el('tmFngZeiger');
            z.setAttribute('cx', (100 + 84 * Math.cos(winkel)).toFixed(1));
            z.setAttribute('cy', (100 - 84 * Math.sin(winkel)).toFixed(1));
            el('tmFng').setAttribute('data-stufe', w < 25 ? 'angst-x' : w < 45 ? 'angst' : w <= 55 ? 'neutral' : w <= 75 ? 'gier' : 'gier-x');
            const reihe = el('tmFngReihe');
            if (reihe && d.reihe && d.reihe.length) {
                reihe.innerHTML = d.reihe.map(function (v, i) {
                    const farbe = v < 25 ? '#FB7185' : v < 45 ? '#FDA4AF' : v <= 55 ? '#FBBF24' : v <= 75 ? '#6EE7B7' : '#34D399';
                    return '<i style="height:' + Math.max(6, v) + '%;background:' + farbe + '" title="' + v + '"></i>';
                }).join('');
            }
            const mini = el('tmMiniFng');
            if (mini) {
                mini.querySelector('strong').textContent = String(w);
                mini.querySelector('span').textContent = d.heute.text;
                mini.querySelector('i').style.left = w + '%';
                mini.setAttribute('data-stufe', el('tmFng').getAttribute('data-stufe'));
            }
            el('tmFngVerlauf').innerHTML = [['Gestern', d.gestern], ['Vor einer Woche', d.woche], ['Vor einem Monat', d.monat]]
                .filter(function (x) { return x[1]; })
                .map(function (x) { return '<div><dt>' + x[0] + '</dt><dd><strong>' + x[1].wert + '</strong> ' + esc(x[1].text) + '</dd></div>'; }).join('');
        } catch (e) {
            el('tmFngText').textContent = 'gerade nicht erreichbar';
        }
    }

    // ------------------------------------------------------------- Feed

    const BILD_TTL = 3600;
    let posts = [];

    function tvBild(url) {
        const m = String(url || '').match(/^https:\/\/(?:www\.)?tradingview\.com\/x\/([A-Za-z0-9]{6,12})\/?/);
        return m ? 'https://s3.tradingview.com/snapshots/' + m[1].charAt(0).toLowerCase() + '/' + m[1] + '.png' : null;
    }
    function tweetTeile(url) {
        const m = String(url || '').match(/^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/);
        return m ? { name: m[1], id: m[2], url: 'https://twitter.com/' + m[1] + '/status/' + m[2] } : null;
    }
    function verlinken(text) {
        return esc(text).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\n/g, '<br>');
    }
    function wann(iso) {
        const s = (Date.now() - new Date(iso).getTime()) / 1000;
        if (s < 60) return 'gerade eben';
        if (s < 3600) return 'vor ' + Math.floor(s / 60) + ' Min.';
        if (s < 86400) return 'vor ' + Math.floor(s / 3600) + ' Std.';
        return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            + ', ' + new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    function xErlaubt() { try { return localStorage.getItem('cf_x_erlaubt') === '1'; } catch (e) { return false; } }

    function postHtml(p, bilder) {
        const admin = profil && profil.is_admin;
        const richtung = p.richtung ? { long: 'Long', short: 'Short', neutral: 'Neutral' }[p.richtung] : '';
        const chart = tvBild(p.chart_url);
        const tw = tweetTeile(p.tweet_url);
        let medien = '';
        if (bilder[p.id]) medien += '<a class="tm-post-bild" href="' + esc(bilder[p.id]) + '" target="_blank" rel="noopener"><img src="' + esc(bilder[p.id]) + '" alt="Bild zur These" loading="lazy"></a>';
        if (chart) medien += '<a class="tm-post-bild" href="' + esc(p.chart_url) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(chart) + '" alt="Chart zur These" loading="lazy" referrerpolicy="no-referrer"></a>';
        else if (p.chart_url) medien += '<a class="tm-post-link" href="' + esc(p.chart_url) + '" target="_blank" rel="noopener noreferrer">Chart öffnen</a>';
        if (tw) {
            medien += xErlaubt()
                ? '<div class="tm-tweet" data-tweet="' + esc(tw.url) + '"><blockquote class="twitter-tweet" data-theme="dark" data-dnt="true"><a href="' + esc(tw.url) + '">Post von @' + esc(tw.name) + '</a></blockquote></div>'
                : '<div class="tm-tweet tm-tweet-zu"><div><strong>Post von @' + esc(tw.name) + '</strong>'
                  + '<span>Wird von X geladen. Dabei gehen Daten an X.</span></div>'
                  + '<button type="button" class="tm-knopf tm-knopf-leise" data-x-erlauben>X-Posts anzeigen</button>'
                  + '<a href="' + esc(tw.url) + '" target="_blank" rel="noopener noreferrer">Auf X öffnen</a></div>';
        }
        return '<article class="tm-post' + (p.angeheftet ? ' tm-angeheftet' : '') + '" data-id="' + esc(p.id) + '">'
            + '<header class="tm-post-kopf">'
            +   '<img src="logo/terminal-icon.svg" alt="" width="28" height="28">'
            +   '<div><strong>CapitalFlow</strong><span>' + esc(wann(p.created_at)) + (p.angeheftet ? ', angeheftet' : '') + '</span></div>'
            +   '<div class="tm-post-tags">'
            +     (p.coin && p.art === 'these' ? '<span class="tm-tag">' + (p.coin === 'ALLGEMEIN' ? 'Allgemein' : p.coin) + '</span>' : '')
            +     (richtung && p.art === 'these' ? '<span class="tm-tag tm-tag-' + p.richtung + '">' + richtung + '</span>' : '')
            +     (p.art === 'tweet' ? '<span class="tm-tag">X</span>' : '')
            +   '</div>'
            + '</header>'
            + (p.titel ? '<h3 class="tm-post-titel">' + esc(p.titel) + '</h3>' : '')
            + (p.text ? '<p class="tm-post-text">' + verlinken(p.text) + '</p>' : '')
            + medien
            + (admin ? '<footer class="tm-post-aktionen">'
                + '<button type="button" data-aktion="anheften">' + (p.angeheftet ? 'Lösen' : 'Anheften') + '</button>'
                + '<button type="button" data-aktion="loeschen" class="tm-gefahr">Löschen</button></footer>' : '')
            + '</article>';
    }

    let widgetsGeladen = false;
    function tweetsLaden() {
        if (!xErlaubt() || !document.querySelector('.tm-tweet blockquote')) return;
        if (window.twttr && window.twttr.widgets) { window.twttr.widgets.load(el('tmPosts')); return; }
        if (widgetsGeladen) return;
        widgetsGeladen = true;
        const s = document.createElement('script');
        s.src = 'https://platform.twitter.com/widgets.js';
        s.async = true;
        document.body.appendChild(s);
    }

    async function bildAdressen(liste) {
        const pfade = liste.filter(function (p) { return p.bild_pfad; });
        const aus = {};
        await Promise.all(pfade.map(async function (p) {
            try {
                const { data } = await window.cfDb.storage.from('terminal').createSignedUrl(p.bild_pfad, BILD_TTL);
                if (data && data.signedUrl) aus[p.id] = data.signedUrl;
            } catch (e) { /* Bild fehlt dann */ }
        }));
        return aus;
    }

    let laedt = null;
    async function feedLaden() {
        if (laedt) return laedt;
        laedt = (async function () {
            const { data, error } = await window.cfDb.from('terminal_posts').select('*')
                .order('angeheftet', { ascending: false }).order('created_at', { ascending: false }).limit(60);
            if (error) {
                el('tmPosts').innerHTML = '<p class="tm-leer">Feed konnte nicht geladen werden: ' + esc(error.message) + '</p>';
                return;
            }
            posts = data || [];
            neuZaehlen();
            stimmungZeigen();
            const bilder = await bildAdressen(posts);
            const sichtbar = posts.filter(passtFilter);
            el('tmPosts').innerHTML = sichtbar.length ? sichtbar.map(function (p) { return postHtml(p, bilder); }).join('')
                : posts.length ? '<p class="tm-leer">Keine Beiträge für diesen Filter.</p>'
                : '<p class="tm-leer">Noch keine Beiträge.' + (profil.is_admin ? ' Schreib die erste These über „Neue These schreiben“.' : '') + '</p>';
            el('tmFeedStand').textContent = posts.length ? posts.length + (posts.length === 1 ? ' Beitrag' : ' Beiträge') : '';
            tweetsLaden();
        })();
        try { await laedt; } finally { laedt = null; }
    }

    // Seitenleiste: Thesen der letzten 30 Tage je Coin, Long gegen Short
    function stimmungZeigen() {
        const box = el('tmStimmung');
        if (!box) return;
        const ab = new Date(Date.now() - 30 * 86400000).toISOString();
        const je = {};
        posts.forEach(function (p) {
            if (p.art !== 'these' || !p.coin || p.created_at < ab) return;
            const z = je[p.coin] || (je[p.coin] = { long: 0, short: 0, neutral: 0, n: 0 });
            z[p.richtung || 'neutral']++; z.n++;
        });
        const coins = Object.keys(je).sort(function (a, b) { return je[b].n - je[a].n; });
        box.innerHTML = coins.length ? coins.map(function (c) {
            const z = je[c];
            const name = c === 'ALLGEMEIN' ? 'Allgemein' : c;
            return '<button type="button" class="tm-stimmung-zeile" data-filter-setzen="' + c + '">'
                + '<b>' + name + '</b>'
                + '<span class="tm-stimmung-balken" aria-hidden="true">'
                +   '<i class="tm-st-long" style="flex:' + z.long + '"></i><i class="tm-st-neutral" style="flex:' + z.neutral + '"></i><i class="tm-st-short" style="flex:' + z.short + '"></i></span>'
                + '<em>' + z.n + '</em>'
                + '<span class="tm-stimmung-text">' + z.long + ' Long, ' + z.short + ' Short' + (z.neutral ? ', ' + z.neutral + ' Neutral' : '') + '</span>'
                + '</button>';
        }).join('') : '<p class="tm-leer">Noch keine Thesen.</p>';
    }

    // Filter im Feed
    let filter = 'alle';
    function passtFilter(p) {
        if (filter === 'alle') return true;
        if (filter === 'tweet') return p.art === 'tweet';
        return p.art === 'these' && p.coin === filter;
    }

    // Neue Beitraege, waehrend man im Markt-Tab ist: Punkt am Feed-Tab
    function gesehenBis() { try { return localStorage.getItem('cf_tm_gesehen') || ''; } catch (e) { return ''; } }
    function neuZaehlen() {
        const bis = gesehenBis();
        const n = bis ? posts.filter(function (p) { return p.created_at > bis; }).length : 0;
        const r = document.querySelector('.tm-raster');
        if (r && r.getAttribute('data-ansicht') === 'feed') { neuGesehen(); return; }
        const b = el('tmFeedNeu');
        b.hidden = !n;
        b.textContent = n > 9 ? '9+' : String(n);
        if (!bis) neuGesehen();
    }
    function neuGesehen() {
        const neueste = posts.reduce(function (m, p) { return p.created_at > m ? p.created_at : m; }, '');
        try { if (neueste) localStorage.setItem('cf_tm_gesehen', neueste); } catch (e) { /* egal */ }
        const b = el('tmFeedNeu');
        if (b) b.hidden = true;
    }

    // --------------------------------------------------------- Bild gross
    //
    // Alle Bilder eines Beitrags (eigenes Bild + Chart) als Reihe. Klick ins
    // Bild zoomt auf die Stelle, Pfeile/Wischen wechseln, Esc schliesst.

    let lupe = { liste: [], i: 0 };
    function lupeAuf(post, index) {
        const bilder = Array.prototype.map.call(post.querySelectorAll('.tm-post-bild'), function (a) {
            const img = a.querySelector('img');
            return { src: img.getAttribute('src'), original: a.getAttribute('href'), alt: img.alt };
        });
        if (!bilder.length) return;
        lupe = { liste: bilder, i: index, vorher: document.activeElement };
        el('tmLupe').hidden = false;
        document.documentElement.classList.add('tm-lupe-offen');
        lupeZeigen();
        el('tmLupeZu').focus();
    }
    function lupeZeigen() {
        const b = lupe.liste[lupe.i];
        const img = el('tmLupeBild');
        el('tmLupeFlaeche').classList.remove('tm-gezoomt');
        img.classList.remove('tm-lupe-da');
        img.onload = function () { img.classList.add('tm-lupe-da'); };
        img.src = b.src;
        img.alt = b.alt;
        if (img.complete) img.classList.add('tm-lupe-da');
        el('tmLupeOriginal').href = b.original || b.src;
        const mehr = lupe.liste.length > 1;
        el('tmLupeZahl').textContent = mehr ? (lupe.i + 1) + ' / ' + lupe.liste.length : '';
        el('tmLupeZurueck').hidden = !mehr;
        el('tmLupeWeiter').hidden = !mehr;
    }
    function lupeBlaettern(d) {
        if (lupe.liste.length < 2) return;
        lupe.i = (lupe.i + d + lupe.liste.length) % lupe.liste.length;
        lupeZeigen();
    }
    function lupeZu() {
        if (el('tmLupe').hidden) return;
        el('tmLupe').hidden = true;
        document.documentElement.classList.remove('tm-lupe-offen');
        el('tmLupeBild').removeAttribute('src');
        if (lupe.vorher && lupe.vorher.focus) lupe.vorher.focus();
    }
    function lupeZoom(e) {
        const f = el('tmLupeFlaeche');
        const img = el('tmLupeBild');
        if (f.classList.contains('tm-gezoomt')) { f.classList.remove('tm-gezoomt'); return; }
        const r = img.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        f.classList.add('tm-gezoomt');
        el('tmLupeTipp').hidden = true;
        // Auf die geklickte Stelle scrollen
        requestAnimationFrame(function () {
            f.scrollLeft = fx * f.scrollWidth - f.clientWidth / 2;
            f.scrollTop = fy * f.scrollHeight - f.clientHeight / 2;
        });
    }
    function lupeVerdrahten() {
        el('tmLupeZu').addEventListener('click', lupeZu);
        el('tmLupeZurueck').addEventListener('click', function () { lupeBlaettern(-1); });
        el('tmLupeWeiter').addEventListener('click', function () { lupeBlaettern(1); });
        el('tmLupeBild').addEventListener('click', function (e) { e.stopPropagation(); lupeZoom(e); });
        el('tmLupeFlaeche').addEventListener('click', function (e) { if (e.target === e.currentTarget) lupeZu(); });
        document.addEventListener('keydown', function (e) {
            if (el('tmLupe').hidden) return;
            if (e.key === 'Escape') lupeZu();
            else if (e.key === 'ArrowLeft') lupeBlaettern(-1);
            else if (e.key === 'ArrowRight') lupeBlaettern(1);
        });
        // Wischen auf dem Handy (nur ungezoomt)
        let x0 = null, y0 = null;
        el('tmLupeFlaeche').addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1 || e.currentTarget.classList.contains('tm-gezoomt')) { x0 = null; return; }
            x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
        }, { passive: true });
        el('tmLupeFlaeche').addEventListener('touchend', function (e) {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) lupeBlaettern(dx < 0 ? 1 : -1);
            else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) lupeZu();
        });
        el('tmPosts').addEventListener('click', function (e) {
            const a = e.target.closest('.tm-post-bild');
            if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            const post = a.closest('.tm-post');
            lupeAuf(post, Array.prototype.indexOf.call(post.querySelectorAll('.tm-post-bild'), a));
        });
    }

    // Beitraege von anderen Geraeten / vom Admin sofort zeigen
    function live() {
        try {
            window.cfDb.channel('terminal-feed')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'terminal_posts' }, function () {
                    clearTimeout(live.t);
                    live.t = setTimeout(feedLaden, 300);
                })
                .subscribe();
        } catch (e) { /* ohne Realtime: beim naechsten Laden */ }
        // Zeitangaben ("vor 5 Min.") aktuell halten, und als Rueckfall
        setInterval(feedLaden, 120000);
    }

    // --------------------------------------------------------- Schreiben

    let bildDatei = null;
    const auswahl = { art: 'these', coin: 'BTC', richtung: 'neutral' };

    function fehler(text) { const f = el('tmFehler'); f.textContent = text || ''; f.hidden = !text; }

    function artSetzen(art) {
        auswahl.art = art;
        segment(document.querySelector('.tm-art'), art, 'data-art');
        document.querySelectorAll('.tm-nur-these').forEach(function (e) { e.hidden = art !== 'these'; });
        document.querySelectorAll('.tm-nur-tweet').forEach(function (e) { e.hidden = art !== 'tweet'; });
        document.querySelector('.tm-text-label').textContent = art === 'tweet' ? 'Dein Kommentar (optional)' : 'These';
    }

    function bildZeigen(datei) {
        if (!datei || !/^image\//.test(datei.type)) return;
        if (datei.size > 5 * 1024 * 1024) { fehler('Das Bild ist größer als 5 MB.'); return; }
        bildDatei = datei;
        const v = el('tmBildVorschau');
        v.innerHTML = '<img src="' + URL.createObjectURL(datei) + '" alt="Vorschau"><button type="button" class="tm-knopf tm-knopf-leise" id="tmBildWeg">Bild entfernen</button>';
        v.hidden = false;
        el('tmBildFlaeche').hidden = true;
        el('tmBildWeg').addEventListener('click', bildWeg);
    }
    function bildWeg() {
        bildDatei = null;
        el('tmBildVorschau').hidden = true;
        el('tmBildVorschau').innerHTML = '';
        el('tmBildFlaeche').hidden = false;
    }

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
    }

    async function senden(e) {
        e.preventDefault();
        fehler('');
        const titel = el('tmTitel').value.trim();
        const text = el('tmText').value.trim();
        const chart = el('tmChart').value.trim();
        const tweet = el('tmTweet').value.trim();
        const zeile = { id: uuid(), art: auswahl.art };
        if (auswahl.art === 'tweet') {
            if (!tweetTeile(tweet)) { fehler('Das ist kein Link zu einem X-Post (x.com/name/status/…).'); return; }
            zeile.tweet_url = tweet;
            zeile.text = text || null;
        } else {
            if (!titel && !text && !bildDatei && !chart) { fehler('Schreib eine These oder hänge ein Bild an.'); return; }
            if (chart && !/^https:\/\//.test(chart)) { fehler('Der Chart-Link muss mit https:// beginnen.'); return; }
            Object.assign(zeile, { coin: auswahl.coin, richtung: auswahl.richtung, titel: titel || null,
                                   text: text || null, chart_url: chart || null });
        }
        const knopf = el('tmSenden');
        knopf.disabled = true;
        knopf.textContent = 'Wird veröffentlicht …';
        try {
            if (auswahl.art === 'these' && bildDatei) {
                const endung = (bildDatei.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
                const pfad = 'posts/' + uuid() + '.' + endung;
                const { error: fe } = await window.cfDb.storage.from('terminal').upload(pfad, bildDatei, { contentType: bildDatei.type });
                if (fe) throw new Error('Bild: ' + fe.message);
                zeile.bild_pfad = pfad;
            }
            const { error } = await window.cfDb.from('terminal_posts').insert(zeile);
            if (error) throw new Error(error.message);
            composerZu();
            toast('Veröffentlicht – alle VIPs sehen es jetzt');
            pushSenden(zeile.id);
            await feedLaden();
        } catch (err) {
            fehler('Nicht veröffentlicht: ' + err.message);
        } finally {
            knopf.disabled = false;
            knopf.textContent = 'Veröffentlichen';
        }
    }

    function frage(titel, text, ja) {
        el('tmDialogTitel').textContent = titel;
        el('tmDialogText').textContent = text;
        el('tmDialog').hidden = false;
        el('tmDialogJa').focus();
        el('tmDialogJa').onclick = function () { el('tmDialog').hidden = true; ja(); };
    }

    async function postAktion(id, was) {
        const p = posts.find(function (x) { return x.id === id; });
        if (!p) return;
        if (was === 'anheften') {
            const { error } = await window.cfDb.from('terminal_posts').update({ angeheftet: !p.angeheftet }).eq('id', id);
            if (error) toast('Nicht geändert: ' + error.message, true); else feedLaden();
        }
        if (was === 'loeschen') {
            frage('Beitrag löschen?', 'Der Beitrag verschwindet sofort für alle.', async function () {
                const { error } = await window.cfDb.from('terminal_posts').delete().eq('id', id);
                if (error) { toast('Nicht gelöscht: ' + error.message, true); return; }
                if (p.bild_pfad) window.cfDb.storage.from('terminal').remove([p.bild_pfad]).catch(function () {});
                toast('Beitrag gelöscht');
                feedLaden();
            });
        }
    }

    // -------------------------------------------------------- Verdrahtung

    function verdrahten() {
        lupeVerdrahten();
        document.querySelector('.tm-heat-zeit').addEventListener('click', function (e) {
            const b = e.target.closest('[data-fenster]');
            if (!b) return;
            heatFenster = +b.getAttribute('data-fenster');
            segment(e.currentTarget, b.getAttribute('data-fenster'), 'data-fenster');
            heatZeigen();
        });
        histCoinsAufbauen();
        document.querySelector('.tm-hist-zeit').addEventListener('click', function (e) {
            const b = e.target.closest('[data-fenster]');
            if (!b) return;
            histFenster = +b.getAttribute('data-fenster');
            segment(e.currentTarget, b.getAttribute('data-fenster'), 'data-fenster');
            histKerzen = []; histZeichnen(); histKerzenLaden();
        });
        el('tmHistCoins').addEventListener('click', function (e) {
            const b = e.target.closest('[data-coin]');
            if (!b) return;
            histCoin = b.getAttribute('data-coin');
            segment(e.currentTarget, histCoin, 'data-coin');
            histKerzen = []; histZeichnen(); histKerzenLaden();
        });
        el('tmHistGrafik').addEventListener('mousemove', histTipp);
        el('tmHistGrafik').addEventListener('click', histTipp);
        el('tmHistGrafik').addEventListener('mouseleave', function () {
            el('tmHistTipp').hidden = true;
            const m = document.getElementById('tmHistMarke'); if (m) m.setAttribute('visibility', 'hidden');
        });
        document.querySelector('.tm-heat-gruppe').addEventListener('click', function (e) {
            const b = e.target.closest('[data-gruppe]');
            if (!b) return;
            heatGruppe = b.getAttribute('data-gruppe');
            segment(e.currentTarget, heatGruppe, 'data-gruppe');
            el('tmHeatTipp').hidden = true;
            heatZeigen();
        });
        el('tmHeatKacheln').addEventListener('mousemove', kachelTipp);
        el('tmHeatKacheln').addEventListener('click', kachelTipp);
        el('tmHeatKacheln').addEventListener('mouseleave', function () { el('tmHeatTipp').hidden = true; });
        let groesseT = null;
        window.addEventListener('resize', function () { clearTimeout(groesseT); groesseT = setTimeout(function () { heatZeigen(); histZeichnen(); }, 150); });
        el('tmHeatRaster').addEventListener('mouseover', heatTipp);
        el('tmHeatRaster').addEventListener('click', heatTipp);
        el('tmHeatRaster').addEventListener('mouseleave', function () { el('tmHeatTipp').hidden = true; });
        el('tmStimmung').addEventListener('click', function (e) {
            const b = e.target.closest('[data-filter-setzen]');
            if (!b) return;
            const c = b.getAttribute('data-filter-setzen');
            const knopf = document.querySelector('.tm-feed-filter [data-filter="' + c + '"]');
            if (knopf) knopf.click();
        });
        document.querySelector('.tm-feed-filter').addEventListener('click', function (e) {
            const b = e.target.closest('[data-filter]');
            if (!b) return;
            filter = b.getAttribute('data-filter');
            segment(e.currentTarget, filter, 'data-filter');
            feedLaden();
        });
        document.querySelector('.tm-umschalter').addEventListener('click', function (e) {
            const b = e.target.closest('[data-ansicht]');
            if (b) ansicht(b.getAttribute('data-ansicht'));
        });
        document.querySelector('.tm-liq-zeit').addEventListener('click', function (e) {
            const b = e.target.closest('[data-zeit]');
            if (!b) return;
            liqZeit = +b.getAttribute('data-zeit');
            segment(e.currentTarget, b.getAttribute('data-zeit'), 'data-zeit');
            liqStatsZeigen();
        });
        document.querySelector('.tm-liq-filter').addEventListener('click', function (e) {
            const b = e.target.closest('[data-min]');
            if (!b) return;
            liqMin = +b.getAttribute('data-min');
            segment(e.currentTarget, b.getAttribute('data-min'), 'data-min');
            liqListeZeigen();
        });
        el('tmPosts').addEventListener('click', function (e) {
            if (e.target.closest('[data-x-erlauben]')) {
                try { localStorage.setItem('cf_x_erlaubt', '1'); } catch (er) { /* dann nur fuer jetzt */ }
                feedLaden();
                return;
            }
            const a = e.target.closest('[data-aktion]');
            if (a) postAktion(a.closest('.tm-post').getAttribute('data-id'), a.getAttribute('data-aktion'));
        });
        el('tmDialogNein').addEventListener('click', function () { el('tmDialog').hidden = true; });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') el('tmDialog').hidden = true; });

        glockeEinrichten();

        if (profil.is_admin) {
            const f = el('tmComposer');
            el('tmNeu').hidden = false;
            el('tmNeu').addEventListener('click', composerAuf);
            el('tmAbbrechen').addEventListener('click', composerZu);
            f.addEventListener('submit', senden);
            document.querySelector('.tm-art').addEventListener('click', function (e) {
                const b = e.target.closest('[data-art]');
                if (b) artSetzen(b.getAttribute('data-art'));
            });
            f.querySelectorAll('[data-feld]').forEach(function (g) {
                g.addEventListener('click', function (e) {
                    const b = e.target.closest('[data-wert]');
                    if (!b) return;
                    auswahl[g.getAttribute('data-feld')] = b.getAttribute('data-wert');
                    segment(g, b.getAttribute('data-wert'), 'data-wert');
                });
            });
            const flaeche = el('tmBildFlaeche');
            flaeche.addEventListener('click', function () { el('tmBildDatei').click(); });
            flaeche.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el('tmBildDatei').click(); } });
            el('tmBildDatei').addEventListener('change', function () { bildZeigen(this.files && this.files[0]); this.value = ''; });
            f.addEventListener('paste', function (e) {
                const items = (e.clipboardData && e.clipboardData.items) || [];
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image/') === 0) { bildZeigen(items[i].getAsFile()); e.preventDefault(); return; }
                }
            });
        }
    }

    // Eingabe nur bei Bedarf offen - sonst nimmt sie dem Feed den Platz
    function composerAuf() {
        el('tmNeu').hidden = true;
        el('tmComposer').hidden = false;
        el(auswahl.art === 'tweet' ? 'tmTweet' : 'tmTitel').focus();
    }
    function composerZu() {
        el('tmComposer').reset();
        bildWeg();
        fehler('');
        el('tmComposer').hidden = true;
        el('tmNeu').hidden = false;
    }

    // ---------------------------------------------------- Glocke (Push)
    //
    // Desktop (Chrome, Edge, Firefox, Safari) und Android: direkt.
    // iPhone/iPad: nur, wenn CapitalFlow ueber "Zum Home-Bildschirm"
    // installiert ist (Vorgabe von Apple, ab iOS 16.4).

    const istIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installiert = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
        || navigator.standalone === true;
    const pushGeht = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    function glockeStand(an) {
        const g = el('tmGlocke');
        g.setAttribute('aria-pressed', an ? 'true' : 'false');
        g.querySelector('.tm-glocke-text').textContent = an ? 'Glocke an' : 'Glocke';
    }

    async function swBereit() {
        await navigator.serviceWorker.register('sw.js');
        return navigator.serviceWorker.ready;
    }

    function schluesselBytes(b64) {
        const roh = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(roh.length);
        for (let i = 0; i < roh.length; i++) out[i] = roh.charCodeAt(i);
        return out;
    }

    async function glockeEinrichten() {
        const g = el('tmGlocke');
        g.addEventListener('click', glockeKlick);
        if (!pushGeht || Notification.permission !== 'granted') return;
        try {
            const reg = await swBereit();
            glockeStand(!!(await reg.pushManager.getSubscription()));
        } catch (e) { /* bleibt aus */ }
    }

    let glockeLaeuft = false;
    async function glockeKlick() {
        if (glockeLaeuft) return;
        if (!pushGeht) {
            toast(istIos && !installiert
                ? 'Auf dem iPhone: Teilen → „Zum Home-Bildschirm“, CapitalFlow von dort öffnen und dann die Glocke antippen.'
                : 'Dieser Browser kann keine Benachrichtigungen empfangen.', true);
            return;
        }
        glockeLaeuft = true;
        try {
            const reg = await swBereit();
            const alt = await reg.pushManager.getSubscription();
            if (alt && el('tmGlocke').getAttribute('aria-pressed') === 'true') {
                await window.cfDb.rpc('push_abo_loeschen', { p_endpoint: alt.endpoint });
                await alt.unsubscribe();
                glockeStand(false);
                toast('Glocke aus – keine Benachrichtigungen mehr auf diesem Gerät');
                return;
            }
            const recht = await Notification.requestPermission();
            if (recht !== 'granted') {
                toast('Benachrichtigungen sind blockiert. Erlaube sie in den Seiten-Einstellungen (Schloss links in der Adresszeile).', true);
                return;
            }
            const { data, error } = await window.cfDb.functions.invoke('terminal-push', { body: { aktion: 'schluessel' } });
            if (error) throw new Error(await funktionsFehler(error));
            if (!data || !data.schluessel) throw new Error('keine Antwort mit Schlüssel');
            const abo = alt || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(data.schluessel) });
            const j = abo.toJSON();
            const { error: fe } = await window.cfDb.rpc('push_abo_setzen', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
            if (fe) throw new Error(/push_abo_setzen|schema cache/i.test(fe.message) ? '11_push.sql fehlt in Supabase' : fe.message);
            glockeStand(true);
            toast('Glocke an – du bekommst eine Nachricht bei jeder neuen These');
        } catch (e) {
            toast('Glocke nicht aktiviert: ' + e.message, true);
        } finally {
            glockeLaeuft = false;
        }
    }

    // Fehler der Edge Function lesbar machen: Status + Meldung aus der Antwort
    async function funktionsFehler(error) {
        if (!error) return '';
        let text = error.message || String(error);
        const r = error.context;
        if (r && typeof r.status === 'number') {
            let detail = '';
            try { const j = await r.clone().json(); detail = j.fehler || j.message || j.msg || ''; } catch (e) {
                try { detail = (await r.text()).slice(0, 120); } catch (e2) { /* egal */ }
            }
            text = 'HTTP ' + r.status + (detail ? ' – ' + detail : '');
            if (r.status === 404 && !detail) text += ' (Edge Function „terminal-push“ nicht gefunden)';
        } else if (/Failed to send a request/i.test(text)) {
            text = 'Edge Function „terminal-push“ nicht erreichbar – ist sie deployt?';
        }
        return text;
    }

    async function pushSenden(id) {
        try {
            const { data, error } = await window.cfDb.functions.invoke('terminal-push', { body: { aktion: 'senden', id: id } });
            if (error) throw new Error(await funktionsFehler(error));
            if (data && data.fehler) toast('Veröffentlicht – ' + (data.gesendet || 0) + ' zugestellt, ' + data.fehler + ' fehlgeschlagen (Logs der Function prüfen)', true);
            else if (data && data.gesendet) toast('Veröffentlicht – Benachrichtigung an ' + data.gesendet + (data.gesendet === 1 ? ' Gerät' : ' Geräte'));
        } catch (e) {
            toast('Veröffentlicht, aber Benachrichtigung fehlgeschlagen: ' + e.message, true);
        }
    }

    // Intro: einmal pro Sitzung die volle Animation (2 s), danach kurz
    function introDauer() {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
        // Ob kurz oder lang, steht schon im <head> fest (Klasse am <html>) -
        // sonst wuerde die Animation mitten im Lauf umspringen
        const kurz = document.documentElement.classList.contains('tm-intro-kurz');
        try { sessionStorage.setItem('cf_tm_intro', '1'); } catch (e) { /* egal */ }
        return kurz ? 700 : 2000;
    }
    function warte(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function start() {
        const intro = warte(introDauer());
        let ok = false;
        try { ok = await zugang(); } catch (e) { tor('Zugang konnte nicht geprüft werden.', true); }
        if (!ok) return;
        await intro;
        const tor_ = el('tmTor');
        tor_.setAttribute('data-stand', 'fertig');
        el('tmApp').hidden = false;
        document.body.classList.add('tm-auftritt');
        setTimeout(function () { tor_.hidden = true; document.body.classList.remove('tm-auftritt'); }, 650);
        let gemerkt = null;
        try { gemerkt = localStorage.getItem('cf_tm_ansicht'); } catch (e) { /* egal */ }
        if (gemerkt === 'feed' && !location.hash) ansicht('feed');
        kurseAufbauen();
        buchAufbauen();
        verdrahten();
        markt = window.cfMarkt.starten({
            orderbuch: buchZeigen, kurs: kursZeigen, funding: fundingZeigen, status: statusZeigen,
            liquidation: neueLiquidation, historie: function () { heatZeigen(); histZeichnen(); },
        });
        heatZeigen();
        setInterval(heatZeigen, 2000);
        histZeichnen();
        histKerzenLaden();
        setInterval(function () { if (!el('tmHistTipp').hidden) return; histZeichnen(); }, 5000);
        setInterval(histKerzenLaden, 60000);
        liqStatsZeigen();
        setInterval(liqStatsZeigen, 1000);
        fng();
        setInterval(fng, 10 * 60 * 1000);
        await feedLaden();
        live();
        zuPost();
        window.addEventListener('hashchange', function () { feedLaden().then(zuPost); });
    }

    // Aus einer Benachrichtigung geoeffnet: zum Beitrag springen
    function zuPost() {
        const m = /^#post-([\w-]+)$/.exec(location.hash);
        const ziel = m && document.querySelector('.tm-post[data-id="' + m[1] + '"]');
        if (!ziel) return;
        const r = document.querySelector('.tm-raster');
        if (r && r.getAttribute('data-ansicht') !== 'feed') {
            const k = document.querySelector('.tm-umschalter [data-ansicht="feed"]');
            if (k && k.offsetParent) k.click();
        }
        document.querySelectorAll('.tm-post-ziel').forEach(function (p) { p.classList.remove('tm-post-ziel'); });
        ziel.scrollIntoView({ block: 'center' });
        ziel.classList.add('tm-post-ziel');
    }

    window.cfTerminal = { tvBild: tvBild, tweetTeile: tweetTeile, feedLaden: feedLaden, heatZeigen: heatZeigen, heatFarbe: heatFarbe, histZeichnen: histZeichnen, squarify: squarify };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
