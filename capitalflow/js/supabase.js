/* CapitalFlow - Verbindung zur Datenbank
 *
 * Der anon key darf hier offen stehen: er ist fuer den Browser gedacht
 * und gibt fuer sich genommen keinen Zugriff. Was ein angemeldeter
 * Nutzer sehen darf, entscheidet Row Level Security in der Datenbank,
 * nicht dieser Schluessel.
 *
 * Der service_role key gehoert NIEMALS in diese Datei. Der umgeht RLS
 * vollstaendig, und diese Datei liegt oeffentlich auf GitHub.
 */
(function () {
    'use strict';

    const URL_ = 'https://vraymusbcgsoksnsfwiv.supabase.co';
    const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyYXltdXNiY2dzb2tzbnNmd2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODI4NzMsImV4cCI6MjEwNTc1ODg3M30.56lXJvmsBw4fYCV46h6xPuupI2AdH1ohqp82WF39pLg';

    if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.error('[CapitalFlow] js/vendor/supabase.js fehlt oder wurde '
            + 'nach dieser Datei geladen.');
        window.cfDb = null;
        return;
    }

    window.cfDb = supabase.createClient(URL_, ANON, {
        auth: {
            persistSession: true,       // Anmeldung ueberlebt das Neuladen
            autoRefreshToken: true,
            detectSessionInUrl: true,   // fuer Bestaetigungslinks aus E-Mails
            // Eigener Schluessel, damit die Sitzung nicht mit den alten
            // capitalflow_*-Eintraegen im localStorage kollidiert
            storageKey: 'capitalflow_auth',
        },
    });

    /**
     * Prueft die Verbindung UND die Absicherung in einem Durchgang.
     *
     * Ohne Anmeldung muss die Datenbank den Zugriff verweigern. Kommen
     * hier Daten zurueck, ist etwas grundlegend falsch konfiguriert -
     * dann koennte jeder mit dem anon key alles auslesen.
     *
     * In der Console aufrufen: await cfVerbindungstest()
     */
    window.cfVerbindungstest = async function () {
        if (!window.cfDb) return { ok: false, grund: 'Client nicht geladen' };

        try {
            const { data, error } = await window.cfDb
                .from('instruments').select('id').limit(1);

            if (error) {
                const text = error.message || '';

                // supabase-js verpackt auch Netzwerkfehler als error-Objekt,
                // statt zu werfen - ohne diesen Zweig stuende hier nur
                // "Failed to fetch", und man sucht im falschen Bereich
                if (/failed to fetch|networkerror|load failed/i.test(text)) {
                    return { ok: false, grund: 'Server nicht erreichbar. '
                        + 'Falsche URL, Projekt pausiert oder kein Netz.' };
                }

                // 42501 = permission denied. Genau das wollen wir ohne Login.
                const abgesichert = error.code === '42501'
                    || /permission denied|JWT|row-level security/i.test(text);
                return abgesichert
                    ? { ok: true, server: 'antwortet', abgesichert: true,
                        hinweis: 'Zugriff ohne Anmeldung korrekt verweigert' }
                    : { ok: false, grund: text, code: error.code };
            }

            if (Array.isArray(data)) {
                return { ok: false, abgesichert: false,
                    grund: 'ACHTUNG: Daten ohne Anmeldung lesbar. '
                         + 'RLS oder die Rechte stimmen nicht.' };
            }
            return { ok: false, grund: 'Unerwartete Antwort' };

        } catch (e) {
            // Kein HTTP-Fehler, sondern gar keine Antwort: falsche URL,
            // Projekt pausiert oder kein Netz
            return { ok: false, grund: 'Server nicht erreichbar: ' + e.message };
        }
    };

    /** Aktuelle Sitzung oder null. */
    window.cfSitzung = async function () {
        if (!window.cfDb) return null;
        const { data } = await window.cfDb.auth.getSession();
        return data ? data.session : null;
    };
})();
