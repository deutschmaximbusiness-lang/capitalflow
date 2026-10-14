// CapitalFlow Krypto Terminal: Push bei neuer These
//
// Drei Aufrufe (per POST):
//   { aktion: "schluessel" }        -> oeffentlicher VAPID-Schluessel
//   { aktion: "senden", id: "..." } -> These/X-Post an alle VIP-Geraete (nur Admin)
//   { aktion: "session" }           -> vom Zeitplan (pg_cron, alle 5 Min.):
//                                      Nachricht, wenn eine Session startet.
//                                      Erlaubt nur mit dem Geheimnis aus dem Vault.
//
// Deployen mit --no-verify-jwt: der Zeitplan hat kein Login. Die Pruefung
// passiert hier im Code (Admin-Login bzw. Geheimnis).
//
// "senden" darf nur der Admin. Geprueft wird mit seinem eigenen Login
// (ist_admin), danach liest die Funktion mit dem service_role-Schluessel.
// Den stellt Supabase hier selbst bereit - er steht in keiner Datei.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (z.B. mailto:deine@mail.de)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import "./sessions.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwort(daten: unknown, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const RICHTUNG: Record<string, string> = { long: "Long", short: "Short", neutral: "Neutral" };
const FARBE: Record<string, string> = { long: "🟢", short: "🔴", neutral: "⚪" };

// TradingView-Snapshot-Link -> direktes Bild (wie im Feed)
function tvBild(url: string | null) {
  const m = String(url || "").match(/^https:\/\/(?:www\.)?tradingview\.com\/x\/([A-Za-z0-9]{6,12})\/?/);
  return m ? "https://s3.tradingview.com/snapshots/" + m[1].charAt(0).toLowerCase() + "/" + m[1] + ".png" : null;
}

function kuerzen(t: string, n: number) {
  t = t.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

// Titel und Text der Benachrichtigung. Farbe kommt ueber das Emoji -
// mehr Gestaltung erlauben Windows, Android und iOS nicht.
export function nachricht(post: any) {
  if (post.art === "tweet") {
    const m = String(post.tweet_url || "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\//);
    return {
      titel: "𝕏  Neuer Post" + (m ? " von @" + m[1] : ""),
      text: post.text ? kuerzen(post.text, 160) : "Jetzt im CapitalFlow Terminal ansehen",
      knopf: "Post ansehen",
    };
  }
  const coin = post.coin && post.coin !== "ALLGEMEIN" ? post.coin : "";
  const richtung = RICHTUNG[post.richtung] || "";
  const kopf = [coin, post.richtung === "neutral" ? "" : richtung].filter(Boolean).join(" ");
  const zeichen = post.richtung && post.richtung !== "neutral" ? FARBE[post.richtung] : (coin ? "⚪" : "📈");
  const titel = zeichen + "  " + (kopf ? kopf + " · " : "") + "Neue These";
  let text = "";
  if (post.titel && post.text) text = kuerzen(post.titel, 90) + "\n" + kuerzen(post.text.split("\n")[0], 110);
  else text = kuerzen(post.titel || post.text || "Chart im Terminal ansehen", 180);
  return { titel, text, knopf: "These ansehen" };
}

// ---------------------------------------------------------- Sessions

const S = (globalThis as any).cfSessions;

function uhrBerlin(ms: number) {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

async function btcKurs() {
  try {
    const r = await fetch((Deno.env.get("BINANCE_URL") ?? "https://fapi.binance.com") + "/fapi/v1/ticker/24hr?symbol=BTCUSDT", { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const p = +j.lastPrice, v = +j.priceChangePercent;
    if (!(p > 0)) return "";
    return "BTC " + p.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " $ ("
      + (v >= 0 ? "+" : "") + v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " % in 24 h)";
  } catch { return ""; }
}

// Text einer Session-Nachricht. Zeiten in deutscher Zeit (die Nutzer
// sitzen in Deutschland). Ueberschneidung London/New York wird genannt.
export function sessionNachricht(g: any, jetzt: number, kurs: string) {
  const s = g.session;
  const teile = [s.name + " ist offen bis " + uhrBerlin(g.ende) + " Uhr."];
  if (s.id === "london") {
    const ny = S.termine(S.SESSIONS[2], g.start, g.ende)[0];
    if (ny) teile.push("New York kommt um " + uhrBerlin(ny.start) + " dazu.");
  }
  if (s.id === "newyork") {
    const lo = S.stand(jetzt)[1];
    if (lo.offen) teile.push("Überschneidung mit London bis " + uhrBerlin(lo.ende) + " Uhr.");
  }
  if (kurs) teile.push(kurs);
  return {
    titel: s.zeichen + "  " + s.name + "-Session gestartet",
    text: teile.join(" "),
    knopf: "Terminal öffnen",
  };
}

// ------------------------------------------------- Versand an alle VIPs

async function anAlle(db: any, inhalt: string, nurSessions: boolean) {
  let q = db.from("push_abos").select("endpoint, user_id, p256dh, auth");
  if (nurSessions) q = q.eq("sessions", true);
  const { data: abos } = await q;
  if (!abos || !abos.length) return { gesendet: 0, entfernt: 0, fehler: 0 };

  const ids = [...new Set(abos.map((a: any) => a.user_id))];
  const { data: profile } = await db.from("profiles")
    .select("id, is_vip, is_admin, activated").in("id", ids);
  const erlaubt = new Set((profile || [])
    .filter((p: any) => p.activated && (p.is_vip || p.is_admin)).map((p: any) => p.id));

  let gesendet = 0, fehler = 0;
  const weg: string[] = [];
  await Promise.all(abos.map(async (a: any) => {
    // Kein VIP mehr: Geraet austragen
    if (!erlaubt.has(a.user_id)) { weg.push(a.endpoint); return; }
    try {
      await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        inhalt,
        { TTL: 3600, urgency: "high" },
      );
      gesendet++;
    } catch (e: any) {
      // 404/410: Abo gibt es nicht mehr (Browser-Daten geloescht, App weg)
      if (e && (e.statusCode === 404 || e.statusCode === 410)) weg.push(a.endpoint);
      else { fehler++; console.error("Push fehlgeschlagen", e && (e.statusCode || e.message)); }
    }
  }));
  if (weg.length) await db.from("push_abos").delete().in("endpoint", weg);
  return { gesendet, entfernt: weg.length, fehler };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST" }, 405);

  const PUBLIC = Deno.env.get("VAPID_PUBLIC");
  const PRIVATE = Deno.env.get("VAPID_PRIVATE");
  const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!PUBLIC || !PRIVATE) return antwort({ fehler: "VAPID-Schlüssel fehlen in den Secrets" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* leer */ }

  if (body.aktion === "schluessel") return antwort({ schluessel: PUBLIC });

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(URL_, SERVICE);
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);

  // ---- Zeitplan: Session-Start
  if (body.aktion === "session") {
    const geheim = req.headers.get("x-cron-secret") || "";
    const { data: ok } = await db.rpc("terminal_cron_ok", { p: geheim });
    if (ok !== true) return antwort({ fehler: "Nicht erlaubt" }, 403);
    const jetzt = typeof body.jetzt === "number" && body.test === true ? body.jetzt : Date.now();
    // Fenster 10 Min.: der Zeitplan laeuft alle 5 Min., einer darf ausfallen
    const faellig = S.gestartet(jetzt, 10 * 60000);
    const ergebnis: any[] = [];
    for (const g of faellig) {
      // Nur einmal pro Session und Tag - der Primaerschluessel entscheidet
      const { error: doppelt } = await db.from("terminal_session_log").insert({ tag: g.tag, session: g.session.id });
      if (doppelt) { ergebnis.push({ session: g.session.id, schon: true }); continue; }
      const n = sessionNachricht(g, jetzt, await btcKurs());
      const inhalt = JSON.stringify({ ...n, id: "session-" + g.session.id + "-" + g.tag, url: "terminal.html" });
      ergebnis.push({ session: g.session.id, ...(await anAlle(db, inhalt, true)) });
    }
    return antwort({ sessions: ergebnis });
  }

  if (body.aktion !== "senden" || typeof body.id !== "string") {
    return antwort({ fehler: "Unbekannte Aktion" }, 400);
  }

  // ---- These/X-Post: nur der Admin. Mit seinem eigenen Login pruefen.
  const nutzer = createClient(URL_, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: istAdmin, error: adminFehler } = await nutzer.rpc("ist_admin");
  if (adminFehler || istAdmin !== true) return antwort({ fehler: "Nur für den Admin" }, 403);

  const { data: post } = await db.from("terminal_posts")
    .select("id, art, coin, richtung, titel, text, bild_pfad, chart_url, tweet_url, created_at").eq("id", body.id).maybeSingle();
  if (!post) return antwort({ fehler: "Beitrag nicht gefunden" }, 404);

  const n = nachricht(post);
  // Grosses Vorschaubild: hochgeladenes Bild (signierter Link, 7 Tage)
  // oder der TradingView-Chart. iPhones zeigen es nicht an.
  let bild = tvBild(post.chart_url);
  if (post.bild_pfad) {
    const { data: s } = await db.storage.from("terminal").createSignedUrl(post.bild_pfad, 7 * 24 * 3600);
    if (s && s.signedUrl) bild = s.signedUrl;
  }
  const inhalt = JSON.stringify({
    ...n, id: post.id, bild, zeit: Date.parse(post.created_at) || Date.now(),
    url: "terminal.html#post-" + post.id,
  });
  return antwort(await anAlle(db, inhalt, false));
});
