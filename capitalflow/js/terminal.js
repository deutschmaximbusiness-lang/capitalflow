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
        toast.zeit = setTimeout(function () { t.hidden = true; }, 3200);
    }

    // ------------------------------------------------------------ Zugang

    let profil = null;

    function tor(text, knoepfe) {
        el('tmTorText').textContent = text;
        el('tmTorKnoepfe').hidden = !knoepfe;
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
                + '<em>' + (st !== 'live' ? (st === 'verbinde' ? 'verbindet' : 'getrennt')
                    : t ? 'zuletzt ' + uhr(t).slice(0, 5) : 'verbunden') + '</em></span>';
        }).join('');
    }

    // -------------------------------------------------------- Orderbuch

    const stufen = {};
    const ZEILEN = 12;

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
        box.innerHTML = window.cfMarkt.NAMEN.map(function (coin) {
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
            + '<span class="tm-liq-preis">@ ' + window.cfZahl(l.preis, l.coin === 'BTC' ? 0 : 2) + '</span>'
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
            const bilder = await bildAdressen(posts);
            el('tmPosts').innerHTML = posts.length ? posts.map(function (p) { return postHtml(p, bilder); }).join('')
                : '<p class="tm-leer">Noch keine Beiträge.' + (profil.is_admin ? ' Dein erster steht oben im Formular.' : '') + '</p>';
            el('tmFeedStand').textContent = posts.length ? posts.length + (posts.length === 1 ? ' Beitrag' : ' Beiträge') : '';
            tweetsLaden();
        })();
        try { await laedt; } finally { laedt = null; }
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
        return Date.now().toString(16) + Math.random().toString(16).slice(2);
    }

    async function senden(e) {
        e.preventDefault();
        fehler('');
        const titel = el('tmTitel').value.trim();
        const text = el('tmText').value.trim();
        const chart = el('tmChart').value.trim();
        const tweet = el('tmTweet').value.trim();
        const zeile = { art: auswahl.art };
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
            el('tmComposer').reset();
            bildWeg();
            toast('Veröffentlicht – alle VIPs sehen es jetzt');
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

        if (profil.is_admin) {
            const f = el('tmComposer');
            f.hidden = false;
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

    async function start() {
        let ok = false;
        try { ok = await zugang(); } catch (e) { tor('Zugang konnte nicht geprüft werden.', true); }
        if (!ok) return;
        el('tmTor').hidden = true;
        el('tmApp').hidden = false;
        buchAufbauen();
        verdrahten();
        markt = window.cfMarkt.starten({
            orderbuch: buchZeigen, kurs: kursZeigen, funding: fundingZeigen, status: statusZeigen,
            liquidation: neueLiquidation,
        });
        liqStatsZeigen();
        setInterval(liqStatsZeigen, 1000);
        fng();
        setInterval(fng, 10 * 60 * 1000);
        await feedLaden();
        live();
    }

    window.cfTerminal = { tvBild: tvBild, tweetTeile: tweetTeile, feedLaden: feedLaden };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
