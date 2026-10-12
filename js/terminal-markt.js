/* CapitalFlow Krypto Terminal - Marktdaten
 *
 * Alles hier kommt direkt aus den oeffentlichen Schnittstellen der
 * Boersen in den Browser. Kein eigener Server, kein Schluessel.
 *
 *   Orderbuch      Binance USDⓈ-M Futures (Perps), Diff-Stream + Snapshot
 *   Liquidationen  Binance (gedrosselt: max. 1 je Coin und Sekunde)
 *                  + Bybit (alle Liquidationen, alle 500 ms gebuendelt)
 *   Kurs, Funding  Binance Futures
 *   Fear & Greed   alternative.me
 *
 * Liquidations-Summen zaehlen ab dem Oeffnen der Seite. 24h-Summen
 * brauchen einen Dienst, der rund um die Uhr mitschreibt (Stufe 2).
 */
(function () {
    'use strict';

    const COINS = {
        BTC: { binance: 'btcusdt', bybit: 'BTCUSDT', stufen: [1, 10, 50, 100], stufe: 10, nachkomma: 1 },
        ETH: { binance: 'ethusdt', bybit: 'ETHUSDT', stufen: [0.1, 0.5, 1, 5], stufe: 0.5, nachkomma: 2 },
    };

    const BINANCE_WS = 'wss://fstream.binance.com/stream?streams=';
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
        const coin = o.s === 'BTCUSDT' ? 'BTC' : o.s === 'ETHUSDT' ? 'ETH' : null;
        if (!coin) return null;
        const menge = +(o.z || o.q), preis = +(o.ap || o.p);
        if (!(menge > 0) || !(preis > 0)) return null;
        // SELL-Auftrag = eine Long-Position wurde zwangsgeschlossen
        return { boerse: 'Binance', coin: coin, seite: o.S === 'SELL' ? 'long' : 'short',
                 menge: menge, preis: preis, wert: menge * preis, zeit: +o.T || Date.now() };
    }
    function ausBybit(d) {
        if (!d || !d.s) return null;
        const coin = d.s === 'BTCUSDT' ? 'BTC' : d.s === 'ETHUSDT' ? 'ETH' : null;
        if (!coin) return null;
        const menge = +d.v, preis = +d.p;
        if (!(menge > 0) || !(preis > 0)) return null;
        // Bybit: "Buy" = eine Long-Position wurde liquidiert
        return { boerse: 'Bybit', coin: coin, seite: d.S === 'Buy' ? 'long' : 'short',
                 menge: menge, preis: preis, wert: menge * preis, zeit: +d.T || Date.now() };
    }

    function LiqStatistik() { this.seit = Date.now(); this.liste = []; }
    LiqStatistik.prototype.neu = function (l) {
        this.liste.unshift(l);
        if (this.liste.length > 5000) this.liste.length = 5000;
    };
    LiqStatistik.prototype.summen = function (coin, abMs) {
        const ab = abMs ? Date.now() - abMs : 0;
        const r = { long: 0, short: 0, anzahl: 0, groesste: null };
        for (let i = 0; i < this.liste.length; i++) {
            const l = this.liste[i];
            if (l.coin !== coin || l.zeit < ab) continue;
            r[l.seite] += l.wert; r.anzahl++;
            if (!r.groesste || l.wert > r.groesste.wert) r.groesste = l;
        }
        return r;
    };

    // ---------------------------------------------------- Fear & Greed

    const FNG_DE = { 'Extreme Fear': 'Extreme Angst', 'Fear': 'Angst', 'Neutral': 'Neutral',
                     'Greed': 'Gier', 'Extreme Greed': 'Extreme Gier' };
    function fngLesen(json) {
        const d = json && Array.isArray(json.data) ? json.data : [];
        if (!d.length) return null;
        const wert = function (i) { return d[i] ? { wert: +d[i].value, text: FNG_DE[d[i].value_classification] || d[i].value_classification } : null; };
        return { heute: wert(0), gestern: wert(1), woche: wert(7), monat: wert(30),
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
        const buecher = { BTC: new Orderbuch(), ETH: new Orderbuch() };
        const liq = new LiqStatistik();
        const status = { binance: 'verbinde', bybit: 'verbinde' };
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

        const streams = [];
        Object.keys(COINS).forEach(function (c) {
            const s = COINS[c].binance;
            streams.push(s + '@depth@100ms', s + '@forceOrder', s + '@ticker', s + '@markPrice@1s');
        });

        const binance = new Leitung(BINANCE_WS + streams.join('/'), {
            offen: function () { Object.keys(COINS).forEach(snapshot); },
            status: function (s) { status.binance = s; melden(); },
            nachricht: function (m) {
                const name = m.stream || '', d = m.data || {};
                const coin = name.indexOf('btcusdt') === 0 ? 'BTC' : name.indexOf('ethusdt') === 0 ? 'ETH' : null;
                if (!coin) return;
                if (name.indexOf('@depth') > 0) {
                    if (!buecher[coin].ereignis(d)) snapshot(coin);
                } else if (name.indexOf('@forceOrder') > 0) {
                    const l = ausBinance(d.o);
                    if (l) { liq.neu(l); if (ui.liquidation) ui.liquidation(l); }
                } else if (name.indexOf('@ticker') > 0) {
                    if (ui.kurs) ui.kurs(coin, { preis: +d.c, prozent: +d.P });
                } else if (name.indexOf('@markPrice') > 0) {
                    if (ui.funding) ui.funding(coin, { rate: +d.r, naechste: +d.T });
                }
            },
        });

        let ping = null;
        const bybit = new Leitung(BYBIT_WS, {
            offen: function (ws) {
                ws.send(JSON.stringify({ op: 'subscribe', args: Object.keys(COINS).map(function (c) { return 'allLiquidation.' + COINS[c].bybit; }) }));
                clearInterval(ping);
                ping = setInterval(function () { try { ws.send(JSON.stringify({ op: 'ping' })); } catch (e) { /* egal */ } }, 20000);
            },
            zu: function () { clearInterval(ping); },
            status: function (s) { status.bybit = s; melden(); },
            nachricht: function (m) {
                if (!m || typeof m.topic !== 'string' || m.topic.indexOf('allLiquidation.') !== 0) return;
                (Array.isArray(m.data) ? m.data : [m.data]).forEach(function (d) {
                    const l = ausBybit(d);
                    if (l) { liq.neu(l); if (ui.liquidation) ui.liquidation(l); }
                });
            },
        });

        // Orderbuch nicht bei jedem Ereignis zeichnen (10x pro Sekunde je
        // Coin), sondern hoechstens viermal pro Sekunde
        const tick = setInterval(function () {
            if (ui.orderbuch) Object.keys(COINS).forEach(function (c) {
                if (buecher[c].bereit) ui.orderbuch(c, buecher[c]);
            });
        }, 250);

        return {
            buecher: buecher, liq: liq,
            stoppen: function () { binance.schliessen(); bybit.schliessen(); clearInterval(tick); clearInterval(ping); },
        };
    }

    async function fngHolen() {
        const r = await fetch(FNG_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return fngLesen(await r.json());
    }

    window.cfMarkt = {
        COINS: COINS, Orderbuch: Orderbuch, gruppieren: gruppieren, kennzahlen: kennzahlen,
        ausBinance: ausBinance, ausBybit: ausBybit, LiqStatistik: LiqStatistik,
        fngLesen: fngLesen, fngHolen: fngHolen, starten: starten,
    };
})();
