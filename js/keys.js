/* =========================================================================
   CAPITALFLOW — ZUGANGSSCHLÜSSEL
   =========================================================================

   Hier stehen NUR die Hashes der gültigen Keys, niemals die Keys selbst.
   Aus einem SHA-256-Hash lässt sich der Key nicht zurückrechnen — wer in
   den Quelltext schaut, findet also keinen brauchbaren Zugang.

   NEUEN NUTZER AUFNEHMEN:
     1. Als Admin einloggen, Namen eintragen, "Generate Key" klicken
     2. Der erzeugte Eintrag erscheint fertig formatiert im Admin-Panel
     3. Zeile hier unten in AUTHORIZED_KEYS einfügen
     4. Datei speichern, committen, pushen
     5. Den Key selbst an die Person weitergeben — er steht nirgends sonst

   WICHTIG: Der Key wird nur EINMAL angezeigt. Geht er verloren, muss ein
   neuer erzeugt werden.

   ZUGANG ENTZIEHEN: Zeile löschen, pushen. Fertig.
   ========================================================================= */

const AUTHORIZED_KEYS = [
    { name: "Maxim (ADMIN)", hash: "990af5f50276579416815ec4daa73a2d217629b263ec9a4166defd376cb53d01", added: "2026-09-20" },
    { name: "Marcel",        hash: "dd809c64c663ae01397de23881bca979b4f50f3985bc296dc00b6118c7956044", added: "2026-09-20" },
    { name: "Etienne",       hash: "8809ca7ba548a44fdb6c63f52ad7bc640beb90388110e7c1ef44d9a51d6db251", added: "2026-09-20" },
    { name: "Matteo",        hash: "40145725e617362ba3e931e2d9c2eec674c374e003ac8c7d9180b112095183fa", added: "2026-09-20" },
    { name: "Matthis",       hash: "9f32d1fa366d5c4e05b77ac43d98297fd24ea3b90e45cdbbc7fdda25ce172551", added: "2026-09-20" },
];

// Hash des Admin-Keys. Zum Ändern: als Admin einloggen und im Panel
// den Punkt "Admin-Key ändern" nutzen.
const ADMIN_KEY_HASH =
    "5635661c38574e16348d7d64c462dddc5b277f2ecc51419a17462e2c1bab7c11";
