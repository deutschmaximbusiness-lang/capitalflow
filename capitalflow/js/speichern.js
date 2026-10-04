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
            // Das Schema verlangt bei Zertifikaten einen Basispreis. Ein
            // Faktor-Zertifikat hat keinen - deshalb hier ein neutraler
            // Wert statt einer Ausnahme im Check.
            zeile.strike = 0;
        } else {
            zeile.strike = p.strike;
            // Kein Bezugsverhaeltnis eingetragen heisst UNBEKANNT, nicht
            // eins. Eine erfundene 1 sieht aus wie eine Angabe, und die
            // Hebelrechnung bevorzugt den Weg ueber das Verhaeltnis -
            // bei einem Schein mit echtem 0,1 kaeme der zehnfache Hebel
            // heraus, ohne dass irgendwo etwas unplausibel aussieht.
            zeile.ratio = p.ratio !== null && p.ratio !== undefined
                ? p.ratio : null;
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

    // ------------------------------------------------------ Playbook

    /** Strategie-Ids sind UUIDs aus dem Browser, lokale Trade-Ids Zahlen. */
    function alsUuid(v) {
        return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    }

    /**
     * Die Playbook-Felder eines Trades fuer die Datenbank.
     *
     * Ganz geschrieben, auch wenn leer: wer beim Bearbeiten die Strategie
     * wieder entfernt, muss sie auch in der Datenbank verlieren.
     */
    function playbookSpalten(t) {
        const r = parseFloat(t.rMultiple);
        return {
            strategy_id: alsUuid(t.strategyId),
            rules_followed: t.strategyId && t.regelnErfuellt
                && typeof t.regelnErfuellt === 'object' ? t.regelnErfuellt : null,
            r_multiple: Number.isFinite(r) ? r : null,
            earnings_at: t.earningsAm || null,
        };
    }

    /**
     * 08_playbook.sql bringt neue Spalten. Laeuft die App schon, bevor
     * das Skript in Supabase ausgefuehrt wurde, wuerde ab sofort JEDER
     * Trade mit "column does not exist" scheitern. Dann lieber ohne die
     * neue Spalte speichern und deutlich sagen, was fehlt.
     */
    const NEUE_SPALTEN = ['earnings_at', 'settings'];
    let spaltenHinweis = false;
    async function ohneFehlendeSpalte(fn, zeile) {
        let r = await fn(zeile);
        const text = r && r.error ? String(r.error.message || '') : '';
        const fehlt = NEUE_SPALTEN.filter(function (s) {
            return text.indexOf(s) >= 0 && Object.prototype.hasOwnProperty.call(zeile, s);
        });
        if (fehlt.length) {
            const ohne = Object.assign({}, zeile);
            fehlt.forEach(function (s) { delete ohne[s]; });
            if (!spaltenHinweis) {
                spaltenHinweis = true;
                meldung('08_playbook.sql ist in Supabase noch nicht ausgeführt – '
                    + 'Earnings-Termin und Grenzen werden erst danach gespeichert.', 'error');
            }
            r = await fn(ohne);
        }
        return r;
    }

    window.cfDbStrategieSpeichern = function (s) {
        return schreiben(async function () {
            const zeile = {
                id: s.id,
                user_id: await uid(),
                name: String(s.name || '').trim(),
                description: s.beschreibung || null,
                rules: Array.isArray(s.regeln) ? s.regeln : [],
                settings: s.grenzen && typeof s.grenzen === 'object' ? s.grenzen : {},
                archived: Boolean(s.archiviert),
            };
            const { error } = await ohneFehlendeSpalte(function (z) {
                return window.cfDb.from('strategies').upsert(z, { onConflict: 'id' });
            }, zeile);
            if (error && /strategies_user_id_name_key|duplicate key/.test(error.message || '')) {
                throw new Error('Es gibt schon eine Strategie mit diesem Namen');
            }
            pruefe(error, 'Strategie speichern');
        }, 'Strategie');
    };

    /**
     * Einstellungen des Playbooks (Kapital) am Profil. Gelesen, ergaenzt,
     * zurueckgeschrieben - settings kann spaeter mehr enthalten, und ein
     * blindes Ueberschreiben wuerde das jedes Mal wegwischen.
     */
    window.cfDbPlaybookEinstellungen = function (werte) {
        return schreiben(async function () {
            const id = await uid();
            const { data, error } = await window.cfDb.from('profiles')
                .select('*').eq('id', id).maybeSingle();
            pruefe(error, 'Profil lesen');
            if (!data || !Object.prototype.hasOwnProperty.call(data, 'settings')) {
                throw new Error('08_playbook.sql ist in Supabase noch nicht ausgeführt');
            }
            const neu = Object.assign({}, data.settings || {}, { playbook: werte || {} });
            const { error: e2 } = await window.cfDb.from('profiles')
                .update({ settings: neu }).eq('id', id);
            pruefe(e2, 'Einstellung speichern');
        }, 'Einstellung');
    };

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
                // Der Setup-Typ hat seit 06_bearbeiten.sql eine eigene
                // Spalte. Vorher wurde er hinten an die Notizen geklebt
                // und beim Laden nicht wieder herausgeholt - jeder
                // Klick im Formular war nach dem Neustart weg.
                notes: t.notes || null,
                setup_type: t.setupType || null,
                error_type: t.errorType || null,
                ...playbookSpalten(t),
                screenshot_path: await screenshotHoch(t.screenshot),
                opened_at: alsZeitpunkt(t.date),
                closed_at: alsZeitpunkt(t.date),
                source: 'manuell',
            };
            const { error } = await ohneFehlendeSpalte(function (z) {
                return window.cfDb.from('trades').insert(z);
            }, zeile);
            pruefe(error, 'Trade anlegen');
        }, 'Trade');
    };

    /**
     * Einen bestehenden Trade ueberschreiben.
     *
     * Der Grund, warum es das gibt: nach einem CSV-Import stehen vierzig
     * Trades im Journal, denen Stop, These, Setup-Typ und die
     * Hebelzahlen fehlen - die Trade-Republic-Datei nennt sie nicht. Ohne
     * einen Weg, das nachzutragen, bleibt die halbe Auswertung dauerhaft
     * leer und der Import ist nicht mehr als eine Kontoauszugsanzeige.
     *
     * Geschrieben wird der GANZE Datensatz, nicht nur die geaenderten
     * Felder. Ein Teilupdate muesste wissen, was sich geaendert hat, und
     * jedes Feld, an das dabei niemand denkt, bleibt still auf dem alten
     * Wert stehen - dieselbe Klasse Fehler wie der verschluckte
     * Setup-Typ.
     */
    window.cfDbTradeAendern = function (id, t) {
        return schreiben(async function () {
            const basis = await instrumentId(t.ticker);
            const p = t.produkt || null;

            // Bild: ein neues kommt als data:-URL und wird hochgeladen.
            // Kommt eine signierte Adresse zurueck, liegt das Bild schon
            // im Storage - dann bleibt der bekannte Pfad stehen, statt
            // ihn durch null zu ersetzen und das Bild zu verlieren.
            let bild = t.screenshotPfad || null;
            if (t.screenshot && String(t.screenshot).startsWith('data:')) {
                bild = await screenshotHoch(t.screenshot);
            } else if (!t.screenshot) {
                bild = null;
            }

            const zeile = {
                instrument_id: basis,
                product_id: await produktId(basis, p),
                underlying_entry: p ? p.basisEin : null,
                underlying_exit: p ? p.basisAus : null,
                underlying_stop: p ? p.basisStop : null,
                leverage_effective: p ? p.hebelEffektiv : null,
                ko_distance_percent: p ? p.koAbstandProzent : null,
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
                notes: t.notes || null,
                setup_type: t.setupType || null,
                error_type: t.errorType || null,
                ...playbookSpalten(t),
                screenshot_path: bild,
                // Die beiden Zeitpunkte bleiben, wie sie sind.
                //
                // Das Formular hat kein Datumsfeld - es kennt nur das
                // Anzeigedatum. Beides daraus neu zu setzen wuerde bei
                // jedem importierten Trade den Kaufzeitpunkt auf den
                // Verkaufstag ziehen: aus drei Wochen Haltedauer wuerden
                // null Tage, und die Haltedaueranalyse waere nach dem
                // ersten Nachtragen wertlos. Nur wenn nichts da ist,
                // wird aus dem Anzeigedatum einer gemacht.
                opened_at: t.geoeffnet || alsZeitpunkt(t.date),
                closed_at: t.geschlossen || alsZeitpunkt(t.date),
                // Was den Trade unvollstaendig gemacht hat, war das
                // Fehlen von Stop und These. Sind beide da, ist die
                // Markierung erledigt - und zwar hier, nicht als
                // Handgriff, den man vergessen kann.
                incomplete: !(t.stopLoss > 0 && String(t.reason || '').trim()),
            };
            const { error } = await ohneFehlendeSpalte(function (z) {
                return window.cfDb.from('trades').update(z).eq('id', id);
            }, zeile);
            pruefe(error, 'Trade ändern');
        }, 'Trade ändern');
    };

    window.cfDbPositionNeu = function (p) {
        return schreiben(async function () {
            const basis = await instrumentId(p.ticker);
            const pr = p.produkt || null;
            const zeile = {
                user_id: await uid(),
                instrument_id: basis,
                product_id: await produktId(basis, pr),
                status: 'offen',
                direction: p.direction === 'short' ? 'short' : 'long',
                entry_price: p.entry,
                position_size: p.size,
                quantity: p.entry ? p.size / p.entry : null,
                leverage: pr && pr.hebelEffektiv ? pr.hebelEffektiv : 1,
                underlying_entry: pr ? pr.basisEin : null,
                underlying_stop: pr ? pr.basisStop : null,
                leverage_effective: pr ? pr.hebelEffektiv : null,
                ko_distance_percent: pr ? pr.koAbstandProzent : null,
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
                ko_barrier: s.ko || null,
                thesis: s.thesis || null,
                screenshot_path: await screenshotHoch(s.screenshot),
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
                    ko_barrier: s.ko || null,
                    thesis: s.thesis || null,
                    // Das Bild fehlte hier: nach dem Speichern wurde neu aus
                    // der Datenbank geladen, und der Screenshot war weg.
                    screenshot_path: await screenshotHoch(s.screenshot),
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
