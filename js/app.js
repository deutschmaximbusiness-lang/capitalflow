// ===== SHA-256 =====
// Eigene Umsetzung statt crypto.subtle: das steht nur in sicheren Kontexten
// zur Verfuegung und faellt weg, sobald die Datei per Doppelklick
// (file://) geoeffnet wird.
function sha256Hex(message) {
    const K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,
        0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
        0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,
        0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,
        0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
        0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,
        0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,
        0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
        0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];

    // UTF-8 kodieren
    const bytes = [];
    for (const ch of unescape(encodeURIComponent(message))) {
        bytes.push(ch.charCodeAt(0));
    }

    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) {
        bytes.push((i < 4 ? Math.floor(bitLen / Math.pow(2, 8 * i)) : 0) & 0xff);
    }

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let pos = 0; pos < bytes.length; pos += 64) {
        const w = new Array(64);
        for (let i = 0; i < 16; i++) {
            w[i] = (bytes[pos + i*4] << 24) | (bytes[pos + i*4 + 1] << 16) |
                   (bytes[pos + i*4 + 2] << 8) | bytes[pos + i*4 + 3];
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
            const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
            w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
        }
        let [a,b,c,d,e,f,g,h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H = H.map((v, i) => (v + [a,b,c,d,e,f,g,h][i]) | 0);
    }

    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

function sha256Hex_selftest() {
    return sha256Hex('abc') ===
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
}

// ===== DATENTRENNUNG PRO ACCESS KEY =====
// Jeder Key bekommt seinen eigenen Datenbestand. Statt jeden einzelnen
// localStorage-Aufruf umzuschreiben, wird hier einmal zentral ein Suffix
// an die Datenschluessel gehaengt: 'trades' wird zu 'trades::CF-XXXX'.
// Fuer den restlichen Code aendert sich dadurch nichts.
(function scopeStoragePerUser() {
    // Nur diese Schluessel werden getrennt. Anmeldedaten bleiben global,
    // sonst koennte sich niemand mehr einloggen.
    const DATA_KEYS = ['trades', 'positions', 'closedPositions', 'transactions', 'setups'];
    const CURRENT = 'capitalflow_current_key';

    const raw = {
        get: localStorage.getItem.bind(localStorage),
        set: localStorage.setItem.bind(localStorage),
        remove: localStorage.removeItem.bind(localStorage)
    };

    // Rohzugriff ohne Trennung - wird fuer Migration und Export gebraucht
    window.cfRawStorage = raw;

    function scoped(key) {
        if (!DATA_KEYS.includes(key)) return key;
        const user = raw.get(CURRENT);
        // Ohne angemeldeten Key gibt es keinen gueltigen Ablageort
        if (!user) return null;
        return key + '::' + user;
    }

    // Am Prototyp ueberschreiben, nicht am Objekt selbst: eine direkte
    // Zuweisung auf localStorage legt dort einen sichtbaren Eintrag an,
    // der beim Durchlaufen des Speichers als Datensatz erscheint.
    const proto = Object.getPrototypeOf(localStorage);
    function override(name, fn) {
        Object.defineProperty(proto, name, {
            value: fn, writable: true, configurable: true, enumerable: false
        });
    }

    override('getItem', function (key) {
        const k = scoped(key);
        return k === null ? null : raw.get(k);
    });
    override('setItem', function (key, val) {
        const k = scoped(key);
        // Vor dem Login nicht schreiben - sonst landen Daten in einem
        // Topf, den spaeter jeder Key sehen wuerde
        if (k === null) return;
        return raw.set(k, val);
    });
    override('removeItem', function (key) {
        const k = scoped(key);
        if (k === null) return;
        return raw.remove(k);
    });

    // Einmalige Uebernahme: Daten aus der Zeit vor der Trennung gehoeren
    // dem ersten Key, der sich danach anmeldet.
    window.cfClaimLegacyData = function (userKey) {
        if (raw.get('capitalflow_legacy_claimed')) return false;
        let moved = false;
        DATA_KEYS.forEach(function (k) {
            const old = raw.get(k);
            const target = k + '::' + userKey;
            if (old && old !== '[]' && !raw.get(target)) {
                raw.set(target, old);
                raw.remove(k);
                moved = true;
            }
        });
        raw.set('capitalflow_legacy_claimed', 'true');
        return moved;
    };
})();

// ===== COUNTDOWN TIMER ===== 
function initCountdownTimer() {
    const updateCountdown = () => {
        const targetDate = new Date("2027-03-01T00:00:00").getTime();   // Launch 1. Maerz 2027
        const now = new Date().getTime();
        const timeLeft = targetDate - now;
        
        const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        document.getElementById("countdownDays").textContent = String(days).padStart(2, "0");
        document.getElementById("countdownHours").textContent = String(hours).padStart(2, "0");
        document.getElementById("countdownMinutes").textContent = String(minutes).padStart(2, "0");
        document.getElementById("countdownSeconds").textContent = String(seconds).padStart(2, "0");
    };
    
    updateCountdown();
    setInterval(updateCountdown, 1000);
}


// ===== TRADING JOURNAL APP =====

// ===== LOGIN SYSTEM =====
// Der Admin-Key steht nicht mehr im Klartext hier, sondern nur
// als Hash in js/keys.js

/**
 * Erzeugt einen Zugangsschluessel.
 *
 * Die alte Fassung war
 *
 *     'CF-' + Math.random().toString(36).substr(2, 16).toUpperCase()
 *
 * und hatte zwei Fehler, die beide nicht auffallen, weil das Ergebnis
 * zufaellig AUSSIEHT:
 *
 *   1. Math.random() ist kein Zufallsgenerator fuer Geheimnisse. Der
 *      Browser benutzt xorshift128+, und aus wenigen Ausgaben laesst
 *      sich der interne Zustand zurueckrechnen. Wer einen Schluessel
 *      bekommen hat, kann daraus die naechsten ableiten.
 *   2. substr(2, 16) liefert keine 16 Zeichen. Eine Gleitkommazahl hat
 *      53 Bit Mantisse, in Basis 36 sind das rund elf Stellen - die
 *      Schluessel waren also kuerzer als beabsichtigt, und mehr als 53
 *      Bit Zufall war ohnehin nicht drin.
 *
 * Jetzt: 20 Zeichen aus crypto.getRandomValues, also rund 100 Bit. Das
 * Alphabet laesst 0/O und 1/I/L weg, weil diese Schluessel abgetippt
 * und vorgelesen werden.
 *
 * Die Gleichverteilung ist wichtig: ein einfaches Modulo auf 256 Werte
 * bevorzugt die ersten Buchstaben des Alphabets leicht. Deshalb werden
 * Bytes ueber 247 verworfen statt umgebogen.
 */
function generateUserKey() {
    const ZEICHEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 31 Zeichen
    const LAENGE = 20;
    const GRENZE = 256 - (256 % ZEICHEN.length);          // 248

    if (!(window.crypto && window.crypto.getRandomValues)) {
        // Lieber gar keinen Schluessel als einen schwachen. Ohne
        // crypto.getRandomValues laeuft die App in einem Browser, der
        // ohnehin nichts von dem kann, was sie braucht.
        throw new Error('Dieser Browser kann keine sicheren Zufallszahlen '
            + 'erzeugen. Schlüssel wurde nicht angelegt.');
    }

    let aus = '';
    while (aus.length < LAENGE) {
        const puffer = new Uint8Array(LAENGE);
        window.crypto.getRandomValues(puffer);
        for (let i = 0; i < puffer.length && aus.length < LAENGE; i++) {
            if (puffer[i] >= GRENZE) continue;            // sonst schief verteilt
            aus += ZEICHEN[puffer[i] % ZEICHEN.length];
        }
    }

    return 'CF-' + aus;
}

/**
 * Bringt einen eingetippten Schluessel auf die Form, ueber die gehasht
 * wird.
 *
 * Gehasht wird immer diese eine Form, sonst haengt der Zugang davon ab,
 * ob jemand Leerzeichen mitkopiert hat. Angezeigt wird der Schluessel in
 * Vierergruppen - wer die Bindestriche mit abtippt, kommt trotzdem rein.
 *
 * Wichtig: bei den alten Schluesseln ("CF-" plus elf Zeichen) muss diese
 * Funktion den Text unveraendert lassen, sonst sperrt sie Marcel und die
 * anderen aus. Deshalb wird nur zusammengeschoben und genau ein
 * Bindestrich nach CF wieder eingesetzt - bei einem alten Schluessel
 * kommt exakt der Ausgangstext heraus.
 */
function cfSchluesselNormalisieren(roh) {
    const nur = String(roh || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!nur) return '';
    if (nur.slice(0, 2) === 'CF') return 'CF-' + nur.slice(2);
    return nur;
}

/** Nur fuer die Anzeige: in Fuenfergruppen, damit man ihn vorlesen kann. */
function cfSchluesselAnzeigen(key) {
    const n = cfSchluesselNormalisieren(key);
    const rest = n.slice(3);
    return 'CF-' + (rest.match(/.{1,5}/g) || []).join('-');
}
window.cfSchluesselNormalisieren = cfSchluesselNormalisieren;
window.cfSchluesselAnzeigen = cfSchluesselAnzeigen;

// Keys liegen jetzt als Hash-Liste in js/keys.js, nicht mehr im Browser.

function initLoginSystem() {
    const loginScreen = document.getElementById('loginScreen');
    const adminPanel = document.getElementById('adminPanel');
    const normalLoginForm = document.getElementById('normalLoginForm');
    const navbar = document.querySelector('.navbar');
    const sidebar = document.querySelector('.sidebar');
    const container = document.querySelector('.container');
    
    const loginKeyInput = document.getElementById('loginKeyInput');
    const loginBtn = document.getElementById('loginBtn');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    
    // Admin panel
    const generateNewKeyBtn = document.getElementById('generateNewKeyBtn');
    const adminUserNameInput = document.getElementById('adminUserNameInput');
    
    // Check if logged in
    // Sitzung ohne aktiven Key stammt aus der Zeit vor der Datentrennung -
    // in dem Fall neu anmelden lassen, sonst waere unklar, wem die Daten gehoeren
    if (localStorage.getItem('capitalflow_logged_in') === 'true' &&
        !window.cfRawStorage.get('capitalflow_current_key')) {
        localStorage.removeItem('capitalflow_logged_in');
    }

    const isLoggedIn = localStorage.getItem('capitalflow_logged_in') === 'true';
    const isAdminLoggedIn = sessionStorage.getItem('capitalflow_admin_logged_in') === 'true';

    // Wer angemeldet ist, entscheidet seit dem Discord-Login js/auth.js -
    // und zwar asynchron, weil die Sitzung erst beim Server erfragt wird.
    // Deshalb hier nichts anzeigen, sonst blitzt kurz der falsche Zustand
    // auf. Die Ereignisbehandlung weiter unten wird trotzdem verdrahtet,
    // weil der Admin-Pfad sie braucht.
    const authUebernimmt = Boolean(window.cfDb) && !isAdminLoggedIn;

    // Show/hide based on auth state
    if (authUebernimmt) {
        // auth.js entscheidet
    } else if (isLoggedIn) {
        // User logged in - show app
        loginScreen.classList.add('hidden');
        adminPanel.classList.add('hidden');
        navbar.style.display = 'flex';
        sidebar.style.display = 'block';
        container.style.display = 'block';
        renderSessionBadge();
    } else if (isAdminLoggedIn) {
        // Admin logged in - show admin panel only
        loginScreen.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        navbar.style.display = 'none';
        sidebar.style.display = 'none';
        container.style.display = 'none';
        renderKeysList();
    } else {
        // Not logged in - show login screen
        loginScreen.classList.remove('hidden');
        adminPanel.classList.add('hidden');
        navbar.style.display = 'none';
        sidebar.style.display = 'none';
        container.style.display = 'none';
    }
    
    // Login: Admin-Key oder User-Key ueber dasselbe Feld
    loginBtn.addEventListener('click', () => {
        const enteredKey = loginKeyInput.value.trim();
        if (!enteredKey) {
            showToast('Bitte deinen Key eingeben', 'error');
            return;
        }

        // Admin-Key erkannt -> direkt ins Admin Panel
        const enteredHash = sha256Hex(enteredKey);

        if (enteredHash === ADMIN_KEY_HASH) {
            loginKeyInput.value = '';
            loginScreen.classList.add('hidden');
            adminPanel.classList.remove('hidden');
            navbar.style.display = 'none';
            sidebar.style.display = 'none';
            container.style.display = 'none';
            sessionStorage.setItem('capitalflow_admin_logged_in', 'true');
            // Admin hat keine eigenen Trades - aktiven Key freigeben,
            // sonst wirkt im Hintergrund noch der vorherige Nutzer
            window.cfRawStorage.remove('capitalflow_current_key');
            window.cfRawStorage.remove('capitalflow_current_name');
            localStorage.removeItem('capitalflow_logged_in');
            renderKeysList();
            return;
        }

        // Seit dem Discord-Login ist dieses Feld nur noch fuer den Admin.
        // Normale Access Keys werden nach der Discord-Anmeldung
        // eingeloest, gegen die Einladungstabelle in der Datenbank -
        // eine Pruefung hier im Browser waere ohnehin umgehbar.
        if (window.cfDb) {
            showToast('Bitte über Discord anmelden', 'error');
            loginKeyInput.value = '';
            return;
        }

        // Notpfad ohne Datenbankverbindung: alte Hash-Liste aus keys.js
        const matched = (typeof AUTHORIZED_KEYS !== 'undefined'
            ? AUTHORIZED_KEYS : []).find(k => k.hash === enteredHash);
        const keyExists = Boolean(matched);
        
        if (keyExists) {
            // Aktiven Key setzen, bevor irgendwelche Daten gelesen werden
            window.cfRawStorage.set('capitalflow_current_key', enteredKey);
            window.cfRawStorage.set('capitalflow_current_name',
                                    (matched && matched.name) || 'Verbunden');
            window.cfClaimLegacyData(enteredKey);

            // Fade out login screen
            loginScreen.style.opacity = '0';
            loginScreen.style.transition = 'opacity 0.4s ease';
            
            setTimeout(() => {
                loginScreen.classList.add('hidden');
                navbar.style.display = 'flex';
                sidebar.style.display = 'block';
                container.style.display = 'block';
                localStorage.setItem('capitalflow_logged_in', 'true');
                
                // Animate app entrance
                navbar.classList.add('app-enter');
                sidebar.classList.add('app-enter');
                container.classList.add('app-enter');

                // Alle Ansichten fuer DIESEN Key neu aufbauen. Ohne das
                // bliebe stehen, was beim Seitenaufbau gerendert wurde.
                // Einzeln abgesichert: faellt eine Ansicht aus, laufen die
                // anderen trotzdem durch.
                [loadTrades, loadPositions, loadTransactions, loadSetups, loadDashboard,
                 loadAnalytics, loadCalendar].forEach((fn) => {
                    try {
                        if (typeof fn === 'function') fn();
                    } catch (err) {
                        console.error('Ansicht konnte nicht geladen werden:', err);
                    }
                });

                // Wer schon Trades hat, ist kein Neuzugang
                const existing = JSON.parse(localStorage.getItem('trades')) || [];
                showWelcome(matched && matched.name, existing.length > 0);
                renderSessionBadge();
            }, 400);
        } else {
            showToast('Key ungültig – frag beim Admin nach.', 'error');
            loginKeyInput.value = '';
        }
    });
    
    loginKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });
    
    // Admin logout
    adminLogoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('capitalflow_admin_logged_in');
        adminPanel.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        navbar.style.display = 'none';
        sidebar.style.display = 'none';
        container.style.display = 'none';
        normalLoginForm.style.display = 'flex';
        loginKeyInput.value = '';
        // Neu laden, damit kein Zustand aus der Admin-Sitzung haengen bleibt
        window.location.reload();
    });
    
    // Navbar logout button
    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    if (sidebarLogoutBtn) {
        sidebarLogoutBtn.addEventListener('click', () => {
            showLogoutModal();
        });
    }
    
    // Generate new key
    generateNewKeyBtn.addEventListener('click', () => {
        const userName = adminUserNameInput.value.trim();
        if (!userName) {
            showToast('Bitte einen Namen eingeben!', 'error');
            return;
        }

        const newKey = generateUserKey();
        const hash = sha256Hex(newKey);
        const today = new Date().toISOString().slice(0, 10);

        // Der Key wird bewusst NICHT gespeichert - nur hier einmal
        // angezeigt. Gespeichert wird allein der Hash, und zwar von Hand
        // in js/keys.js.
        renderNewKeyResult(userName, newKey, hash, today);
        adminUserNameInput.value = '';
        showToast('Key erstellt', 'success');
    });
}

function renderNewKeyResult(name, key, hash, today) {
    const box = document.getElementById('keysList');
    if (!box) return;

    const line = '    { name: "' + name + '", hash: "' + hash +
                 '", added: "' + today + '" },';

    box.innerHTML =
      '<div class="newkey-card">' +
        '<div class="newkey-warn">Der Key wird nur jetzt angezeigt. ' +
        'Notiere ihn, bevor du das Panel verlaesst.</div>' +

        '<div class="newkey-label">Key fuer ' + escapeHtml(name) + '</div>' +
        '<div class="newkey-value">' + escapeHtml(key) + '</div>' +
        '<button class="admin-btn-primary newkey-btn" ' +
          'onclick="copyToClipboard(\'' + key + '\')">Key kopieren</button>' +

        '<div class="newkey-label" style="margin-top:22px;">' +
        'Diese Zeile in js/keys.js einfuegen</div>' +
        '<div class="newkey-code">' + escapeHtml(line) + '</div>' +
        '<button class="admin-btn-primary newkey-btn" ' +
          'onclick="copyToClipboard(this.dataset.line)" ' +
          'data-line="' + escapeHtml(line) + '">Zeile kopieren</button>' +

        '<div class="newkey-steps">' +
          '<strong>Danach:</strong> Zeile in <code>js/keys.js</code> in die ' +
          'Liste <code>AUTHORIZED_KEYS</code> einfuegen, speichern, ' +
          'committen und pushen. Erst dann funktioniert der Key.' +
        '</div>' +
      '</div>';
}

function renderKeysList() {
    const box = document.getElementById('keysList');
    if (!box) return;

    const keys = (typeof AUTHORIZED_KEYS !== 'undefined') ? AUTHORIZED_KEYS : [];
    if (keys.length === 0) {
        box.innerHTML = '<p style="color:#A9A5BD;text-align:center;padding:20px;">' +
            'Noch keine Keys in js/keys.js eingetragen</p>';
        return;
    }

    box.innerHTML = keys.map(function (k) {
        return '<div class="key-item">' +
            '<div class="key-item-info">' +
              '<div class="key-item-name">' + escapeHtml(k.name) + '</div>' +
              '<div class="key-item-key">Hash ' +
                escapeHtml(String(k.hash).slice(0, 16)) + '…</div>' +
              '<div style="font-size:11px;color:#8A86A0;margin-top:4px;">' +
                'Eingetragen: ' + escapeHtml(k.added || '—') + '</div>' +
            '</div>' +
          '</div>';
    }).join('');
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Key kopiert', 'success');
    });
}

function deleteKey() {
    // Keys werden nicht mehr im Browser verwaltet, sondern in js/keys.js.
    showToast('Zugang entziehen: Zeile in js/keys.js loeschen und pushen',
              'error');
}

// ===== LOGOUT MODAL =====
function showLogoutModal() {
    const logoutModal = document.getElementById('logoutModal');
    logoutModal.classList.add('active');
}

function cancelLogout() {
    const logoutModal = document.getElementById('logoutModal');
    logoutModal.classList.remove('active');
}

function confirmLogout() {
    // Mit Discord-Anmeldung reicht es nicht, die lokalen Eintraege zu
    // loeschen - die Supabase-Sitzung lebt weiter, und nach dem Neuladen
    // waere man sofort wieder angemeldet. cfAbmelden() raeumt beides ab.
    if (window.cfDb && typeof window.cfAbmelden === 'function') {
        window.cfAbmelden();
        return;
    }

    localStorage.removeItem('capitalflow_logged_in');
    // Aktiven Key freigeben, sonst sieht der naechste Nutzer fremde Daten
    window.cfRawStorage.remove('capitalflow_current_key');
    window.cfRawStorage.remove('capitalflow_current_name');
    window.cfRawStorage.remove('capitalflow_current_avatar');
    window.cfRawStorage.remove('capitalflow_login_art');
    window.location.reload();
}

// ===== MOBILE MENU SYSTEM =====
function initMobileMenu() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sidebar = document.querySelector('.sidebar');
    
    if (!hamburgerMenu) return;
    
    hamburgerMenu.addEventListener('click', () => {
        hamburgerMenu.classList.toggle('active');
        sidebar.classList.toggle('active');
    });
    
    // Close sidebar when nav item is clicked
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            hamburgerMenu.classList.remove('active');
            sidebar.classList.remove('active');
        });
    });
    
    // Close sidebar when outside is clicked
    document.addEventListener('click', (e) => {
        if (!sidebar.contains(e.target) && !hamburgerMenu.contains(e.target)) {
            hamburgerMenu.classList.remove('active');
            sidebar.classList.remove('active');
        }
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initLoginSystem();
    initMobileMenu();
    initCountdownTimer();
    cfNutzerblock();
});

const tradeForm = document.getElementById('tradeForm');
const tradesContainer = document.getElementById('tradesContainer');
const calendarContent = document.getElementById('calendarContent');
const deleteModal = document.getElementById('deleteModal');
let tradeToDelete = null;
let currentFilter = 'all'; // 'all', 'leverage', 'normal'
let currentSetupTypeFilter = 'all'; // Setup-Type Filter
let screenshotData = null;
let currentTab = 'dashboard'; // Tracke aktuellen Tab

// Positionen Management
let positionsScreenshotData = null;
let positionToDelete = null;
let positionToClose = null; // Für Close Position Modal
let closedPositionToDelete = null; // Für Closed Position Delete Modal
let transactionToDelete = null; // Für Transaktions-Löschdialog

function displayScreenshot(base64Data) {
    screenshotData = base64Data;
    const pasteArea = document.getElementById('screenshotPasteArea');
    const preview = document.getElementById('screenshotPreview');
    pasteArea.classList.add('has-image');
    pasteArea.textContent = '';
    pasteArea.style.display = 'none';
    preview.innerHTML = `
        <img src="${base64Data}" alt="Trade Setup" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(124, 92, 240, 0.225); display: block;">
        <button type="button" onclick="document.getElementById('screenshot').click()" style="margin-top: 10px; padding: 8px 16px; background: rgba(124, 92, 240, 0.15); border: 1px solid rgba(124, 92, 240, 0.3); color: #D5D2E2; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Bild ändern</button>
    `;
}

function clearScreenshot() {
    screenshotData = null;
    const pasteArea = document.getElementById('screenshotPasteArea');
    const preview = document.getElementById('screenshotPreview');
    pasteArea.classList.remove('has-image');
    pasteArea.textContent = 'Strg+V zum Einfügen oder klicken zum Hochladen';
    pasteArea.style.display = 'block';
    preview.innerHTML = '';
}

function openScreenshotModal(imageSrc) {
    const modal = document.getElementById('screenshotModal');
    const img = document.getElementById('screenshotModalImg');
    img.src = imageSrc;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeScreenshotModal() {
    const modal = document.getElementById('screenshotModal');
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

// ESC-Taste zum Schließen
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeScreenshotModal();
    }
});

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    // Logo Click Effekt
    const logoElement = document.querySelector('.navbar h1');
    if (logoElement) {
        logoElement.addEventListener('click', (e) => {
            const ripple = document.createElement('span');
            ripple.style.position = 'absolute';
            ripple.style.borderRadius = '50%';
            ripple.style.background = 'radial-gradient(circle, rgba(124, 92, 240, 0.45) 0%, transparent 70%)';
            ripple.style.width = '100px';
            ripple.style.height = '100px';
            ripple.style.pointerEvents = 'none';
            ripple.style.animation = 'logoRipple 0.6s ease-out forwards';
            
            const rect = logoElement.getBoundingClientRect();
            ripple.style.left = (e.clientX - rect.left - 50) + 'px';
            ripple.style.top = (e.clientY - rect.top - 50) + 'px';
            
            logoElement.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
            
            showToast('unemployment center journal');
        });
    }
    
    setupTabs();
    initCustomDropdowns();
    setupFilterButtons();
    loadTrades();
    loadDashboard();
    tradeForm.addEventListener('submit', addTrade);

    // Zuruecksetzen beendet auch das Bearbeiten. Sonst steht das
    // Formular leer da, der Bearbeitungszustand laeuft im Hintergrund
    // weiter - und der naechste Klick auf Speichern ueberschreibt den
    // Trade mit leeren Feldern.
    tradeForm.addEventListener('reset', function () {
        if (!tradeInBearbeitung) return;
        tradeInBearbeitung = null;
        bearbeitungsLeiste(null);
        // Die Haken und das Bild raeumt das Formular nicht von allein
        // ab: reset() stellt nur den Ausgangszustand des Markups wieder
        // her, und der Screenshot liegt ohnehin in einer Variablen.
        setTimeout(function () {
            clearScreenshot();
            document.querySelectorAll('.setup-type-checkbox')
                .forEach(function (cb) { cb.checked = false; });
        }, 0);
    });

    // Screenshot Paste & Click Handler
    const pasteArea = document.getElementById('screenshotPasteArea');
    const screenshotInput = document.getElementById('screenshot');
    
    // Click = File-Input öffnen
    if (pasteArea) {
        pasteArea.addEventListener('click', () => {
            if (!screenshotData) {
                screenshotInput.click();
            }
        });
    }
    
    // File-Input Handler
    if (screenshotInput) {
        screenshotInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    displayScreenshot(event.target.result);
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    // Paste-Handler (Global - funktioniert überall auf der Seite)
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items || [];
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    // Nutze currentTab Variable um zu wissen welcher Tab aktiv ist
                    if (currentTab === 'journal') {
                        displayScreenshot(event.target.result);
                    } else if (currentTab === 'positions') {
                        displayPositionsScreenshot(event.target.result);
                    } else if (currentTab === 'setups') {
                        displaySetupsScreenshot(event.target.result);
                    }
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    });
    
    // ===== POSITIONEN FORM =====
    // Long/Short-Umschalter. Jede Gruppe schaltet nur ihre eigenen
    // Buttons und schreibt in ihr eigenes verstecktes Feld (data-target).
    // Sonst wuerde ein Klick in den Setups den im Journal umschalten.
    document.querySelectorAll('.direction-toggle').forEach((group) => {
        const target = document.getElementById(group.dataset.target);
        group.querySelectorAll('.direction-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.direction-btn')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (target) target.value = btn.getAttribute('data-direction');
            });
        });
    });

    const transactionForm = document.getElementById('transactionForm');
    if (transactionForm) {
        transactionForm.addEventListener('submit', addTransaction);
        setTransactionDateToday();
    }

    const positionsForm = document.getElementById('positionsForm');
    if (positionsForm) {
        positionsForm.addEventListener('submit', addPosition);
    }
    
    // Positionen Screenshot Paste & Click Handler
    const positionsPasteArea = document.getElementById('positionsScreenshotPasteArea');
    const positionsScreenshotInput = document.getElementById('positionsScreenshotInput');
    
    if (positionsPasteArea) {
        positionsPasteArea.addEventListener('click', () => {
            positionsScreenshotInput.click();
        });
    }
    
    if (positionsScreenshotInput) {
        positionsScreenshotInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    displayPositionsScreenshot(event.target.result);
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    // Positionen Modal Close
    const deleteModal = document.getElementById('deleteModal');
    const confirmBtn = deleteModal?.querySelector('.confirm-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            // Check if it's a position delete or trade delete
            if (positionToDelete !== null) {
                confirmDeletePosition();
            } else if (tradeToDelete !== null) {
                confirmDeleteTrade();
            }
        });
    }
    
    // Load Positionen
    loadPositions();
});

// ===== TABS =====
function setupTabs() {
    // Alt Tab Buttons (versteckt)
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            handleTabChange(button.getAttribute('data-tab'));
        });
    });
    
    // Neue Sidebar Nav Items
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            handleTabChange(tabId);
        });
    });
}

function handleTabChange(tabId) {
    currentTab = tabId; // Aktualisiere globalen Tab-State
    
    // Entferne active von allen Nav Items
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    // Entferne active von allen Tab Buttons (old)
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(b => b.classList.remove('active'));
    
    // Entferne active von allen Tab-Contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(c => c.classList.remove('active'));
    
    // Füge active zum aktuellen Nav Item hinzu
    const activeNavItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (activeNavItem) activeNavItem.classList.add('active');
    
    // Füge active zum alten Button hinzu (falls vorhanden)
    const activeButton = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
    if (activeButton) activeButton.classList.add('active');
    
    // Füge active zum entsprechenden Tab-Content hinzu
    const tabContent = document.getElementById(tabId);
    if (tabContent) {
        tabContent.classList.add('active');
    }
    
    // Kein Coming-Soon-Overlay mehr: der leere Portfolio-Tab ist raus,
    // weil er mit "Portfolio Analyse" kollidiert hat und Nutzern nur
    // gezeigt hat, was fehlt. Investoren-Features kommen in v2.

    // Inhalte im SELBEN Durchgang rendern, in dem der Tab sichtbar wird.
    // Vorher kam das Rendern 100 ms spaeter: man sah kurz den alten Stand
    // oder "Loading...", dann sprang alles an seinen Platz. Der Browser
    // zeichnet erst, wenn diese Funktion fertig ist - so erscheint der
    // Tab gleich im fertigen Zustand.
    const laden = {
        calendar: typeof loadCalendar === 'function' ? loadCalendar : null,
        dashboard: typeof loadDashboard === 'function' ? loadDashboard : null,
        analytics: typeof loadAnalytics === 'function' ? loadAnalytics : null,
        journal: typeof loadTrades === 'function' ? loadTrades : null,
        positions: typeof loadPositions === 'function' ? loadPositions : null,
        transactions: typeof loadTransactions === 'function' ? loadTransactions : null,
        setups: typeof loadSetups === 'function' ? loadSetups : null,
    }[tabId];
    if (laden) {
        // Ein Fehler im Rendern darf das Umschalten nicht abbrechen (Navigation
        // bleibt bedienbar) - aber er darf auch nicht verschwinden: danach
        // erneut werfen, damit er in der Konsole und in den Tests auffaellt.
        try { laden(); } catch (e) { setTimeout(() => { throw e; }, 0); }
    }
    if (tabId === 'admin' && typeof cfAdminOeffnen === 'function') {
        cfAdminOeffnen();
    }
    if (tabId === 'daten') {
        // Der Migrationsblock erscheint nur, wenn es lokal ueberhaupt
        // etwas zu uebertragen gibt - sonst steht dort eine Aufgabe,
        // die niemand hat.
        if (typeof window.cfMigrationsblockPruefen === 'function') {
            window.cfMigrationsblockPruefen();
        }
    }
}

function setupFilterButtons() {
    // Event Delegation: funktioniert auch für dynamisch hinzugefügte Buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            // Entferne active von allen Buttons
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            // Setze current Filter und add active
            currentFilter = e.target.getAttribute('data-filter');
            e.target.classList.add('active');
            // Reload je nach aktuellem Tab
            loadTrades();
            if (currentTab === 'dashboard') loadDashboard();
            if (currentTab === 'analytics') loadAnalytics();
        }
        
        if (e.target.classList.contains('setup-type-filter-btn')) {
            // Entferne active von allen Setup-Type Buttons
            document.querySelectorAll('.setup-type-filter-btn').forEach(b => b.classList.remove('active'));
            // Setze Setup-Type Filter und add active
            currentSetupTypeFilter = e.target.getAttribute('data-setup-type');
            e.target.classList.add('active');
            // Reload je nach aktuellem Tab
            loadTrades();
            if (currentTab === 'dashboard') loadDashboard();
            if (currentTab === 'analytics') loadAnalytics();
        }
    });
}

function getFilteredTrades(trades) {
    let filtered = trades;
    
    // Hebel Filter
    if (currentFilter === 'leverage') {
        filtered = filtered.filter(istHebelTrade);
    } else if (currentFilter === 'normal') {
        filtered = filtered.filter(t => !istHebelTrade(t));
    }
    
    // Setup-Type Filter
    if (currentSetupTypeFilter !== 'all') {
        filtered = filtered.filter(t => t.setupType === currentSetupTypeFilter);
    }
    
    return filtered;
}

// ===== TRADES =====

/**
 * Der Trade, der gerade im Formular liegt - oder null.
 *
 * Es gibt bewusst kein zweites Formular fuer das Bearbeiten. Das
 * Journal-Formular kennt Aktien, Knock-Outs und Faktor-Zertifikate,
 * rechnet Hebel und KO-Abstand mit und zeigt Widersprueche an; eine
 * zweite Fassung davon waere ab dem ersten Tag eine halbe Kopie, die
 * langsam auseinanderlaeuft. Stattdessen wechselt dasselbe Formular in
 * einen Bearbeitungszustand.
 */
let tradeInBearbeitung = null;

function bearbeitungsLeiste(trade) {
    const leiste = document.getElementById('tradeEditHinweis');
    const btn = document.querySelector('#tradeForm button[type="submit"]');
    const abbrechen = document.getElementById('tradeEditAbbrechen');

    if (!trade) {
        if (leiste) leiste.style.display = 'none';
        if (btn) btn.textContent = 'Trade speichern';
        if (abbrechen) abbrechen.style.display = 'none';
        return;
    }

    if (leiste) {
        leiste.innerHTML = '<strong>Du bearbeitest einen Trade:</strong> '
            + escapeHtml(trade.ticker) + ' vom ' + escapeHtml(trade.date)
            + '. Beim Speichern wird der bestehende Eintrag überschrieben, '
            + 'nicht ein zweiter angelegt.';
        leiste.style.display = '';
    }
    if (btn) btn.textContent = 'Änderungen speichern';
    if (abbrechen) abbrechen.style.display = '';
}

/**
 * Laedt einen Trade ins Formular.
 *
 * Der Anlass sind die importierten Trades: die Trade-Republic-Datei
 * nennt weder Stop noch These noch den Kurs des Basiswerts, also stehen
 * nach einem Import vierzig Eintraege im Journal, zu denen die Haelfte
 * jeder Auswertung fehlt. Bisher liess sich davon nichts nachtragen -
 * ein Trade konnte nur angelegt oder geloescht werden.
 */
function tradeBearbeiten(id) {
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    const trade = trades.find(t => String(t.id) === String(id));
    if (!trade) {
        showToast('Dieser Trade ist nicht mehr da.', 'error');
        return;
    }

    if (currentTab !== 'journal') handleTabChange('journal');

    // Erst den Zustand setzen, dann die Felder: cfProduktSetzen rechnet
    // am Ende neu, und dafuer muessen Ticker, Richtung und Preise schon
    // stehen.
    tradeInBearbeitung = trade;

    const setz = (fid, v) => {
        const el = document.getElementById(fid);
        if (el) el.value = (v === null || v === undefined) ? '' : String(v);
    };

    const zert = Boolean(trade.produkt && trade.produkt.art
        && trade.produkt.art !== 'aktie');

    setz('ticker', trade.ticker === '—' ? '' : trade.ticker);
    setz('entryPrice', trade.entryPrice || '');
    setz('exitPrice', trade.exitPrice || '');
    setz('positionSize', trade.positionSize || '');
    setz('reason', trade.reason || '');
    setz('notes', trade.notes || '');

    // Bei einem Zertifikat steht in stopLoss der Stop auf dem BASISWERT
    // und in leverage der gerechnete Hebel. Beides gehoert nicht in die
    // Aktienfelder - dort waeren es getippte Angaben, die sie nie waren.
    setz('stopLoss', zert ? '' : (trade.stopLoss || ''));
    setz('leverage', zert ? '' : (trade.leverage > 1 ? trade.leverage : ''));

    const richtung = trade.direction === 'short' ? 'short' : 'long';
    setz('direction', richtung);
    document.querySelectorAll('[data-target="direction"] .direction-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.direction === richtung));

    // Setup-Typ: mehrere, durch Komma getrennt
    const gewaehlt = String(trade.setupType || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    document.querySelectorAll('.setup-type-checkbox')
        .forEach(cb => { cb.checked = gewaehlt.indexOf(cb.value) >= 0; });

    // Fehlertyp liegt in einem versteckten Feld, sichtbar ist die
    // eigengebaute Auswahl - beides muss gesetzt werden, sonst zeigt sie
    // "Kein Fehler" und speichert etwas anderes.
    const fehler = trade.errorType || 'Kein Fehler';
    setz('errorType', fehler);
    const kopf = document.querySelector('.custom-select[data-select-id="errorType"] '
        + '.custom-select-value');
    if (kopf) kopf.textContent = fehler;

    if (trade.screenshot) displayScreenshot(trade.screenshot);
    else clearScreenshot();

    if (window.cfProduktSetzen) window.cfProduktSetzen(trade.produkt || null);

    bearbeitungsLeiste(trade);

    cfKlapp('auf', 'tradeFormHuelle', { fokus: null });
    const form = document.getElementById('tradeForm');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Bei importierten Trades ist der Stop das, was fehlt - und das Feld,
    // in dem der Cursor steht, ist das Feld, das ausgefuellt wird.
    const ziel = document.getElementById(zert ? 'zKo' : 'stopLoss');
    if (ziel) setTimeout(() => ziel.focus(), 400);
}

function bearbeitenAbbrechen() {
    tradeInBearbeitung = null;
    const form = document.getElementById('tradeForm');
    if (form) form.reset();
    clearScreenshot();
    document.querySelectorAll('.setup-type-checkbox').forEach(cb => { cb.checked = false; });
    if (window.cfProduktZuruecksetzen) window.cfProduktZuruecksetzen();
    bearbeitungsLeiste(null);
    cfKlapp('zu', 'tradeFormHuelle');
    showToast('Bearbeitung abgebrochen — nichts geändert.');
}

function addTrade(e) {
    e.preventDefault();

    try {
        const ticker = document.getElementById('ticker').value.toUpperCase();
        const entryPrice = parseFloat(document.getElementById('entryPrice').value);
        const exitPrice = parseFloat(document.getElementById('exitPrice').value);
        const stopLossValue = document.getElementById('stopLoss').value;
        const stopLoss = stopLossValue ? parseFloat(stopLossValue) : entryPrice;
        const positionSize = parseFloat(document.getElementById('positionSize').value);
        const leverageValue = document.getElementById('leverage').value;
        const leverage = leverageValue ? parseFloat(leverageValue) : 1;
        const reason = document.getElementById('reason').value;
        // Setup Type - Multiple Selection
        const setupTypeCheckboxes = document.querySelectorAll('.setup-type-checkbox:checked');
        const setupType = Array.from(setupTypeCheckboxes).map(cb => cb.value).join(', ') || 'Sonstiges';
        const errorType = document.getElementById('errorType').value || 'Kein Fehler';
        const notes = document.getElementById('notes').value;
        
        const direction = document.getElementById('direction').value === 'short'
            ? 'short' : 'long';

        // Produktart entscheidet ueber die gesamte Rechnung darunter.
        const produkt = window.cfProduktDaten ? window.cfProduktDaten() : null;
        const istZert = Boolean(produkt);

        // Halb ausgefuellte Zertifikatstrades gar nicht erst annehmen -
        // ohne Basispreis laesst sich der Trade spaeter nicht auswerten,
        // und nachtragen wird ihn niemand.
        if (istZert && window.cfProduktPruefen) {
            const fehlt = window.cfProduktPruefen();
            if (fehlt.length) {
                showToast('' + fehlt[0], 'error');
                return;
            }
        }

        const shares = positionSize / entryPrice;
        let pnl, pnlPercent, risk;

        if (istZert) {
            // Bei einem Zertifikat sind entryPrice und exitPrice die
            // Preise des SCHEINS in Euro. Der Hebel steckt bereits in
            // dieser Bewegung - ihn noch einmal zu multiplizieren, wuerde
            // die P&L um genau diesen Faktor aufblasen.
            //
            // Auch das Vorzeichen wird NICHT gedreht: ein Short-Knockout
            // steigt im Preis, wenn der Basiswert faellt. Der Gewinn
            // steht also schon richtig in der Preisdifferenz.
            const diff = exitPrice - entryPrice;
            pnl = diff * shares;
            pnlPercent = (diff / entryPrice) * 100;

            // Das Risiko kommt aus dem Stop auf dem BASISWERT und wird
            // ueber den inneren Wert in Euro umgerechnet. Liegt der Stop
            // jenseits der Schwelle, ist es der volle Einsatz - nicht
            // mehr, wie die alte Formel Hebel-mal-Kursabstand behauptet
            // haette.
            const r = (window.cfZert && produkt.basisStop)
                ? window.cfZert.risiko(window.cfProduktEingaben(), produkt.basisStop)
                : null;
            risk = (r && r.ok) ? r.wert.euro : 0;
        } else {
            // Aktie: Bei Short dreht sich das Vorzeichen, dort verdienst
            // du, wenn der Kurs faellt.
            const richtung = direction === 'short' ? -1 : 1;
            const kursDiff = (exitPrice - entryPrice) * richtung;
            pnl = kursDiff * shares * leverage;
            pnlPercent = (kursDiff / entryPrice) * 100 * leverage;
            risk = stopLoss
                ? Math.abs(entryPrice - stopLoss) * shares * leverage : 0;
        }

        const reward = pnl;
        const riskReward = risk !== 0 ? reward / risk : 0;

        const alt = tradeInBearbeitung;
        // Beim Bearbeiten bleibt das Datum, wie es war. Das Formular hat
        // kein Datumsfeld - wuerde hier "heute" hineingeschrieben,
        // wanderte jeder nachgetragene Trade im Kalender auf den Tag des
        // Nachtragens, und die Monatsauswertung waere still verschoben.
        const date = alt ? alt.date : new Date().toLocaleDateString('de-DE',
            { year: 'numeric', month: '2-digit', day: '2-digit' });

        // Trade Object erstellen
        const trade = {
            id: alt ? alt.id : Date.now(),
            ticker,
            direction,
            entryPrice,
            exitPrice,
            stopLoss: istZert ? (produkt.basisStop || 0) : (stopLoss || 0),
            positionSize,
            // Der ausgewiesene Hebel: bei Zertifikaten der gerechnete,
            // bei Aktien der getippte. Die P&L oben nutzt ihn bei
            // Zertifikaten bewusst NICHT.
            leverage: istZert ? (produkt.hebelEffektiv || 1) : leverage,
            pnl: Math.round(pnl * 100) / 100,
            pnlPercent: Math.round(pnlPercent * 100) / 100,
            risk: Math.round(risk * 100) / 100,
            reward: Math.round(reward * 100) / 100,
            riskReward: Math.round(riskReward * 100) / 100,
            reason,
            setupType,
            errorType,
            notes,
            screenshot: screenshotData || null,
            date,
            produkt: produkt || null
        };

        // Alles, was der Trade schon hatte und das Formular nicht kennt,
        // wandert mit. Ohne diese Zeilen verlieren importierte Trades
        // beim ersten Nachtragen Gebuehren, Kauf- und Verkaufszeitpunkt
        // und den Pfad zum Screenshot - und zwar lautlos. Genau so
        // verschwinden Daten: nicht mit einer Fehlermeldung, sondern
        // weil ein neu gebautes Objekt ein Feld nicht kennt.
        if (alt) {
            ['geoeffnet', 'geschlossen', 'gebuehren', 'screenshotPfad',
             'quelle'].forEach(function (f) {
                if (alt[f] !== undefined) trade[f] = alt[f];
            });
            // Nachgetragen heisst vollstaendig, sobald Stop und Grund da
            // sind - dieselbe Bedingung wie beim Schreiben.
            trade.unvollstaendig = !(trade.stopLoss > 0
                && String(trade.reason || '').trim());
        }

        const trades = JSON.parse(localStorage.getItem('trades')) || [];
        if (alt) {
            const i = trades.findIndex(t => String(t.id) === String(alt.id));
            if (i >= 0) trades[i] = trade; else trades.push(trade);
        } else {
            trades.push(trade);
        }
        localStorage.setItem('trades', JSON.stringify(trades));

        if (alt) {
            if (window.cfDbTradeAendern) window.cfDbTradeAendern(alt.id, trade);
        } else if (window.cfDbTradeNeu) {
            window.cfDbTradeNeu(trade);
        }

        showToast(alt
            ? `${ticker} geändert (P&L: ${cfGeld(trade.pnl, { vorzeichen: true })})`
            : `Trade hinzugefügt: ${ticker} (P&L: ${cfGeld(trade.pnl, { vorzeichen: true })})`);

        tradeInBearbeitung = null;
        bearbeitungsLeiste(null);
        tradeForm.reset();
        document.querySelectorAll('.setup-type-checkbox')
            .forEach(cb => { cb.checked = false; });
        document.getElementById('screenshotPreview').innerHTML = '';
        clearScreenshot();
        if (window.cfProduktZuruecksetzen) window.cfProduktZuruecksetzen();
        loadTrades();
        cfKlapp('gespeichert', 'tradeFormHuelle');

    } catch (error) {
        console.error('Error adding trade:', error);
        showToast('Fehler beim Hinzufügen des Trades!', 'error');
    }
}

function getSetupTypeBadgeClass(setupType) {
    const typeMap = {
        'Breakout': 'breakout',
        'Pullback': 'pullback',
        'Support': 'support',
        'Rebound': 'rebound',
        'Gap-Fill': 'gap-fill',
        'Trend-Continuation': 'trend-continuation',
        'Sonstiges': 'sonstiges'
    };
    return typeMap[setupType] || 'sonstiges';
}

// Bringt einen Trade auf ein vollstaendiges, rechenbares Format.
// Ohne das reicht EIN Altdatensatz ohne pnl, um beim Rendern
// toFixed(undefined) auszuloesen und die ganze Liste lahmzulegen.
// Hebel anzeigen ohne zu runden: 3 bleibt "3x", 3.2 bleibt "3,2x".
// Gerechnet wurde schon immer mit dem genauen Wert - nur die Anzeige
// hat auf ganze Zahlen gerundet.
function formatLeverage(value) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return '';
    return (Number.isInteger(n) ? String(n) : String(n).replace('.', ',')) + 'x';
}

/**
 * Euro-Betrag mit dem Vorzeichen, das die Zahl wirklich hat.
 *
 * Drei Kacheln in dieser App hatten ein hartcodiertes Plus im Text und
 * zeigten damit "+€-421". Wer das Vorzeichen in die Vorlage schreibt,
 * schreibt eine Behauptung hin statt eines Werts.
 */
/**
 * Screenshot auf einer Karte (Trade, Position, Setup).
 *
 * Bilder aus der Datenbank kommen als signierte Adresse, die nach einer
 * Stunde ablaeuft. Vorher stand dann nur noch der Alternativtext
 * "Trade Setup" auf der Karte. Jetzt traegt das Bild seinen Speicherpfad
 * mit; laedt es nicht, holt cfBildLaden() eine neue Adresse. Klappt auch
 * das nicht, steht dort ein ruhiger Hinweis statt eines kaputten Bildes.
 */
function cfBildHtml(adresse, pfad, klasse, alt) {
    const a = String(adresse || '').trim();
    const p = String(pfad || '').trim();
    if (!a && !p) return '';
    const gemerkt = p && window.cfBildGemerkt ? window.cfBildGemerkt(p) : null;
    const src = gemerkt || a;
    return `<div class="${klasse || ''} cf-bild">`
        + `<img ${src ? `src="${escapeHtml(src)}"` : ''} data-pfad="${escapeHtml(p)}" alt="${escapeHtml(alt || 'Screenshot')}"`
        + ` loading="lazy" decoding="async" onerror="cfBildLaden(this)" onclick="openScreenshotModal(this.src)">`
        + `<div class="cf-bild-fehlt" hidden>Screenshot konnte nicht geladen werden.</div></div>`;
}

async function cfBildLaden(img) {
    if (!img || img.dataset.versucht) { cfBildFehlt(img); return; }
    img.dataset.versucht = '1';
    const pfad = img.dataset.pfad;
    const neu = pfad && window.cfBildFrisch ? await window.cfBildFrisch(pfad) : null;
    if (neu && neu !== img.src) img.src = neu;   // laedt es wieder nicht: onerror -> cfBildFehlt
    else cfBildFehlt(img);
}

function cfBildFehlt(img) {
    if (!img) return;
    img.hidden = true;
    const h = img.parentElement && img.parentElement.querySelector('.cf-bild-fehlt');
    if (h) h.hidden = false;
}

// Bilder ohne Adresse, aber mit Pfad (z.B. aus einem alten Zwischenstand):
// gleich nach dem Einfuegen eine Adresse holen.
document.addEventListener('DOMContentLoaded', function () {
    new MutationObserver(function () {
        document.querySelectorAll('.cf-bild img:not([src]):not([data-versucht])').forEach(cfBildLaden);
    }).observe(document.body, { childList: true, subtree: true });
});

/** Eingeklappte Formulare (js/aufklapp.js) - ohne die Datei kein Fehler. */
function cfKlapp(was, id, arg) {
    if (window.cfAufklapp && typeof window.cfAufklapp[was] === 'function') {
        window.cfAufklapp[was](id, arg);
    }
}

function eurMitVorzeichen(n) {
    const z = parseFloat(n);
    if (!Number.isFinite(z)) return '—';
    return cfGeld(z, { vorzeichen: true });
}

/**
 * Waehrung der Kurse auf einer Trade-Karte. Zertifikate und alles aus dem
 * Trade-Republic-Import kosten Euro; nur bei von Hand eingetragenen Aktien
 * fragt das Formular nach Dollar ("Entry Preis ($)"). Vorher stand ueberall
 * "$" - auch beim Knock-Out fuer 1,52 Euro.
 */
function preisWaehrung(trade) {
    if (!trade) return '$';
    if (trade.quelle === 'import') return '€';
    if (trade.produkt && trade.produkt.art && trade.produkt.art !== 'aktie') return '€';
    return '$';
}

/** Gruen im Plus, rot im Minus - passend zu eurMitVorzeichen(). */
function farbeFuer(n) {
    return (parseFloat(n) || 0) >= 0 ? '#34D399' : '#FB7185';
}

/**
 * Ist das ein Hebelprodukt?
 *
 * Nicht am Hebelwert festmachen: bei importierten Zertifikaten ist der
 * Hebel UNBEKANNT, weil in der TR-Datei nicht steht, wo der Basiswert
 * beim Kauf stand. Er steht dann auf 1 - und ein Filter "Nur Hebel"
 * ueber leverage > 1 haette die Haelfte der Trades aussortiert, obwohl
 * sie alle gehebelt waren.
 *
 * Bekannt ist dagegen immer, WAS gehandelt wurde. Danach wird gefiltert.
 */
function istHebelTrade(t) {
    if (t && t.produkt && t.produkt.art && t.produkt.art !== 'aktie') return true;
    return Boolean(t && parseFloat(t.leverage) > 1);
}

/** Abzeichen fuer den Hebel - nur, wenn er bekannt ist. */
function hebelBadge(t) {
    const lev = parseFloat(t && t.leverage);
    if (lev > 1) return '<span class="trade-leverage-badge">'
        + formatLeverage(lev) + '</span>';
    // Unbekannter Hebel: kein Abzeichen. Ein lila "Hebel ?" auf jeder
    // importierten Karte war Laerm - wo er fehlt, sagt der Nachtragen-Hinweis.
    return '';
}

/**
 * Abzeichen mit dem Abstand zur KO-Schwelle.
 *
 * Die Zahl gehoert in die Liste und nicht nur ins Formular: erst im
 * Rueckblick sieht man, ob die Gewinner immer die knappen Abstaende
 * waren - und dann steht irgendwann ein Totalverlust dazwischen, der
 * alles davor auffrisst. Rot ab 5 Prozent, gelb ab 10.
 */
function koBadge(trade) {
    const p = trade && trade.produkt;
    if (!p || typeof p.koAbstandProzent !== 'number') return '';
    const pz = p.koAbstandProzent;
    const eng = pz < 5 ? ' eng' : '';
    const titel = pz < 5
        ? 'Nur ' + cfProz(pz, 1) + ' bis zum Totalverlust'
        : 'Abstand zur KO-Schwelle beim Einstieg';
    return '<span class="trade-ko-badge' + eng + '" title="'
        + escapeHtml(titel) + '">KO ' + cfProz(pz, 1) + '</span>';
}

/**
 * Was an einem importierten Trade noch fehlt - als Satz, nicht als Liste.
 *
 * Ohne diesen Hinweis bleibt nach einem CSV-Import die Haelfte jeder
 * Auswertung leer, und niemand erfaehrt warum: die Trades sehen
 * vollstaendig aus, weil P&L und Datum ja dastehen. Genannt wird nur,
 * was wirklich fehlt, und dazu der Weg dorthin.
 */
function nachtragenHinweis(trade) {
    if (!trade || !trade.unvollstaendig) return '';

    const fehlt = [];
    if (!(parseFloat(trade.stopLoss) > 0)) fehlt.push('dein Stop');
    if (!String(trade.reason || '').trim()) fehlt.push('der Grund');
    if (istHebelTrade(trade) && !(parseFloat(trade.leverage) > 1)) {
        fehlt.push('der Hebel vom Schein');
    }
    if (!fehlt.length) return '';

    const text = fehlt.length > 1
        ? fehlt.slice(0, -1).join(', ') + ' und ' + fehlt[fehlt.length - 1]
        : fehlt[0];

    return '<div class="trade-nachtragen">Aus dem Import — es '
        + (fehlt.length > 1 ? 'fehlen ' : 'fehlt ') + escapeHtml(text)
        + '. <button type="button" class="trade-nachtragen-btn" onclick="tradeBearbeiten(\''
        + trade.id + '\')">Jetzt nachtragen</button></div>';
}

function normalizeTrade(trade, index) {
    const num = (v, fallback) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const entry = num(trade.entryPrice, 0);
    const exit = num(trade.exitPrice, 0);
    const size = num(trade.positionSize, 0);
    const lev = num(trade.leverage, 1) || 1;

    // Bei einem Zertifikat sind entry/exit die Preise des Scheins - der
    // Hebel steckt schon in der Bewegung und darf nicht noch einmal
    // multipliziert werden.
    const zertifikat = Boolean(trade.produkt && trade.produkt.art
        && trade.produkt.art !== 'aktie');
    const rechenHebel = zertifikat ? 1 : lev;

    // Fehlendes Ergebnis aus den Preisen nachrechnen, statt den
    // Datensatz zu verlieren
    let pnl = num(trade.pnl, null);
    if (pnl === null) {
        pnl = entry > 0 ? (exit - entry) * (size / entry) * rechenHebel : 0;
        pnl = Math.round(pnl * 100) / 100;
    }
    let pnlPercent = num(trade.pnlPercent, null);
    if (pnlPercent === null) {
        pnlPercent = entry > 0
            ? Math.round(((exit - entry) / entry) * 100 * rechenHebel * 100) / 100
            : 0;
    }

    return {
        ...trade,
        id: trade.id || (Date.now() + index),
        ticker: trade.ticker || '—',
        // Trades aus der Zeit vor dem Richtungsfeld sind Long
        direction: trade.direction === 'short' ? 'short' : 'long',
        entryPrice: entry,
        exitPrice: exit,
        stopLoss: num(trade.stopLoss, 0),
        positionSize: size,
        leverage: lev,
        pnl: pnl,
        pnlPercent: pnlPercent,
        risk: num(trade.risk, 0),
        reward: num(trade.reward, 0),
        riskReward: num(trade.riskReward, 0),
        reason: trade.reason || '',
        notes: trade.notes || '',
        // Der Rest der App zerlegt date mit split('.') - ein ISO-Datum
        // als Ersatzwert waere hier ein blinder Passagier.
        date: trade.date || new Date().toLocaleDateString('de-DE',
            { year: 'numeric', month: '2-digit', day: '2-digit' }),
        screenshot: trade.screenshot && String(trade.screenshot).trim()
            ? trade.screenshot : null,
        setupType: trade.setupType || 'Sonstiges',
        errorType: trade.errorType || 'Kein Fehler'
    };
}

function loadTrades() {
    let trades = JSON.parse(localStorage.getItem('trades')) || [];

    // Phantome aussortieren: ein Eintrag ohne Ticker UND ohne
    // Einstiegspreis ist kein Trade, sondern Datenmuell aus einer
    // frueheren Version. Er wuerde sonst mitgezaehlt, obwohl im
    // Journal nichts Sinnvolles erscheint.
    trades = trades.filter((t) => {
        if (!t || typeof t !== 'object') return false;
        const hatTicker = typeof t.ticker === 'string' && t.ticker.trim() !== '';
        const hatPreis = Number.isFinite(parseFloat(t.entryPrice)) &&
                         parseFloat(t.entryPrice) > 0;
        return hatTicker || hatPreis;
    });

    // Alles auf ein vollstaendiges Format bringen und doppelte IDs
    // auseinanderziehen - sonst loescht ein Klick zwei Eintraege
    const seenIds = new Set();
    trades = trades.map((t, i) => {
        const n = normalizeTrade(t, i);
        while (seenIds.has(n.id)) n.id = n.id + 1;
        seenIds.add(n.id);
        return n;
    });
    localStorage.setItem('trades', JSON.stringify(trades));
    
    const filteredTrades = getFilteredTrades(trades);
    
    // Update Display Stats oben (ALLE Trades, nicht gefiltert)
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const filteredPnL = filteredTrades.reduce((sum, t) => sum + t.pnl, 0);
    const tradesPnLDisplay = document.getElementById('tradesPnLDisplay');
    const tradeCountDisplay = document.getElementById('tradeCountDisplay');
    
    if (tradesPnLDisplay) {
        tradesPnLDisplay.textContent = cfGeld(filteredPnL, { vorzeichen: true });
        // Die Zahl steht als Farbverlauf mit background-clip: text.
        // Dabei ist -webkit-text-fill-color auf transparent gesetzt, und
        // das schlaegt jedes color. Ein Minusbetrag blieb deshalb gruen,
        // egal was hier zugewiesen wurde - man muss den Verlauf selbst
        // austauschen.
        const rot = 'linear-gradient(135deg, #FB7185, #F0505F)';
        const gruen = 'linear-gradient(135deg, #34D399, #34D399)';
        tradesPnLDisplay.style.color = filteredPnL >= 0 ? '#34D399' : '#FB7185';
    }
    
    if (tradeCountDisplay) {
        tradeCountDisplay.textContent = filteredTrades.length;
    }
    
    if (filteredTrades.length === 0) {
        // Zwei verschiedene Lagen, die bisher denselben Satz bekamen:
        // ueberhaupt keine Trades, oder nur keine in diesem Filter. Der
        // erste Fall braucht einen Weg nach vorn, der zweite nur den
        // Hinweis, dass der Filter greift.
        tradesContainer.innerHTML = trades.length === 0
            ? leererStart(0)
            : '<div style="text-align: center; padding: 40px; color: #A9A5BD;">'
              + 'Keine Trades in dieser Kategorie</div>';
        return;
    }
    
    // Jede Karte einzeln bauen: faellt eine aus, bleiben die anderen
    // sichtbar, statt dass die ganze Liste leer bleibt
    const renderTradeCard = (trade) => `
        <div class="trade-card">
            <div class="trade-header">
                <div class="trade-ticker">
                    ${escapeHtml(trade.ticker)}
                    <span class="dir-badge dir-${trade.direction === 'short' ? 'short' : 'long'}">${trade.direction === 'short' ? 'SHORT' : 'LONG'}</span>
                    ${hebelBadge(trade)}
                    ${koBadge(trade)}
                </div>
                <div class="trade-pnl ${trade.pnl > 0 ? 'profit' : 'loss'}">
                    <div>${cfGeld(trade.pnl, { vorzeichen: true })}</div>
                    <div class="trade-pnl-percent">${cfProz(trade.pnlPercent, 1, { vorzeichen: true })}</div>
                </div>
            </div>
            <div style="margin-bottom: 15px; margin-top: 10px;">
                <span class="setup-type-badge ${getSetupTypeBadgeClass(trade.setupType || 'Sonstiges')}">${escapeHtml(trade.setupType || 'Sonstiges')}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Kauf / Verkauf</span>
                <span class="trade-detail-value">${cfGeld(trade.entryPrice, { waehrung: preisWaehrung(trade) })} / ${cfGeld(trade.exitPrice, { waehrung: preisWaehrung(trade) })}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Grund</span>
                <span class="trade-detail-value">${escapeHtml(trade.reason || '–')}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Positionsgröße</span>
                <span class="trade-detail-value">${cfGeld(trade.positionSize)}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Chance : Risiko</span>
                <span class="trade-detail-value">${cfZahl(trade.riskReward, 2)} : 1</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Fehler</span>
                <span class="trade-detail-value">${escapeHtml(trade.errorType || 'Keine')}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Datum</span>
                <span class="trade-detail-value">${trade.date}</span>
            </div>
            ${trade.notes ? `<div class="trade-detail"><span class="trade-detail-label">Notizen</span><span class="trade-detail-value">${escapeHtml(trade.notes)}</span></div>` : ''}
            ${cfBildHtml(trade.screenshot, trade.screenshotPfad, 'trade-screenshot', 'Screenshot zu ' + trade.ticker)}
            ${nachtragenHinweis(trade)}
            <div class="trade-aktionen">
                <button class="trade-edit" onclick="tradeBearbeiten('${trade.id}')">Bearbeiten</button>
                <button class="trade-delete" onclick="confirmDelete('${trade.id}')">Löschen</button>
            </div>
        </div>
    `;

    tradesContainer.innerHTML = filteredTrades.map((trade) => {
        try {
            return renderTradeCard(trade);
        } catch (err) {
            console.error('Trade konnte nicht dargestellt werden:', trade, err);
            return '<div class="trade-card"><div class="trade-header">' +
                   '<div class="trade-ticker">' + escapeHtml(trade.ticker || '—') +
                   '</div></div><p style="color:#FB7185;font-size:13px;">' +
                   'Dieser Eintrag ist beschädigt und kann nicht angezeigt werden.' +
                   '</p><button class="trade-delete" onclick="confirmDelete(\'' +
                   (trade.id || 0) + '\')">Löschen</button></div>';
        }
    }).join('');
}

function confirmDelete(id) {
    tradeToDelete = id;
    const deleteModal = document.getElementById('deleteModal');
    const modalTitle = document.getElementById('deleteModalTitle');
    const modalText = document.getElementById('deleteModalText');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    
    modalTitle.textContent = 'Trade löschen?';
    modalText.textContent = 'Dieser Trade wird permanent gelöscht.';
    confirmBtn.textContent = 'Ja, löschen';
    confirmBtn.onclick = () => confirmDeleteTrade();
    
    deleteModal.style.display = 'flex';
}

function cancelDelete() {
    tradeToDelete = null;
    positionToDelete = null;
    closedPositionToDelete = null;
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function confirmDeleteTrade() {
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    const geloeschteId = tradeToDelete;
    const filtered = trades.filter(t => String(t.id) !== String(tradeToDelete));
    localStorage.setItem('trades', JSON.stringify(filtered));
    if (window.cfDbLoeschen && geloeschteId) window.cfDbLoeschen('trades', geloeschteId);
    
    // Modal schließen
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.display = 'none';
    }
    tradeToDelete = null;
    
    loadTrades();
    showToast('Trade gelöscht!');
}

// ===== CALENDAR =====
let currentCalendarView = 'daily';

function loadCalendar() {
    const calendarContent = document.getElementById('calendarContent');
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    
    // Setup event listeners für Buttons
    const calendarBtns = document.querySelectorAll('.calendar-btn');
    calendarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            currentCalendarView = view;
            
            // Aktiven Button umschalten - Styling kommt aus .filter-btn/.active
            calendarBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Render new calendar
            if (view === 'daily') renderDailyCalendar(trades, calendarContent);
            else if (view === 'monthly') renderMonthlyCalendar(trades, calendarContent);
            updateCalendarStats(trades);
        });
    });
    
    // Render initial (daily)
    renderDailyCalendar(trades, calendarContent);
    updateCalendarStats(trades);
}

function renderDailyCalendar(trades, container) {
    const groupedByDate = {};
    trades.forEach(t => {
        groupedByDate[t.date] = (groupedByDate[t.date] || []).concat(t);
    });
    
    let allDates = [];
    const today = new Date();
    const heuteEnde = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Gezeigt werden die letzten 30 Tage bis heute - nicht mehr der
    // Kalendermonat des juengsten Trades. Der zeigte am Monatsanfang zwei
    // Kacheln und liess die Vorwoche verschwinden; davor war der halbe
    // Monat graue Zukunftstage, die nichts bedeuten konnten.
    // Liegt der juengste Trade laenger zurueck, enden die 30 Tage
    // bei ihm statt bei heute. Ein Tag mit Trades bleibt immer sichtbar,
    // auch mit vertipptem Datum in der Zukunft.
    const TAGE = 30;
    const gueltig = Object.keys(groupedByDate)
        .map(d => new Date(d.split('.').reverse().join('-') + 'T00:00:00'))
        .filter(d => !isNaN(d.getTime()));
    const juengster = gueltig.length ? new Date(Math.max(...gueltig)) : heuteEnde;
    const grenze = new Date(heuteEnde); grenze.setDate(grenze.getDate() - (TAGE - 1));
    const endDate = juengster < grenze ? juengster : heuteEnde;
    const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - (TAGE - 1));
    const schluessel = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        allDates.push(schluessel(d));
    }
    gueltig.forEach(d => {
        if (d > endDate) allDates.push(schluessel(d));
    });

    // Neuester Tag zuerst, also oben links.
    const sortedDates = allDates.sort((a, b) => new Date(b.split('.').reverse().join('-')) - new Date(a.split('.').reverse().join('-')));
    
    // Berechne Stats
    const monthTrades = sortedDates.flatMap(d => groupedByDate[d] || []);
    const totalPnL = monthTrades.reduce((sum, t) => sum + t.pnl, 0);
    const tradingDays = sortedDates.filter(d => groupedByDate[d]?.length > 0).length;
    const wins = monthTrades.filter(t => t.pnl > 0).length;
    const winRate = monthTrades.length > 0 ? ((wins / monthTrades.length) * 100).toFixed(1) : 0;
    const avgPerDay = tradingDays > 0 ? (totalPnL / tradingDays).toFixed(2) : 0;
    
    // Beste & Schlechteste Tage finden
    let bestDay = { date: '-', pnl: 0 };
    let worstDay = { date: '-', pnl: 0 };
    sortedDates.forEach(date => {
        const dayTrades = groupedByDate[date] || [];
        const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
        if (dayTrades.length > 0) {
            if (dayPnL > bestDay.pnl) bestDay = { date, pnl: dayPnL };
            if (dayPnL < worstDay.pnl) worstDay = { date, pnl: dayPnL };
        }
    });
    
    // HTML
    const html = `
        <!-- Legende -->
        <div style="display: flex; gap: 20px; margin-bottom: 30px; padding: 16px; background: rgba(138, 134, 160, 0.1); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #34D399; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Gewinn</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #FB7185; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Verlust</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #8A86A0; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Keine Trades</span>
            </div>
        </div>
        
        <!-- Calendar Grid -->
        <div class="calendar-grid-daily">
            ${sortedDates.map(date => {
                const dayTrades = groupedByDate[date] || [];
                const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
                const status = dayTrades.length === 0 ? 'neutral' : (dayPnL > 0 ? 'profit' : 'loss');
                const isSpecial = (bestDay.date === date) ? 'style="box-shadow: 0 0 20px rgba(52, 211, 153, 0.6);"' : (worstDay.date === date) ? 'style="box-shadow: 0 0 20px rgba(251, 113, 133, 0.6);"' : '';
                
                return `
                    <div class="calendar-day ${status}" ${isSpecial} title="${date}: ${dayTrades.length} Trades, ${cfGeld(dayPnL, { vorzeichen: true })}">
                        <div class="calendar-day-header">${date}</div>
                        <div class="calendar-day-pnl">${dayTrades.length > 0 ? cfGeld(dayPnL, { vorzeichen: true, stellen: 0 }) : '—'}</div>
                        <div class="calendar-day-trades">${dayTrades.length} T.</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    container.innerHTML = html;
}

function renderWeeklyCalendar(trades, container) {
    const groupedByWeek = {};
    
    trades.forEach(t => {
        const date = new Date(t.date.split('.').reverse().join('-'));
        const weekNum = getWeekNumber(date);
        const year = date.getFullYear();
        const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;
        groupedByWeek[weekKey] = (groupedByWeek[weekKey] || []).concat(t);
    });
    
    const allWeeks = new Set();
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentWeek = getWeekNumber(today);
    
    if (Object.keys(groupedByWeek).length > 0) {
        const years = Object.keys(groupedByWeek).map(k => parseInt(k.split('-')[0]));
        const minYear = Math.min(...years);
        
        for (let year = minYear; year <= currentYear; year++) {
            const maxWeek = year === currentYear ? currentWeek : 52;
            for (let week = 1; week <= maxWeek; week++) {
                const weekKey = `${year}-W${String(week).padStart(2, '0')}`;
                allWeeks.add(weekKey);
            }
        }
    } else {
        // FALLBACK: Wenn keine Trades, zeige aktuelle Woche + 52 vorherige Wochen
        for (let i = 52; i >= 0; i--) {
            const weekDate = new Date(today);
            weekDate.setDate(weekDate.getDate() - (i * 7));
            const weekNum = getWeekNumber(weekDate);
            const year = weekDate.getFullYear();
            const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;
            allWeeks.add(weekKey);
        }
    }
    
    const sortedWeeks = Array.from(allWeeks).sort().reverse();
    
    container.className = 'calendar-grid-weekly';
    container.innerHTML = sortedWeeks.map(weekKey => {
        const weekTrades = groupedByWeek[weekKey] || [];
        const weekPnL = weekTrades.reduce((sum, t) => sum + t.pnl, 0);
        const status = weekTrades.length === 0 ? 'neutral' : (weekPnL > 0 ? 'profit' : 'loss');
        
        return `
            <div class="calendar-day ${status}">
                <div class="calendar-day-header">${weekKey}</div>
                <div class="calendar-day-pnl">${weekTrades.length > 0 ? cfGeld(weekPnL, { vorzeichen: true, stellen: 0 }) : '—'}</div>
                <div class="calendar-day-trades">${weekTrades.length} T.</div>
            </div>
        `;
    }).join('');
}

function renderMonthlyCalendar(trades, container) {
    const groupedByMonth = {};
    
    // Gruppiere Trades nach Monat
    trades.forEach(t => {
        const [day, month, year] = t.date.split('.');
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        groupedByMonth[monthKey] = (groupedByMonth[monthKey] || []).concat(t);
    });
    
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Monate bis einschliesslich heute - keine leeren Zukunftsmonate.
    // Zurueck bis Januar oder bis zum fruehesten Trade, je nachdem was
    // weiter zurueckliegt; vorher fielen Trades aus dem Vorjahr einfach
    // heraus. Monate mit Trades bleiben immer drin.
    const heuteKey = `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const mitTrades = Object.keys(groupedByMonth).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
    let vonKey = `${currentYear}-01`;
    if (mitTrades.length && mitTrades[0] < vonKey) vonKey = mitTrades[0];
    const allMonths = [];
    let [jj, mm] = vonKey.split('-').map(Number);
    while (`${jj}-${String(mm).padStart(2, '0')}` <= heuteKey) {
        allMonths.push(`${jj}-${String(mm).padStart(2, '0')}`);
        mm++; if (mm > 12) { mm = 1; jj++; }
    }
    mitTrades.forEach(k => { if (!allMonths.includes(k)) allMonths.push(k); });

    // Neuester Monat zuerst, also oben links.
    allMonths.sort().reverse();
    
    // Berechne Stats
    const allTrades = trades;
    const totalPnL = allTrades.reduce((sum, t) => sum + t.pnl, 0);
    const tradingMonths = allMonths.filter(m => groupedByMonth[m]?.length > 0).length;
    const wins = allTrades.filter(t => t.pnl > 0).length;
    const winRate = allTrades.length > 0 ? ((wins / allTrades.length) * 100).toFixed(1) : 0;
    const avgPerMonth = tradingMonths > 0 ? (totalPnL / tradingMonths).toFixed(2) : 0;
    
    // Beste & Schlechteste Monate finden
    let bestMonth = { key: '-', pnl: 0 };
    let worstMonth = { key: '-', pnl: 0 };
    allMonths.forEach(monthKey => {
        const monthTrades = groupedByMonth[monthKey] || [];
        const monthPnL = monthTrades.reduce((sum, t) => sum + t.pnl, 0);
        if (monthTrades.length > 0) {
            if (monthPnL > bestMonth.pnl) bestMonth = { key: monthKey, pnl: monthPnL };
            if (monthPnL < worstMonth.pnl) worstMonth = { key: monthKey, pnl: monthPnL };
        }
    });
    
    const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const getMonthName = (monthKey) => {
        const [y, m] = monthKey.split('-');
        return `${monthNames[parseInt(m) - 1]} ${y}`;
    };
    
    // HTML
    const html = `
        <!-- Legende -->
        <div style="display: flex; gap: 20px; margin-bottom: 30px; padding: 16px; background: rgba(138, 134, 160, 0.1); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #34D399; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Gewinn</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #FB7185; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Verlust</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #8A86A0; border-radius: 6px;"></div>
                <span style="color: #D5D2E2; font-size: 13px;">Keine Trades</span>
            </div>
        </div>
        
        <!-- Calendar Grid -->
        <div class="calendar-grid-monthly">
            ${allMonths.map(monthKey => {
                const monthTrades = groupedByMonth[monthKey] || [];
                const monthPnL = monthTrades.reduce((sum, t) => sum + t.pnl, 0);
                const status = monthTrades.length === 0 ? 'neutral' : (monthPnL > 0 ? 'profit' : 'loss');
                const isSpecial = (bestMonth.key === monthKey) ? 'style="box-shadow: 0 0 20px rgba(52, 211, 153, 0.6);"' : (worstMonth.key === monthKey) ? 'style="box-shadow: 0 0 20px rgba(251, 113, 133, 0.6);"' : '';
                
                return `
                    <div class="calendar-day ${status}" ${isSpecial} title="${getMonthName(monthKey)}: ${monthTrades.length} Trades, ${cfGeld(monthPnL, { vorzeichen: true })}">
                        <div class="calendar-day-header">${getMonthName(monthKey)}</div>
                        <div class="calendar-day-pnl">${monthTrades.length > 0 ? cfGeld(monthPnL, { vorzeichen: true, stellen: 0 }) : '—'}</div>
                        <div class="calendar-day-trades">${monthTrades.length} T.</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    container.innerHTML = html;
}

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNum;
}

// ===== DASHBOARD =====
// Helper: Calculate all dashboard stats once
function calculateDashboardStats(trades) {
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl < 0).length;
    const winRate = trades.length > 0 ? parseFloat(((wins / trades.length) * 100).toFixed(1)) : 0;
    const avgWin = wins > 0 ? parseFloat((trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / wins).toFixed(2)) : 0;
    const avgLoss = losses > 0 ? parseFloat((trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) / losses).toFixed(2)) : 0;
    const totalWins = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? parseFloat((totalWins / totalLosses).toFixed(2)) : (totalWins > 0 ? 99.99 : 0);
    const expectancy = trades.length > 0 ? (totalPnL / trades.length) : 0;
    
    const today = new Date().toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayTrades = trades.filter(t => t.date === today);
    const todayPnL = todayTrades.reduce((sum, t) => sum + t.pnl, 0);
    const todayWins = todayTrades.filter(t => t.pnl > 0).length;
    const todayWinRate = todayTrades.length > 0 ? ((todayWins / todayTrades.length) * 100).toFixed(1) : 0;
    
    let tradeScore = 0;
    if (trades.length > 0) {
        const winRateScore = Math.min(winRate / 0.6 * 20, 20);
        const profitFactorScore = Math.min((profitFactor / 2) * 25, 25);
        const consistencyScore = Math.min((Math.abs(avgWin) / (Math.abs(avgWin) + Math.abs(avgLoss))) * 25, 25);
        const tradeCountScore = Math.min((trades.length / 100) * 30, 30);
        tradeScore = Math.round(winRateScore + profitFactorScore + consistencyScore + tradeCountScore);
        tradeScore = Math.min(100, Math.max(0, tradeScore));
    }
    
    return {
        totalPnL, wins, losses, winRate, avgWin, avgLoss, profitFactor, expectancy,
        todayPnL, todayTrades, todayWins, todayWinRate, tradeScore,
        trades
    };
}

// Kopfzeile des Dashboards: Begruessung, Datum und ein Satz zum
// aktuellen Stand. Ersetzt die blosse Ueberschrift "Dashboard" -
// die sagte nichts, was die Sidebar nicht schon sagt.
function buildDashboardGreeting(trades, stats) {
    const name = window.cfRawStorage.get('capitalflow_current_name') || '';
    const jetzt = new Date();

    const stunde = jetzt.getHours();
    const tageszeit = stunde < 11 ? 'Guten Morgen'
                    : stunde < 18 ? 'Guten Tag'
                    : 'Guten Abend';

    const datum = jetzt.toLocaleDateString('de-DE', {
        weekday: 'long', day: 'numeric', month: 'long'
    });

    // Trades von heute. Die Trades tragen TT.MM.JJJJ - vorher stand hier
    // toISOString() (JJJJ-MM-TT, dazu in UTC), damit passte nie ein Trade
    // und die Zeile "X Trades heute" erschien nie.
    const heute = jetzt.toLocaleDateString('de-DE',
        { year: 'numeric', month: '2-digit', day: '2-digit' });
    const heutige = trades.filter(t => t.date === heute);
    const heutePnl = heutige.reduce((sum, t) => sum + (t.pnl || 0), 0);

    let lage;
    if (trades.length === 0) {
        lage = 'Noch kein Trade erfasst. Leg im Journal deinen ersten an.';
    } else if (heutige.length > 0) {
        const vz = heutePnl >= 0 ? '+' : '';
        lage = `${heutige.length} ${heutige.length === 1 ? 'Trade' : 'Trades'} ` +
               `heute, ${cfGeld(heutePnl, { vorzeichen: true })}.`;
    } else if (trades.length < 20) {
        const fehlt = 20 - trades.length;
        lage = `${trades.length} ${trades.length === 1 ? 'Trade' : 'Trades'} erfasst. ` +
               `Ab etwa 20 werden die Auswertungen aussagekräftig – ` +
               `noch ${fehlt} zu gehen.`;
    } else {
        lage = `${trades.length} Trades erfasst, Trefferquote ` +
               `${cfProz(stats.winRate || 0, 1)}.`;
    }

    return `
        <div class="dash-greeting">
            <div class="dash-greeting-date">${escapeHtml(datum)}</div>
            <h2 class="dash-greeting-title">${tageszeit}${name ? ', ' : ''}<span class="dash-greeting-name">${escapeHtml(name)}</span></h2>
            <p class="dash-greeting-note">${escapeHtml(lage)}</p>
        </div>`;
}

/**
 * Der Kasten, der erscheint, solange noch kein einziger Trade da ist.
 *
 * Ohne ihn sieht ein neuer Nutzer ein Dashboard voller Nullen und weiss
 * nicht, dass es einen CSV-Import gibt - die App sieht dann aus, als
 * waere sie kaputt oder als muesste man vierzig Trades abtippen. Beides
 * fuehrt dazu, dass er nicht wiederkommt.
 *
 * Bewusst an dieser Stelle und nicht als Tour beim ersten Start: eine
 * Tour klickt man weg, bevor man sie gelesen hat, und findet sie danach
 * nie wieder. Dieser Kasten erscheint von selbst und verschwindet von
 * selbst, sobald der erste Trade da ist.
 */
function leererStart(anzahlTrades) {
    if (anzahlTrades > 0) return '';
    return `
        <div class="start-kasten">
            <div class="start-kopf">Noch keine Trades</div>
            <p class="start-text">
                Du musst nichts abtippen. Trade Republic gibt dir eine Datei mit
                allem, was du gehandelt hast — die liest CapitalFlow ein und baut
                daraus dein Journal. Dauert zwei Minuten.
            </p>
            <div class="start-knoepfe">
                <button type="button" class="btn btn-primary"
                        onclick="handleTabChange('daten')">Trades importieren</button>
                <button type="button" class="btn btn-secondary"
                        onclick="handleTabChange('anleitung')">Erst die Anleitung lesen</button>
            </div>
            <p class="start-fuss">
                Oder <button type="button" class="start-link" onclick="cfTradeVonHand()">trag deinen ersten Trade von Hand ein</button>.
            </p>
        </div>`;
}

/** Aus dem Leer-Kasten heraus: ins Journal und das Formular aufklappen. */
function cfTradeVonHand() {
    if (currentTab !== 'journal') handleTabChange('journal');
    cfKlapp('auf', 'tradeFormHuelle');
}

function loadDashboard() {
    const allTrades = JSON.parse(localStorage.getItem('trades')) || [];
    const trades = getFilteredTrades(allTrades);
    const stats = calculateDashboardStats(trades);
    
    // Berechne weitere Stats
    let bestTradeData = { pnl: 0, date: '-', ticker: '-' };
    let worstTradeData = { pnl: 0, date: '-', ticker: '-' };
    if (trades.length > 0) {
        bestTradeData = trades.reduce((prev, current) => (prev.pnl > current.pnl) ? prev : current);
        worstTradeData = trades.reduce((prev, current) => (prev.pnl < current.pnl) ? prev : current);
    }
    
    // Largest Drawdown
    let largestDrawdown = 0;
    let cumulativePnL = 0;
    let peak = 0;
    trades.forEach(t => {
        cumulativePnL += t.pnl;
        if (cumulativePnL > peak) peak = cumulativePnL;
        const drawdown = peak - cumulativePnL;
        if (drawdown > largestDrawdown) largestDrawdown = drawdown;
    });
    
    // Serien nach DATUM, nicht nach Reihenfolge im Speicher: importierte
    // Trades liegen dort in der Reihenfolge der Datei, nachgetragene am
    // Ende. Gleiches Datum behaelt die gespeicherte Reihenfolge.
    const zeitVon = (t) => {
        const [d, m, j] = String(t.date || '').split('.');
        return new Date(`${j}-${m}-${d}`).getTime() || 0;
    };
    const chronologisch = trades.map((t, i) => ({ t, i }))
        .sort((a, b) => zeitVon(a.t) - zeitVon(b.t) || a.i - b.i)
        .map(x => x.t);

    // Consecutive Wins/Losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;
    
    chronologisch.forEach(t => {
        if (t.pnl > 0) {
            currentWins++;
            currentLosses = 0;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
        } else if (t.pnl < 0) {
            currentLosses++;
            currentWins = 0;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
        }
    });
    
    // Laufende Serie: vom juengsten Trade rueckwaerts, solange das
    // Vorzeichen gleich bleibt. Vorher hiess die laengste Gewinnserie
    // "Current Streak" und die laengste Verlustserie "Longest Streak" -
    // beide Beschriftungen waren falsch.
    let serie = 0, serieArt = null;
    for (let i = chronologisch.length - 1; i >= 0; i--) {
        const p = parseFloat(chronologisch[i].pnl) || 0;
        if (p === 0) continue;
        const art = p > 0 ? 'gewinn' : 'verlust';
        if (serieArt === null) serieArt = art;
        if (art !== serieArt) break;
        serie++;
    }
    const serieText = serie === 0 ? '—'
        : serie + ' ' + (serieArt === 'gewinn'
            ? (serie === 1 ? 'Gewinn' : 'Gewinne')
            : (serie === 1 ? 'Verlust' : 'Verluste'));
    const serieFarbe = serieArt === 'verlust' ? '#FB7185' : '#34D399';

    // Trading Days (unique days mit Trades)
    const uniqueTradingDays = new Set(trades.map(t => t.date)).size;
    
    // Win Rate by Day
    const winsByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const totalByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    const pnlByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };

    trades.forEach(t => {
        const [day, month, year] = String(t.date).split('.');
        const d = new Date(`${year}-${month}-${day}`);
        // Ein unlesbares Datum darf die Statistik nicht vergiften:
        // dayMap[NaN] ist undefined, und totalByDay[undefined]++ macht
        // aus jeder Auswertung danach NaN.
        if (isNaN(d.getTime())) return;
        const dayName = dayMap[d.getDay()];
        if (!dayName) return;
        totalByDay[dayName]++;
        pnlByDay[dayName] += (parseFloat(t.pnl) || 0);
        if (t.pnl > 0) winsByDay[dayName]++;
    });
    
    const winRateByDay = Object.keys(winsByDay).map(day => ({
        day,
        rate: totalByDay[day] > 0 ? ((winsByDay[day] / totalByDay[day]) * 100).toFixed(0) : 0,
        total: totalByDay[day],
        pnl: pnlByDay[day]
    }));

    // Bester Wochentag nach ERGEBNIS, nicht nach Trefferquote.
    //
    // Vorher stand hier Trefferquote mal Gesamtergebnis geteilt durch
    // hundert - eine Zahl ohne Bedeutung. Bei 60 % Treffern und minus
    // 1404 Euro Gesamtergebnis kam "+€-842,56" heraus: ein Pluszeichen
    // vor einem Minusbetrag, gruen eingefaerbt, als "bester Tag".
    //
    // Nur Tage beruecksichtigen, an denen ueberhaupt gehandelt wurde -
    // sonst gewinnt der Samstag mit null Trades und null Euro.
    const gehandelt = winRateByDay.filter(d => d.total > 0);
    const bestDay = gehandelt.length
        ? gehandelt.reduce((max, day) => day.pnl > max.pnl ? day : max)
        : { day: '—', rate: 0, total: 0, pnl: 0 };
    
    // Ergebnis der laufenden Woche, ab Montag.
    const jetzt = new Date();
    const wochenStart = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    // getDay(): Sonntag ist 0. Ohne die Korrektur begaenne die Woche
    // am Sonntag und der Montag fiele in die vorige.
    wochenStart.setDate(wochenStart.getDate() - ((jetzt.getDay() + 6) % 7));
    const wocheTrades = trades.filter(t => {
        const [d, m, j] = String(t.date || '').split('.');
        const x = new Date(`${j}-${m}-${d}`);
        return !isNaN(x.getTime()) && x >= wochenStart;
    });
    const wocheSumme = wocheTrades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
    const wocheQuote = wocheTrades.length
        ? Math.round(100 * wocheTrades.filter(t => t.pnl > 0).length / wocheTrades.length)
        : 0;

    const tagNamen = { Mon: 'Montag', Tue: 'Dienstag', Wed: 'Mittwoch', Thu: 'Donnerstag',
                       Fri: 'Freitag', Sat: 'Samstag', Sun: 'Sonntag' };
    const groessterGewinn = bestTradeData.pnl > 0 ? bestTradeData : null;
    const monatsName = jetzt.toLocaleDateString('de-DE', { month: 'long' });
    const imMonat = trades.filter(t => {
        const [, m, j] = String(t.date || '').split('.');
        return parseInt(m, 10) === jetzt.getMonth() + 1 && parseInt(j, 10) === jetzt.getFullYear();
    }).length;
    const kachel = (titel, wert, farbe, zusatz) => `
            <div class="dashboard-card">
                <div class="dash-kachel-titel">${titel}</div>
                <div class="dash-kachel-wert" style="color: ${farbe};">${wert}</div>
                <div class="dash-kachel-zusatz">${zusatz}</div>
            </div>`;
    const gross = (titel, wert, zusatz) => `
            <div class="dashboard-big-card">
                <div class="dash-kachel-titel">${titel}</div>
                <div class="dash-gross-wert" style="color: ${wert >= 0 ? '#34D399' : '#FB7185'};">${eurMitVorzeichen(wert)}</div>
                <div class="dash-kachel-zusatz">${zusatz}</div>
            </div>`;

    // Reihenfolge nach Wichtigkeit: erst die Zahlen, wegen derer man
    // das Dashboard oeffnet, dann die Einordnung, ganz unten Score und
    // Aktivitaet. Die Begruessung ist eine Zeile, kein Kopfbereich mehr -
    // vorher brauchte sie mit Filter darunter das halbe erste Bild.
    const dashboardContent = document.getElementById('dashboard');
    dashboardContent.innerHTML = `
        ${leererStart(allTrades.length)}
        <div class="dash-kopf">
            ${buildDashboardGreeting(trades, stats)}
            <div class="trades-filter dash-filter" role="group" aria-label="Welche Trades zählen">
                <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Alle Trades</button>
                <button class="filter-btn ${currentFilter === 'leverage' ? 'active' : ''}" data-filter="leverage">Nur Hebel</button>
                <button class="filter-btn ${currentFilter === 'normal' ? 'active' : ''}" data-filter="normal">Nur Normal</button>
            </div>
        </div>

        <!-- Gesamt, Woche, Heute. Hier stand frueher der Kontostand -
             raus, weil er ohne offene Positionen und Kursbewegungen nie
             mit dem Depot uebereinstimmt. -->
        <div class="dashboard-top-cards dash-raster-3">
            ${gross('Gesamt', stats.totalPnL, `${stats.trades.length} Trades • ${cfProz(stats.winRate, 1)} Treffer`)}
            ${gross('Diese Woche', wocheSumme, `${wocheTrades.length} Trades${wocheTrades.length ? ' • ' + cfProz(wocheQuote, 0) + ' Treffer' : ''}`)}
            ${gross('Heute', stats.todayPnL, stats.todayTrades.length ? `${stats.todayTrades.length} Trades • ${cfProz(stats.todayWinRate, 1)} Treffer` : 'Heute noch kein Trade')}
        </div>

        <div class="dashboard-mid-cards dash-raster-4">
            ${kachel('Aktuelle Serie', serieText, serie ? serieFarbe : '#A1A1AA', serie ? 'in Folge, jüngster Trade zuerst' : 'Noch keine Serie')}
            ${kachel('Profit Factor', cfZahl(stats.profitFactor, 2), '#C9B8FF', 'Gewinne geteilt durch Verluste')}
            ${kachel('Größter Gewinn', groessterGewinn ? cfGeld(groessterGewinn.pnl, { vorzeichen: true }) : '—', '#34D399',
                groessterGewinn ? escapeHtml(String(groessterGewinn.ticker || '')) + ' • ' + escapeHtml(String(groessterGewinn.date || '')) : 'Noch kein Gewinn')}
            ${kachel('Bester Wochentag', gehandelt.length ? cfGeld(bestDay.pnl, { vorzeichen: true }) : '—',
                bestDay.pnl >= 0 ? '#34D399' : '#FB7185',
                gehandelt.length ? `${tagNamen[bestDay.day]} • ${bestDay.total} Trades • ${cfProz(bestDay.rate, 0)} Treffer` : 'Noch keine Trades')}
        </div>

        <div class="dashboard-bottom-stats dash-raster-4">
            ${kachel('Handelstage', uniqueTradingDays, '#C9B8FF', 'Tage mit mindestens einem Trade')}
            ${kachel('Längste Gewinnserie', maxConsecutiveWins, '#34D399', 'Gewinne hintereinander')}
            ${kachel('Längste Verlustserie', maxConsecutiveLosses, '#FB7185', 'Verluste hintereinander')}
            ${kachel('Ø je Trade', eurMitVorzeichen(stats.expectancy), stats.expectancy >= 0 ? '#34D399' : '#FB7185', 'Ergebnis geteilt durch Anzahl')}
        </div>

        <!-- Score und Aktivitaet zuletzt: beide ordnen ein, keine von
             beiden ist eine Zahl, wegen der man nachsieht. -->
        <div class="dashboard-zwei" style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 20px;">
            <div class="dashboard-section" style="padding: 24px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div class="trade-score-label" style="color: #A9A5BD; font-size: 12px; margin-bottom: 8px;">Trade-Score</div>
                    <div class="trade-score-value" id="tradeScoreValue" style="font-size: 48px; font-weight: 700; color: #ECEAF4;">0</div>
                    <div class="trade-score-status" id="tradeScoreStatus" style="color: #fbbf24; font-size: 13px; margin-top: 4px;">-</div>
                </div>
                <div class="cf-diagramm" style="height: 250px;"><canvas id="tradeScoreChart"></canvas></div>
            </div>

            <div class="dashboard-section" style="padding: 24px;">
                <div style="color: #D5D2E2; font-size: 14px; font-weight: 600; margin-bottom: 16px;">Aktivität im ${escapeHtml(monatsName)}</div>
                <div style="color: #A9A5BD; font-size: 12px; margin-bottom: 16px;">${imMonat} ${imMonat === 1 ? 'Trade' : 'Trades'} in diesem Monat</div>
                <div id="activityHeatmap" style="overflow-x: auto;"></div>
            </div>
        </div>
    `;
    
    // Sofort zeichnen, nicht nach einer Pause: mit Verzoegerung stand
    // die Seite erst ohne Diagramme da und sortierte sich dann um.
    renderDashboardCharts(trades, stats);
    renderActivityHeatmap(trades);
}

function renderDashboardCharts(trades, stats) {
    // Trade Score Calculation
    let tradeScore = 0;
    if (trades.length > 0) {
        const winRateScore = Math.min(stats.winRate / 0.6 * 20, 20);
        const profitFactorScore = Math.min((stats.profitFactor / 2) * 25, 25);
        const consistencyScore = Math.min((Math.abs(stats.avgWin) / (Math.abs(stats.avgWin) + Math.abs(stats.avgLoss))) * 25, 25);
        const tradeCountScore = Math.min((trades.length / 100) * 30, 30);
        tradeScore = Math.round(winRateScore + profitFactorScore + consistencyScore + tradeCountScore);
        tradeScore = Math.min(100, Math.max(0, tradeScore));
    }
    
    const status = tradeScore >= 75 ? 'Sehr gut' : tradeScore >= 50 ? 'Gut' : tradeScore >= 25 ? 'Ausbaufähig' : 'Am Anfang';
    // Diese Elemente stammen aus einer aelteren Dashboard-Version und
    // existieren im HTML nicht mehr - ohne Pruefung bricht die Funktion hier ab
    const scoreValueEl = document.getElementById('tradeScoreValue');
    const scoreStatusEl = document.getElementById('tradeScoreStatus');
    if (scoreValueEl) scoreValueEl.textContent = tradeScore;
    if (scoreStatusEl) scoreStatusEl.textContent = status;
    
    // Render Radar Chart
    if (window.tradeScoreChartInstance) window.tradeScoreChartInstance.destroy();
    const canvasEl = document.getElementById('tradeScoreChart');
    
    if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        window.tradeScoreChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Trefferquote', 'Beständigkeit', 'Profit Factor', 'Anzahl Trades', 'Chance : Risiko'],
                datasets: [{
                    label: 'Performance',
                    data: [
                        Math.min(stats.winRate / 0.6 * 20, 20),
                        Math.min((Math.abs(stats.avgWin) / (Math.abs(stats.avgWin) + Math.abs(stats.avgLoss))) * 25, 25),
                        Math.min((stats.profitFactor / 2) * 25, 25),
                        Math.min((trades.length / 100) * 30, 30),
                        Math.min((stats.profitFactor / 2) * 20, 20)
                    ],
                    borderColor: '#8B6CF3',
                    backgroundColor: 'rgba(124, 92, 240, 0.112)',
                    borderWidth: 2,
                    pointBackgroundColor: '#8B6CF3',
                    pointBorderColor: '#fff',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    r: {
                        max: 100,
                        ticks: { display: false },
                        pointLabels: { 
                            display: true,
                            color: '#8A86A0',
                            font: { size: 10, weight: 'normal' }
                        },
                        grid: { color: 'rgba(124, 92, 240, 0.075)' },
                        angleLines: { color: 'rgba(124, 92, 240, 0.075)' }
                    }
                }
            }
        });
    }
}

function renderActivityHeatmap(trades) {
    const container = document.getElementById('activityHeatmap');
    if (!container) return;
    
    // Group trades by date (YYYY-MM-DD)
    const tradesByDate = {};
    trades.forEach(t => {
        const [day, month, year] = t.date.split('.');
        const dateKey = `${year}-${month}-${day}`;
        if (!tradesByDate[dateKey]) tradesByDate[dateKey] = { wins: 0, losses: 0 };
        if (t.pnl > 0) tradesByDate[dateKey].wins++;
        else tradesByDate[dateKey].losses++;
    });
    
    // Get current month from latest trades
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    
    // Generate all days of current month
    const daysInMonth = new Date(currentYear, parseInt(currentMonth), 0).getDate();
    const weeks = [];
    let currentWeek = [];
    
    // Get day of week for first day
    // Woche beginnt am Montag, wie die Spaltenkoepfe. Vorher zaehlte
    // getDay() ab Sonntag, und jeder Tag stand eine Spalte zu weit rechts
    // (der 1. Oktober 2026, ein Donnerstag, unter "Fr"). Ausserdem lokal
    // statt "JJJJ-MM-TT" - das wird als UTC gelesen.
    const firstDay = new Date(currentYear, parseInt(currentMonth, 10) - 1, 1);
    const startDayOfWeek = (firstDay.getDay() + 6) % 7;
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
        currentWeek.push(null);
    }
    
    // Add all days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${currentMonth}-${String(day).padStart(2, '0')}`;
        const data = tradesByDate[dateStr];
        currentWeek.push({ day, data });
        
        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    }
    
    // Add remaining days
    if (currentWeek.length > 0) {
        weeks.push(currentWeek);
    }
    
    const dayHeaders = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    
    let html = '';
    html += '<div style="display: flex; gap: 8px; flex-direction: column;">';
    
    // Day headers
    html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">';
    dayHeaders.forEach(h => {
        html += `<div style="text-align: center; color: #A9A5BD; font-size: 9px; font-weight: 600; height: 16px;">${h}</div>`;
    });
    html += '</div>';
    
    // Weeks
    weeks.forEach(week => {
        html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">';
        week.forEach(day => {
            if (!day) {
                html += '<div></div>';
            } else {
                const data = day.data;
                let color = '#1e1e2e';
                if (data) {
                    if (data.wins > data.losses) color = '#10b98166';
                    else if (data.losses > data.wins) color = '#f8717166';
                    else color = '#a855f766';
                }
                const tradeCount = data ? (data.wins + data.losses) : 0;
                html += `<div title="${day.day}.${currentMonth}.: ${tradeCount} ${tradeCount === 1 ? 'Trade' : 'Trades'}" style="justify-self: center; width: 24px; height: 24px; background: ${color}; border-radius: 3px; font-size: 9px; display: flex; align-items: center; justify-content: center; color: #D5D2E2; border: 1px solid rgba(124, 92, 240, 0.15); cursor: pointer; font-weight: 500; transition: all 0.2s ease;" onmouseover="this.style.borderColor='rgba(124, 92, 240, 0.45)'; this.style.transform='scale(1.15)';" onmouseout="this.style.borderColor='rgba(124, 92, 240, 0.15)'; this.style.transform='scale(1)';">${day.day}</div>`;
            }
        });
        html += '</div>';
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Auswertung nach Richtung: viele Trader verdienen mit Longs und
// verlieren mit Shorts (oder umgekehrt) - ohne Trennung geht das im
// Gesamtergebnis unter.
function buildDirectionBreakdown(trades) {
    const gruppe = (dir) => {
        const list = trades.filter(t =>
            (t.direction === 'short' ? 'short' : 'long') === dir);
        const wins = list.filter(t => (t.pnl || 0) > 0).length;
        const pnl = list.reduce((sum, t) => sum + (t.pnl || 0), 0);
        return {
            anzahl: list.length,
            wins: wins,
            verluste: list.length - wins,
            quote: list.length ? (wins / list.length) * 100 : 0,
            pnl: pnl,
            schnitt: list.length ? pnl / list.length : 0
        };
    };

    const l = gruppe('long');
    const shrt = gruppe('short');

    if (l.anzahl === 0 && shrt.anzahl === 0) return '';

    const karte = (titel, d, farbe, klasse) => {
        const vz = d.pnl >= 0 ? '+' : '';
        const pnlFarbe = d.pnl >= 0 ? '#34D399' : '#FB7185';
        const anteil = d.anzahl
            ? Math.round((d.anzahl / (l.anzahl + shrt.anzahl)) * 100) : 0;
        return `
        <div class="dir-card ${klasse}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
                <div class="dir-card-title" style="color:${farbe};">${titel}</div>
                <div style="font-size:11px;color:#8A86A0;font-weight:600;">${cfProz(anteil, 0)} aller Trades</div>
            </div>
            <div style="font-size:30px;font-weight: 700;color:${pnlFarbe};line-height:1;margin-bottom:6px;">
                ${cfGeld(d.pnl, { vorzeichen: true })}
            </div>
            <div style="font-size:12px;color:#A9A5BD;margin-bottom:18px;">
                ${d.anzahl} ${d.anzahl === 1 ? 'Trade' : 'Trades'} · Ø ${cfGeld(d.schnitt, { vorzeichen: true })}
            </div>
            <div style="height:6px;border-radius:3px;background:rgba(251, 113, 133, 0.25);overflow:hidden;margin-bottom:8px;">
                <div style="height:100%;width:${d.quote.toFixed(1)}%;background:#34D399;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;">
                <span style="color:#34D399;">${d.wins} Gewinner</span>
                <span style="color:#D5D2E2;">${cfProz(d.quote, 1)} Trefferquote</span>
                <span style="color:#FB7185;">${d.verluste} Verlierer</span>
            </div>
        </div>`;
    };

    // Ein Satz, der die Zahlen einordnet
    let fazit = '';
    if (l.anzahl >= 5 && shrt.anzahl >= 5) {
        if (l.pnl > 0 && shrt.pnl < 0) {
            fazit = 'Deine Longs tragen das Ergebnis, die Shorts kosten dich Geld.';
        } else if (shrt.pnl > 0 && l.pnl < 0) {
            fazit = 'Deine Shorts tragen das Ergebnis, die Longs kosten dich Geld.';
        } else if (Math.abs(l.quote - shrt.quote) > 15) {
            fazit = l.quote > shrt.quote
                ? 'Longs treffen deutlich häufiger als Shorts.'
                : 'Shorts treffen deutlich häufiger als Longs.';
        }
    } else {
        fazit = 'Ab etwa 5 Trades je Richtung wird der Vergleich aussagekräftig.';
    }

    return `
        <div style="margin-bottom: 40px;">
            <h3 style="font-size:18px;font-weight:600;margin-bottom:20px;">Long gegen Short</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;">
                ${karte('LONG', l, '#34D399', 'dir-card-long')}
                ${karte('SHORT', shrt, '#fb923c', 'dir-card-short')}
            </div>
            ${fazit ? `<p style="margin:16px 0 0 0;font-size:13px;color:#A9A5BD;">${escapeHtml(fazit)}</p>` : ''}
        </div>`;
}

function loadAnalytics() {
    const allTrades = JSON.parse(localStorage.getItem('trades')) || [];
    const trades = getFilteredTrades(allTrades);
    const stats = calculateDashboardStats(trades);
    
    // Calculate additional metrics
    let avgWin = 0, avgLoss = 0, largestWin = 0, largestLoss = 0;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    
    if (wins.length > 0) {
        avgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;
        largestWin = Math.max(...wins.map(t => t.pnl));
    }
    if (losses.length > 0) {
        avgLoss = losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length;
        largestLoss = Math.abs(Math.min(...losses.map(t => t.pnl)));
    }

    // Durchschnittliches Chance-Risiko-Verhaeltnis.
    //
    // Hier stand bisher stats.riskRewardRatio - eine Eigenschaft, die
    // nirgends in dieser App berechnet wird. Der Ausdruck war also immer
    // undefined, und die Kachel zeigte seit dem ersten Tag den
    // fest eingetippten Ersatzwert "0.00:1". Eine Kachel, die eine
    // Konstante anzeigt, ist schlimmer als gar keine: sie sieht aus wie
    // eine Messung.
    //
    // Gerechnet wird nur ueber Trades MIT Stop. Ohne Stop ist das
    // Risiko nicht bekannt; solche Trades mit 0 einzurechnen wuerde den
    // Schnitt nach unten ziehen und damit genau die Zahl verfaelschen,
    // wegen der man hinschaut. Nach einem CSV-Import ist das die
    // Mehrheit - deshalb steht dabei, auf wie vielen Trades sie beruht.
    const mitStop = trades.filter(t =>
        Number.isFinite(parseFloat(t.riskReward)) && parseFloat(t.risk) > 0);
    const avgRR = mitStop.length
        ? mitStop.reduce((s, t) => s + parseFloat(t.riskReward), 0) / mitStop.length
        : null;
    const avgRRText = avgRR === null ? '—' : cfZahl(avgRR, 2) + ' : 1';
    const avgRRZusatz = mitStop.length === 0
        ? 'Kein Trade hat einen Stop'
        : 'aus ' + mitStop.length + ' von ' + trades.length + ' Trades';


    // Calculate Sharpe Ratio (simplified)
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.length > 0 ? returns.reduce((a,b) => a+b) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev).toFixed(2) : 0;
    
    // Maximaler Rueckgang (Max Drawdown)
    //
    // Gemessen am HOECHSTSTAND des Kontos, nicht am Gesamtergebnis.
    // Vorher stand hier maxDD / totalPnL: bei negativem Gesamtergebnis
    // wird dieser Bruch negativ, und zusammen mit dem hartcodierten
    // Minus davor kam "--160 %" heraus. Ein Rueckgang von 160 Prozent
    // gibt es nicht.
    //
    // Startpunkt ist das eingezahlte Kapital. Ohne das waere der erste
    // Verlusttrade immer ein Rueckgang von 100 Prozent.
    const ddSortiert = trades.slice().sort((a, b) => {
        const z = (x) => {
            const [d, m, j] = String(x.date || '').split('.');
            return new Date(`${j}-${m}-${d}`).getTime() || 0;
        };
        return z(a) - z(b);
    });
    const startKapital = (typeof getNetDeposits === 'function')
        ? getNetDeposits() : 0;
    let maxDD = 0;              // in Euro
    let maxDDProzent = null;    // null = nicht bestimmbar
    let kapital = startKapital;
    let hoch = startKapital;
    ddSortiert.forEach(t => {
        kapital += (parseFloat(t.pnl) || 0);
        if (kapital > hoch) hoch = kapital;
        const dd = hoch - kapital;
        if (dd > maxDD) {
            maxDD = dd;
            maxDDProzent = hoch > 0 ? (dd / hoch) * 100 : null;
        }
    });
    
    // Bester Kalendertag: nach Datum gruppieren und das beste Ergebnis
    // nehmen. Vorher stand in der Kachel Gesamtergebnis mal 0,3 - eine
    // Zahl, die mit keinem Tag etwas zu tun hatte.
    const jeTag = {};
    trades.forEach(t => {
        if (!t.date) return;
        jeTag[t.date] = (jeTag[t.date] || 0) + (parseFloat(t.pnl) || 0);
    });
    const tage = Object.keys(jeTag);
    const besterTag = tage.length
        ? tage.reduce((b, d) => jeTag[d] > b.pnl ? { datum: d, pnl: jeTag[d] } : b,
                      { datum: tage[0], pnl: jeTag[tage[0]] })
        : { datum: null, pnl: 0 };

    // Behavioral Score (mock data - in real app would be calculated from trade patterns)
    const behavioralScore = {
        discipline: Math.min(100, stats.winRate * 1.5),
        psychology: Math.min(100, Math.abs(avgWin) / (Math.abs(avgWin) + Math.abs(avgLoss)) * 100),
        riskMgmt: Math.min(100, stats.profitFactor * 30),
        strategy: Math.min(100, stats.winRate * 1.2),
        timing: Math.min(100, stats.expectancy / 10 + 50),
        consistency: Math.min(100, (1 - (stdDev / Math.abs(avgReturn + 1))) * 100)
    };
    
    // Vorher stand unter jedem Profit Factor fest "Excellent" - auch
    // unter 0,4. Ein Urteil, das nie wechselt, ist keins.
    const pf = parseFloat(stats.profitFactor) || 0;
    const pfUrteil = trades.length === 0 ? { text: 'Noch keine Trades', farbe: '#8B8B94' }
        : pf >= 2 ? { text: 'Stark', farbe: '#34D399' }
        : pf >= 1.5 ? { text: 'Gut', farbe: '#34D399' }
        : pf >= 1 ? { text: 'Knapp im Plus', farbe: '#E8AE4F' }
        : { text: 'Verluste überwiegen', farbe: '#FB7185' };

    const analyticsContent = document.getElementById('analytics');
    analyticsContent.innerHTML = `
        <div class="cf-tabkopf">
            <div>
                <h2>Analytics</h2>
                <p>Was deine Trades über dich verraten</p>
            </div>
        <!-- ===== FILTER BUTTONS ===== -->
        <div class="trades-filter" role="group" aria-label="Welche Trades zählen">
            <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Alle Trades</button>
            <button class="filter-btn ${currentFilter === 'leverage' ? 'active' : ''}" data-filter="leverage">Nur Hebel</button>
            <button class="filter-btn ${currentFilter === 'normal' ? 'active' : ''}" data-filter="normal">Nur Normal</button>
        </div>
        </div>

        <!-- Reihenfolge nach Wichtigkeit: Kennzahlen, dann die Saetze, die
             sie erklaeren, dann die Kurven. Platzhalter (Coming Soon,
             Behavioral Score) stehen gesammelt unten als Ausblick - oben
             verdraengten sie echte Zahlen. -->
        <!-- TOP 4 KEY METRICS -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 20px; margin-bottom: 30px;">
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: none; color: #A9A5BD; font-weight: 600;">Trefferquote</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: #ECEAF4; margin-bottom: 8px;">${cfProz(stats.winRate, 1)}</div>
                <div style="font-size: 12px; color: #A9A5BD;">${wins.length} Gewinner / ${losses.length} Verlierer</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: none; color: #A9A5BD; font-weight: 600;">Profit Factor</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: #ECEAF4; margin-bottom: 8px;">${cfZahl(stats.profitFactor, 2)}</div>
                <div style="font-size: 12px; color: ${pfUrteil.farbe};">${pfUrteil.text}</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: none; color: #A9A5BD; font-weight: 600;">Erwartungswert</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: ${farbeFuer(stats.expectancy)}; margin-bottom: 8px;">${eurMitVorzeichen(stats.expectancy)}</div>
                <div style="font-size: 12px; color: #A9A5BD;">pro Trade im Schnitt</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: none; color: #A9A5BD; font-weight: 600;">Gesamtergebnis</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: ${stats.totalPnL >= 0 ? '#34D399' : '#FB7185'}; margin-bottom: 8px;">${eurMitVorzeichen(stats.totalPnL)}</div>
                <div style="font-size: 12px; color: #A9A5BD;">${trades.length} ${trades.length === 1 ? 'Trade' : 'Trades'}</div>
            </div>
        </div>

        <!-- Die eigenen Auswertungen stehen VOR dem Win/Loss-Diagramm.
             Sie beantworten eine Frage; das Ringdiagramm zeigt eine
             Quote, die drei Zeilen weiter oben schon steht. Was etwas
             erklaert, gehoert nach oben. -->
        <div id="cfAuswertung"></div>

        <div class="ana-reihe ana-eins">
            <!-- LEFT: Equity Curve -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(124, 92, 240, 0.06) 0%, rgba(124, 92, 240, 0.025) 100%); border: 1px solid rgba(124, 92, 240, 0.15); border-radius: 16px; padding: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 14px; font-weight: 600; color: #D5D2E2;">Equity-Kurve</div>
                </div>
                <p style="color: #A9A5BD; font-size: 12px; margin-bottom: 16px;">Dein Ergebnis Trade für Trade aufaddiert. Steigt die Linie, arbeitet dein Vorgehen für dich.</p>
                <div class="cf-diagramm" style="height: 300px;"><canvas id="equityChart"></canvas></div>
            </div>
        </div>

        <div class="ana-reihe ana-zwei">
        <!-- Win/Loss Donut -->
        <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(124, 92, 240, 0.06) 0%, rgba(124, 92, 240, 0.025) 100%); border: 1px solid rgba(124, 92, 240, 0.15); border-radius: 16px; padding: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div style="font-size: 14px; font-weight: 600; color: #D5D2E2;">Gewinner und Verlierer</div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 30px; align-items: center;">
                <div style="position: relative; height: 260px; min-width: 0;"><canvas id="winLossChart"></canvas></div>
                <div style="display: flex; flex-direction: column; justify-content: center;">
                    <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="width: 12px; height: 12px; background: #34D399; border-radius: 2px;"></div>
                            <span style="color: #D5D2E2; font-size: 12px;">Gewinner</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="width: 12px; height: 12px; background: #FB7185; border-radius: 2px;"></div>
                            <span style="color: #D5D2E2; font-size: 12px;">Verlierer</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
            <!-- Additional Stats -->
            <div class="dashboard-section ana-keystats" style="padding: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: #D5D2E2; margin-bottom: 8px;">Eckdaten</div>
                <div class="ana-keystats-liste">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #A9A5BD;">Bester Tag</span>
                        <span style="color: ${farbeFuer(besterTag.pnl)}; font-weight: 600;" title="${besterTag.datum || ''}">${besterTag.datum ? eurMitVorzeichen(besterTag.pnl) : '—'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #A9A5BD;">Ø je Trade</span>
                        <span style="color: ${farbeFuer(stats.expectancy)}; font-weight: 600;">${eurMitVorzeichen(stats.expectancy)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #A9A5BD;" title="Größter Rückgang vom Kontohöchststand">Max. Rückgang</span>
                        <span style="color: #FB7185; font-weight: 600;">${cfGeld(-maxDD)}${maxDDProzent !== null ? ' · ' + cfProz(maxDDProzent, 1) : ''}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 5 SECONDARY METRICS -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 20px; margin-bottom: 30px;">
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 8px;">Ø Gewinn</div>
                <div style="font-size: 24px; font-weight: 700; color: #34D399;">${cfGeld(avgWin, { vorzeichen: true })}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 8px;">Ø Verlust</div>
                <div style="font-size: 24px; font-weight: 700; color: #FB7185;">${cfGeld(-Math.abs(avgLoss))}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 8px;">Größter Gewinn</div>
                <div style="font-size: 24px; font-weight: 700; color: #34D399;">${cfGeld(largestWin, { vorzeichen: true })}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 8px;">Größter Verlust</div>
                <div style="font-size: 24px; font-weight: 700; color: #FB7185;">${cfGeld(-Math.abs(largestLoss))}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 8px;">Ø Chance : Risiko</div>
                <div style="font-size: 24px; font-weight: 700; color: #C9B8FF;">${avgRRText}</div>
                <div style="font-size: 11px; color: #8A86A0; margin-top: 4px;">${escapeHtml(avgRRZusatz)}</div>
            </div>
        </div>

        ${buildDirectionBreakdown(trades)}

        <h3 class="ana-ausblick-titel">Ausblick</h3>
        <div class="ana-reihe ana-drei">
            <!-- RIGHT: Behavioral Score -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(124, 92, 240, 0.06) 0%, rgba(124, 92, 240, 0.025) 100%); border: 1px solid rgba(124, 92, 240, 0.15); border-radius: 16px; padding: 24px;">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 14px; font-weight: 600; color: #ECEAF4;">Verhaltens-Score</div>
                </div>
                <!-- Der Radar ist noch keine echte Auswertung.
                     "Disziplin" ist Trefferquote mal 1,5, "Strategie"
                     Trefferquote mal 1,2 - drei der sechs Achsen sind
                     dieselbe Zahl in anderer Skalierung. Eine Grafik, die
                     Erkenntnis vortaeuscht, ist schlimmer als keine: wer
                     genau hinsieht, merkt es, und dann sind auch die
                     echten Zahlen daneben verdaechtig.
                     Sichtbar bleibt sie als Ausblick, bis das Playbook
                     aus M3 echte Werte liefert. -->
                <div style="position: relative; margin-bottom: 16px;">
                    <div class="cf-diagramm" style="height: 250px; opacity: 0.35; filter: blur(3px); pointer-events: none;"><canvas id="behavioralChart"></canvas></div>
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 20, 35, 0.9); padding: 10px 18px; border-radius: 8px; color: #ECEAF4; font-weight: 700; font-size: 11px; letter-spacing: 0; border: 1.5px solid #8B6CF3; white-space: nowrap;">Kommt mit dem Playbook</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; font-size: 12px;">
                    <div style="text-align: center;">
                        <div style="color: #A9A5BD; margin-bottom: 4px;">Trefferquote</div>
                        <div style="font-size: 20px; font-weight: 700; color: #34D399;">${cfProz(stats.winRate, 1)}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #A9A5BD; margin-bottom: 4px;">Profit Factor</div>
                        <div style="font-size: 20px; font-weight: 700; color: #D5D2E2;">${cfZahl(stats.profitFactor, 2)}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #A9A5BD; margin-bottom: 4px;">Ø Chance : Risiko</div>
                        <div style="font-size: 20px; font-weight: 700; color: #D5D2E2;">${avgRRText}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #A9A5BD; margin-bottom: 4px;">Sharpe</div>
                        <div style="font-size: 20px; font-weight: 700; color: #D5D2E2;">${cfZahl(sharpeRatio, 2)}</div>
                    </div>
                </div>
            </div>
            <!-- Erfasste Trades: vorher "N+ metrics per trade" - ein Text,
                 der nach Kennzahl aussah und nichts aussagte. Jetzt steht da,
                 wie vollstaendig das Journal ist: ohne Stop kein Risiko, ohne
                 Setup-Typ keine Auswertung nach Setup. -->
            <div class="dashboard-section" style="padding: 24px;">
                <div style="font-size: 13px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 16px;">Erfasste Trades</div>
                <div style="font-size: 48px; font-weight: 700; color: #ECEAF4; margin-bottom: 12px;">${trades.length}</div>
                <div class="ana-vollstaendig">
                    ${[['mit Stop', trades.filter(t => parseFloat(t.stopLoss) > 0 || (t.produkt && t.produkt.stop)).length],
                       ['mit Setup-Typ', trades.filter(t => String(t.setupType || '').trim()).length],
                       ['mit Begründung', trades.filter(t => String(t.reason || '').trim()).length]]
                      .map(([text, n]) => `<div><span>${text}</span><span>${n} von ${trades.length}</span></div>
                        <div class="ana-balken"><span style="width: ${trades.length ? Math.round(100 * n / trades.length) : 0}%;"></span></div>`).join('')}
                </div>
            </div>
            <!-- Geographic Performance -->
            <div style="position: relative;">
                <!-- Blurred Background -->
                <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(124, 92, 240, 0.06) 0%, rgba(124, 92, 240, 0.025) 100%); border: 1px solid rgba(124, 92, 240, 0.15); border-radius: 16px; padding: 24px; opacity: 0.4; pointer-events: none; filter: blur(3px); position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;">
                    <div style="font-size: 13px; text-transform: none; color: #A9A5BD; font-weight: 600; margin-bottom: 16px;">Handelszeiten</div>
                    <div style="font-size: 12px; color: #D5D2E2; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>London</span>
                            <span style="color: #34D399; font-weight: 600;">45%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(124, 92, 240, 0.15); border-radius: 2px; overflow: hidden;">
                            <div style="width: 45%; height: 100%; background: #34D399;"></div>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #D5D2E2; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>New York</span>
                            <span style="color: #60a5fa; font-weight: 600;">32%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(124, 92, 240, 0.15); border-radius: 2px; overflow: hidden;">
                            <div style="width: 32%; height: 100%; background: #60a5fa;"></div>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #D5D2E2;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Asien</span>
                            <span style="color: #f59e0b; font-weight: 600;">23%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(124, 92, 240, 0.15); border-radius: 2px; overflow: hidden;">
                            <div style="width: 23%; height: 100%; background: #f59e0b;"></div>
                        </div>
                    </div>
                </div>
                
                <!-- Coming Soon Overlay (OUTSIDE blur!) -->
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 20, 35, 0.85); padding: 12px 20px; border-radius: 8px; color: #ECEAF4; font-weight: 700; font-size: 12px; letter-spacing: 0; z-index: 100; white-space: nowrap; border: 1.5px solid #8B6CF3; box-shadow: 0 0 12px rgba(124, 92, 240, 0.225);">Kommt bald</div>
            </div>
        </div>

    `;
    
    // Erst die Auswertungen (sie stehen oben und bestimmen, wo alles
    // darunter landet), dann die Diagramme - beides im selben Durchgang.
    // Vorher kamen sie 50 ms spaeter und schoben die Equity-Kurve sichtbar
    // nach unten.
    if (typeof window.cfAuswertungAufbauen === 'function') {
        window.cfAuswertungAufbauen();
    }
    renderAnalyticsCharts(trades, stats, wins, losses, behavioralScore);
}

function renderAnalyticsCharts(trades, stats, wins, losses, behavioralScore) {
    // Equity Curve Chart (Line Chart)
    if (window.equityChartInstance) window.equityChartInstance.destroy();
    const equityCanvas = document.getElementById('equityChart');
    
    if (equityCanvas) {
        // Cumulative P&L
        let cumulative = 0;
        const cumulativeData = trades.map(t => {
            cumulative += t.pnl;
            return cumulative;
        });
        
        const labels = trades.map((t, i) => i + 1);
        
        const ctx = equityCanvas.getContext('2d');
        window.equityChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Equity',
                    data: cumulativeData,
                    borderColor: '#7C5CF0',
                    backgroundColor: 'rgba(124, 92, 240, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                scales: {
                    y: {
                        ticks: { color: '#A9A5BD', font: { size: 10 } },
                        grid: { color: 'rgba(124, 92, 240, 0.075)' }
                    },
                    x: {
                        ticks: { color: '#A9A5BD', font: { size: 9 } },
                        grid: { display: false }
                    }
                }
            }
        });
    }
    
    // Behavioral Score Radar Chart
    if (window.behavioralChartInstance) window.behavioralChartInstance.destroy();
    const behavioralCanvas = document.getElementById('behavioralChart');
    
    if (behavioralCanvas) {
        const ctx = behavioralCanvas.getContext('2d');
        window.behavioralChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Disziplin', 'Psychologie', 'Risiko', 'Strategie', 'Timing', 'Beständigkeit'],
                datasets: [{
                    label: 'Score',
                    data: [
                        behavioralScore.discipline,
                        behavioralScore.psychology,
                        behavioralScore.riskMgmt,
                        behavioralScore.strategy,
                        behavioralScore.timing,
                        behavioralScore.consistency
                    ],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.15)',
                    borderWidth: 2,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#fff',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                scales: {
                    r: {
                        max: 100,
                        ticks: { display: false },
                        pointLabels: {
                            display: true,
                            color: '#8A86A0',
                            font: { size: 10 }
                        },
                        grid: { color: 'rgba(124, 92, 240, 0.075)' },
                        angleLines: { color: 'rgba(124, 92, 240, 0.075)' }
                    }
                }
            }
        });
    }
    
    // Win/Loss Donut Chart
    if (window.winLossChartInstance) window.winLossChartInstance.destroy();
    const winLossCanvas = document.getElementById('winLossChart');
    
    if (winLossCanvas) {
        const ctx = winLossCanvas.getContext('2d');
        window.winLossChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [wins.length, losses.length],
                    backgroundColor: ['#34D399', '#FB7185'],
                    borderColor: '#13121C',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                }
            }
        });
    }
}

function renderCharts(trades, stats, winRateByDay, recentTrades) {
    // Berechne Best Day (höchste Win Rate)
    const bestDay = winRateByDay.reduce((max, day) => 
        parseInt(day.rate) > parseInt(max.rate) ? day : max, 
        winRateByDay[0] || { day: '-', rate: 0 }
    );
    
    // Update Best Day in Top Stats
    const bestDayValue = document.getElementById('bestDayValue');
    const bestDayDetail = document.getElementById('bestDayDetail');
    if (bestDayValue) bestDayValue.textContent = cfProz(bestDay.rate, 0);
    if (bestDayDetail) bestDayDetail.textContent = bestDay.day;
    // Equity Chart
    if (window.equityChartInstance) window.equityChartInstance.destroy();
    const equityData = [];
    let cumulativePnL = 0;
    trades.forEach(t => {
        cumulativePnL += t.pnl;
        equityData.push(cumulativePnL);
    });
    const equityCtx = document.getElementById('equityChart')?.getContext('2d');
    if (equityCtx) {
        window.equityChartInstance = new Chart(equityCtx, {
            type: 'line',
            data: {
                labels: trades.map((_, i) => `Trade ${i + 1}`),
                datasets: [{
                    label: 'Cumulative P&L',
                    data: equityData,
                    borderColor: equityData[equityData.length - 1] >= 0 ? '#34D399' : '#FB7185',
                    backgroundColor: equityData[equityData.length - 1] >= 0 ? 'rgba(52, 211, 153, 0.05)' : 'rgba(251, 113, 133, 0.05)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        ticks: { color: '#A9A5BD', font: { size: 11 } },
                        grid: { color: 'rgba(124, 92, 240, 0.038)', drawBorder: false }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
    
    // Update equity current value
    const equityCurrentValue = document.getElementById('equityCurrentValue');
    if (equityCurrentValue && trades.length > 0) {
        equityCurrentValue.textContent = cfGeld(equityData[equityData.length - 1], { vorzeichen: true });
    }
    
    // Win/Loss Chart
    if (window.winLossChartInstance) window.winLossChartInstance.destroy();
    const winLossCtx = document.getElementById('winLossChart')?.getContext('2d');
    if (winLossCtx) {
        window.winLossChartInstance = new Chart(winLossCtx, {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [stats.wins, stats.losses],
                    backgroundColor: ['#34D399', '#FB7185'],
                    borderColor: '#13121C',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                // Legende steht als HTML neben dem Ring. Die Chart.js-Legende
                // landete bei breitem Rahmen mitten im Ring.
                plugins: { legend: { display: false } }
            }
        });
    }
    
    // Win Rate by Day
    const dayWinRateContainer = document.getElementById('dayWinRateContainer');
    if (dayWinRateContainer) {
        dayWinRateContainer.innerHTML = winRateByDay.map(day => `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="color: #D5D2E2;">${day.day}</span>
                    <span style="color: #a78bfa; font-weight: 600;">${cfProz(day.rate, 0)} (${day.total})</span>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(124, 92, 240, 0.075); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${day.rate}%; height: 100%; background: linear-gradient(90deg, #8B6CF3, #ec4899);"></div>
                </div>
            </div>
        `).join('');
    }
    
    // Setup Type Chart
    if (window.setupTypeChartInstance) window.setupTypeChartInstance.destroy();
    renderSetupTypeChart(trades);
    
    // Recent Trades
    const recentTradesContainer = document.getElementById('recentTradesContainer');
    if (recentTradesContainer) {
        recentTradesContainer.innerHTML = recentTrades.map(trade => `
            <div class="trade-card" style="margin-bottom: 12px;">
                <div class="trade-header">
                    <span class="trade-ticker">${escapeHtml(trade.ticker)}</span>
                    <span class="trade-pnl ${trade.pnl >= 0 ? 'positive' : 'negative'}">${cfGeld(trade.pnl, { vorzeichen: true })} ${cfProz(trade.pnlPercent, 1, { vorzeichen: true })}</span>
                </div>
                <div class="trade-detail">
                    <span class="trade-detail-label">Kauf / Verkauf</span>
                    <span class="trade-detail-value">$${trade.entryPrice} / $${trade.exitPrice}</span>
                </div>
                <div class="trade-detail">
                    <span class="trade-detail-label">Datum</span>
                    <span class="trade-detail-value">${trade.date}</span>
                </div>
            </div>
        `).join('');
    }
}

// ===== POSITIONEN MANAGEMENT =====

/**
 * Offene Positionen fuer die Portfolio-Analyse.
 *
 * Zertifikate gehoeren hier nicht hin. Die Portfolio-Analyse zeigt, was
 * im Depot liegt - Aktien und Fonds, die man haelt. Ein Knock-out ist
 * ein Trade mit Verfallsrisiko, kein Bestand; zwischen NVDA-Aktien und
 * einem Turbo darauf zu mitteln ergibt keine sinnvolle Aufteilung.
 *
 * Sie verschwinden nicht, sie stehen weiter unter den offenen
 * Positionen - nur die Auswertung laesst sie aussen vor.
 */
function portfolioPositionen() {
    const alle = JSON.parse(localStorage.getItem('positions')) || [];
    return alle.filter(function (p) {
        return !(p && p.produkt && p.produkt.art && p.produkt.art !== 'aktie');
    });
}

function updatePortfolioSummary() {
    const positions = portfolioPositionen();
    
    // Berechne Statistiken
    const openCount = positions.length;
    const totalValue = positions.reduce((sum, pos) => sum + parseFloat(pos.size), 0);
    const avgSize = openCount > 0 ? totalValue / openCount : 0;
    const maxSize = openCount > 0 ? Math.max(...positions.map(p => parseFloat(p.size))) : 0;
    
    // Update DOM
    document.getElementById('portfolioOpenCount').textContent = openCount;
    document.getElementById('portfolioTotalValue').textContent = cfGeld(totalValue);
    document.getElementById('portfolioAvgSize').textContent = cfGeld(avgSize);
    document.getElementById('portfolioMaxSize').textContent = cfGeld(maxSize);
    
    // Render Chart
    renderPortfolioCompositionChart(positions);
}

function loadPositions() {
    const positions = JSON.parse(localStorage.getItem('positions')) || [];
    const container = document.getElementById('positionsContainer');
    cfKlapp('leer', 'positionsFormHuelle', positions.length === 0);
    
    if (positions.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #A9A5BD;">
                <p style="font-size: 14px;">Noch keine offenen Positionen. </p>
            </div>
        `;
        updatePortfolioSummary();
        displayClosedPositions();
        return;
    }
    
    container.innerHTML = positions.map((pos, idx) => {
        const dateOpened = new Date(pos.dateOpened).toLocaleDateString('de-DE');
        return `
            <div class="position-card" data-position-id="${idx}">
                <div class="position-header">
                    <div>
                        <div class="position-ticker">${escapeHtml(pos.ticker)}
                            <span class="dir-badge dir-${pos.direction === 'short' ? 'short' : 'long'}">${pos.direction === 'short' ? 'SHORT' : 'LONG'}</span>
                            ${hebelBadge(Object.assign({}, pos, { leverage: pos.produkt && pos.produkt.hebelEffektiv }))}
                            ${koBadge(pos)}
                        </div>
                        <div class="position-entry">Kauf: ${cfGeld(pos.entry)}</div>
                    </div>
                </div>
                
                <div class="position-details">
                    <div class="position-detail-row">
                        <span class="position-detail-label">Positionsgröße:</span>
                        <span class="position-detail-value">${cfGeld(pos.size)}</span>
                    </div>
                    <div class="position-detail-row">
                        <span class="position-detail-label">Geöffnet:</span>
                        <span class="position-detail-value">${dateOpened}</span>
                    </div>
                </div>
                
                ${pos.thesis ? `
                <div class="position-thesis">
                    <strong>These:</strong> ${escapeHtml(pos.thesis)}
                </div>` : `
                <div class="position-thesis" style="color:#8A86A0;">
                    Keine These hinterlegt — kannst du nachtragen.
                </div>`}
                
                ${cfBildHtml(pos.screenshot, pos.screenshotPfad, 'position-screenshot', 'Screenshot zu ' + pos.ticker)}
                
                <div class="position-actions">
                    <button class="position-close-btn" onclick="closePosition(${idx})">Position schließen</button>
                    <button class="position-delete-btn" onclick="deletePosition(${idx})">Löschen</button>
                </div>
            </div>
        `;
    }).join('');
    
    updatePortfolioSummary();
    displayClosedPositions();
}

/**
 * Die drei freiwilligen Hebelzahlen einer offenen Position auslesen.
 * Gibt null zurueck, wenn nichts eingetragen wurde.
 */
function positionsHebelDaten() {
    const z = (id) => {
        const e = document.getElementById(id);
        if (!e) return null;
        const n = parseFloat(String(e.value).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };
    const dirEl = document.getElementById('positionsDirection');
    const richtung = (dirEl && dirEl.value === 'short') ? 'short' : 'long';
    const ko = z('positionsKo');
    const hebelTr = z('positionsHebel');
    const stop = z('positionsStop');
    if (ko === null && hebelTr === null && stop === null) {
        return { richtung: richtung, leer: true };
    }

    // Kurs des Basiswerts aus Hebel und Schwelle - dieselbe Rechnung wie
    // im Journal. Ohne Hebel bleibt er unbekannt, dann gibt es eben
    // keinen KO-Abstand.
    let kurs = null;
    if (window.cfZert && ko !== null && hebelTr !== null) {
        const r = window.cfZert.basiswertAusHebel({
            art: 'knockout', richtung: richtung, ko: ko, hebelAngezeigt: hebelTr
        });
        if (r.ok) kurs = r.wert;
    }
    return {
        richtung: richtung, leer: false,
        ko: ko, hebelAngezeigt: hebelTr, stop: stop, kurs: kurs,
    };
}

/** Live-Vorschau unter den Hebelfeldern der Position. */
function updatePositionsVorschau() {
    const ziel = document.getElementById('positionsVorschau');
    if (!ziel || !window.cfZert) return;

    const d = positionsHebelDaten();
    if (d.leer) { ziel.innerHTML = ''; return; }

    const einsatzEl = document.getElementById('positionsSize');
    const einsatz = einsatzEl ? parseFloat(einsatzEl.value) : null;

    const p = {
        art: 'knockout', richtung: d.richtung,
        kurs: d.kurs, strike: d.ko, ko: d.ko,
        einsatz: Number.isFinite(einsatz) ? einsatz : null,
    };

    const kachel = (label, wert, zusatz, klasse) =>
        '<div class="zert-kachel ' + (klasse || '') + '">'
        + '<div class="zert-kachel-label">' + label + '</div>'
        + '<div class="zert-kachel-wert">' + wert + '</div>'
        + (zusatz ? '<div class="zert-kachel-zusatz">' + zusatz + '</div>' : '')
        + '</div>';
    const nz = (x, n) => x.toLocaleString('de-DE',
        { minimumFractionDigits: n, maximumFractionDigits: n });

    const teile = [];
    const k = window.cfZert.koAbstand(p);
    if (k.ok) {
        const pz = k.wert.prozent;
        teile.push(kachel('KO-Abstand', nz(pz, 1) + ' %',
            'Basiswert steht bei ' + nz(d.kurs, 2) + ' $',
            pz < 5 ? 'rot' : (pz < 10 ? 'warn' : 'gut')));
    } else {
        teile.push(kachel('KO-Abstand', '—',
            'Knockout-Preis und Hebel eintragen', 'leer'));
    }

    if (d.stop !== null) {
        const r = window.cfZert.risiko(p, d.stop);
        if (r.ok) {
            let zusatz = nz(r.wert.prozent, 1) + ' % vom Einsatz';
            const kb = (typeof getAccountBalance === 'function')
                ? getAccountBalance() : null;
            if (kb && kb > 0) zusatz += ' · ' + nz((r.wert.euro / kb) * 100, 1)
                + ' % vom Konto';
            teile.push(kachel('Risiko bei deinem Stop', cfGeld(r.wert.euro),
                zusatz, r.wert.totalverlust ? 'rot' : 'gut'));
            if (r.wert.hinweis) {
                teile.push('<div class="zert-warnung" style="grid-column:1/-1;'
                    + 'display:block;">' + escapeHtml(r.wert.hinweis) + '</div>');
            }
        } else {
            teile.push(kachel('Risiko bei deinem Stop', '—', r.grund, 'leer'));
        }
    }

    ziel.innerHTML = teile.join('');
}

function addPosition(event) {
    event.preventDefault();
    
    try {
        const ticker = document.getElementById('positionsTicker').value.trim();
        const entry = document.getElementById('positionsEntry').value;
        const size = document.getElementById('positionsSize').value;
        const thesis = document.getElementById('positionsThesis').value.trim();
        const hebel = positionsHebelDaten();
        
        // Die These ist freiwillig.
        //
        // Sie ist der wertvollste Teil eines Journals - und genau deshalb
        // darf sie den Eintrag nicht aufhalten. Wer beim Kauf drei Saetze
        // tippen muss, traegt die Position irgendwann gar nicht mehr ein,
        // und dann fehlt nicht nur die These, sondern der ganze Trade.
        // Nachtragen geht; den nicht erfassten Trade holt niemand zurueck.
        if (!ticker || !entry || !size) {
            showToast('Ticker, Kaufpreis und Einsatz brauche ich.', 'error');
            return;
        }
        
        const entryNum = parseFloat(entry);
        const sizeNum = parseFloat(size);
        
        // Entry 0 wuerde beim Schliessen eine Division durch null ausloesen
        if (isNaN(entryNum) || entryNum <= 0) {
            showToast('Der Kaufpreis muss größer als 0 sein.', 'error');
            return;
        }
        if (isNaN(sizeNum) || sizeNum <= 0) {
            showToast('Der Einsatz muss größer als 0 sein.', 'error');
            return;
        }
        
        const position = {
            ticker: ticker.toUpperCase(),
            direction: hebel.richtung,
            entry: entryNum,
            size: sizeNum,
            thesis,
            screenshot: positionsScreenshotData,
            dateOpened: new Date().toISOString()
        };

        // Hebelzahlen nur anhaengen, wenn welche da sind - eine Aktie
        // soll kein leeres produkt-Objekt mitschleppen.
        if (!hebel.leer && hebel.ko) {
            const abstand = hebel.kurs
                ? (hebel.richtung === 'long' ? hebel.kurs - hebel.ko
                                             : hebel.ko - hebel.kurs)
                : null;
            position.produkt = {
                art: 'knockout',
                richtung: hebel.richtung,
                wkn: null, emittent: null,
                strike: hebel.ko, ko: hebel.ko,
                ratio: null, faktor: null,
                basisEin: hebel.kurs, basisAus: null, basisStop: hebel.stop,
                hebelEffektiv: (hebel.kurs && abstand > 0)
                    ? Math.round((hebel.kurs / abstand) * 100) / 100 : null,
                koAbstandProzent: (hebel.kurs && abstand > 0)
                    ? Math.round((abstand / hebel.kurs) * 10000) / 100 : null,
            };
        }
        
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        positions.push(position);
        localStorage.setItem('positions', JSON.stringify(positions));
        if (window.cfDbPositionNeu) window.cfDbPositionNeu(position);
        
        // Form zurücksetzen
        document.getElementById('positionsForm').reset();
        document.getElementById('positionsScreenshotPreview').innerHTML = '';
        positionsScreenshotData = null;
        const vorschau = document.getElementById('positionsVorschau');
        if (vorschau) vorschau.innerHTML = '';
        document.querySelectorAll('[data-target="positionsDirection"] .direction-btn')
            .forEach((b, i) => b.classList.toggle('active', i === 0));
        const pdir = document.getElementById('positionsDirection');
        if (pdir) pdir.value = 'long';
        
        loadPositions();
        cfKlapp('gespeichert', 'positionsFormHuelle');
        showToast(`Position ${ticker} geöffnet!`);
    } catch (error) {
        console.error('Fehler beim Öffnen der Position:', error);
        showToast('Fehler beim Öffnen der Position!', 'error');
    }
}

function deletePosition(idx) {
    positionToDelete = idx;
    const positions = JSON.parse(localStorage.getItem('positions')) || [];
    const position = positions[idx];
    
    const deleteModal = document.getElementById('deleteModal');
    const modalTitle = document.getElementById('deleteModalTitle');
    const modalText = document.getElementById('deleteModalText');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    
    modalTitle.textContent = 'Position löschen?';
    modalText.textContent = `${position.ticker} wird permanent gelöscht.`;
    confirmBtn.textContent = 'Ja, löschen';
    confirmBtn.onclick = () => confirmDeletePosition();
    
    deleteModal.style.display = 'flex';
}

function confirmDeletePosition() {
    if (positionToDelete !== null) {
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        const removedTicker = positions[positionToDelete].ticker;
        const geloeschteId = positions[positionToDelete].id;
        positions.splice(positionToDelete, 1);
        localStorage.setItem('positions', JSON.stringify(positions));
        if (window.cfDbLoeschen && geloeschteId) window.cfDbLoeschen('trades', geloeschteId);
        
        document.getElementById('deleteModal').style.display = 'none';
        loadPositions();
        showToast(`Position ${removedTicker} gelöscht!`);
        positionToDelete = null;
    }
}

function closePosition(idx) {
    positionToClose = idx;
    const positions = JSON.parse(localStorage.getItem('positions')) || [];
    const position = positions[idx];
    
    // Populate modal with position info
    document.getElementById('modalExitPrice').value = '';
    document.getElementById('modalExitReason').value = '';
    document.getElementById('modalPositionTicker').textContent = position.ticker;
    document.getElementById('modalPositionSize').textContent = cfGeld(position.size);
    
    document.getElementById('closePositionModal').style.display = 'flex';
    document.getElementById('modalExitPrice').focus();
}

function confirmClosePositionModal() {
    
    if (positionToClose === null) return;
    
    const exitPriceInput = document.getElementById('modalExitPrice').value;
    const exitReason = document.getElementById('modalExitReason').value.trim();
    
    
    // Validierung
    if (!exitPriceInput || exitPriceInput === '') {
        showToast('Bitte den Verkaufspreis eintragen.', 'error');
        return;
    }
    
    const exitPrice = parseFloat(exitPriceInput);
    if (isNaN(exitPrice) || exitPrice <= 0) {
        showToast('Der Verkaufspreis muss größer als 0 sein.', 'error');
        return;
    }
    
    
    try {
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
        const position = positions[positionToClose];
        
        
        // P&L. Bei einem Zertifikat sind Kauf- und Verkaufspreis die
        // Preise des Scheins - ein Short-Knockout STEIGT im Preis, wenn
        // der Basiswert faellt, das Vorzeichen steht also schon richtig
        // drin. Nur bei einer echten Short-Aktie muss gedreht werden.
        const shares = position.size / position.entry;
        const zertifikat = Boolean(position.produkt);
        const vz = (!zertifikat && position.direction === 'short') ? -1 : 1;
        const pnl = (exitPrice - position.entry) * shares * vz;
        const pnlPercent = ((exitPrice - position.entry) / position.entry) * 100 * vz;
        
        // Erstelle geschlossene Position
        const closedPosition = {
            ...position,
            exitPrice,
            exitReason,
            pnl: Math.round(pnl * 100) / 100,
            pnlPercent: Math.round(pnlPercent * 100) / 100,
            dateClosed: new Date().toISOString()
        };
        
        
        // Speichere geschlossene Position
        closedPositions.push(closedPosition);
        localStorage.setItem('closedPositions', JSON.stringify(closedPositions));
        // In der Datenbank wird nicht kopiert, sondern der Status
        // umgestellt - es ist dieselbe Zeile, nur nicht mehr offen
        if (window.cfDbPositionSchliessen && position.id) {
            window.cfDbPositionSchliessen(
                position.id, exitPrice, exitReason,
                closedPosition.pnl, closedPosition.pnlPercent);
        }
        
        
        // Lösche offene Position
        positions.splice(positionToClose, 1);
        localStorage.setItem('positions', JSON.stringify(positions));
        
        // Schließe Modal
        closeModal('closePositionModal');
        positionToClose = null;
        
        // Reload UI
        loadPositions();
        showToast(`Position ${position.ticker} geschlossen! P&L: ${cfGeld(closedPosition.pnl, { vorzeichen: true })}`);
    } catch (error) {
        console.error('Fehler:', error);
        showToast('Fehler beim Schließen der Position!', 'error');
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}


function displayPositionsScreenshot(base64Data) {
    positionsScreenshotData = base64Data;
    const preview = document.getElementById('positionsScreenshotPreview');
    preview.innerHTML = `
        <img src="${base64Data}" alt="Position Setup" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(124, 92, 240, 0.225); display: block; margin-top: 10px;">
        <button type="button" onclick="document.getElementById('positionsScreenshotInput').click()" style="margin-top: 10px; padding: 8px 16px; background: rgba(124, 92, 240, 0.15); border: 1px solid rgba(124, 92, 240, 0.3); color: #D5D2E2; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Bild ändern</button>
    `;
}

function clearPositionsScreenshot() {
    positionsScreenshotData = null;
    document.getElementById('positionsScreenshotPreview').innerHTML = '';
}

function displayClosedPositions() {
    const container = document.getElementById('closedPositionsContainer');
    const noDataDiv = document.getElementById('noClosedPositions');
    
    if (!container) return;
    
    const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
    
    if (closedPositions.length === 0) {
        container.innerHTML = '';
        if (noDataDiv) noDataDiv.style.display = 'block';
        return;
    }
    
    if (noDataDiv) noDataDiv.style.display = 'none';
    
    container.innerHTML = closedPositions.map((pos, idx) => {
        const dateClosed = new Date(pos.dateClosed).toLocaleDateString('de-DE');
        const pnlColor = pos.pnl >= 0 ? '#34D399' : '#FB7185';
        const pnlSign = pos.pnl >= 0 ? '+' : '';
        
        return `
            <div class="position-card" style="border-left: 4px solid ${pnlColor};">
                <div class="position-header">
                    <div>
                        <div class="position-ticker">${escapeHtml(pos.ticker)}</div>
                        <div class="position-entry">Kauf: ${cfGeld(pos.entry)} → Verkauf: ${cfGeld(pos.exitPrice)}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 18px; font-weight: 700; color: ${pnlColor};">${cfGeld(pos.pnl, { vorzeichen: true })}</div>
                        <div style="font-size: 12px; color: ${pnlColor};">${cfProz(pos.pnlPercent, 2, { vorzeichen: true })}</div>
                    </div>
                </div>
                
                <div class="position-details">
                    <div class="position-detail-row">
                        <span class="position-detail-label">Position:</span>
                        <span class="position-detail-value">${cfGeld(pos.size)}</span>
                    </div>
                    <div class="position-detail-row">
                        <span class="position-detail-label">Geschlossen:</span>
                        <span class="position-detail-value">${dateClosed}</span>
                    </div>
                </div>
                
                ${pos.thesis ? `
                <div class="position-thesis">
                    <strong>These:</strong> ${escapeHtml(pos.thesis)}
                </div>` : `
                <div class="position-thesis" style="color:#8A86A0;">
                    Keine These hinterlegt — kannst du nachtragen.
                </div>`}
                
                <div class="position-thesis" style="margin-top: 12px; color: #D5D2E2; font-size: 13px; border-top: 1px solid rgba(124, 92, 240, 0.075); padding-top: 12px;">
                    <strong>Grund zum Schließen:</strong> ${escapeHtml(pos.exitReason)}
                </div>
                
                ${cfBildHtml(pos.screenshot, pos.screenshotPfad, 'position-screenshot', 'Screenshot zu ' + pos.ticker)}
                
                <div class="position-actions">
                    <button class="position-delete-btn" onclick="deleteClosedPosition(${idx})">Löschen</button>
                </div>
            </div>
        `;
    }).join('');
}

function deleteClosedPosition(idx) {
    closedPositionToDelete = idx;
    const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
    const position = closedPositions[idx];
    
    const deleteModal = document.getElementById('deleteModal');
    const modalTitle = document.getElementById('deleteModalTitle');
    const modalText = document.getElementById('deleteModalText');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    
    modalTitle.textContent = 'Geschlossene Position löschen?';
    modalText.textContent = `${position.ticker} wird permanent gelöscht.`;
    confirmBtn.textContent = 'Ja, löschen';
    confirmBtn.onclick = () => confirmDeleteClosedPosition();
    
    deleteModal.style.display = 'flex';
}

function confirmDeleteClosedPosition() {
    if (closedPositionToDelete !== null) {
        const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
        const removedTicker = closedPositions[closedPositionToDelete].ticker;
        const geloeschteId = closedPositions[closedPositionToDelete].id;
        closedPositions.splice(closedPositionToDelete, 1);
        localStorage.setItem('closedPositions', JSON.stringify(closedPositions));
        if (window.cfDbLoeschen && geloeschteId) window.cfDbLoeschen('trades', geloeschteId);
        
        document.getElementById('deleteModal').style.display = 'none';
        displayClosedPositions();
        showToast(`Geschlossene Position ${removedTicker} gelöscht!`);
        closedPositionToDelete = null;
    }
}


function renderPortfolioCompositionChart(positions) {
    const barDiv = document.getElementById('portfolioStackedBar');
    const legendDiv = document.getElementById('portfolioCompositionLegend');
    
    if (!barDiv || !legendDiv || positions.length === 0) {
        barDiv.innerHTML = '<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #8A86A0; font-size: 13px;">Noch keine Positionen</div>';
        legendDiv.innerHTML = '';
        return;
    }
    
    // Berechne Gewichtungen
    const positionData = positions.map(pos => ({
        ticker: pos.ticker,
        size: parseFloat(pos.size)
    }));
    
    const totalSize = positionData.reduce((sum, p) => sum + p.size, 0);
    
    // Farben - Premium Palette
    const colors = [
        '#8B6CF3', '#ec4899', '#3b82f6', '#34D399', '#f59e0b', 
        '#fb7185', '#6366f1', '#14b8a6', '#f97316', '#7C5CF0',
        '#06b6d4', '#84cc16', '#F0505F', '#8855ff'
    ];
    
    // Render Stacked Bar
    let barHTML = '';
    positionData.forEach((pos, idx) => {
        const percentage = (pos.size / totalSize) * 100;
        const color = colors[idx % colors.length];
        barHTML += `
            <div style="
                flex: ${percentage};
                background: ${color};
                height: 100%;
                border-right: 2px solid rgba(15, 15, 32, 1);
                position: relative;
                transition: all 0.3s ease;
                cursor: pointer;
            " 
            class="portfolio-bar-segment"
            title="${escapeHtml(pos.ticker)}: ${cfProz(percentage, 1)} (${cfGeld(pos.size)})"
            onmouseover="this.style.filter='brightness(1.2)'; this.style.flex='${percentage * 1.1}'"
            onmouseout="this.style.filter='brightness(1)'; this.style.flex='${percentage}'">
                ${percentage > 8 ? `<span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: 700; font-size: 12px; color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.5);">${cfProz(percentage, 0)}</span>` : ''}
            </div>
        `;
    });
    barDiv.innerHTML = barHTML;
    
    // Render Position Cards
    legendDiv.innerHTML = positionData.map((pos, idx) => {
        const percentage = (pos.size / totalSize) * 100;
        const color = colors[idx % colors.length];
        return `
            <div style="
                background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
                border: 1px solid rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.3);
                border-radius: 12px;
                padding: 16px;
                backdrop-filter: blur(8px);
                transition: all 0.2s ease;
            "
            onmouseover="this.style.transform='translateY(-4px)'; this.style.borderColor='rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.8)'"
            onmouseout="this.style.transform='translateY(0)'; this.style.borderColor='rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.3)'">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; box-shadow: 0 0 12px ${color}80;"></div>
                    <div style="font-weight: 700; font-size: 14px; color: #ECEAF4;">${escapeHtml(pos.ticker)}</div>
                </div>
                <div style="font-size: 16px; font-weight: 700; color: #ECEAF4; margin-bottom: 4px;">${cfGeld(pos.size)}</div>
                <div style="font-size: 12px; color: #A9A5BD; font-weight: 600;">${cfProz(percentage, 1)} des Portfolios</div>
            </div>
        `;
    }).join('');
}

function renderTradeScoreChart(tradeScore, stats) {
    if (window.tradeScoreChartInstance) window.tradeScoreChartInstance.destroy();
    const canvasEl = document.getElementById('tradeScoreChart');
    
    if (!canvasEl) return;
    
    const ctx = canvasEl.getContext('2d');
    window.tradeScoreChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Trefferquote', 'Beständigkeit', 'Profit Factor', 'Anzahl Trades', 'Chance : Risiko'],
            datasets: [{
                label: 'Performance Metrics',
                data: [
                    Math.min(stats.winRate / 0.6 * 20, 20),
                    Math.min((Math.abs(stats.avgWin) / (Math.abs(stats.avgWin) + Math.abs(stats.avgLoss))) * 25, 25),
                    Math.min((stats.profitFactor / 2) * 25, 25),
                    Math.min((stats.trades.length / 100) * 30, 30),
                    Math.min((stats.profitFactor / 2) * 20, 20)
                ],
                borderColor: '#8B6CF3',
                backgroundColor: 'rgba(124, 92, 240, 0.112)',
                borderWidth: 2,
                pointBackgroundColor: '#8B6CF3',
                pointBorderColor: '#fff',
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                r: {
                    max: 100,
                    ticks: { color: '#A9A5BD', font: { size: 11 } },
                    grid: { color: 'rgba(124, 92, 240, 0.075)' }
                }
            }
        }
    });
}

function renderSetupTypeChart(trades) {
    const setupTypeStats = calculateSetupTypeStats(trades);
    const canvasEl = document.getElementById('setupTypeChart');
    
    if (!canvasEl) return;
    
    // Daten vorbereiten (nur Types mit Trades)
    const labels = [];
    const pnlData = [];
    const pnlColors = [];
    const winRateData = [];
    const winRateColors = [];
    
    Object.entries(setupTypeStats).forEach(([type, stats]) => {
        if (stats.count > 0) {
            labels.push(type);
            
            // P&L Daten
            const pnl = parseFloat(stats.totalPnL);
            pnlData.push(pnl);
            pnlColors.push(pnl >= 0 ? 'rgba(52, 211, 153, 0.7)' : 'rgba(251, 113, 133, 0.7)'); // Grün/Rot
            
            // Win-Rate Daten
            const winRate = parseFloat(stats.winRate);
            winRateData.push(winRate);
            winRateColors.push(winRate >= 50 ? 'rgba(124, 92, 240, 0.525)' : 'rgba(251, 113, 133, 0.7)'); // Purple/Rot
        }
    });
    
    // Zerstöre altes Chart wenn es existiert
    if (window.setupTypeChartInstance) {
        window.setupTypeChartInstance.destroy();
    }
    
    // Side-by-Side Bar Chart
    const ctx = canvasEl.getContext('2d');
    window.setupTypeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Ergebnis (€)',
                    data: pnlData,
                    backgroundColor: pnlColors,
                    borderColor: pnlColors.map(c => c.replace('0.7', '1')),
                    borderWidth: 2,
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
                    hoverBackgroundColor: pnlColors.map(c => c.replace('0.7', '0.9')),
                    hoverBorderWidth: 3
                },
                {
                    label: 'Win-Rate (%)',
                    data: winRateData,
                    backgroundColor: winRateColors,
                    borderColor: winRateColors.map(c => c.replace('0.7', '1')),
                    borderWidth: 2,
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
                    hoverBackgroundColor: winRateColors.map(c => c.replace('0.7', '0.9')),
                    hoverBorderWidth: 3
                }
            ]
        },
        options: {
            indexAxis: 'y', // Horizontal bars für bessere Lesbarkeit
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: '#D5D2E2',
                        font: { size: 13, weight: '600' },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'rect'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 18, 28, 0.95)',
                    borderColor: 'rgba(124, 92, 240, 0.3)',
                    borderWidth: 1,
                    titleColor: '#C9B8FF',
                    bodyColor: '#D5D2E2',
                    padding: 12,
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return 'P&L: ' + cfGeld(context.parsed.x, { vorzeichen: true });
                            } else {
                                return 'Trefferquote: ' + cfProz(context.parsed.x, 1);
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    ticks: {
                        color: '#A9A5BD',
                        font: { size: 11 },
                        callback: (value, index) => {
                            if (index % 2 === 0 || value === 0) return value;
                            return '';
                        }
                    },
                    grid: {
                        color: 'rgba(124, 92, 240, 0.038)',
                        drawBorder: false
                    }
                },
                y: {
                    ticks: {
                        color: '#D5D2E2',
                        font: { size: 12, weight: '600' }
                    },
                    grid: {
                        color: 'rgba(124, 92, 240, 0.038)',
                        drawBorder: false
                    }
                }
            }
        }
    });
}

// ===== UTILITIES =====
function calculateSetupTypeStats(trades) {
    const setupTypes = ['Breakout', 'Pullback', 'Support', 'Rebound', 'Gap-Fill', 'Trend-Continuation', 'Sonstiges'];
    const stats = {};
    
    setupTypes.forEach(type => {
        const typeTrades = trades.filter(t => t.setupType === type);
        const wins = typeTrades.filter(t => t.pnl > 0).length;
        const losses = typeTrades.filter(t => t.pnl < 0).length;
        const totalPnL = typeTrades.reduce((sum, t) => sum + t.pnl, 0);
        const avgPnL = typeTrades.length > 0 ? (totalPnL / typeTrades.length).toFixed(2) : 0;
        const winRate = typeTrades.length > 0 ? ((wins / typeTrades.length) * 100).toFixed(1) : 0;
        
        stats[type] = {
            count: typeTrades.length,
            wins,
            losses,
            totalPnL: totalPnL.toFixed(2),
            avgPnL,
            winRate
        };
    });
    
    return stats;
}

// ===== UTILITIES =====
// Wandelt HTML-Sonderzeichen in Entities um, damit Nutzereingaben
// nicht als Markup interpretiert werden
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Kurze Begruessung nach dem Login. Neue Keys ohne Daten werden
// begruesst, wiederkehrende mit "Willkommen zurueck".
// Zeigt dauerhaft an, mit welchem Key man verbunden ist.
// Der Key wird gekuerzt dargestellt - er steht sonst bei jedem
// Screenshot und jedem Blick ueber die Schulter offen da.
function renderSessionBadge() {
    const badge = document.getElementById('sessionBadge');
    if (!badge) return;

    const activeKey = window.cfRawStorage.get('capitalflow_current_key');
    if (!activeKey) {
        badge.style.display = 'none';
        return;
    }

    const name = window.cfRawStorage.get('capitalflow_current_name')
        || 'Verbunden';

    const nameEl = document.getElementById('sessionName');
    const keyEl = document.getElementById('sessionKey');
    if (nameEl) nameEl.textContent = name;
    if (keyEl) {
        keyEl.textContent = activeKey.length > 10
            ? activeKey.slice(0, 3) + '…' + activeKey.slice(-4)
            : activeKey;
    }
    badge.style.display = 'flex';
    cfNutzerblock();
}

/**
 * Der Block unten in der Seitenleiste: Discord-Bild, Name, Abmelden.
 * Bild und Name kommen aus dem Speicher, den js/auth.js beim Anmelden
 * fuellt - so steht beides auch nach dem Neuladen sofort da. Ohne Bild
 * (oder wenn es nicht laedt) der Anfangsbuchstabe.
 */
function cfNutzerblock() {
    const roh = window.cfRawStorage;
    const name = (roh && roh.get('capitalflow_current_name')) || 'Angemeldet';
    const bild = (roh && roh.get('capitalflow_current_avatar')) || '';
    const art = (roh && roh.get('capitalflow_login_art')) || '';
    const n = document.getElementById('sidebarName');
    const img = document.getElementById('sidebarAvatar');
    const ini = document.getElementById('sidebarInitial');
    const a = document.getElementById('sidebarArt');
    if (n) { n.textContent = name; n.title = name; }
    if (ini) ini.textContent = (name.trim()[0] || '?').toUpperCase();
    if (a) a.hidden = art !== 'discord';
    if (img) {
        if (/^https:\/\//.test(bild)) {
            img.onerror = function () { img.hidden = true; if (ini) ini.hidden = false; };
            img.onload = function () { img.hidden = false; if (ini) ini.hidden = true; };
            if (img.getAttribute('src') !== bild) img.src = bild;
        } else {
            img.removeAttribute('src');
            img.hidden = true;
            if (ini) ini.hidden = false;
        }
    }
}
window.cfNutzerblock = cfNutzerblock;

function showWelcome(name, isReturning) {
    if (!name) return;
    document.querySelectorAll('.welcome-note').forEach(n => n.remove());

    const note = document.createElement('div');
    note.className = 'welcome-note';
    const greeting = isReturning ? 'Willkommen zurück,' : 'Willkommen,';
    note.innerHTML = '<span class="welcome-note-dot"></span>' +
        escapeHtml(greeting) + ' <span class="welcome-note-name">' +
        escapeHtml(name) + '</span>';
    document.body.appendChild(note);

    setTimeout(() => {
        note.classList.add('leaving');
        setTimeout(() => note.remove(), 500);
    }, 3200);
}

function showToast(message, type) {
    const toast = document.createElement('div');
    // type: 'error' faerbt rot, alles andere bleibt gruen
    toast.className = type === 'error' ? 'toast toast-error' : 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ===== CUSTOM DROPDOWN SYSTEM =====
function initCustomDropdowns() {
    const customSelects = document.querySelectorAll('.custom-select');
    
    customSelects.forEach(selectEl => {
        const header = selectEl.querySelector('.custom-select-header');
        const options = selectEl.querySelectorAll('.custom-option');
        const selectId = selectEl.getAttribute('data-select-id');
        const hiddenInput = document.getElementById(selectId);
        
        // Click auf Header -> Dropdown öffnen/schließen
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Schließe alle anderen Dropdowns
            document.querySelectorAll('.custom-select.open').forEach(el => {
                if (el !== selectEl) {
                    el.classList.remove('open');
                }
            });
            
            // Toggle aktuelles Dropdown
            selectEl.classList.toggle('open');
        });
        
        // Click auf Option
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.getAttribute('data-value');
                
                // Update Hidden Input
                hiddenInput.value = value;
                
                // Update Display Text
                header.querySelector('.custom-select-value').textContent = value;
                
                // Update Selected State
                options.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                // Close Dropdown
                selectEl.classList.remove('open');
            });
        });
        
        // Keyboard Navigation
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectEl.classList.toggle('open');
            }
        });
    });
    
    // Click außerhalb -> Dropdown schließen
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select.open').forEach(el => {
            el.classList.remove('open');
        });
    });
}

// ===== CALENDAR STATS =====
function updateCalendarStats(trades) {
    if (!trades || trades.length === 0) {
        // Reset stats to default
        document.getElementById("totalPnLStat").textContent = cfGeld(0);
        document.getElementById("bestDayStat").textContent = cfGeld(0);
        document.getElementById("bestDayDateStat").textContent = "—";
        document.getElementById("worstDayStat").textContent = cfGeld(0);
        document.getElementById("worstDayDateStat").textContent = "—";
        document.getElementById("winningDaysStat").textContent = "0%";
        document.getElementById("losingDaysStat").textContent = "0%";
        document.getElementById("avgDailyPnLStat").textContent = cfGeld(0);
        document.getElementById("calendarTradeCount").textContent = "0";
        document.getElementById("calendarTradingDays").textContent = "0";
        return;
    }

    const groupedByDate = {};
    trades.forEach(t => {
        const date = t.date || new Date(t.entryTime).toLocaleDateString("de-DE");
        if (!groupedByDate[date]) groupedByDate[date] = [];
        groupedByDate[date].push(t);
    });

    let totalPnL = 0;
    let bestDayPnL = -Infinity;
    let worstDayPnL = Infinity;
    let bestDayDate = "";
    let worstDayDate = "";
    let winningDays = 0;
    let losingDays = 0;
    const tradingDays = Object.keys(groupedByDate).length;

    Object.entries(groupedByDate).forEach(([date, dayTrades]) => {
        const dayPnL = dayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        totalPnL += dayPnL;
        if (dayPnL > bestDayPnL) { bestDayPnL = dayPnL; bestDayDate = date; }
        if (dayPnL < worstDayPnL) { worstDayPnL = dayPnL; worstDayDate = date; }
        if (dayPnL > 0) winningDays++;
        else if (dayPnL < 0) losingDays++;
    });

    const winningDaysPercent = tradingDays > 0 ? ((winningDays / tradingDays) * 100).toFixed(1) : 0;
    const losingDaysPercent = tradingDays > 0 ? ((losingDays / tradingDays) * 100).toFixed(1) : 0;
    const avgDailyPnL = tradingDays > 0 ? totalPnL / tradingDays : 0;

    // Handle Infinity values
    bestDayPnL = bestDayPnL === -Infinity ? 0 : bestDayPnL;
    worstDayPnL = worstDayPnL === Infinity ? 0 : worstDayPnL;

    const updateElement = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    updateElement("totalPnLStat", cfGeld(totalPnL, { vorzeichen: true }));
    updateElement("bestDayStat", cfGeld(bestDayPnL, { vorzeichen: true }));
    updateElement("bestDayDateStat", bestDayDate || "—");
    updateElement("worstDayStat", cfGeld(worstDayPnL, { vorzeichen: true }));
    updateElement("worstDayDateStat", worstDayDate || "—");
    updateElement("winningDaysStat", cfProz(winningDaysPercent, 1));
    updateElement("losingDaysStat", cfProz(losingDaysPercent, 1));
    updateElement("avgDailyPnLStat", cfGeld(avgDailyPnL, { vorzeichen: true }));
    updateElement("calendarTradeCount", trades.length);
    updateElement("calendarTradingDays", tradingDays);
}

// ===== LOGIN: LICHTKEGEL =====
(function initLoginSpotlight() {
    function start() {
        const screen = document.getElementById('loginScreen');
        if (!screen) return;

        // Ohne Hover (Touch) bliebe der Kegel nach einer Beruehrung stehen
        if (!window.matchMedia('(hover: hover)').matches) return;
        // Wer Animationen reduziert haben will, bekommt keinen bewegten Effekt
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        let targetX = window.innerWidth / 2;
        let targetY = window.innerHeight / 2;
        let x = targetX;
        let y = targetY;
        let running = false;

        function loop() {
            // Traegheit: der Kegel naehert sich pro Bild nur zu 12 Prozent
            // an die Mausposition an, dadurch laeuft er weich nach
            x += (targetX - x) * 0.12;
            y += (targetY - y) * 0.12;

            screen.style.setProperty('--mx', x.toFixed(1) + 'px');
            screen.style.setProperty('--my', y.toFixed(1) + 'px');

            // Stoppen, sobald der Kegel angekommen ist - spart Rechenzeit
            if (Math.abs(targetX - x) < 0.5 && Math.abs(targetY - y) < 0.5) {
                running = false;
                return;
            }
            requestAnimationFrame(loop);
        }

        screen.addEventListener('mousemove', (e) => {
            targetX = e.clientX;
            targetY = e.clientY;
            screen.classList.add('spotlight-on');
            if (!running) {
                running = true;
                requestAnimationFrame(loop);
            }
        });

        screen.addEventListener('mouseleave', () => {
            screen.classList.remove('spotlight-on');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

// ===== TRANSAKTIONEN =====
// Ein- und Auszahlungen. Erst dadurch ergibt der Kontostand einen Sinn:
// vorher zeigte "Current Balance" nur die Summe der Trade-Ergebnisse,
// also dieselbe Zahl wie "Total P&L" direkt daneben.

function getTransactions() {
    const raw = JSON.parse(localStorage.getItem('transactions')) || [];
    // Gegen unvollstaendige Eintraege absichern, wie bei den Trades
    return raw
        .filter(t => t && typeof t === 'object' &&
                     Number.isFinite(parseFloat(t.amount)))
        .map((t, i) => ({
            id: t.id || (Date.now() + i),
            type: t.type === 'withdrawal' ? 'withdrawal' : 'deposit',
            amount: Math.abs(parseFloat(t.amount)),
            date: t.date || new Date().toISOString().slice(0, 10),
            note: t.note || ''
        }));
}

// Netto eingezahlt = alles was reinging minus alles was rausging.
// Diese Zahl ist die Basis fuer Kontostand und Rendite.
function getNetDeposits() {
    return getTransactions().reduce((sum, t) =>
        sum + (t.type === 'deposit' ? t.amount : -t.amount), 0);
}

function getAccountBalance() {
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    const pnl = trades.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
    return getNetDeposits() + pnl;
}

function addTransaction(e) {
    e.preventDefault();
    try {
        const type = document.getElementById('txType').value;
        const amount = parseFloat(document.getElementById('txAmount').value);
        const date = document.getElementById('txDate').value;
        const note = document.getElementById('txNote').value.trim();

        if (!Number.isFinite(amount) || amount <= 0) {
            showToast('Betrag muss groesser als 0 sein!', 'error');
            return;
        }
        if (!date) {
            showToast('Bitte ein Datum waehlen!', 'error');
            return;
        }

        // Auszahlung, die den Kontostand ins Minus zieht, ist meist ein
        // Tippfehler - deshalb nachfragen statt still speichern
        if (type === 'withdrawal' && amount > getAccountBalance()) {
            if (!confirm('Die Auszahlung ist groesser als dein Kontostand. ' +
                         'Trotzdem speichern?')) {
                return;
            }
        }

        const list = getTransactions();
        const buchung = { id: Date.now(), type, amount, date, note };
        list.push(buchung);
        localStorage.setItem('transactions', JSON.stringify(list));
        if (window.cfDbTransaktionNeu) window.cfDbTransaktionNeu(buchung);

        document.getElementById('transactionForm').reset();
        setTransactionDateToday();
        loadTransactions();
        if (typeof loadDashboard === 'function') loadDashboard();

        showToast(type === 'deposit'
            ? `Einzahlung über ${cfGeld(amount)} gespeichert!`
            : `Auszahlung über ${cfGeld(amount)} gespeichert!`);
    } catch (err) {
        console.error('Buchung konnte nicht gespeichert werden:', err);
        showToast('Buchung konnte nicht gespeichert werden!', 'error');
    }
}

function deleteTransaction(id) {
    transactionToDelete = id;
    const modal = document.getElementById('deleteModal');
    const title = document.getElementById('deleteModalTitle');
    const text = document.getElementById('deleteModalText');
    const btn = document.getElementById('deleteConfirmBtn');

    title.textContent = 'Buchung löschen?';
    text.textContent = 'Diese Buchung wird permanent gelöscht.';
    btn.textContent = 'Ja, löschen';
    btn.onclick = () => confirmDeleteTransaction();
    modal.style.display = 'flex';
}

function confirmDeleteTransaction() {
    if (transactionToDelete === null) return;
    const geloeschteId = transactionToDelete;
    const list = getTransactions().filter(
        t => String(t.id) !== String(transactionToDelete));
    localStorage.setItem('transactions', JSON.stringify(list));
    if (window.cfDbLoeschen && geloeschteId) window.cfDbLoeschen('transactions', geloeschteId);

    document.getElementById('deleteModal').style.display = 'none';
    transactionToDelete = null;
    loadTransactions();
    if (typeof loadDashboard === 'function') loadDashboard();
    showToast('Buchung gelöscht!');
}

function setTransactionDateToday() {
    const el = document.getElementById('txDate');
    if (el && !el.value) el.value = new Date().toISOString().slice(0, 10);
}

function loadTransactions() {
    const list = getTransactions()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const eingezahlt = list.filter(t => t.type === 'deposit')
        .reduce((s, t) => s + t.amount, 0);
    const ausgezahlt = list.filter(t => t.type === 'withdrawal')
        .reduce((s, t) => s + t.amount, 0);
    const netto = eingezahlt - ausgezahlt;
    const stand = getAccountBalance();

    // Rendite bezogen auf das eingesetzte Kapital. Ohne Einzahlung
    // gibt es keine sinnvolle Bezugsgroesse.
    const rendite = netto > 0 ? ((stand - netto) / netto) * 100 : 0;

    const fmt = (v) => cfGeld(v);

    const set = (id, value, color) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = value;
        if (color) el.style.color = color;
    };

    set('txNetDeposit', fmt(netto));
    set('txBalance', fmt(stand), stand >= netto ? '#34D399' : '#FB7185');
    set('txReturn', cfProz(rendite, 2, { vorzeichen: true }),
        rendite >= 0 ? '#3b82f6' : '#FB7185');
    set('txCount', String(list.length));

    const box = document.getElementById('transactionsList');
    if (!box) return;

    if (list.length === 0) {
        box.innerHTML =
            '<div style="text-align:center;padding:40px 20px;color:#8A86A0;">' +
            '<p style="font-size:14px;">Noch keine Buchung erfasst</p>' +
            '<p style="font-size:13px;margin-top:6px;">Trag deine erste ' +
            'Einzahlung ein, damit Kontostand und Rendite stimmen.</p></div>';
        return;
    }

    box.innerHTML = list.map(t => {
        const ein = t.type === 'deposit';
        const farbe = ein ? '#34D399' : '#fb923c';
        const datum = new Date(t.date).toLocaleDateString('de-DE',
            { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `
            <div class="tx-row">
                <div class="tx-icon" style="background:${farbe}1f;color:${farbe};">
                    ${ein ? '↓' : '↑'}
                </div>
                <div class="tx-main">
                    <div class="tx-type">${ein ? 'Einzahlung' : 'Auszahlung'}</div>
                    <div class="tx-meta">${escapeHtml(datum)}${
                        t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
                </div>
                <div class="tx-amount" style="color:${farbe};">
                    ${ein ? '+' : '−'}${fmt(t.amount)}
                </div>
                <button class="tx-delete" onclick="deleteTransaction('${t.id}')"
                        title="Buchung löschen">✕</button>
            </div>`;
    }).join('');
}

// ===== SETUPS =====
// Setups beobachten, bevor man einsteigt. Schliesst die Luecke zwischen
// Idee und Trade und liefert das Chance-Risiko-Verhaeltnis VOR dem Einstieg.

const SETUPS_STATUS = {
    watching:  { label: 'Beobachten',   color: '#8B6CF3' },
    ready:     { label: 'Bereit',       color: '#34D399' },
    entered:   { label: 'Eingestiegen', color: '#3b82f6' },
    discarded: { label: 'Verworfen',    color: '#fb923c' }
};

let setupsScreenshotData = null;
let setupsCurrentFilter = 'active';
let setupsToDelete = null;

function getSetups() {
    const raw = JSON.parse(localStorage.getItem('setups')) || [];
    return raw.filter(w => w && typeof w === 'object' && w.ticker)
        .map((w, i) => ({
            id: w.id || (Date.now() + i),
            ticker: String(w.ticker).toUpperCase(),
            direction: w.direction === 'short' ? 'short' : 'long',
            entryFrom: parseFloat(w.entryFrom) || 0,
            entryTo: parseFloat(w.entryTo) || 0,
            stop: parseFloat(w.stop) || 0,
            target: parseFloat(w.target) || 0,
            // Diese Funktion baut das Objekt Feld fuer Feld neu und wirft
            // dabei alles weg, was sie nicht kennt. Wer hier ein neues
            // Feld vergisst, speichert es und bekommt es nie zurueck -
            // ohne Fehlermeldung.
            ko: parseFloat(w.ko) > 0 ? parseFloat(w.ko) : null,
            leverage: parseFloat(w.leverage) > 0 ? parseFloat(w.leverage) : 1,
            thesis: w.thesis || '',
            screenshot: w.screenshot || null,
            status: SETUPS_STATUS[w.status] ? w.status : 'watching',
            created: w.created || new Date().toISOString(),
            updated: w.updated || w.created || new Date().toISOString()
        }));
}

function saveSetups(list) {
    // Vorher merken, damit die Datenbankschicht erkennt, was sich
    // geaendert hat - angelegt, geloescht oder anderer Status
    let vorher = [];
    try { vorher = JSON.parse(localStorage.getItem('setups')) || []; }
    catch (e) { /* egal */ }

    localStorage.setItem('setups', JSON.stringify(list));

    if (window.cfDbSetupsAbgleichen) window.cfDbSetupsAbgleichen(vorher, list);
}

// Einstieg ist die Mitte der Zone. Ist nur ein Wert gesetzt, zaehlt der.
function setupsEntryPrice(from, to) {
    if (from > 0 && to > 0) return (from + to) / 2;
    return from > 0 ? from : to;
}

// Liefert CRV oder einen Hinweis, warum es sich nicht berechnen laesst.
// Die Richtungspruefung faengt vertauschte Stops und Ziele ab - ein
// haeufiger Tippfehler, der sonst ein voellig falsches CRV ergibt.
/**
 * Knock-Out-Pruefung fuer ein geplantes Setup.
 *
 * Hier ist die Warnung etwas wert: vor dem Einstieg. Im Journal waere
 * dieselbe Zahl nur noch die Erklaerung, warum das Geld weg ist.
 *
 * Zwei Faelle:
 *   1. Der geplante Stop liegt jenseits der Schwelle. Dann loest er nie
 *      aus - der Schein verfaellt vorher wertlos. Aus "ich riskiere
 *      60 %" wird unbemerkt "ich riskiere alles".
 *   2. Der Abstand zur Schwelle ist knapp. Kein Fehler, aber die Zahl,
 *      die man vor dem Klick sehen will.
 */
function setupsKoPruefen(direction, entry, stop, ko) {
    if (!(entry > 0) || !(ko > 0)) return null;
    const isLong = direction !== 'short';
    const abstand = isLong ? entry - ko : ko - entry;
    if (!(abstand > 0)) {
        return {
            hebel: null, abstandPct: null, totalverlust: false,
            fehler: isLong
                ? 'Der Knockout-Preis liegt über deinem Einstieg — bei Long muss er darunter liegen.'
                : 'Der Knockout-Preis liegt unter deinem Einstieg — bei Short muss er darüber liegen.'
        };
    }
    // Hebel = Einstieg / Abstand zur Schwelle. Dieselbe Rechnung wie im
    // Journal, nur mit geplanten statt echten Zahlen.
    const hebel = entry / abstand;
    const abstandPct = (abstand / entry) * 100;
    const totalverlust = (stop > 0)
        && (isLong ? stop <= ko : stop >= ko);
    return { hebel: hebel, abstandPct: abstandPct,
             totalverlust: totalverlust, fehler: null };
}

function setupsCalcCrv(direction, entry, stop, target, leverage) {
    if (!(entry > 0) || !(stop > 0) || !(target > 0)) {
        return { ok: false, reason: 'unvollstaendig' };
    }
    const isLong = direction !== 'short';
    if (isLong && !(stop < entry && entry < target)) {
        return { ok: false, reason: 'Bei Long muss gelten: Stop < Einstieg < Ziel' };
    }
    if (!isLong && !(target < entry && entry < stop)) {
        return { ok: false, reason: 'Bei Short muss gelten: Ziel < Einstieg < Stop' };
    }
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    // Der Hebel vergroessert Chance und Risiko gleich stark - das
    // Verhaeltnis bleibt also gleich. Was sich aendert, ist der Anteil
    // der Position, der im Spiel steht.
    const lev = leverage > 0 ? leverage : 1;
    return {
        ok: true,
        crv: reward / risk,
        riskPct: (risk / entry) * 100 * lev,
        rewardPct: (reward / entry) * 100 * lev,
        leverage: lev
    };
}

function setupsCrvColor(crv) {
    if (crv >= 2) return '#34D399';
    if (crv >= 1) return '#fbbf24';
    return '#FB7185';
}

function updateSetupsCrvPreview() {
    const box = document.getElementById('setupsCrvPreview');
    if (!box) return;
    const dir = document.getElementById('setupsDirection').value;
    const entry = setupsEntryPrice(
        parseFloat(document.getElementById('setupsEntryFrom').value) || 0,
        parseFloat(document.getElementById('setupsEntryTo').value) || 0);
    const stop = parseFloat(document.getElementById('setupsStop').value) || 0;
    const target = parseFloat(document.getElementById('setupsTarget').value) || 0;
    const koFeld = document.getElementById('setupsKo');
    const ko = koFeld ? (parseFloat(koFeld.value) || 0) : 0;
    const koInfo = setupsKoPruefen(dir, entry, stop, ko);

    // Mit Knockout-Preis wird der Hebel gerechnet statt getippt - das
    // Feld daneben ist dann nur noch fuer Aktien da.
    let lev = parseFloat(document.getElementById('setupsLeverage').value) || 1;
    if (koInfo && koInfo.hebel) lev = koInfo.hebel;

    const r = setupsCalcCrv(dir, entry, stop, target, lev);
    box.classList.remove('setups-crv-warn');

    if (koInfo && koInfo.fehler) {
        box.classList.add('setups-crv-warn');
        box.innerHTML = '' + escapeHtml(koInfo.fehler);
        return;
    }

    if (!r.ok && r.reason === 'unvollstaendig') {
        box.style.borderColor = '';
        box.innerHTML = 'Einstieg, Stop und Ziel eintragen, um das Chance-Risiko-Verhältnis zu sehen';
        return;
    }
    if (!r.ok) {
        box.classList.add('setups-crv-warn');
        box.innerHTML = '' + escapeHtml(r.reason);
        return;
    }
    const c = setupsCrvColor(r.crv);

    // Jenseits der Schwelle gibt es kein "60 % Risiko" mehr. Die Zahl
    // wird gedeckelt und der Grund danebengeschrieben - sonst plant
    // jemand mit einem Stop, der nie zum Zug kommt.
    const total = Boolean(koInfo && koInfo.totalverlust);
    const risiko = total ? 100 : Math.min(r.riskPct, 100);

    let zeile =
        '<span>Chance-Risiko</span>' +
        '<strong style="color:' + c + ';">1 : ' + cfZahl(r.crv, 2) + '</strong>' +
        '<span style="color:#FB7185;">Risiko ' + cfProz(-risiko, 2) + '</span>' +
        '<span style="color:#34D399;">Chance ' + cfProz(r.rewardPct, 2, { vorzeichen: true }) + '</span>' +
        (r.leverage > 1
            ? '<span style="color:#C9B8FF;">' + formatLeverage(r.leverage)
              + (koInfo && koInfo.hebel ? ' (gerechnet)' : ' Hebel') + '</span>'
            : '');

    if (koInfo && koInfo.abstandPct !== null) {
        const eng = koInfo.abstandPct < 5;
        zeile += '<span style="color:' + (eng ? '#FB7185' : '#fbbf24') + ';">'
              + 'KO-Abstand ' + cfProz(koInfo.abstandPct, 1) + '</span>';
    }

    box.innerHTML = zeile;

    if (total) {
        box.classList.add('setups-crv-warn');
        box.innerHTML = '<strong>Dein Stop liegt jenseits der Schwelle.</strong> '
            + 'Der Schein verfällt vorher wertlos — der Stop löst nie aus. '
            + 'Du riskierst nicht ' + cfProz(r.riskPct, 0) + ', sondern alles. '
            + 'Setz den Stop über ' + cfZahl(ko, 2)
            + ' oder nimm einen Schein mit tieferer Schwelle.';
    } else if (koInfo && koInfo.abstandPct !== null && koInfo.abstandPct < 5) {
        box.classList.add('setups-crv-warn');
        box.innerHTML = zeile
            + '<span style="color:#FB7185;">Nur '
            + cfProz(koInfo.abstandPct, 1)
            + ' bis zum Totalverlust</span>';
    }
}

function addSetupsItem(e) {
    e.preventDefault();
    try {
        const ticker = document.getElementById('setupsTicker').value.trim().toUpperCase();
        const direction = document.getElementById('setupsDirection').value;
        const entryFrom = parseFloat(document.getElementById('setupsEntryFrom').value) || 0;
        const entryTo = parseFloat(document.getElementById('setupsEntryTo').value) || 0;
        const stop = parseFloat(document.getElementById('setupsStop').value) || 0;
        const target = parseFloat(document.getElementById('setupsTarget').value) || 0;
        const thesis = document.getElementById('setupsThesis').value.trim();
        const levRaw = parseFloat(document.getElementById('setupsLeverage').value);
        const koFeld = document.getElementById('setupsKo');
        const ko = koFeld ? (parseFloat(koFeld.value) || 0) : 0;
        // Mit Knockout-Preis wird der Hebel gerechnet, nicht getippt
        const koInfo = setupsKoPruefen(direction,
            setupsEntryPrice(entryFrom, entryTo), stop, ko);
        const leverage = (koInfo && koInfo.hebel)
            ? Math.round(koInfo.hebel * 100) / 100
            : (levRaw > 0 ? levRaw : 1);

        if (!ticker) {
            showToast('Ticker fehlt!', 'error');
            return;
        }
        if (!(entryFrom > 0) && !(entryTo > 0)) {
            showToast('Mindestens einen Einstiegspreis angeben!', 'error');
            return;
        }
        if (levRaw && levRaw < 1) {
            showToast('Hebel muss mindestens 1 sein!', 'error');
            return;
        }
        if (koInfo && koInfo.fehler) {
            showToast('' + koInfo.fehler, 'error');
            return;
        }

        // Vertauschte Werte speichern wir nicht still - lieber nachfragen
        const check = setupsCalcCrv(direction, setupsEntryPrice(entryFrom, entryTo), stop, target);
        if (!check.ok && check.reason !== 'unvollstaendig') {
            showToast('' + check.reason, 'error');
            return;
        }

        const list = getSetups();
        const now = new Date().toISOString();
        list.push({
            id: Date.now(), ticker, direction,
            entryFrom: Math.min(entryFrom || entryTo, entryTo || entryFrom),
            entryTo: Math.max(entryFrom, entryTo),
            stop, target, leverage, thesis,
            ko: ko || null,
            screenshot: setupsScreenshotData,
            status: 'watching', created: now, updated: now
        });
        saveSetups(list);

        document.getElementById('setupsForm').reset();
        resetSetupsDirection();
        setupsScreenshotData = null;
        document.getElementById('setupsScreenshotPreview').innerHTML = '';
        updateSetupsCrvPreview();
        loadSetups();
        cfKlapp('gespeichert', 'setupsFormHuelle');
        showToast(`Setup ${ticker} gespeichert!`);
    } catch (err) {
        console.error('Setup konnte nicht gespeichert werden:', err);
        showToast('Setup konnte nicht gespeichert werden!', 'error');
    }
}

function resetSetupsDirection() {
    document.getElementById('setupsDirection').value = 'long';
    document.querySelectorAll('[data-target="setupsDirection"] .direction-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.direction === 'long'));
}

function setSetupsStatus(id, status) {
    if (!SETUPS_STATUS[status]) return;
    const list = getSetups().map(w =>
        w.id === id ? { ...w, status, updated: new Date().toISOString() } : w);
    saveSetups(list);
    loadSetups();
}

function deleteSetupsItem(id) {
    setupsToDelete = id;
    const w = getSetups().find(x => x.id === id);
    document.getElementById('deleteModalTitle').textContent = 'Setup löschen?';
    document.getElementById('deleteModalText').textContent =
        (w ? w.ticker : 'Das Setup') + ' wird permanent gelöscht.';
    const btn = document.getElementById('deleteConfirmBtn');
    btn.textContent = 'Ja, löschen';
    btn.onclick = () => {
        saveSetups(getSetups().filter(x => x.id !== setupsToDelete));
        document.getElementById('deleteModal').style.display = 'none';
        setupsToDelete = null;
        loadSetups();
        showToast('Setup gelöscht!');
    };
    document.getElementById('deleteModal').style.display = 'flex';
}

// Uebertraegt das Setup ins Journal-Formular. Dort fehlen dann nur noch
// Ausstieg und Positionsgroesse - nichts muss doppelt getippt werden.
function setupsToJournal(id) {
    const w = getSetups().find(x => x.id === id);
    if (!w) return;

    const nav = document.querySelector('.nav-item[data-tab="journal"]');
    if (nav) nav.click();

    setTimeout(() => {
        const set = (fid, v) => {
            const el = document.getElementById(fid);
            if (el && v !== undefined && v !== null && v !== 0) el.value = v;
        };
        set('ticker', w.ticker);
        set('reason', w.thesis);

        // Mit Knockout-Preis ist es ein Zertifikatstrade. Produktart
        // umschalten und die Schwelle mitnehmen - dann muss niemand
        // dieselbe Zahl zweimal eintippen.
        if (w.ko) {
            const btn = document.querySelector('.produkt-btn[data-art="knockout"]');
            if (btn) btn.click();
            set('zKo', w.ko);
            set('zStop', w.stop || '');
            // Der Einstiegskurs des Basiswerts ist geplant, nicht bezahlt -
            // er gehoert ins Basiswertfeld, nicht in den Scheinpreis.
            set('zBasisEin', setupsEntryPrice(w.entryFrom, w.entryTo).toFixed(2));
        } else {
            set('entryPrice', setupsEntryPrice(w.entryFrom, w.entryTo).toFixed(2));
            set('stopLoss', w.stop || '');
            set('leverage', w.leverage > 1 ? w.leverage : '');
        }

        const dirField = document.getElementById('direction');
        if (dirField) dirField.value = w.direction;
        document.querySelectorAll('[data-target="direction"] .direction-btn')
            .forEach(b => b.classList.toggle('active', b.dataset.direction === w.direction));

        setSetupsStatus(id, 'entered');

        cfKlapp('auf', 'tradeFormHuelle', { fokus: null });
        const form = document.getElementById('tradeForm');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const exit = document.getElementById('exitPrice');
        if (exit) setTimeout(() => exit.focus(), 400);

        showToast(`${w.ticker} ins Journal übernommen – Ausstieg und Größe ergänzen`);
    }, 250);
}

function loadSetups() {
    const all = getSetups();
    cfKlapp('leer', 'setupsFormHuelle', all.length === 0);

    // Kennzahlen
    const active = all.filter(w => w.status === 'watching' || w.status === 'ready');
    const crvs = active.map(w =>
        setupsCalcCrv(w.direction, setupsEntryPrice(w.entryFrom, w.entryTo), w.stop, w.target))
        .filter(r => r.ok).map(r => r.crv);

    const setText = (id, v, color) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = v;
        if (color) el.style.color = color;
    };
    setText('setupsActive', String(active.length));
    setText('setupsReady', String(all.filter(w => w.status === 'ready').length));
    setText('setupsDiscarded', String(all.filter(w => w.status === 'discarded').length));
    if (crvs.length) {
        const avg = crvs.reduce((a, b) => a + b, 0) / crvs.length;
        setText('setupsAvgCrv', '1 : ' + cfZahl(avg, 2), setupsCrvColor(avg));
    } else {
        setText('setupsAvgCrv', '–', '#3b82f6');
    }

    // Filter
    const shown = all.filter(w => {
        if (setupsCurrentFilter === 'active') return w.status === 'watching' || w.status === 'ready';
        if (setupsCurrentFilter === 'all') return true;
        return w.status === setupsCurrentFilter;
    }).sort((a, b) => {
        // Bereite Setups nach oben, dann nach Aenderungsdatum
        const rank = s => ({ ready: 0, watching: 1, entered: 2, discarded: 3 })[s];
        return rank(a.status) - rank(b.status) ||
               (b.updated || '').localeCompare(a.updated || '');
    });

    const box = document.getElementById('setupsContainer');
    if (!box) return;

    if (shown.length === 0) {
        const msg = {
            active: 'Keine aktiven Setups. Trag oben dein erstes ein.',
            entered: 'Noch kein Setup ins Journal übernommen.',
            discarded: 'Noch nichts verworfen.',
            all: 'Noch kein Setup erfasst.'
        }[setupsCurrentFilter];
        box.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:#8A86A0;font-size:14px;">' +
                        escapeHtml(msg) + '</div>';
        return;
    }

    const fmt = v => v > 0 ? cfZahl(v, 2) : '–';

    box.innerHTML = shown.map(w => {
        const st = SETUPS_STATUS[w.status];
        const entry = setupsEntryPrice(w.entryFrom, w.entryTo);
        const r = setupsCalcCrv(w.direction, entry, w.stop, w.target, w.leverage);
        const zone = (w.entryFrom > 0 && w.entryTo > 0 && w.entryFrom !== w.entryTo)
            ? fmt(w.entryFrom) + ' – ' + fmt(w.entryTo) : fmt(entry);
        const erledigt = w.status === 'entered' || w.status === 'discarded';

        const statusBtns = ['watching', 'ready', 'discarded'].map(k =>
            `<button class="setups-status-btn ${w.status === k ? 'active' : ''}"
                     style="--st:${SETUPS_STATUS[k].color};"
                     onclick="setSetupsStatus(${w.id}, '${k}')">${SETUPS_STATUS[k].label}</button>`
        ).join('');

        return `
        <div class="setups-card setups-${w.status}" style="--st:${st.color};">
            <div class="setups-card-head">
                <div class="setups-card-ticker">
                    ${escapeHtml(w.ticker)}
                    <span class="dir-badge dir-${w.direction}">${w.direction === 'short' ? 'SHORT' : 'LONG'}</span>
                    ${w.leverage > 1 ? `<span class="trade-leverage-badge">${formatLeverage(w.leverage)}</span>` : ''}
                </div>
                <span class="setups-status-pill">${st.label}</span>
            </div>

            <div class="setups-levels">
                <div><span>Einstieg</span><strong>${zone}</strong></div>
                <div><span>Stop</span><strong style="color:#FB7185;">${fmt(w.stop)}</strong></div>
                <div><span>Ziel</span><strong style="color:#34D399;">${fmt(w.target)}</strong></div>
            </div>

            ${r.ok ? `
            <div class="setups-crv">
                <span>Chance-Risiko</span>
                <strong style="color:${setupsCrvColor(r.crv)};">1 : ${cfZahl(r.crv, 2)}</strong>
            </div>
            <div class="setups-risk-row">
                <span style="color:#FB7185;">Risiko ${cfProz(-r.riskPct, 2)}</span>
                <span style="color:#34D399;">Chance ${cfProz(r.rewardPct, 2, { vorzeichen: true })}</span>
            </div>` : ''}

            ${w.thesis ? `<div class="setups-thesis">${escapeHtml(w.thesis)}</div>` : ''}

            ${cfBildHtml(w.screenshot, w.screenshotPfad, 'position-screenshot', 'Screenshot zu ' + w.ticker)}

            ${erledigt ? '' : `<div class="setups-status-row">${statusBtns}</div>`}

            <div class="setups-actions">
                ${w.status === 'entered' ? '' :
                  `<button class="setups-btn-primary" onclick="setupsToJournal(${w.id})">Ins Journal übernehmen</button>`}
                ${w.status === 'discarded' ?
                  `<button class="setups-btn-ghost" onclick="setSetupsStatus(${w.id}, 'watching')">Wieder aufnehmen</button>` : ''}
                <button class="setups-btn-delete" onclick="deleteSetupsItem(${w.id})" title="Löschen">✕</button>
            </div>
        </div>`;
    }).join('');
}

// Gemeinsame Anzeige fuer Upload und Strg+V
function displaySetupsScreenshot(dataUrl) {
    setupsScreenshotData = dataUrl;
    const box = document.getElementById('setupsScreenshotPreview');
    if (!box) return;
    box.innerHTML =
        '<img src="' + dataUrl + '" alt="Setup" ' +
        'style="max-width:100%;border-radius:8px;margin-top:10px;' +
        'border:1px solid rgba(124, 92, 240, 0.225);display:block;">' +
        '<button type="button" onclick="clearSetupsScreenshot()" ' +
        'style="margin-top:10px;padding:8px 16px;background:rgba(251, 113, 133, 0.12);' +
        'border:1px solid rgba(251, 113, 133, 0.35);color:#FB7185;border-radius:6px;' +
        'cursor:pointer;font-size:12px;font-weight:600;">Bild entfernen</button>';
    showToast('Screenshot eingefügt!');
}

function clearSetupsScreenshot() {
    setupsScreenshotData = null;
    const box = document.getElementById('setupsScreenshotPreview');
    if (box) box.innerHTML = '';
}

function initSetups() {
    const form = document.getElementById('setupsForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', addSetupsItem);

    // Live-Vorschau der Positions-Hebelzahlen
    ['positionsKo', 'positionsHebel', 'positionsStop', 'positionsSize']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updatePositionsVorschau);
        });
    document.querySelectorAll('[data-target="positionsDirection"] .direction-btn')
        .forEach(b => b.addEventListener('click',
            () => setTimeout(updatePositionsVorschau, 0)));

    ['setupsEntryFrom', 'setupsEntryTo', 'setupsStop', 'setupsTarget',
     'setupsLeverage', 'setupsKo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateSetupsCrvPreview);
    });
    document.querySelectorAll('[data-target="setupsDirection"] .direction-btn')
        .forEach(b => b.addEventListener('click', () => setTimeout(updateSetupsCrvPreview, 0)));

    document.querySelectorAll('#setupsFilter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#setupsFilter .filter-btn')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setupsCurrentFilter = btn.dataset.setupsfilter;
            loadSetups();
        });
    });

    const area = document.getElementById('setupsScreenshotArea');
    const input = document.getElementById('setupsScreenshotInput');
    if (area && input) {
        area.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => displaySetupsScreenshot(reader.result);
            reader.readAsDataURL(f);
            input.value = '';
        });
    }
}

document.addEventListener('DOMContentLoaded', initSetups);


// ===== ZAEHLER IN DER SEITENLEISTE =====
// Neben Journal, Portfolio Analyse und Setups steht, wie viele Trades,
// offene Positionen und Setups es gibt. Aktualisiert sich nach jedem
// Laden/Speichern, weil es an die Ladefunktionen angehaengt ist.
function cfNavZahlen() {
    const lies = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    const setze = (tab, n, wort) => {
        const e = document.getElementById('navZahl-' + tab);
        if (!e) return;
        e.textContent = n > 0 ? String(n) : '';
        e.setAttribute('aria-label', n > 0 ? n + ' ' + wort : '');
    };
    setze('journal', lies('trades').length, 'Trades');
    setze('positions', lies('positions').length, 'offene Positionen');
    let setups = 0;
    try { setups = typeof getSetups === 'function' ? getSetups().length : lies('setups').length; } catch (e) { setups = lies('setups').length; }
    setze('setups', setups, 'Setups');
}
window.cfNavZahlen = cfNavZahlen;
['loadTrades', 'loadDashboard', 'loadSetups', 'loadPositions', 'handleTabChange'].forEach(function (name) {
    const f = window[name];
    if (typeof f !== 'function') return;
    window[name] = function () {
        const r = f.apply(this, arguments);
        try { cfNavZahlen(); } catch (e) { /* Zaehler sind Zugabe, nie ein Grund fuer einen Fehler */ }
        return r;
    };
});
document.addEventListener('DOMContentLoaded', function () { try { cfNavZahlen(); } catch (e) {} });
