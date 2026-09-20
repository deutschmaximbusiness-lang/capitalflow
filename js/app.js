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
    const DATA_KEYS = ['trades', 'positions', 'closedPositions'];
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
        const targetDate = new Date("2027-01-01T00:00:00").getTime();
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

function generateUserKey() {
    return 'CF-' + Math.random().toString(36).substr(2, 16).toUpperCase();
}

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
    
    // Show/hide based on auth state
    if (isLoggedIn) {
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
            showToast('Please enter your key', 'error');
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

        // Gegen die Hash-Liste aus js/keys.js pruefen. Dadurch gilt ein Key
        // in JEDEM Browser, der die Datei laedt - nicht nur in dem, in dem
        // er erzeugt wurde.
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
                [loadTrades, loadPositions, loadDashboard,
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
            showToast('Invalid key! Contact your admin.', 'error');
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
            showToast('❌ Bitte einen Namen eingeben!', 'error');
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
        showToast('Key generated! ✅', 'success');
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
        box.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">' +
            'Noch keine Keys in js/keys.js eingetragen</p>';
        return;
    }

    box.innerHTML = keys.map(function (k) {
        return '<div class="key-item">' +
            '<div class="key-item-info">' +
              '<div class="key-item-name">' + escapeHtml(k.name) + '</div>' +
              '<div class="key-item-key">Hash ' +
                escapeHtml(String(k.hash).slice(0, 16)) + '…</div>' +
              '<div style="font-size:11px;color:#64748b;margin-top:4px;">' +
                'Eingetragen: ' + escapeHtml(k.added || '—') + '</div>' +
            '</div>' +
          '</div>';
    }).join('');
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Key copied! 📋', 'success');
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
    localStorage.removeItem('capitalflow_logged_in');
    // Aktiven Key freigeben, sonst sieht der naechste Nutzer fremde Daten
    window.cfRawStorage.remove('capitalflow_current_key');
    window.cfRawStorage.remove('capitalflow_current_name');
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

function displayScreenshot(base64Data) {
    screenshotData = base64Data;
    const pasteArea = document.getElementById('screenshotPasteArea');
    const preview = document.getElementById('screenshotPreview');
    pasteArea.classList.add('has-image');
    pasteArea.textContent = '';
    pasteArea.style.display = 'none';
    preview.innerHTML = `
        <img src="${base64Data}" alt="Trade Setup" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.3); display: block;">
        <button type="button" onclick="document.getElementById('screenshot').click()" style="margin-top: 10px; padding: 8px 16px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #cbd5e1; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Bild ändern</button>
    `;
}

function clearScreenshot() {
    screenshotData = null;
    const pasteArea = document.getElementById('screenshotPasteArea');
    const preview = document.getElementById('screenshotPreview');
    pasteArea.classList.remove('has-image');
    pasteArea.textContent = '📋 Hier Screenshot einfügen (Ctrl+V) oder klicken zum Datei wählen';
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
            ripple.style.background = 'radial-gradient(circle, rgba(168, 85, 247, 0.6) 0%, transparent 70%)';
            ripple.style.width = '100px';
            ripple.style.height = '100px';
            ripple.style.pointerEvents = 'none';
            ripple.style.animation = 'logoRipple 0.6s ease-out forwards';
            
            const rect = logoElement.getBoundingClientRect();
            ripple.style.left = (e.clientX - rect.left - 50) + 'px';
            ripple.style.top = (e.clientY - rect.top - 50) + 'px';
            
            logoElement.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
            
            showToast('💜 unemployment center journal');
        });
    }
    
    setupTabs();
    initCustomDropdowns();
    setupFilterButtons();
    loadTrades();
    loadDashboard();
    tradeForm.addEventListener('submit', addTrade);
    
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
                    }
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    });
    
    // ===== POSITIONEN FORM =====
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
    
    // Coming Soon Overlays managen
    const positionsOverlay = document.getElementById('positionsComingSoonOverlay');
    const watchlistOverlay = document.getElementById('watchlistComingSoonOverlay');
    const portfolioOverlay = document.getElementById('portfolioComingSoonOverlay');
    const transactionsOverlay = document.getElementById('transactionsComingSoonOverlay');
    
    if (positionsOverlay) {
        if (tabId === 'positions') {
            positionsOverlay.classList.add('visible');
        } else {
            positionsOverlay.classList.remove('visible');
        }
    }
    
    if (watchlistOverlay) {
        if (tabId === 'watchlist') {
            watchlistOverlay.classList.add('visible');
        } else {
            watchlistOverlay.classList.remove('visible');
        }
    }
    
    if (portfolioOverlay) {
        if (tabId === 'portfolio') {
            portfolioOverlay.classList.add('visible');
        } else {
            portfolioOverlay.classList.remove('visible');
        }
    }
    
    if (transactionsOverlay) {
        if (tabId === 'transactions') {
            transactionsOverlay.classList.add('visible');
        } else {
            transactionsOverlay.classList.remove('visible');
        }
    }
    
    // Lade spezielle Inhalte
    if (tabId === 'calendar') {
        setTimeout(() => loadCalendar(), 100);
    }
    if (tabId === 'dashboard') {
        setTimeout(() => loadDashboard(), 100);
    }
    if (tabId === 'analytics') {
        setTimeout(() => loadAnalytics(), 100);
    }
    if (tabId === 'journal') {
        setTimeout(() => loadTrades(), 100);
    }
    if (tabId === 'positions') {
        setTimeout(() => loadPositions(), 100);
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
        filtered = filtered.filter(t => t.leverage && t.leverage > 1);
    } else if (currentFilter === 'normal') {
        filtered = filtered.filter(t => !t.leverage || t.leverage === 1);
    }
    
    // Setup-Type Filter
    if (currentSetupTypeFilter !== 'all') {
        filtered = filtered.filter(t => t.setupType === currentSetupTypeFilter);
    }
    
    return filtered;
}

// ===== TRADES =====
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
        
        // P&L Berechnung
        const shares = positionSize / entryPrice;
        const pnl = (exitPrice - entryPrice) * shares * leverage;
        const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100 * leverage;
        const risk = stopLoss ? (entryPrice - stopLoss) * shares * leverage : 0;
        const reward = (exitPrice - entryPrice) * shares * leverage;
        const riskReward = risk !== 0 ? reward / risk : 0;
        
        const date = new Date().toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
        
        // Trade Object erstellen
        const trade = {
            id: Date.now(),
            ticker,
            entryPrice,
            exitPrice,
            stopLoss: stopLoss || 0,
            positionSize,
            leverage,
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
            date
        };
        
        // In localStorage speichern
        const trades = JSON.parse(localStorage.getItem('trades')) || [];
        trades.push(trade);
        localStorage.setItem('trades', JSON.stringify(trades));
        
        // UI Update
        showToast(`Trade hinzugefügt: ${ticker} (P&L: €${trade.pnl.toFixed(2)})`);
        tradeForm.reset();
        document.getElementById('screenshotPreview').innerHTML = '';
        clearScreenshot();
        loadTrades();
        
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
function normalizeTrade(trade, index) {
    const num = (v, fallback) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const entry = num(trade.entryPrice, 0);
    const exit = num(trade.exitPrice, 0);
    const size = num(trade.positionSize, 0);
    const lev = num(trade.leverage, 1) || 1;

    // Fehlendes Ergebnis aus den Preisen nachrechnen, statt den
    // Datensatz zu verlieren
    let pnl = num(trade.pnl, null);
    if (pnl === null) {
        pnl = entry > 0 ? (exit - entry) * (size / entry) * lev : 0;
        pnl = Math.round(pnl * 100) / 100;
    }
    let pnlPercent = num(trade.pnlPercent, null);
    if (pnlPercent === null) {
        pnlPercent = entry > 0
            ? Math.round(((exit - entry) / entry) * 100 * lev * 100) / 100
            : 0;
    }

    return {
        ...trade,
        id: trade.id || (Date.now() + index),
        ticker: trade.ticker || '—',
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
        date: trade.date || new Date().toISOString().slice(0, 10),
        screenshot: trade.screenshot && String(trade.screenshot).trim()
            ? trade.screenshot : null,
        setupType: trade.setupType || 'Sonstiges',
        errorType: trade.errorType || 'Kein Fehler'
    };
}

function loadTrades() {
    let trades = JSON.parse(localStorage.getItem('trades')) || [];

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
        tradesPnLDisplay.textContent = `€ ${filteredPnL.toFixed(2)}`;
        tradesPnLDisplay.style.color = filteredPnL >= 0 ? '' : '#f87171';
    }
    
    if (tradeCountDisplay) {
        tradeCountDisplay.textContent = filteredTrades.length;
    }
    
    if (filteredTrades.length === 0) {
        tradesContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: #94a3b8;">Keine Trades in dieser Kategorie</div>';
        return;
    }
    
    // Jede Karte einzeln bauen: faellt eine aus, bleiben die anderen
    // sichtbar, statt dass die ganze Liste leer bleibt
    const renderTradeCard = (trade) => `
        <div class="trade-card">
            <div class="trade-header">
                <div class="trade-ticker">
                    ${escapeHtml(trade.ticker)}
                    ${trade.leverage > 1 ? `<span class="trade-leverage-badge">${trade.leverage.toFixed(0)}x</span>` : ''}
                </div>
                <div class="trade-pnl ${trade.pnl > 0 ? 'profit' : 'loss'}">
                    <div>€${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}</div>
                    <div class="trade-pnl-percent">${trade.pnlPercent > 0 ? '+' : ''}${trade.pnlPercent.toFixed(1)}%</div>
                </div>
            </div>
            <div style="margin-bottom: 15px; margin-top: 10px;">
                <span class="setup-type-badge ${getSetupTypeBadgeClass(trade.setupType || 'Sonstiges')}">${trade.setupType || 'Sonstiges'}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Entry / Exit</span>
                <span class="trade-detail-value">$${trade.entryPrice.toFixed(2)} / $${trade.exitPrice.toFixed(2)}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Grund</span>
                <span class="trade-detail-value">${trade.reason || '-'}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Position Größe</span>
                <span class="trade-detail-value">€${trade.positionSize.toFixed(2)}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">R:R Ratio</span>
                <span class="trade-detail-value">${trade.riskReward.toFixed(2)} : 1</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Fehler</span>
                <span class="trade-detail-value">${trade.errorType || 'Keine'}</span>
            </div>
            <div class="trade-detail">
                <span class="trade-detail-label">Datum</span>
                <span class="trade-detail-value">${trade.date}</span>
            </div>
            ${trade.notes ? `<div class="trade-detail"><span class="trade-detail-label">Notes</span><span class="trade-detail-value">${escapeHtml(trade.notes)}</span></div>` : ''}
            ${trade.screenshot && trade.screenshot.trim() ? `<div class="trade-screenshot"><img src="${trade.screenshot}" alt="Trade Setup" onclick="openScreenshotModal('${trade.screenshot}')" style="cursor: pointer;"></div>` : ''}
            <button class="trade-delete" onclick="confirmDelete(${trade.id})">🗑️ Löschen</button>
        </div>
    `;

    tradesContainer.innerHTML = filteredTrades.map((trade) => {
        try {
            return renderTradeCard(trade);
        } catch (err) {
            console.error('Trade konnte nicht dargestellt werden:', trade, err);
            return '<div class="trade-card"><div class="trade-header">' +
                   '<div class="trade-ticker">' + escapeHtml(trade.ticker || '—') +
                   '</div></div><p style="color:#f87171;font-size:13px;">' +
                   'Dieser Eintrag ist beschädigt und kann nicht angezeigt werden.' +
                   '</p><button class="trade-delete" onclick="confirmDelete(' +
                   (trade.id || 0) + ')">🗑️ Löschen</button></div>';
        }
    }).join('');
}

function confirmDelete(id) {
    tradeToDelete = id;
    const deleteModal = document.getElementById('deleteModal');
    const modalTitle = document.getElementById('deleteModalTitle');
    const modalText = document.getElementById('deleteModalText');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    
    modalTitle.textContent = '🗑️ Trade löschen?';
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
    const filtered = trades.filter(t => t.id !== tradeToDelete);
    localStorage.setItem('trades', JSON.stringify(filtered));
    
    // Modal schließen
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.display = 'none';
    }
    tradeToDelete = null;
    
    loadTrades();
    showToast('✅ Trade gelöscht!');
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
    
    if (Object.keys(groupedByDate).length > 0) {
        const dates = Object.keys(groupedByDate).map(d => new Date(d.split('.').reverse().join('-')));
        const maxDate = new Date(Math.max(...dates));
        
        const startDate = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
        const endDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0);
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            allDates.push(`${day}.${month}.${year}`);
        }
    } else {
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            allDates.push(`${day}.${month}.${year}`);
        }
    }
    
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
        <div style="display: flex; gap: 20px; margin-bottom: 30px; padding: 16px; background: rgba(100, 116, 139, 0.1); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #10b981; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Gewinn</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #f87171; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Verlust</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #64748b; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Keine Trades</span>
            </div>
        </div>
        
        <!-- Calendar Grid -->
        <div class="calendar-grid-daily">
            ${sortedDates.map(date => {
                const dayTrades = groupedByDate[date] || [];
                const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
                const status = dayTrades.length === 0 ? 'neutral' : (dayPnL > 0 ? 'profit' : 'loss');
                const isSpecial = (bestDay.date === date) ? 'style="box-shadow: 0 0 20px rgba(16, 185, 129, 0.6);"' : (worstDay.date === date) ? 'style="box-shadow: 0 0 20px rgba(248, 113, 113, 0.6);"' : '';
                
                return `
                    <div class="calendar-day ${status}" ${isSpecial} title="${date}: ${dayTrades.length} Trades, €${dayPnL.toFixed(2)}">
                        <div class="calendar-day-header">${date}</div>
                        <div class="calendar-day-pnl">${dayTrades.length > 0 ? `€${Math.abs(dayPnL).toFixed(0)}` : '—'}</div>
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
                <div class="calendar-day-pnl">${weekTrades.length > 0 ? `€${Math.abs(weekPnL).toFixed(0)}` : '—'}</div>
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
    
    // Generiere ALLE 12 Monate des aktuellen Jahres (Jan - Dez)
    const allMonths = [];
    for (let month = 1; month <= 12; month++) {
        const monthKey = `${currentYear}-${String(month).padStart(2, '0')}`;
        allMonths.push(monthKey);
    }
    
    // Sortiere absteigend (Dez zuerst, dann Nov, etc.)
    allMonths.reverse();
    
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
        <div style="display: flex; gap: 20px; margin-bottom: 30px; padding: 16px; background: rgba(100, 116, 139, 0.1); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #10b981; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Gewinn</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #f87171; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Verlust</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: #64748b; border-radius: 6px;"></div>
                <span style="color: #cbd5e1; font-size: 13px;">Keine Trades</span>
            </div>
        </div>
        
        <!-- Calendar Grid -->
        <div class="calendar-grid-monthly">
            ${allMonths.map(monthKey => {
                const monthTrades = groupedByMonth[monthKey] || [];
                const monthPnL = monthTrades.reduce((sum, t) => sum + t.pnl, 0);
                const status = monthTrades.length === 0 ? 'neutral' : (monthPnL > 0 ? 'profit' : 'loss');
                const isSpecial = (bestMonth.key === monthKey) ? 'style="box-shadow: 0 0 20px rgba(16, 185, 129, 0.6);"' : (worstMonth.key === monthKey) ? 'style="box-shadow: 0 0 20px rgba(248, 113, 113, 0.6);"' : '';
                
                return `
                    <div class="calendar-day ${status}" ${isSpecial} title="${getMonthName(monthKey)}: ${monthTrades.length} Trades, €${monthPnL.toFixed(2)}">
                        <div class="calendar-day-header">${getMonthName(monthKey)}</div>
                        <div class="calendar-day-pnl">${monthTrades.length > 0 ? `€${Math.abs(monthPnL).toFixed(0)}` : '—'}</div>
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
    
    // Consecutive Wins/Losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;
    
    trades.forEach(t => {
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
    
    // Trading Days (unique days mit Trades)
    const uniqueTradingDays = new Set(trades.map(t => t.date)).size;
    
    // Win Rate by Day
    const winsByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const totalByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    trades.forEach(t => {
        const [day, month, year] = t.date.split('.');
        const d = new Date(`${year}-${month}-${day}`);
        const dayName = dayMap[d.getDay()];
        totalByDay[dayName]++;
        if (t.pnl > 0) winsByDay[dayName]++;
    });
    
    const winRateByDay = Object.keys(winsByDay).map(day => ({
        day,
        rate: totalByDay[day] > 0 ? ((winsByDay[day] / totalByDay[day]) * 100).toFixed(0) : 0,
        total: totalByDay[day]
    }));
    
    const bestDay = winRateByDay.reduce((max, day) => 
        parseInt(day.rate) > parseInt(max.rate) ? day : max, 
        winRateByDay[0] || { day: '-', rate: 0 }
    );
    
    const dashboardContent = document.getElementById('dashboard');
    dashboardContent.innerHTML = `
        <h2 style="margin-bottom: 30px;">Dashboard</h2>
        
        <!-- ===== FILTER BUTTONS ===== -->
        <div class="trades-filter" style="margin-bottom: 30px;">
            <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Alle Trades</button>
            <button class="filter-btn ${currentFilter === 'leverage' ? 'active' : ''}" data-filter="leverage">Nur Hebel</button>
            <button class="filter-btn ${currentFilter === 'normal' ? 'active' : ''}" data-filter="normal">Nur Normal</button>
        </div>
        
        <!-- TOP 3 BIG CARDS -->
        <div class="dashboard-top-cards" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px;">
            <div class="dashboard-big-card">
                <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">Today</div>
                <div style="font-size: 28px; font-weight: 700; color: ${stats.todayPnL >= 0 ? '#10b981' : '#f87171'};">€${stats.todayPnL.toFixed(2)}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">${stats.todayTrades.length} trades • ${stats.todayWinRate}% win</div>
            </div>
            <div class="dashboard-big-card">
                <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">Current Balance</div>
                <div style="font-size: 28px; font-weight: 700; color: #cbd5e1;">€${stats.totalPnL.toFixed(2)}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Broker account</div>
            </div>
            <div class="dashboard-big-card">
                <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">Total P&L</div>
                <div style="font-size: 28px; font-weight: 700; color: ${stats.totalPnL >= 0 ? '#10b981' : '#f87171'};">€${stats.totalPnL.toFixed(2)}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">${stats.trades.length} trades • ${stats.winRate}% win rate</div>
            </div>
        </div>
        
        <!-- MID 4 CARDS -->
        <div class="dashboard-mid-cards" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px;">
            <div class="dashboard-card">
                <div style="color: #94a3b8; font-size: 11px; margin-bottom: 8px; text-transform: uppercase;">Streak</div>
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">${maxConsecutiveWins} wins</div>
                <div style="color: #94a3b8; font-size: 11px; margin-top: 8px;">Current momentum 🔥</div>
            </div>
            <div class="dashboard-card">
                <div style="color: #94a3b8; font-size: 11px; margin-bottom: 8px; text-transform: uppercase;">Profit Factor</div>
                <div style="font-size: 24px; font-weight: 700; color: #a855f7;">${stats.profitFactor}</div>
                <div style="color: #94a3b8; font-size: 11px; margin-top: 8px;">Risk/Reward ratio</div>
            </div>
            <div class="dashboard-card">
                <div style="color: #94a3b8; font-size: 11px; margin-bottom: 8px; text-transform: uppercase;">Biggest Win</div>
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">€${bestTradeData.pnl.toFixed(2)}</div>
                <div style="color: #94a3b8; font-size: 11px; margin-top: 8px;">Single trade best</div>
            </div>
            <div class="dashboard-card">
                <div style="color: #94a3b8; font-size: 11px; margin-bottom: 8px; text-transform: uppercase;">Best Day</div>
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">+€${(bestDay.rate * stats.totalPnL / 100).toFixed(2)}</div>
                <div style="color: #94a3b8; font-size: 11px; margin-top: 8px;">${bestDay.day} • ${bestDay.rate}% win</div>
            </div>
        </div>
        
        <!-- TRADE SCORE + ACTIVITY GRID -->
        <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 20px; margin-bottom: 30px;">
            <!-- Trade Score Card -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div class="trade-score-label" style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">Trade Score</div>
                    <div class="trade-score-value" id="tradeScoreValue" style="font-size: 48px; font-weight: 700; color: #a855f7;">0</div>
                    <div class="trade-score-status" id="tradeScoreStatus" style="color: #fbbf24; font-size: 13px; margin-top: 4px;">-</div>
                </div>
                <canvas id="tradeScoreChart" style="max-height: 250px;"></canvas>
            </div>
            
            <!-- Trading Activity Heatmap -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="color: #cbd5e1; font-size: 14px; font-weight: 600; margin-bottom: 16px;">Trading Activity</div>
                <div style="color: #94a3b8; font-size: 12px; margin-bottom: 16px;">${stats.trades.length} trades in 2026</div>
                <div id="activityHeatmap" style="overflow-x: auto;"></div>
            </div>
        </div>
        
        <!-- BOTTOM STATS -->
        <div class="dashboard-bottom-stats" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
            <div class="dashboard-card">
                <div style="font-size: 28px; font-weight: 700; color: #a855f7;">${uniqueTradingDays}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Trading Days</div>
            </div>
            <div class="dashboard-card">
                <div style="font-size: 28px; font-weight: 700; color: #10b981;">${maxConsecutiveWins}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Current Streak</div>
            </div>
            <div class="dashboard-card">
                <div style="font-size: 28px; font-weight: 700; color: #f87171;">${maxConsecutiveLosses}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Longest Streak</div>
            </div>
            <div class="dashboard-card">
                <div style="font-size: 28px; font-weight: 700; color: ${stats.totalPnL >= 0 ? '#10b981' : '#f87171'};">€${stats.totalPnL.toFixed(0)}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Total P&L</div>
            </div>
        </div>
    `;
    
    // Render Charts + Heatmap
    setTimeout(() => {
        renderDashboardCharts(trades, stats);
        renderActivityHeatmap(trades);
    }, 50);
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
    
    const status = tradeScore >= 75 ? 'Excellent' : tradeScore >= 50 ? 'Good' : tradeScore >= 25 ? 'Fair' : 'Improving';
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
                labels: ['Win Rate', 'Consistency', 'Profit Factor', 'Trade Count', 'Risk/Reward'],
                datasets: [{
                    label: 'Performance',
                    data: [
                        Math.min(stats.winRate / 0.6 * 20, 20),
                        Math.min((Math.abs(stats.avgWin) / (Math.abs(stats.avgWin) + Math.abs(stats.avgLoss))) * 25, 25),
                        Math.min((stats.profitFactor / 2) * 25, 25),
                        Math.min((trades.length / 100) * 30, 30),
                        Math.min((stats.profitFactor / 2) * 20, 20)
                    ],
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    borderWidth: 2,
                    pointBackgroundColor: '#a855f7',
                    pointBorderColor: '#fff',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
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
                            color: '#64748b',
                            font: { size: 10, weight: 'normal' }
                        },
                        grid: { color: 'rgba(168, 85, 247, 0.1)' },
                        angleLines: { color: 'rgba(168, 85, 247, 0.1)' }
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
    const firstDay = new Date(`${currentYear}-${currentMonth}-01`);
    const startDayOfWeek = firstDay.getDay();
    
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
    
    const dayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    
    let html = `<div style="margin-bottom: 8px; color: #94a3b8; font-size: 11px;">${String(parseInt(currentMonth)).padStart(2, '0')}/2026 — ${daysInMonth} days</div>`;
    html += '<div style="display: flex; gap: 8px; flex-direction: column;">';
    
    // Day headers
    html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">';
    dayHeaders.forEach(h => {
        html += `<div style="text-align: center; color: #94a3b8; font-size: 9px; font-weight: 600; height: 16px;">${h}</div>`;
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
                const tradeCount = data ? (data.wins + data.losses) : '-';
                html += `<div title="${day.day}.${currentMonth}: ${tradeCount} trade(s)" style="width: 24px; height: 24px; background: ${color}; border-radius: 3px; font-size: 9px; display: flex; align-items: center; justify-content: center; color: #cbd5e1; border: 1px solid rgba(168, 85, 247, 0.2); cursor: pointer; font-weight: 500; transition: all 0.2s ease;" onmouseover="this.style.borderColor='rgba(168, 85, 247, 0.6)'; this.style.transform='scale(1.15)';" onmouseout="this.style.borderColor='rgba(168, 85, 247, 0.2)'; this.style.transform='scale(1)';">${day.day}</div>`;
            }
        });
        html += '</div>';
    });
    
    html += '</div>';
    container.innerHTML = html;
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
    
    // Calculate Sharpe Ratio (simplified)
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.length > 0 ? returns.reduce((a,b) => a+b) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev).toFixed(2) : 0;
    
    // Calculate Max Drawdown
    let maxDD = 0;
    let peak = 0;
    let cumPnL = 0;
    trades.forEach(t => {
        cumPnL += t.pnl;
        if (cumPnL > peak) peak = cumPnL;
        const dd = peak - cumPnL;
        if (dd > maxDD) maxDD = dd;
    });
    
    // Behavioral Score (mock data - in real app would be calculated from trade patterns)
    const behavioralScore = {
        discipline: Math.min(100, stats.winRate * 1.5),
        psychology: Math.min(100, Math.abs(avgWin) / (Math.abs(avgWin) + Math.abs(avgLoss)) * 100),
        riskMgmt: Math.min(100, stats.profitFactor * 30),
        strategy: Math.min(100, stats.winRate * 1.2),
        timing: Math.min(100, stats.expectancy / 10 + 50),
        consistency: Math.min(100, (1 - (stdDev / Math.abs(avgReturn + 1))) * 100)
    };
    
    const analyticsContent = document.getElementById('analytics');
    analyticsContent.innerHTML = `
        <div style="margin-bottom: 40px;">
            <h2 style="margin-bottom: 8px;">Analytics</h2>
            <p style="color: #94a3b8; font-size: 14px;">Deep dive into your trading performance</p>
        </div>
        
        <!-- ===== FILTER BUTTONS ===== -->
        <div class="trades-filter" style="margin-bottom: 40px;">
            <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Alle Trades</button>
            <button class="filter-btn ${currentFilter === 'leverage' ? 'active' : ''}" data-filter="leverage">Nur Hebel</button>
            <button class="filter-btn ${currentFilter === 'normal' ? 'active' : ''}" data-filter="normal">Nur Normal</button>
        </div>
        
        <!-- TOP 4 KEY METRICS -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px;">
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Win Rate</div>
                    <div style="font-size: 11px; background: rgba(168, 85, 247, 0.2); color: #d8b4fe; padding: 4px 8px; border-radius: 4px;">Key Metric</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">${stats.winRate}%</div>
                <div style="font-size: 12px; color: #94a3b8;">${wins.length}W / ${losses.length}L</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Profit Factor</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">${stats.profitFactor}</div>
                <div style="font-size: 12px; color: #fbbf24;">Excellent</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Expectancy</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: #10b981; margin-bottom: 8px;">€${stats.expectancy.toFixed(2)}</div>
                <div style="font-size: 12px; color: #94a3b8;">Per trade average</div>
            </div>
            
            <div class="analytics-metric-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Total P&L</div>
                </div>
                <div style="font-size: 32px; font-weight: 700; color: ${stats.totalPnL >= 0 ? '#10b981' : '#f87171'}; margin-bottom: 8px;">€${stats.totalPnL.toFixed(2)}</div>
                <div style="font-size: 12px; color: #94a3b8;">${trades.length} trades</div>
            </div>
        </div>
        
        <!-- 5 SECONDARY METRICS -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; margin-bottom: 40px;">
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Avg Win</div>
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">€${avgWin.toFixed(2)}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Avg Loss</div>
                <div style="font-size: 24px; font-weight: 700; color: #f87171;">-€${Math.abs(avgLoss).toFixed(2)}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Largest Win</div>
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">€${largestWin.toFixed(2)}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Largest Loss</div>
                <div style="font-size: 24px; font-weight: 700; color: #f87171;">-€${largestLoss.toFixed(2)}</div>
            </div>
            <div class="analytics-metric-card-small">
                <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Avg R:R</div>
                <div style="font-size: 24px; font-weight: 700; color: #cbd5e1;">${stats.riskRewardRatio || '0.00:1'}</div>
            </div>
        </div>
        
        <!-- CHARTS GRID - 2 COLUMNS -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px;">
            <!-- LEFT: Equity Curve -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 14px; font-weight: 600; color: #cbd5e1;">EQUITY CURVE</div>
                    <div style="display: flex; gap: 12px; font-size: 11px;">
                        <span style="color: #cbd5e1; padding: 4px 8px; background: rgba(168, 85, 247, 0.2); border-radius: 4px; cursor: pointer;">Portfolio</span>
                        <span style="color: #94a3b8; cursor: pointer;">Benchmark</span>
                    </div>
                </div>
                <p style="color: #94a3b8; font-size: 12px; margin-bottom: 16px;">Track your growth with live-updating equity curves that reveal your true edge over time.</p>
                <canvas id="equityChart" style="max-height: 250px;"></canvas>
            </div>
            
            <!-- RIGHT: Behavioral Score -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 14px; font-weight: 600; color: #10b981;">BEHAVIORAL SCORE</div>
                </div>
                <canvas id="behavioralChart" style="max-height: 250px; margin-bottom: 16px;"></canvas>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
                    <div style="text-align: center;">
                        <div style="color: #94a3b8; margin-bottom: 4px;">Win Rate</div>
                        <div style="font-size: 20px; font-weight: 700; color: #10b981;">${stats.winRate}%</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #94a3b8; margin-bottom: 4px;">Profit Factor</div>
                        <div style="font-size: 20px; font-weight: 700; color: #cbd5e1;">${stats.profitFactor}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #94a3b8; margin-bottom: 4px;">Avg R:R</div>
                        <div style="font-size: 20px; font-weight: 700; color: #cbd5e1;">1:2.1</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #94a3b8; margin-bottom: 4px;">Sharpe</div>
                        <div style="font-size: 20px; font-weight: 700; color: #cbd5e1;">${sharpeRatio}</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- BOTTOM GRID - 3 COLUMNS -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-bottom: 40px;">
            <!-- Trades Logged -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="font-size: 13px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 16px;">TRADES LOGGED</div>
                <div style="font-size: 48px; font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">${trades.length}+</div>
                <div style="font-size: 12px; color: #94a3b8;">metrics per trade</div>
            </div>
            
            <!-- Geographic Performance -->
            <div style="position: relative;">
                <!-- Blurred Background -->
                <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px; opacity: 0.4; pointer-events: none; filter: blur(3px); position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;">
                    <div style="font-size: 13px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 16px;">MARKET PERFORMANCE</div>
                    <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>London</span>
                            <span style="color: #10b981; font-weight: 600;">45%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(168, 85, 247, 0.2); border-radius: 2px; overflow: hidden;">
                            <div style="width: 45%; height: 100%; background: #10b981;"></div>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>New York</span>
                            <span style="color: #60a5fa; font-weight: 600;">32%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(168, 85, 247, 0.2); border-radius: 2px; overflow: hidden;">
                            <div style="width: 32%; height: 100%; background: #60a5fa;"></div>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #cbd5e1;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Asian</span>
                            <span style="color: #f59e0b; font-weight: 600;">23%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(168, 85, 247, 0.2); border-radius: 2px; overflow: hidden;">
                            <div style="width: 23%; height: 100%; background: #f59e0b;"></div>
                        </div>
                    </div>
                </div>
                
                <!-- Coming Soon Overlay (OUTSIDE blur!) -->
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 20, 35, 0.85); padding: 12px 20px; border-radius: 8px; color: #a855f7; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; z-index: 100; white-space: nowrap; border: 1.5px solid #a855f7; box-shadow: 0 0 12px rgba(168, 85, 247, 0.3);">Coming Soon</div>
            </div>
            
            <!-- Additional Stats -->
            <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px;">
                <div style="font-size: 13px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 16px;">KEY STATS</div>
                <div style="font-size: 12px; color: #cbd5e1; line-height: 2;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">Best Day</span>
                        <span style="color: #10b981; font-weight: 600;">+€${stats.totalPnL * 0.3 | 0}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">Avg Trade</span>
                        <span style="color: #cbd5e1; font-weight: 600;">+€${stats.expectancy.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">Max DD</span>
                        <span style="color: #f87171; font-weight: 600;">-${(maxDD / stats.totalPnL * 100 | 0)}%</span>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Win/Loss Donut -->
        <div class="dashboard-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px; margin-bottom: 40px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div style="font-size: 14px; font-weight: 600; color: #cbd5e1;">Win/Loss</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
                <canvas id="winLossChart"></canvas>
                <div style="display: flex; flex-direction: column; justify-content: center;">
                    <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="width: 12px; height: 12px; background: #10b981; border-radius: 2px;"></div>
                            <span style="color: #cbd5e1; font-size: 12px;">Wins</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="width: 12px; height: 12px; background: #f87171; border-radius: 2px;"></div>
                            <span style="color: #cbd5e1; font-size: 12px;">Losses</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Render charts
    setTimeout(() => {
        renderAnalyticsCharts(trades, stats, wins, losses, behavioralScore);
    }, 50);
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
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                scales: {
                    y: {
                        ticks: { color: '#94a3b8', font: { size: 10 } },
                        grid: { color: 'rgba(168, 85, 247, 0.1)' }
                    },
                    x: {
                        ticks: { color: '#94a3b8', font: { size: 9 } },
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
                labels: ['Discipline', 'Psychology', 'Risk Mgmt', 'Strategy', 'Timing', 'Consistency'],
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
                maintainAspectRatio: true,
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
                            color: '#64748b',
                            font: { size: 10 }
                        },
                        grid: { color: 'rgba(168, 85, 247, 0.1)' },
                        angleLines: { color: 'rgba(168, 85, 247, 0.1)' }
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
                    backgroundColor: ['#10b981', '#f87171'],
                    borderColor: '#0a0a15',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
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
    if (bestDayValue) bestDayValue.textContent = `${bestDay.rate}%`;
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
                    borderColor: equityData[equityData.length - 1] >= 0 ? '#10b981' : '#f87171',
                    backgroundColor: equityData[equityData.length - 1] >= 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(248, 113, 113, 0.05)',
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
                        ticks: { color: '#94a3b8', font: { size: 11 } },
                        grid: { color: 'rgba(168, 85, 247, 0.05)', drawBorder: false }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
    
    // Update equity current value
    const equityCurrentValue = document.getElementById('equityCurrentValue');
    if (equityCurrentValue && trades.length > 0) {
        equityCurrentValue.textContent = `€${equityData[equityData.length - 1].toFixed(2)}`;
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
                    backgroundColor: ['#10b981', '#f87171'],
                    borderColor: '#0a0a15',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1' } } }
            }
        });
    }
    
    // Win Rate by Day
    const dayWinRateContainer = document.getElementById('dayWinRateContainer');
    if (dayWinRateContainer) {
        dayWinRateContainer.innerHTML = winRateByDay.map(day => `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="color: #cbd5e1;">${day.day}</span>
                    <span style="color: #a78bfa; font-weight: 600;">${day.rate}% (${day.total})</span>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(168, 85, 247, 0.1); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${day.rate}%; height: 100%; background: linear-gradient(90deg, #a855f7, #ec4899);"></div>
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
                    <span class="trade-pnl ${trade.pnl >= 0 ? 'positive' : 'negative'}">€${trade.pnl.toFixed(2)} ${trade.pnl >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(1)}%</span>
                </div>
                <div class="trade-detail">
                    <span class="trade-detail-label">Entry / Exit</span>
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
function updatePortfolioSummary() {
    const positions = JSON.parse(localStorage.getItem('positions')) || [];
    
    // Berechne Statistiken
    const openCount = positions.length;
    const totalValue = positions.reduce((sum, pos) => sum + parseFloat(pos.size), 0);
    const avgSize = openCount > 0 ? totalValue / openCount : 0;
    const maxSize = openCount > 0 ? Math.max(...positions.map(p => parseFloat(p.size))) : 0;
    
    // Update DOM
    document.getElementById('portfolioOpenCount').textContent = openCount;
    document.getElementById('portfolioTotalValue').textContent = `€${totalValue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('portfolioAvgSize').textContent = `€${avgSize.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('portfolioMaxSize').textContent = `€${maxSize.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    // Render Chart
    renderPortfolioCompositionChart(positions);
}

function loadPositions() {
    const positions = JSON.parse(localStorage.getItem('positions')) || [];
    const container = document.getElementById('positionsContainer');
    
    if (positions.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8;">
                <p style="font-size: 14px;">Noch keine offenen Positionen. 🚀</p>
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
                        <div class="position-ticker">${escapeHtml(pos.ticker)}</div>
                        <div class="position-entry">Entry: €${parseFloat(pos.entry).toFixed(2)}</div>
                    </div>
                </div>
                
                <div class="position-details">
                    <div class="position-detail-row">
                        <span class="position-detail-label">Position Size:</span>
                        <span class="position-detail-value">€${parseFloat(pos.size).toFixed(2)}</span>
                    </div>
                    <div class="position-detail-row">
                        <span class="position-detail-label">Geöffnet:</span>
                        <span class="position-detail-value">${dateOpened}</span>
                    </div>
                </div>
                
                <div class="position-thesis">
                    <strong>These:</strong> ${escapeHtml(pos.thesis)}
                </div>
                
                ${pos.screenshot ? `
                    <div class="position-screenshot">
                        <img src="${pos.screenshot}" alt="Position Setup" onclick="openScreenshotModal(this.src)">
                    </div>
                ` : ''}
                
                <div class="position-actions">
                    <button class="position-close-btn" onclick="closePosition(${idx})">Position Schließen</button>
                    <button class="position-delete-btn" onclick="deletePosition(${idx})">Löschen</button>
                </div>
            </div>
        `;
    }).join('');
    
    updatePortfolioSummary();
    displayClosedPositions();
}

function addPosition(event) {
    event.preventDefault();
    
    try {
        const ticker = document.getElementById('positionsTicker').value.trim();
        const entry = document.getElementById('positionsEntry').value;
        const size = document.getElementById('positionsSize').value;
        const thesis = document.getElementById('positionsThesis').value.trim();
        
        if (!ticker || !entry || !size || !thesis) {
            showToast('❌ Alle Felder ausfüllen!', 'error');
            return;
        }
        
        const entryNum = parseFloat(entry);
        const sizeNum = parseFloat(size);
        
        // Entry 0 wuerde beim Schliessen eine Division durch null ausloesen
        if (isNaN(entryNum) || entryNum <= 0) {
            showToast('❌ Entry Price muss groesser als 0 sein!', 'error');
            return;
        }
        if (isNaN(sizeNum) || sizeNum <= 0) {
            showToast('❌ Position Size muss groesser als 0 sein!', 'error');
            return;
        }
        
        const position = {
            ticker: ticker.toUpperCase(),
            entry: entryNum,
            size: sizeNum,
            thesis,
            screenshot: positionsScreenshotData,
            dateOpened: new Date().toISOString()
        };
        
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        positions.push(position);
        localStorage.setItem('positions', JSON.stringify(positions));
        
        // Form zurücksetzen
        document.getElementById('positionsForm').reset();
        document.getElementById('positionsScreenshotPreview').innerHTML = '';
        positionsScreenshotData = null;
        
        loadPositions();
        showToast(`✅ Position ${ticker} geöffnet!`);
    } catch (error) {
        console.error('Fehler beim Öffnen der Position:', error);
        showToast('❌ Fehler beim Öffnen der Position!', 'error');
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
    
    modalTitle.textContent = '🗑️ Position löschen?';
    modalText.textContent = `${position.ticker} wird permanent gelöscht.`;
    confirmBtn.textContent = 'Ja, löschen';
    confirmBtn.onclick = () => confirmDeletePosition();
    
    deleteModal.style.display = 'flex';
}

function confirmDeletePosition() {
    if (positionToDelete !== null) {
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        const removedTicker = positions[positionToDelete].ticker;
        positions.splice(positionToDelete, 1);
        localStorage.setItem('positions', JSON.stringify(positions));
        
        document.getElementById('deleteModal').style.display = 'none';
        loadPositions();
        showToast(`✅ Position ${removedTicker} gelöscht!`);
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
    document.getElementById('modalPositionSize').textContent = `€${parseFloat(position.size).toFixed(2)}`;
    
    document.getElementById('closePositionModal').style.display = 'flex';
    document.getElementById('modalExitPrice').focus();
}

function confirmClosePositionModal() {
    
    if (positionToClose === null) return;
    
    const exitPriceInput = document.getElementById('modalExitPrice').value;
    const exitReason = document.getElementById('modalExitReason').value.trim();
    
    
    // Validierung
    if (!exitPriceInput || exitPriceInput === '') {
        showToast('❌ Exit Price erforderlich!', 'error');
        return;
    }
    
    const exitPrice = parseFloat(exitPriceInput);
    if (isNaN(exitPrice) || exitPrice <= 0) {
        showToast('❌ Exit Price muss eine Zahl > 0 sein!', 'error');
        return;
    }
    
    if (!exitReason) {
        showToast('❌ Grund zum Schließen erforderlich!', 'error');
        return;
    }
    
    try {
        const positions = JSON.parse(localStorage.getItem('positions')) || [];
        const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
        const position = positions[positionToClose];
        
        
        // Berechne P&L
        const shares = position.size / position.entry;
        const pnl = (exitPrice - position.entry) * shares;
        const pnlPercent = ((exitPrice - position.entry) / position.entry) * 100;
        
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
        
        
        // Lösche offene Position
        positions.splice(positionToClose, 1);
        localStorage.setItem('positions', JSON.stringify(positions));
        
        // Schließe Modal
        closeModal('closePositionModal');
        positionToClose = null;
        
        // Reload UI
        loadPositions();
        showToast(`✅ Position ${position.ticker} geschlossen! P&L: €${closedPosition.pnl.toFixed(2)}`);
    } catch (error) {
        console.error('Fehler:', error);
        showToast('❌ Fehler beim Schließen der Position!', 'error');
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}


function displayPositionsScreenshot(base64Data) {
    positionsScreenshotData = base64Data;
    const preview = document.getElementById('positionsScreenshotPreview');
    preview.innerHTML = `
        <img src="${base64Data}" alt="Position Setup" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.3); display: block; margin-top: 10px;">
        <button type="button" onclick="document.getElementById('positionsScreenshotInput').click()" style="margin-top: 10px; padding: 8px 16px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #cbd5e1; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Bild ändern</button>
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
        const pnlColor = pos.pnl >= 0 ? '#10b981' : '#f87171';
        const pnlSign = pos.pnl >= 0 ? '+' : '';
        
        return `
            <div class="position-card" style="border-left: 4px solid ${pnlColor};">
                <div class="position-header">
                    <div>
                        <div class="position-ticker">${escapeHtml(pos.ticker)}</div>
                        <div class="position-entry">Entry: €${parseFloat(pos.entry).toFixed(2)} → Exit: €${parseFloat(pos.exitPrice).toFixed(2)}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 18px; font-weight: 700; color: ${pnlColor};">${pnlSign}€${pos.pnl.toFixed(2)}</div>
                        <div style="font-size: 12px; color: ${pnlColor};">${pnlSign}${pos.pnlPercent.toFixed(2)}%</div>
                    </div>
                </div>
                
                <div class="position-details">
                    <div class="position-detail-row">
                        <span class="position-detail-label">Position:</span>
                        <span class="position-detail-value">€${parseFloat(pos.size).toFixed(2)}</span>
                    </div>
                    <div class="position-detail-row">
                        <span class="position-detail-label">Geschlossen:</span>
                        <span class="position-detail-value">${dateClosed}</span>
                    </div>
                </div>
                
                <div class="position-thesis">
                    <strong>These:</strong> ${escapeHtml(pos.thesis)}
                </div>
                
                <div class="position-thesis" style="margin-top: 12px; color: #cbd5e1; font-size: 13px; border-top: 1px solid rgba(168, 85, 247, 0.1); padding-top: 12px;">
                    <strong>Grund zum Schließen:</strong> ${escapeHtml(pos.exitReason)}
                </div>
                
                ${pos.screenshot ? `
                    <div class="position-screenshot">
                        <img src="${pos.screenshot}" alt="Position Setup" onclick="openScreenshotModal(this.src)">
                    </div>
                ` : ''}
                
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
    
    modalTitle.textContent = '🗑️ Geschlossene Position löschen?';
    modalText.textContent = `${position.ticker} wird permanent gelöscht.`;
    confirmBtn.textContent = 'Ja, löschen';
    confirmBtn.onclick = () => confirmDeleteClosedPosition();
    
    deleteModal.style.display = 'flex';
}

function confirmDeleteClosedPosition() {
    if (closedPositionToDelete !== null) {
        const closedPositions = JSON.parse(localStorage.getItem('closedPositions')) || [];
        const removedTicker = closedPositions[closedPositionToDelete].ticker;
        closedPositions.splice(closedPositionToDelete, 1);
        localStorage.setItem('closedPositions', JSON.stringify(closedPositions));
        
        document.getElementById('deleteModal').style.display = 'none';
        displayClosedPositions();
        showToast(`✅ Geschlossene Position ${removedTicker} gelöscht!`);
        closedPositionToDelete = null;
    }
}


function renderPortfolioCompositionChart(positions) {
    const barDiv = document.getElementById('portfolioStackedBar');
    const legendDiv = document.getElementById('portfolioCompositionLegend');
    
    if (!barDiv || !legendDiv || positions.length === 0) {
        barDiv.innerHTML = '<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 13px;">Noch keine Positionen</div>';
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
        '#a855f7', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', 
        '#fb7185', '#6366f1', '#14b8a6', '#f97316', '#8b5cf6',
        '#06b6d4', '#84cc16', '#ef4444', '#8855ff'
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
            title="${escapeHtml(pos.ticker)}: ${percentage.toFixed(1)}% (€${pos.size.toFixed(2)})"
            onmouseover="this.style.filter='brightness(1.2)'; this.style.flex='${percentage * 1.1}'"
            onmouseout="this.style.filter='brightness(1)'; this.style.flex='${percentage}'">
                ${percentage > 8 ? `<span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: 700; font-size: 12px; color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.5);">${percentage.toFixed(0)}%</span>` : ''}
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
                    <div style="font-weight: 700; font-size: 14px; color: #f1f5f9;">${escapeHtml(pos.ticker)}</div>
                </div>
                <div style="font-size: 16px; font-weight: 800; color: #f1f5f9; margin-bottom: 4px;">€${pos.size.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">${percentage.toFixed(1)}% des Portfolios</div>
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
            labels: ['Win Rate', 'Consistency', 'Profit Factor', 'Trade Count', 'Risk/Reward'],
            datasets: [{
                label: 'Performance Metrics',
                data: [
                    Math.min(stats.winRate / 0.6 * 20, 20),
                    Math.min((Math.abs(stats.avgWin) / (Math.abs(stats.avgWin) + Math.abs(stats.avgLoss))) * 25, 25),
                    Math.min((stats.profitFactor / 2) * 25, 25),
                    Math.min((stats.trades.length / 100) * 30, 30),
                    Math.min((stats.profitFactor / 2) * 20, 20)
                ],
                borderColor: '#a855f7',
                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                borderWidth: 2,
                pointBackgroundColor: '#a855f7',
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
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    grid: { color: 'rgba(168, 85, 247, 0.1)' }
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
            pnlColors.push(pnl >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(248,113,113,0.7)'); // Grün/Rot
            
            // Win-Rate Daten
            const winRate = parseFloat(stats.winRate);
            winRateData.push(winRate);
            winRateColors.push(winRate >= 50 ? 'rgba(168,85,247,0.7)' : 'rgba(248,113,113,0.7)'); // Purple/Rot
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
                    label: 'Total P&L (€)',
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
                        color: '#cbd5e1',
                        font: { size: 13, weight: '600' },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'rect'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 15, 30, 0.95)',
                    borderColor: 'rgba(168,85,247,0.4)',
                    borderWidth: 1,
                    titleColor: '#d8b4fe',
                    bodyColor: '#cbd5e1',
                    padding: 12,
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return 'P&L: €' + context.parsed.x.toFixed(2);
                            } else {
                                return 'Win-Rate: ' + context.parsed.x.toFixed(1) + '%';
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        callback: (value, index) => {
                            if (index % 2 === 0 || value === 0) return value;
                            return '';
                        }
                    },
                    grid: {
                        color: 'rgba(168,85,247,0.05)',
                        drawBorder: false
                    }
                },
                y: {
                    ticks: {
                        color: '#cbd5e1',
                        font: { size: 12, weight: '600' }
                    },
                    grid: {
                        color: 'rgba(168,85,247,0.05)',
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
}

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
        document.getElementById("totalPnLStat").textContent = "€ 0.00";
        document.getElementById("bestDayStat").textContent = "€ 0.00";
        document.getElementById("bestDayDateStat").textContent = "—";
        document.getElementById("worstDayStat").textContent = "€ 0.00";
        document.getElementById("worstDayDateStat").textContent = "—";
        document.getElementById("winningDaysStat").textContent = "0%";
        document.getElementById("losingDaysStat").textContent = "0%";
        document.getElementById("avgDailyPnLStat").textContent = "€ 0.00";
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

    updateElement("totalPnLStat", `€ ${totalPnL.toFixed(2)}`);
    updateElement("bestDayStat", `€ ${bestDayPnL.toFixed(2)}`);
    updateElement("bestDayDateStat", bestDayDate || "—");
    updateElement("worstDayStat", `€ ${worstDayPnL.toFixed(2)}`);
    updateElement("worstDayDateStat", worstDayDate || "—");
    updateElement("winningDaysStat", `${winningDaysPercent}%`);
    updateElement("losingDaysStat", `${losingDaysPercent}%`);
    updateElement("avgDailyPnLStat", `€ ${avgDailyPnL.toFixed(2)}`);
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
