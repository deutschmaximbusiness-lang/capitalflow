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
    const COINS = {
        BTC: { binance: 'btcusdt', bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP', ctVal: 0.01,
               stufen: [1, 10, 50, 100], stufe: 10, preisStellen: 1, mengeStellen: 3, kursStellen: 0 },
        ETH: { binance: 'ethusdt', bybit: 'ETHUSDT', okx: 'ETH-USDT-SWAP', ctVal: 0.1,
               stufen: [0.1, 0.5, 1, 5], stufe: 0.5, preisStellen: 2, mengeStellen: 2, kursStellen: 2 },
        SOL: { binance: 'solusdt', bybit: 'SOLUSDT', okx: 'SOL-USDT-SWAP', ctVal: 1,
               stufen: [0.01, 0.05, 0.1, 0.5], stufe: 0.05, preisStellen: 2, mengeStellen: 1, kursStellen: 2 },
    };
    const NAMEN = Object.keys(COINS);
    function coinVon(feld, wert) {
        for (let i = 0; i < NAMEN.length; i++) if (COINS[NAMEN[i]][feld] === wert) return NAMEN[i];
        return null;
    }

    const BINANCE_PUBLIC = 'wss://fstream.binance.com/public/stream?streams=';
    const BINANCE_MARKET = 'wss://fstream.binance.com/market/stream?streams=';
    const OKX_WS = 'wss://ws.okx.com:8443/ws/v5/public';
    const OKX_REST = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=';
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
        if (!coin || !d) return null;
        const menge = (+d.sz) * COINS[coin].ctVal, preis = +d.bkPx;
        if (!(menge > 0) || !(preis > 0)) return null;
        const seite = d.posSide === 'long' || d.posSide === 'short' ? d.posSide
            : (d.side === 'sell' ? 'long' : 'short');
        return { boerse: 'OKX', coin: coin, seite: seite,
                 menge: menge, preis: preis, wert: menge * preis, zeit: +d.ts || Date.now() };
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
            if (l.coin !== coin || (l.empfangen || l.zeit) < ab) continue;
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
        NAMEN.forEach(function (c) { buecher[c] = new Orderbuch(); });
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
        const buch = new Leitung(BINANCE_PUBLIC + NAMEN.map(function (c) { return COINS[c].binance + '@depth@100ms'; }).join('/'), {
            offen: function () { NAMEN.forEach(snapshot); },
            status: quelle('orderbuch'),
            nachricht: function (m) {
                const coin = coinVon('binance', String(m.stream || '').split('@')[0]);
                if (coin && m.data && !buecher[coin].ereignis(m.data)) snapshot(coin);
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
                ws.send(JSON.stringify({ op: 'subscribe', args: NAMEN.map(function (c) { return 'allLiquidation.' + COINS[c].bybit; }) }));
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
        // Kontraktgroessen von OKX holen, falls sie sich geaendert haben
        NAMEN.forEach(function (c) {
            fetch(OKX_REST + COINS[c].okx).then(function (r) { return r.json(); }).then(function (j) {
                const v = j && j.data && j.data[0] && +j.data[0].ctVal;
                if (v > 0) COINS[c].ctVal = v;
            }).catch(function () { /* Rueckfall bleibt */ });
        });

        // Orderbuch nicht bei jedem Ereignis zeichnen (10x pro Sekunde je
        // Coin), sondern hoechstens viermal pro Sekunde
        const tick = setInterval(function () {
            if (ui.orderbuch) NAMEN.forEach(function (c) {
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
        ausBinance: ausBinance, ausBybit: ausBybit, ausOkx: ausOkx, LiqStatistik: LiqStatistik, NAMEN: NAMEN,
        fngLesen: fngLesen, fngHolen: fngHolen, starten: starten,
    };
})();
