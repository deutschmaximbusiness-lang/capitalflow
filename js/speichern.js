/* CapitalFlow - Schreiben in die Datenbank
 *
 * Die Oberfläche arbeitet weiter synchron auf dem localStorage. Nach
 * jeder Änderung wird sie hier nachgezogen: erst in die Datenbank, dann
 * den Zwischenspeicher neu aus der Datenbank füllen und die Ansichten
 * neu aufbauen.
 *
 * Das kostet eine Netzrunde pro Änderung - dafür können lokaler Stand
 * und Datenbank nicht auseinanderlaufen. Zwei getrennt gepflegte
 * Zustände waren die Ursache jedes Fehlers dieser Woche.
 */
(function () {
    'use strict';

    const instrumente = {};       // Symbol -> id, innerhalb der Sitzung

    const STATUS = { watching: 'beobachten', ready: 'bereit',
                     entered: 'eingestiegen', discarded: 'verworfen' };

    /**
     * Datum aus der App in einen Zeitstempel.
     *
     * addTrade() speichert mit toLocaleDateString('de-DE'), also
     * "24.09.2026". new Date() versteht das nicht und liefert Invalid
     * Date - stillschweigend, weshalb ohne diese Funktion alle Trades
     * auf dem heutigen Datum gelandet waeren.
     */
    function alsZeitpunkt(v, ersatz) {
        const fallback = ersatz || new Date().toISOString();
        if (!v) return fallback;
        const s = String(v).trim();

        // deutsches Format: TT.MM.JJJJ
        const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (de) {
            const d = new Date(Date.UTC(+de[3], +de[2] - 1, +de[1], 12, 0, 0));
            return isNaN(d.getTime()) ? fallback : d.toISOString();
        }

        const d = new Date(s);
        return isNaN(d.getTime()) ? fallback : d.toISOString();
    }


    function meldung(t, typ) {
        if (typeof showToast === 'function') showToast(t, typ);
    }

    async function uid() {
        const s = await window.cfSitzung();
        return s ? s.user.id : null;
    }

    function bereit() {
        return Boolean(window.cfDb && window.cfDatenLaden);
    }

    // ------------------------------------------------------ Instrumente

    async function instrumentId(symbol) {
        const s = String(symbol || '').trim().toUpperCase();
        if (!s || s === '—' || s === '-') return null;
        if (instrumente[s]) return instrumente[s];

        const { data, error } = await window.cfDb
            .from('instruments').select('id, symbol').eq('symbol', s).maybeSingle();
        if (error) throw new Error('Basiswert suchen: ' + error.message);
        if (data) { instrumente[s] = data.id; return data.id; }

        const { data: neu, error: f2 } = await window.cfDb
            .from('instruments').insert({ symbol: s, created_by: await uid() })
            .select('id').single();
        if (f2) throw new Error('Basiswert anlegen: ' + f2.message);
        instrumente[s] = neu.id;
        return neu.id;
    }

    // -------------------------------------------------------- Produkte

    /**
     * Sucht das Zertifikat oder legt es an.
     *
     * products ist eine gemeinsame Tabelle: handeln zwei Nutzer denselben
     * Knock-Out, soll das auch dieselbe Zeile sein. Ueber die WKN geht
     * das eindeutig. Ohne WKN - und die tippt kaum jemand ab - dient die
     * Kombination aus Basiswert, Richtung, Basispreis und Schwelle als
     * Kennzeichen; dafuer liegt ein eindeutiger Index in 03_zertifikate.sql.
     */
    async function produktId(instrument, p) {
        if (!p || !p.art || p.art === 'aktie') return null;
        if (!instrument) return null;
        // Die Zertifikatsfelder sind freiwillig. Ohne Basispreis bzw.
        // Faktor liesse sich keine gueltige Produktzeile anlegen - der
        // Trade wird trotzdem gespeichert, nur eben ohne Produktbezug.
        if (p.art === 'faktor' ? !p.faktor : !p.strike) return null;

        const db = window.cfDb;

        if (p.wkn) {
            const { data, error } = await db.from('products')
                .select('id').eq('wkn', p.wkn).maybeSingle();
            if (error) throw new Error('Produkt suchen: ' + error.message);
            if (data) return data.id;
        } else {
            let frage = db.from('products').select('id')
                .eq('instrument_id', instrument)
                .eq('kind', p.art)
                .eq('direction', p.richtung)
                .is('wkn', null);
            frage = p.art === 'faktor'
                ? frage.eq('factor', p.faktor)
                : frage.eq('strike', p.strike)
                       .eq('ko_barrier', p.ko !== null ? p.ko : p.strike);
            const { data, error } = await frage.maybeSingle();
            if (error) throw new Error('Produkt suchen: ' + error.message);
            if (data) return data.id;
        }

        const zeile = {
            instrument_id: instrument,
            kind: p.art,
            direction: p.richtung,
            wkn: p.wkn || null,
            issuer: p.emittent || null,
            created_by: await uid(),
        };
        if (p.art === 'faktor') {
            zeile.factor = p.faktor;
            // Das Schema verlangt bei Zertifikaten Basispreis und
            // Bezugsverhaeltnis. Ein Faktor-Zertifikat hat beides nicht -
            // deshalb hier neutrale Werte statt einer Ausnahme im Check.
            zeile.strike = 0;
            zeile.ratio = 1;
        } else {
            zeile.strike = p.strike;
            zeile.ratio = p.ratio !== null && p.ratio !== undefined ? p.ratio : 1;
            zeile.ko_barrier = p.ko !== null && p.ko !== undefined ? p.ko : p.strike;
        }

        const { data: neu, error: f2 } = await db.from('products')
            .insert(zeile).select('id').single();
        // Zwei Geraete koennen dasselbe Produkt gleichzeitig anlegen. Der
        // eindeutige Index faengt das ab; dann gewinnt die andere Zeile.
        if (f2) {
            if (String(f2.code) === '23505') {
                const { data: da } = await db.from('products').select('id')
                    .eq('instrument_id', instrument).eq('kind', p.art)
                    .eq('direction', p.richtung).limit(1).maybeSingle();
                if (da) return da.id;
            }
            throw new Error('Produkt anlegen: ' + f2.message);
        }
        return neu.id;
    }

    // ------------------------------------------------------ Screenshot

    function alsBlob(dataUrl) {
        const teile = String(dataUrl || '').split(',');
        if (teile.length < 2) return null;
        const typ = (teile[0].match(/data:([^;]+)/) || [, 'image/png'])[1];
        try {
            const roh = atob(teile[1]);
            const bytes = new Uint8Array(roh.length);
            for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
            return new Blob([bytes], { type: typ });
        } catch (e) { return null; }
    }

    async function screenshotHoch(dataUrl) {
        // Kommt schon eine Adresse statt Base64, liegt das Bild bereits
        // im Storage - dann nichts tun
        if (!dataUrl || !String(dataUrl).startsWith('data:')) return null;
        const blob = alsBlob(dataUrl);
        if (!blob) return null;
        const endung = ({ 'image/png': 'png', 'image/jpeg': 'jpg',
                          'image/webp': 'webp' })[blob.type] || 'png';
        const pfad = (await uid()) + '/' + Date.now() + '-'
                   + Math.random().toString(36).slice(2, 8) + '.' + endung;
        const { error } = await window.cfDb.storage
            .from('screenshots').upload(pfad, blob, { contentType: blob.type });
        if (error) {
            // Ein Bild ist nie wichtiger als der Trade daran
            console.warn('Screenshot nicht gespeichert:', error.message);
            return null;
        }
        return pfad;
    }

    // ---------------------------------------------------------- Rahmen

    /**
     * Führt eine Schreiboperation aus und zieht danach alles nach.
     *
     * Bei Fehlern bleibt der lokale Stand stehen und der Nutzer wird
     * gewarnt - lieber eine sichtbare Warnung als stillschweigend
     * auseinanderlaufende Daten.
     */
    async function schreiben(fn, was) {
        if (!bereit()) return;
        try {
            await fn();
            const r = await window.cfDatenLaden();
            if (r && r.ok && typeof window.cfAnsichtenAufbauen === 'function') {
                window.cfAnsichtenAufbauen();
            }
        } catch (e) {
            console.error(was, e);
            meldung('⚠️ ' + was + ' nicht gespeichert: ' + e.message, 'error');
        }
    }

    function pruefe(error, was) {
        if (error) throw new Error(was + ': ' + error.message);
    }

    // ------------------------------------------------------- Aufrufe

    window.cfDbTradeNeu = function (t) {
        return schreiben(async function () {
            const basis = await instrumentId(t.ticker);
            const p = t.produkt || null;
            const zeile = {
                user_id: await uid(),
                instrument_id: basis,
                product_id: await produktId(basis, p),
                underlying_entry: p ? p.basisEin : null,
                underlying_exit: p ? p.basisAus : null,
                underlying_stop: p ? p.basisStop : null,
                leverage_effective: p ? p.hebelEffektiv : null,
                ko_distance_percent: p ? p.koAbstandProzent : null,
                status: 'geschlossen',
                direction: t.direction === 'short' ? 'short' : 'long',
                entry_price: t.entryPrice,
                exit_price: t.exitPrice,
                stop_loss: t.stopLoss || null,
                position_size: t.positionSize,
                quantity: t.entryPrice ? t.positionSize / t.entryPrice : null,
                leverage: t.leverage || 1,
                pnl: t.pnl,
                pnl_percent: t.pnlPercent,
                risk_amount: t.risk || null,
                thesis: t.reason || null,
                notes: t.setupType
                    ? ((t.notes ? t.notes + '\n\n' : '') + 'Setup: ' + t.setupType)
                    : (t.notes || null),
                error_type: t.errorType || null,
                screenshot_path: await screenshotHoch(t.screenshot),
                opened_at: alsZeitpunkt(t.date),
                closed_at: alsZeitpunkt(t.date),
                source: 'manuell',
            };
            const { error } = await window.cfDb.from('trades').insert(zeile);
            pruefe(error, 'Trade anlegen');
        }, 'Trade');
    };

    window.cfDbPositionNeu = function (p) {
        return schreiben(async function () {
            const zeile = {
                user_id: await uid(),
                instrument_id: await instrumentId(p.ticker),
                status: 'offen',
                direction: 'long',
                entry_price: p.entry,
                position_size: p.size,
                quantity: p.entry ? p.size / p.entry : null,
                leverage: 1,
                thesis: p.thesis || null,
                screenshot_path: await screenshotHoch(p.screenshot),
                opened_at: p.dateOpened || new Date().toISOString(),
                source: 'manuell',
            };
            const { error } = await window.cfDb.from('trades').insert(zeile);
            pruefe(error, 'Position anlegen');
        }, 'Position');
    };

    window.cfDbPositionSchliessen = function (id, exitPrice, exitReason, pnl, pnlPercent) {
        return schreiben(async function () {
            const { error } = await window.cfDb.from('trades').update({
                status: 'geschlossen',
                exit_price: exitPrice,
                exit_reason: exitReason || null,
                pnl: pnl,
                pnl_percent: pnlPercent,
                closed_at: new Date().toISOString(),
            }).eq('id', id);
            pruefe(error, 'Position schließen');
        }, 'Position schließen');
    };

    window.cfDbLoeschen = function (tabelle, id) {
        return schreiben(async function () {
            const { error } = await window.cfDb.from(tabelle).delete().eq('id', id);
            pruefe(error, 'Löschen');
        }, 'Löschen');
    };

    window.cfDbTransaktionNeu = function (t) {
        return schreiben(async function () {
            const { error } = await window.cfDb.from('transactions').insert({
                user_id: await uid(),
                kind: t.type === 'withdrawal' ? 'auszahlung' : 'einzahlung',
                amount: Math.abs(t.amount),
                booked_at: t.date,
                note: t.note || null,
            });
            pruefe(error, 'Transaktion anlegen');
        }, 'Transaktion');
    };

    window.cfDbSetupNeu = function (s) {
        return schreiben(async function () {
            const { error } = await window.cfDb.from('setups').insert({
                user_id: await uid(),
                instrument_id: await instrumentId(s.ticker),
                direction: s.direction === 'short' ? 'short' : 'long',
                entry_from: s.entryFrom, entry_to: s.entryTo,
                stop_loss: s.stop, target: s.target,
                thesis: s.thesis || null,
                status: ({ watching: 'beobachten', ready: 'bereit',
                           entered: 'eingestiegen', discarded: 'verworfen'
                         })[s.status] || 'beobachten',
            });
            pruefe(error, 'Setup anlegen');
        }, 'Setup');
    };

    /** Ids aus der Datenbank sind UUIDs, lokal neu angelegte Zahlen. */
    function ausDb(id) {
        return typeof id === 'string' && id.length === 36 && id.indexOf('-') > 0;
    }

    /**
     * Setups laufen in app.js alle durch saveSetups(liste). Statt neun
     * Aufrufstellen zu suchen, wird hier verglichen, was sich geaendert
     * hat - neu, weg, oder anderer Status.
     */
    window.cfDbSetupsAbgleichen = function (vorher, nachher) {
        return schreiben(async function () {
            const altIds = new Set(vorher.filter(function (s) {
                return ausDb(s.id);
            }).map(function (s) { return s.id; }));
            const neuIds = new Set(nachher.filter(function (s) {
                return ausDb(s.id);
            }).map(function (s) { return s.id; }));

            // Entfernt
            for (const id of altIds) {
                if (neuIds.has(id)) continue;
                const { error } = await window.cfDb.from('setups')
                    .delete().eq('id', id);
                pruefe(error, 'Setup löschen');
            }

            // Neu
            const nutzer = await uid();
            for (const s of nachher) {
                if (ausDb(s.id)) continue;
                const { error } = await window.cfDb.from('setups').insert({
                    user_id: nutzer,
                    instrument_id: await instrumentId(s.ticker),
                    direction: s.direction === 'short' ? 'short' : 'long',
                    entry_from: s.entryFrom, entry_to: s.entryTo,
                    stop_loss: s.stop, target: s.target,
                    thesis: s.thesis || null,
                    status: STATUS[s.status] || 'beobachten',
                });
                pruefe(error, 'Setup anlegen');
            }

            // Geaendert
            const altNach = {};
            vorher.forEach(function (s) { altNach[s.id] = s; });
            for (const s of nachher) {
                if (!ausDb(s.id)) continue;
                const a = altNach[s.id];
                if (!a || a.status === s.status) continue;
                const { error } = await window.cfDb.from('setups').update({
                    status: STATUS[s.status] || 'beobachten',
                }).eq('id', s.id);
                pruefe(error, 'Setup ändern');
            }
        }, 'Setups');
    };

    window.cfDbSetupStatus = function (id, status) {
        return schreiben(async function () {
            const { error } = await window.cfDb.from('setups').update({
                status: ({ watching: 'beobachten', ready: 'bereit',
                           entered: 'eingestiegen', discarded: 'verworfen'
                         })[status] || 'beobachten',
            }).eq('id', id);
            pruefe(error, 'Setup ändern');
        }, 'Setup ändern');
    };
})();
