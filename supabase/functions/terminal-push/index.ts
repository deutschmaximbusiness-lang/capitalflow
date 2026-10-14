// CapitalFlow Krypto Terminal: Push bei neuer These
//
// Zwei Aufrufe (beide per POST aus terminal.js):
//   { aktion: "schluessel" }        -> oeffentlicher VAPID-Schluessel
//   { aktion: "senden", id: "..." } -> Benachrichtigung an alle VIP-Geraete
//
// "senden" darf nur der Admin. Geprueft wird mit seinem eigenen Login
// (ist_admin), danach liest die Funktion mit dem service_role-Schluessel.
// Den stellt Supabase hier selbst bereit - er steht in keiner Datei.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (z.B. mailto:deine@mail.de)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
  if (body.aktion !== "senden" || typeof body.id !== "string") {
    return antwort({ fehler: "Unbekannte Aktion" }, 400);
  }

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // 1. Ist der Aufrufer Admin? Mit seinem eigenen Login pruefen.
  const nutzer = createClient(URL_, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: istAdmin, error: adminFehler } = await nutzer.rpc("ist_admin");
  if (adminFehler || istAdmin !== true) return antwort({ fehler: "Nur für den Admin" }, 403);

  // 2. Beitrag und Empfaenger mit vollen Rechten lesen
  const db = createClient(URL_, SERVICE);
  const { data: post } = await db.from("terminal_posts")
    .select("id, art, coin, richtung, titel, text, bild_pfad, chart_url, tweet_url, created_at").eq("id", body.id).maybeSingle();
  if (!post) return antwort({ fehler: "Beitrag nicht gefunden" }, 404);

  const { data: abos } = await db.from("push_abos").select("endpoint, user_id, p256dh, auth");
  if (!abos || !abos.length) return antwort({ gesendet: 0 });

  const ids = [...new Set(abos.map((a: any) => a.user_id))];
  const { data: profile } = await db.from("profiles")
    .select("id, is_vip, is_admin, activated").in("id", ids);
  const erlaubt = new Set((profile || [])
    .filter((p: any) => p.activated && (p.is_vip || p.is_admin)).map((p: any) => p.id));

  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
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

  return antwort({ gesendet, entfernt: weg.length, fehler });
});
