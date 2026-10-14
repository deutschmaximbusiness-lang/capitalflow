/* CapitalFlow Krypto Terminal - Marktdaten
 *
 * Alles hier kommt direkt aus den oeffentlichen Schnittstellen der
 * Boersen in den Browser. Kein eigener Server, kein Schluessel.
 *
 *   Orderbuch      Binance USDⓈ-M Futures (Perps), Diff-Stream + Snapshot
 *   Liquidationen  Binance (gedrosselt: max. 1 je Coin und Sekunde)
 *                  + Bybit (alle Liquidationen, alle 500 ms gebuendelt)
 *                  + OKX (alle Liquidationen der Perps)
 *   Kurs, Funding  Binance Futures
 *
 * Binance hat die Futures-Streams 2026 auf zwei Adressen aufgeteilt:
 * Orderbuch unter /public, Kurs, Funding und Liquidationen unter
 * /market. Ueber die alte Sammeladresse kommen Kurs und Liquidationen
 * nicht mehr an - genau deshalb blieben Kopfzeile und Liquidationen leer.
 *   Fear & Greed   alternative.me
 *
 * Liquidations-Summen zaehlen ab dem Oeffnen der Seite. 24h-Summen
 * brauchen einen Dienst, der rund um die Uhr mitschreibt (Stufe 2).
 */
(function () {
    'use strict';

    // ctVal: Groesse eines OKX-Kontrakts in Coins. Wird beim Start von OKX
    // geholt, das hier ist nur der Rueckfall.
    // buch: true = mit Orderbuch und eigener Statistik-Karte. Die Altcoins
    // laufen in Kursleiste, Heatmap und Live-Liste mit.
    function alt(sym, stellen) {
        const k = sym.toLowerCase();
        return { binance: k + 'usdt', bybit: sym + 'USDT', okx: sym + '-USDT-SWAP', ctVal: 0, kursStellen: stellen, buch: false };
    }
    const COINS = {
        BTC: { binance: 'btcusdt', bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP', ctVal: 0.01, buch: true,
               stufen: [1, 10, 50, 100], stufe: 10, preisStellen: 1, mengeStellen: 3, kursStellen: 0 },
        ETH: { binance: 'ethusdt', bybit: 'ETHUSDT', okx: 'ETH-USDT-SWAP', ctVal: 0.1, buch: true,
               stufen: [0.1, 0.5, 1, 5], stufe: 0.5, preisStellen: 2, mengeStellen: 2, kursStellen: 2 },
        SOL: { binance: 'solusdt', bybit: 'SOLUSDT', okx: 'SOL-USDT-SWAP', ctVal: 1, buch: true,
               stufen: [0.01, 0.05, 0.1, 0.5], stufe: 0.05, preisStellen: 2, mengeStellen: 1, kursStellen: 2 },
        XRP: alt('XRP', 4), BNB: alt('BNB', 2), DOGE: alt('DOGE', 5), HYPE: alt('HYPE', 3),
        SUI: alt('SUI', 4), ADA: alt('ADA', 4), LINK: alt('LINK', 3), AVAX: alt('AVAX', 3),
        NEAR: alt('NEAR', 4), HBAR: alt('HBAR', 5),
    };
    const NAMEN = Object.keys(COINS);
    const BUCH_NAMEN = NAMEN.filter(function (c) { return COINS[c].buch; });
    function coinVon(feld, wert) {
        for (let i = 0; i < NAMEN.length; i++) if (COINS[NAMEN[i]][feld] === wert) return NAMEN[i];
        return null;
    }

    const BINANCE_PUBLIC = 'wss://fstream.binance.com/public/stream?streams=';
    const BINANCE_MARKET = 'wss://fstream.binance.com/market/stream?streams=';
    const OKX_WS = 'wss://ws.okx.com:8443/ws/v5/public';
    const OKX_REST = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
    const OKX_LIQ = 'https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&state=filled&limit=100&instFamily=';
    const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/depth';
    const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear';
    const FNG_URL = 'https://api.alternative.me/fng/?limit=31';

    // ------------------------------------------------------- Orderbuch

    /**
     * Ein lokales Orderbuch nach dem Verfahren, das Binance vorschreibt:
     * Diff-Ereignisse puffern, Snapshot holen, alles vor dem Snapshot
     * verwerfen, dann muss jedes Ereignis nahtlos an das vorige anschliessen
     * (pu == voriges u). Reisst die Kette, wird neu synchronisiert - sonst
     * stuenden Preise im Buch, die laengst weg sind.
     */
    function Orderbuch() {
        this.bids = new Map();
        this.asks = new Map();
        this.lastId = null;
        this.puffer = [];
        this.bereit = false;
        this.letztesU = null;
    }
    Orderbuch.prototype.anwenden = function (seite, liste) {
        const m = seite === 'b' ? this.bids : this.asks;
        for (let i = 0; i < liste.length; i++) {
            const p = +liste[i][0], q = +liste[i][1];
            if (!(p > 0)) continue;
            if (q === 0) m.delete(p); else m.set(p, q);
        }
    };
    Orderbuch.prototype.snapshot = function (snap) {
        this.bids.clear(); this.asks.clear();
        this.anwenden('b', snap.bids || []);
        this.anwenden('a', snap.asks || []);
        this.lastId = snap.lastUpdateId;
        const rest = this.puffer.filter(function (e) { return e.u >= snap.lastUpdateId; });
        this.puffer = [];
        this.bereit = true;
        this.letztesU = null;
        for (let i = 0; i < rest.length; i++) {
            if (!this.ereignis(rest[i])) return false;
        }
        return true;
    };
    /** false heisst: Kette gerissen, neu synchronisieren. */
    Orderbuch.prototype.ereignis = function (e) {
        if (!this.bereit) { this.puffer.push(e); if (this.puffer.length > 2000) this.puffer.shift(); return true; }
        if (e.u < this.lastId) return true;
        if (this.letztesU === null) {
            if (!(e.U <= this.lastId && e.u >= this.lastId)) return false;
        } else if (e.pu !== this.letztesU) {
            return false;
        }
        this.anwenden('b', e.b || []);
        this.anwenden('a', e.a || []);
        this.letztesU = e.u;
        return true;
    };
    Orderbuch.prototype.zuruecksetzen = function () {
        this.bids.clear(); this.asks.clear();
        this.lastId = null; this.puffer = []; this.bereit = false; this.letztesU = null;
    };

    /**
     * Preisstufen zusammenfassen. Bids werden abgerundet, Asks
     * aufgerundet - so landet nie ein Gebot auf einer Stufe ueber dem
     * besten Angebot.
     */
    function gruppieren(buch, stufe, anzahl) {
        const runde = function (p, auf) {
            const n = p / stufe;
            const r = auf ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
            return Math.round(r * stufe * 1e8) / 1e8;
        };
        const sammeln = function (m, auf) {
            const g = new Map();
            m.forEach(function (q, p) {
                const k = runde(p, auf);
                g.set(k, (g.get(k) || 0) + q);
            });
            return Array.from(g.entries()).sort(function (a, b) { return auf ? a[0] - b[0] : b[0] - a[0]; })
                .slice(0, anzahl).map(function (x) { return { preis: x[0], menge: x[1] }; });
        };
        const bids = sammeln(buch.bids, false);
        const asks = sammeln(buch.asks, true);
        let summe = 0;
        bids.forEach(function (z) { summe += z.menge; z.summe = summe; });
        summe = 0;
        asks.forEach(function (z) { summe += z.menge; z.summe = summe; });
        return { bids: bids, asks: asks };
    }

    /** Bestes Gebot, bestes Angebot, Spread, Mitte und Druck im Band ±1 %. */
    function kennzahlen(buch) {
        let bestBid = -Infinity, bestAsk = Infinity;
        buch.bids.forEach(function (q, p) { if (p > bestBid) bestBid = p; });
        buch.asks.forEach(function (q, p) { if (p < bestAsk) bestAsk = p; });
        if (!isFinite(bestBid) || !isFinite(bestAsk)) return null;
        const mitte = (bestBid + bestAsk) / 2;
        let bidWert = 0, askWert = 0;
        buch.bids.forEach(function (q, p) { if (p >= mitte * 0.99) bidWert += p * q; });
        buch.asks.forEach(function (q, p) { if (p <= mitte * 1.01) askWert += p * q; });
        return {
            bestBid: bestBid, bestAsk: bestAsk, mitte: mitte, spread: bestAsk - bestBid,
            bidWert: bidWert, askWert: askWert,
            druck: bidWert + askWert > 0 ? bidWert / (bidWert + askWert) : 0.5,
        };
    }

    // --------------------------------------------------- Liquidationen

    /**
     * Einheitliche Form fuer beide Boersen:
     * { boerse, coin, seite: 'long'|'short' (welche Position liquidiert
     *   wurde), menge, preis, wert (USD), zeit }
     */
    function ausBinance(o) {
        if (!o || !o.s) return null;
        const coin = coinVon('binance', String(o.s).toLowerCase());
        if (!coin) return null;
        const menge = +(o.z || o.q), preis = +(o.ap || o.p);
        if (!(menge > 0) || !(preis > 0)) return null;
        // SELL-Auftrag = eine Long-Position wurde zwangsgeschlossen
        return { boerse: 'Binance', coin: coin, seite: o.S === 'SELL' ? 'long' : 'short',
                 menge: menge, preis: preis, wert: menge * preis, zeit: +o.T || Date.now() };
    }
    function ausBybit(d) {
        if (!d || !d.s) return null;
        const coin = coinVon('bybit', d.s);
        if (!coin) return null;
        const menge = +d.v, preis = +d.p;
        if (!(menge > 0) || !(preis > 0)) return null;
        // Bybit: "Buy" = eine Long-Position wurde liquidiert
        return { boerse: 'Bybit', coin: coin, seite: d.S === 'Buy' ? 'long' : 'short',
                 menge: menge, preis: preis, wert: menge * preis, zeit: +d.T || Date.now() };
    }

    /**
     * OKX: sz ist die Zahl der Kontrakte, nicht die Coins. posSide sagt,
     * welche Position liquidiert wurde; im Netto-Modus steht dort "net",
     * dann gilt: Verkauf = Long liquidiert.
     */
    function ausOkx(zeile, d) {
        const coin = coinVon('okx', zeile && zeile.instId);
        if (!coin || !d || !(COINS[coin].ctVal > 0)) return null;
        const menge = (+d.sz) * COINS[coin].ctVal, preis = +d.bkPx;
        if (!(menge > 0) || !(preis > 0)) return null;
        const seite = d.posSide === 'long' || d.posSide === 'short' ? d.posSide
            : (d.side === 'sell' ? 'long' : 'short');
        return { boerse: 'OKX', coin: coin, seite: seite,
                 menge: menge, preis: preis, wert: menge * preis, zeit: +d.ts || Date.now() };
    }

    function LiqStatistik() { this.seit = Date.now(); this.liste = []; this.historie = []; }
    // Nachgeladene OKX-Liquidationen von vor dem Oeffnen: nur fuer die
    // Heatmap, nicht fuer "gezaehlt seit Oeffnen"
    LiqStatistik.prototype.historieSetzen = function (liste) {
        const da = {};
        this.historie.forEach(function (l) { da[l.coin + l.zeit + l.menge] = true; });
        const self = this;
        liste.forEach(function (l) { if (!da[l.coin + l.zeit + l.menge]) { l.alt = true; self.historie.push(l); } });
        this.historie.sort(function (a, b) { return b.zeit - a.zeit; });
        if (this.historie.length > 5000) this.historie.length = 5000;
    };
    // Alle Liquidationen (live + OKX-Historie) mit ihrer Zeit t
    LiqStatistik.prototype.alle = function () {
        const aus = [];
        this.liste.forEach(function (l) { aus.push({ l: l, t: l.empfangen || l.zeit }); });
        this.historie.forEach(function (l) { aus.push({ l: l, t: l.zeit }); });
        return aus;
    };
    // Ab wann liegen Daten vor? (fruehester Eintrag oder Oeffnen)
    LiqStatistik.prototype.abdeckung = function () {
        let ab = this.seit;
        this.historie.forEach(function (l) { if (l.zeit < ab) ab = l.zeit; });
        return ab;
    };
    /**
     * Auswertung eines Zeitfensters: Summen je Coin und je Boerse,
     * Gesamt Long/Short, groesste einzelne Liquidation.
     */
    LiqStatistik.prototype.auswerten = function (fensterMs, jetzt) {
        jetzt = jetzt || Date.now();
        const ab = jetzt - fensterMs;
        const r = { long: 0, short: 0, anzahl: 0, coins: {}, boersen: {}, groesste: null };
        this.alle().forEach(function (e) {
            if (e.t < ab || e.t > jetzt) return;
            const l = e.l;
            r[l.seite] += l.wert; r.anzahl++;
            const c = r.coins[l.coin] || (r.coins[l.coin] = { long: 0, short: 0, anzahl: 0 });
            c[l.seite] += l.wert; c.anzahl++;
            const b = r.boersen[l.boerse] || (r.boersen[l.boerse] = { long: 0, short: 0, anzahl: 0 });
            b[l.seite] += l.wert; b.anzahl++;
            if (!r.groesste || l.wert > r.groesste.wert) r.groesste = l;
        });
        return r;
    };

    /**
     * Heatmap: pro Coin und Zeitabschnitt Longs/Shorts in USD.
     * fensterMs: wie weit zurueck, spalten: Anzahl Abschnitte.
     */
    LiqStatistik.prototype.raster = function (coins, fensterMs, spalten, jetzt) {
        jetzt = jetzt || Date.now();
        const start = jetzt - fensterMs, schritt = fensterMs / spalten;
        const zellen = {}, summe = {};
        coins.forEach(function (c) {
            zellen[c] = [];
            for (let i = 0; i < spalten; i++) zellen[c].push({ long: 0, short: 0, anzahl: 0 });
            summe[c] = { long: 0, short: 0, anzahl: 0 };
        });
        let max = 0;
        const rein = function (l, t) {
            if (!zellen[l.coin] || t < start || t > jetzt) return;
            const i = Math.min(spalten - 1, Math.floor((t - start) / schritt));
            const z = zellen[l.coin][i];
            z[l.seite] += l.wert; z.anzahl++;
            summe[l.coin][l.seite] += l.wert; summe[l.coin].anzahl++;
            if (z.long + z.short > max) max = z.long + z.short;
        };
        this.liste.forEach(function (l) { rein(l, l.empfangen || l.zeit); });
        this.historie.forEach(function (l) { rein(l, l.zeit); });
        return { start: start, schritt: schritt, spalten: spalten, zellen: zellen, summe: summe, max: max };
    };
    LiqStatistik.prototype.neu = function (l) {
        this.liste.unshift(l);
        if (this.liste.length > 5000) this.liste.length = 5000;
    };
    LiqStatistik.prototype.summen = function (coin, abMs) {
        const ab = abMs ? Date.now() - abMs : 0;
        const r = { long: 0, short: 0, anzahl: 0, groesste: null };
        for (let i = 0; i < this.liste.length; i++) {
            const l = this.liste[i];
            if (l.coin !== coin || (l.empfangen || l.zeit) < ab) continue;
            r[l.seite] += l.wert; r.anzahl++;
            if (!r.groesste || l.wert > r.groesste.wert) r.groesste = l;
        }
        return r;
    };

    // ------------------------------------------------- Kerzen (Kurslinie)

    const BINANCE_KLINES = 'https://fapi.binance.com/fapi/v1/klines';
    // Schlusskurse fuer die Kurslinie im Verlauf: [{ t, preis }]
    async function kerzenHolen(coin, intervall, anzahl) {
        const r = await fetch(BINANCE_KLINES + '?symbol=' + COINS[coin].binance.toUpperCase()
            + '&interval=' + intervall + '&limit=' + anzahl);
        const j = await r.json();
        if (!Array.isArray(j)) return [];
        return j.map(function (k) { return { t: +k[0], ende: +k[6], preis: +k[4] }; })
            .filter(function (k) { return k.preis > 0; });
    }

    // ---------------------------------------------------- Fear & Greed

    const FNG_DE = { 'Extreme Fear': 'Extreme Angst', 'Fear': 'Angst', 'Neutral': 'Neutral',
                     'Greed': 'Gier', 'Extreme Greed': 'Extreme Gier' };
    function fngLesen(json) {
        const d = json && Array.isArray(json.data) ? json.data : [];
        if (!d.length) return null;
        const wert = function (i) { return d[i] ? { wert: +d[i].value, text: FNG_DE[d[i].value_classification] || d[i].value_classification } : null; };
        return { heute: wert(0), gestern: wert(1), woche: wert(7), monat: wert(30),
                 // aelteste zuerst - fuer den Verlauf der letzten 30 Tage
                 reihe: d.slice(0, 30).map(function (x) { return +x.value; }).reverse(),
                 naechstes: d[0].time_until_update ? +d[0].time_until_update : null };
    }

    // ------------------------------------------------------- Verbindung

    /** WebSocket mit Wiederverbinden (1 s, 2 s, 4 s ... hoechstens 30 s). */
    function Leitung(url, bei) {
        this.url = url; this.bei = bei; this.versuch = 0; this.ws = null; this.zu = false;
        this.oeffnen();
    }
    Leitung.prototype.oeffnen = function () {
        const self = this;
        let ws;
        try { ws = new WebSocket(this.url); } catch (e) { this.spaeter(); return; }
        this.ws = ws;
        ws.onopen = function () { self.versuch = 0; if (self.bei.offen) self.bei.offen(ws); if (self.bei.status) self.bei.status('live'); };
        ws.onmessage = function (ev) {
            let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
            self.bei.nachricht(d, ws);
        };
        ws.onclose = function () {
            if (self.bei.status) self.bei.status('getrennt');
            if (self.bei.zu) self.bei.zu();
            if (!self.zu) self.spaeter();
        };
        ws.onerror = function () { try { ws.close(); } catch (e) { /* egal */ } };
    };
    Leitung.prototype.spaeter = function () {
        const self = this;
        const warte = Math.min(30000, 1000 * Math.pow(2, this.versuch++));
        setTimeout(function () { if (!self.zu) self.oeffnen(); }, warte);
    };
    Leitung.prototype.schliessen = function () { this.zu = true; if (this.ws) this.ws.close(); };

    // ------------------------------------------------------ Gesamtstart

    function starten(ui) {
        const buecher = {};
        BUCH_NAMEN.forEach(function (c) { buecher[c] = new Orderbuch(); });
        const liq = new LiqStatistik();
        const status = { orderbuch: 'verbinde', binance: 'verbinde', bybit: 'verbinde', okx: 'verbinde' };
        const melden = function () { if (ui.status) ui.status(status); };

        const laedt = {};
        async function snapshot(coin) {
            if (laedt[coin]) return;
            laedt[coin] = true;
            const b = buecher[coin];
            b.zuruecksetzen();
            let nochmal = 0;
            try {
                const r = await fetch(BINANCE_REST + '?symbol=' + COINS[coin].binance.toUpperCase() + '&limit=1000');
                const snap = await r.json();
                if (!snap || !Array.isArray(snap.bids)) throw new Error('kein Snapshot');
                if (!b.snapshot(snap)) nochmal = 500;
            } catch (e) {
                nochmal = 3000;
            }
            laedt[coin] = false;
            if (nochmal) setTimeout(function () { snapshot(coin); }, nochmal);
        }

        // Kurse sammeln und hoechstens einmal pro Bild zeichnen - BTC hat
        // in hektischen Phasen hunderte Abschluesse pro Sekunde
        const kurse = {};
        NAMEN.forEach(function (c) { kurse[c] = { preis: 0, offen: 0 }; });
        let kursGeplant = false;
        function kursNeu(coin, preis, offen) {
            if (preis > 0) kurse[coin].preis = preis;
            if (offen > 0) kurse[coin].offen = offen;
            if (kursGeplant || !ui.kurs) return;
            kursGeplant = true;
            (window.requestAnimationFrame || setTimeout)(function () {
                kursGeplant = false;
                NAMEN.forEach(function (c) {
                    const k = kurse[c];
                    if (!(k.preis > 0)) return;
                    ui.kurs(c, { preis: k.preis, prozent: k.offen > 0 ? (k.preis / k.offen - 1) * 100 : null });
                });
            });
        }

        // empfangen: eigene Uhr beim Eintreffen. Die Zeitfenster (5 Min, 1 Std)
        // rechnen damit, nicht mit dem Boersen-Zeitstempel - sonst fallen
        // nachgelieferte Liquidationen oder eine abweichende PC-Uhr raus.
        const neueLiq = function (l) { if (l) { l.empfangen = Date.now(); liq.neu(l); if (ui.liquidation) ui.liquidation(l); } };
        const quelle = function (name) {
            return function (s) { status[name] = s; melden(); };
        };

        // Orderbuch (Binance /public)
        const buch = new Leitung(BINANCE_PUBLIC + BUCH_NAMEN.map(function (c) { return COINS[c].binance + '@depth@100ms'; }).join('/'), {
            offen: function () { BUCH_NAMEN.forEach(snapshot); },
            status: quelle('orderbuch'),
            nachricht: function (m) {
                const coin = coinVon('binance', String(m.stream || '').split('@')[0]);
                if (coin && buecher[coin] && m.data && !buecher[coin].ereignis(m.data)) snapshot(coin);
            },
        });

        // Kurs, Funding, Liquidationen (Binance /market)
        const marktStreams = [];
        NAMEN.forEach(function (c) {
            const s = COINS[c].binance;
            // aggTrade: jeder Abschluss, also der Kurs in Echtzeit. @ticker
            // kommt nur einmal pro Sekunde - daher wirkte der Kurs verspaetet.
            // Vom Ticker nehmen wir nur noch den Eroeffnungskurs vor 24 h.
            marktStreams.push(s + '@aggTrade', s + '@forceOrder', s + '@ticker', s + '@markPrice@1s');
        });
        const binance = new Leitung(BINANCE_MARKET + marktStreams.join('/'), {
            status: quelle('binance'),
            nachricht: function (m) {
                const name = String(m.stream || ''), d = m.data || {};
                const coin = coinVon('binance', name.split('@')[0]);
                if (!coin) return;
                if (name.indexOf('@forceOrder') > 0) neueLiq(ausBinance(d.o));
                else if (name.indexOf('@aggTrade') > 0) { kursNeu(coin, +d.p, null); }
                else if (name.indexOf('@ticker') > 0) { kursNeu(coin, kurse[coin].preis ? null : +d.c, +d.o); }
                else if (name.indexOf('@markPrice') > 0) { if (ui.funding) ui.funding(coin, { rate: +d.r, naechste: +d.T }); }
            },
        });

        // Bybit: alle Liquidationen
        let ping = null;
        const bybit = new Leitung(BYBIT_WS, {
            offen: function (ws) {
                // Bybit nimmt hoechstens 10 Themen pro Anmeldung
                const themen = NAMEN.map(function (c) { return 'allLiquidation.' + COINS[c].bybit; });
                for (let i = 0; i < themen.length; i += 10) ws.send(JSON.stringify({ op: 'subscribe', args: themen.slice(i, i + 10) }));
                clearInterval(ping);
                ping = setInterval(function () { try { ws.send(JSON.stringify({ op: 'ping' })); } catch (e) { /* egal */ } }, 20000);
            },
            zu: function () { clearInterval(ping); },
            status: quelle('bybit'),
            nachricht: function (m) {
                if (m && m.op === 'subscribe' && m.success === false) { status.bybit = 'fehler'; melden(); return; }
                if (!m || typeof m.topic !== 'string' || m.topic.indexOf('allLiquidation.') !== 0) return;
                (Array.isArray(m.data) ? m.data : [m.data]).forEach(function (d) { neueLiq(ausBybit(d)); });
            },
        });

        // OKX: alle Liquidationen der Perps, gefiltert auf unsere Coins
        let pingOkx = null;
        const okx = new Leitung(OKX_WS, {
            offen: function (ws) {
                ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] }));
                clearInterval(pingOkx);
                pingOkx = setInterval(function () { try { ws.send('ping'); } catch (e) { /* egal */ } }, 25000);
            },
            zu: function () { clearInterval(pingOkx); },
            status: quelle('okx'),
            nachricht: function (m) {
                if (m && m.event === 'error') { status.okx = 'fehler'; melden(); return; }
                if (!m || !m.arg || m.arg.channel !== 'liquidation-orders' || !Array.isArray(m.data)) return;
                m.data.forEach(function (z) {
                    (z.details || []).forEach(function (d) { neueLiq(ausOkx(z, d)); });
                });
            },
        });
        // Kontraktgroessen aller OKX-Perps auf einmal holen. Ohne bekannte
        // Groesse wird eine OKX-Liquidation verworfen statt falsch gezaehlt.
        // Danach die letzten Liquidationen je Coin fuer die Heatmap nachladen.
        fetch(OKX_REST).then(function (r) { return r.json(); }).then(function (j) {
            (j && j.data || []).forEach(function (ins) {
                const c = coinVon('okx', ins.instId);
                if (c && +ins.ctVal > 0) COINS[c].ctVal = +ins.ctVal;
            });
        }).catch(function () { /* Rueckfall fuer BTC/ETH/SOL bleibt */ }).then(historieLaden);

        function historieLaden() {
            Promise.all(NAMEN.map(function (c) {
                if (!(COINS[c].ctVal > 0)) return [];
                return fetch(OKX_LIQ + c + '-USDT').then(function (r) { return r.json(); }).then(function (j) {
                    const aus = [];
                    (j && j.data || []).forEach(function (z) {
                        (z.details || []).forEach(function (d) {
                            const l = ausOkx({ instId: COINS[c].okx }, d);
                            if (l) aus.push(l);
                        });
                    });
                    return aus;
                }).catch(function () { return []; });
            })).then(function (teile) {
                liq.historieSetzen([].concat.apply([], teile));
                if (ui.historie) ui.historie();
            });
        }

        // Orderbuch nicht bei jedem Ereignis zeichnen (10x pro Sekunde je
        // Coin), sondern hoechstens viermal pro Sekunde
        const tick = setInterval(function () {
            if (ui.orderbuch) BUCH_NAMEN.forEach(function (c) {
                if (buecher[c].bereit) ui.orderbuch(c, buecher[c]);
            });
        }, 250);

        return {
            buecher: buecher, liq: liq,
            stoppen: function () {
                buch.schliessen(); binance.schliessen(); bybit.schliessen(); okx.schliessen();
                clearInterval(tick); clearInterval(ping); clearInterval(pingOkx);
            },
        };
    }

    async function fngHolen() {
        const r = await fetch(FNG_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return fngLesen(await r.json());
    }

    window.cfMarkt = {
        COINS: COINS, Orderbuch: Orderbuch, gruppieren: gruppieren, kennzahlen: kennzahlen,
        kerzenHolen: kerzenHolen, ausBinance: ausBinance, ausBybit: ausBybit, ausOkx: ausOkx, LiqStatistik: LiqStatistik, NAMEN: NAMEN, BUCH_NAMEN: BUCH_NAMEN,
        fngLesen: fngLesen, fngHolen: fngHolen, starten: starten,
    };
})();
