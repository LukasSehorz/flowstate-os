// Termine LESEN direkt bei Google — ohne den Umweg ueber gws-cli.
//
// WARUM (20.08.2026): Ein Blick in den Kalender kostete 9 Sekunden. Nicht das
// Netz, nicht Google — das Werkzeug selbst: gws-cli ist ein Python-Programm,
// das bei jedem Aufruf neu startet, den Zugang entschluesselt und erst dann
// fragt. Gemessen: 9,1 s beim ersten Abruf, 9,4 s beim zweiten. Es wird also
// nicht schneller, wenn man es oefter tut.
//
// In einer Werbeaufnahme ist das der Unterschied zwischen "der Kalender geht
// auf" und "wir warten". Im Alltag ebenso: Wer zehn Sekunden auf seinen
// eigenen Kalender wartet, macht ihn seltener auf.
//
// GESCHRIEBEN wird weiterhin ueber gws-cli (lib/werkzeuge.js). Dort steckt die
// Zeitzonen- und Syntaxarbeit, die schon einmal teuer war; die wird nicht
// nebenbei nachgebaut. Nur das Lesen geht den kurzen Weg.
//
// DERSELBE ZUGANG wie lib/gmail-direkt.js: die Token-Datei von gws-cli. Es gibt
// keinen zweiten Login und keinen zweiten Schluessel — faellt gws-cli aus,
// faellt das hier genauso aus, und umgekehrt.

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GWS_TOKEN_DATEI
  || path.join(process.env.GWS_HOME || process.env.HOME || "/gws-home",
    ".config", "gws-cli", "token.json");

let zugang = { token: "", bis: 0 };

async function token() {
  if (zugang.token && Date.now() < zugang.bis - 60000) return zugang.token;
  let t;
  try { t = JSON.parse(fs.readFileSync(TOKEN, "utf-8")); }
  catch { throw new Error("Kein Google-Zugang hinterlegt"); }
  if (!t.refresh_token) throw new Error("Google-Zugang ohne Erneuerungsschluessel");
  const r = await fetch(t.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: t.client_id, client_secret: t.client_secret,
      refresh_token: t.refresh_token, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("Google verweigert die Erneuerung");
  zugang = { token: d.access_token, bis: Date.now() + (d.expires_in || 3600) * 1000 };
  return zugang.token;
}

// Google liefert ganztaegige Termine als { date }, alle anderen als
// { dateTime }. Der Rest des Hauses erwartet genau diese zwei Formen so, wie
// gws-cli sie geliefert hat — also hier gleich in dieselbe Form bringen.
function umformen(e) {
  const start = e.start || {}, ende = e.end || {};
  return {
    id: e.id,
    summary: e.summary || "",
    titel: e.summary || "",
    start: start.dateTime || start.date || "",
    end: ende.dateTime || ende.date || "",
    location: e.location || "",
    description: e.description || "",
    status: e.status || "confirmed",
    html_link: e.htmlLink || "",
  };
}

// vonISO/bisISO sind vollstaendige Zeitpunkte mit Zonenangabe — dieselben, die
// lib/kalender.js auch an gws-cli uebergeben haette.
async function termine(vonISO, bisISO, max = 200, kalenderId) {
  const kal = kalenderId || process.env.KALENDER_ID || "primary";
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/"
    + encodeURIComponent(kal) + "/events");
  u.searchParams.set("timeMin", vonISO);
  u.searchParams.set("timeMax", bisISO);
  u.searchParams.set("singleEvents", "true");      // Serien aufgeloest, wie gws-cli
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", String(Math.min(2500, Math.max(1, max))));

  const r = await fetch(u, {
    headers: { authorization: "Bearer " + (await token()) },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Kalender " + r.status + " " + (await r.text()).slice(0, 120));
  const d = await r.json();
  return (d.items || []).map(umformen);
}

// Ohne Token-Datei gibt es diesen Weg nicht — dann bleibt gws-cli.
const bereit = () => { try { return fs.existsSync(TOKEN); } catch { return false; } };

module.exports = { termine, bereit };
