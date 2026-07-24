// Der Werkzeugkasten (P2.2) — feste, direkt ausfuehrbare Handgriffe.
//
// Warum es diese Datei gibt: Hermes hat die gws-cli-Syntax wiederholt
// verhauen (vier dokumentierte Fehlversuche 19.-21.07., jedes Mal andere
// Argumentfehler) — ein Agent, der Kommandozeilen raet, ist fuer
// Standard-Aktionen die falsche Maschine. Hier steht jede Aktion als
// getestete Funktion mit fester Syntax. Kein Agent-Loop, keine Skills:
// Aufruf -> Ergebnis in 1-2 s.
//
// Freigabe-Regel (REGELN.md + Entscheidung 21.07.): Nach aussen nur mit
// Bestaetigung — AUSSER der Empfaenger steht auf der internen Whitelist
// (Lukas selbst, Jannik, weitere via INTERN_EMPFAENGER in .env).

const { execFile } = require("child_process");

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };

// gws-cli gmail send {to} {subject} [body] — Positionsargumente, exakt diese
// Reihenfolge. Genau die Syntax, an der Hermes wiederholt gescheitert ist.
function gws(args, timeoutMs = 25000) {
  return new Promise((ok, fehler) => {
    execFile("gws-cli", args, { env: GWS_ENV, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return fehler(new Error(String(stderr || err.message).slice(0, 300)));
      ok(String(stdout || ""));
    });
  });
}

// ------------------------------------------------------------- Kalender
//
// Termin eintragen — direkt statt ueber Hermes (Phase 4, 25.07.2026).
// Gemessen am 24.07.: "trag mir morgen 10 Uhr spazieren ein" ging an Hermes und
// brauchte 43,8 Sekunden. Derselbe Eintrag ueber gws-cli dauert etwa eine.
// Nebeneffekt fuer die Ehrlichkeit: Wenn der Termin in einer Sekunde wirklich
// steht, darf Alexandra auch "steht" sagen — vorher musste sie 44 Sekunden lang
// in der Absicht sprechen, weil nichts bestaetigt war.
//
// Syntax laut gws-cli (am 25.07. am Server geprueft, nicht geraten):
//   gws-cli calendar create {summary} {start} {end} [--all-day] [-l ort] [-d text]
//   start/end: ISO 8601 mit Zeit, oder YYYY-MM-DD fuer ganztaegig.

// Sommerzeit grob: Ende Maerz bis Ende Oktober +02:00, sonst +01:00.
const berlinOffset = (d) => (d.getUTCMonth() > 2 && d.getUTCMonth() < 10 ? "+02:00" : "+01:00");

// Zeitangabe des Modells auf das bringen, was gws-cli erwartet. Robust, weil
// Modelle die Zeitzone gern weglassen: "2026-07-26T10:00" -> "...T10:00:00+02:00".
function zeitNormal(wert, { ganztags = false } = {}) {
  const s = String(wert || "").trim();
  if (!s) return null;
  const nurTag = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (nurTag) return nurTag[1];                       // ganztaegig
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (ganztags) return m[1];
  const [, tag, std, min, sek, zone] = m;
  if (zone) return `${tag}T${std}:${min}:${sek || "00"}${zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`;
  return `${tag}T${std}:${min}:${sek || "00"}${berlinOffset(new Date(tag + "T12:00:00Z"))}`;
}

// Eine Stunde drauf — der uebliche Standard, wenn kein Ende genannt wurde.
function stundeSpaeter(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const neu = new Date(d.getTime() + 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${neu.getFullYear()}-${p(neu.getMonth() + 1)}-${p(neu.getDate())}T${p(neu.getHours())}:${p(neu.getMinutes())}:00${iso.slice(-6)}`;
}

async function terminEintragen({ titel, start, ende, ganztags = false, ort = "", beschreibung = "" }) {
  const name = String(titel || "").trim();
  if (!name) return { ok: false, grund: "kein Titel" };

  const von = zeitNormal(start, { ganztags });
  if (!von) return { ok: false, grund: "Startzeit nicht lesbar: " + String(start).slice(0, 40) };

  let bis = ende ? zeitNormal(ende, { ganztags }) : null;
  if (!bis) bis = ganztags ? von : stundeSpaeter(von);
  if (!bis) return { ok: false, grund: "Endzeit nicht bestimmbar" };

  const args = ["calendar", "create", name, von, bis];
  if (ganztags) args.push("--all-day");
  if (ort) args.push("-l", String(ort).slice(0, 200));
  if (beschreibung) args.push("-d", String(beschreibung).slice(0, 500));

  try {
    const out = await gws(args, 20000);
    return { ok: true, titel: name, start: von, ende: bis, ganztags, roh: out.slice(0, 300) };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 200) };
  }
}

// Interne Empfaenger: Versand ohne Rueckfrage erlaubt.
function internAdressen() {
  return (process.env.INTERN_EMPFAENGER ||
    "lukas.sehorz@hotmail.com,lukas.sehorz@flowstate-ai.net")
    .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

function istIntern(mail) {
  return internAdressen().includes(String(mail || "").toLowerCase().trim());
}

// Harter Riegel (REGELN.md §Freigabe): An EXTERNE Empfaenger wird nur mit
// ausdruecklicher Freigabe gesendet. Auch wenn ein Bug in der Weiche eine
// externe Mail durchreicht, kann sie hier nicht ungefragt rausgehen —
// Defense in Depth, nicht nur Vertrauen auf die Prompt-Logik.
async function mailSenden({ an, betreff, body }, { freigegeben = false } = {}) {
  if (!an || !betreff) throw new Error("mailSenden: Empfaenger und Betreff sind Pflicht.");
  if (!istIntern(an) && !freigegeben) {
    return { ok: false, gesperrt: true, an,
      grund: "Externer Empfaenger — braucht Freigabe (nicht auf der internen Whitelist)." };
  }
  const out = await gws(["gmail", "send", an, betreff, body || ""]);
  return { ok: true, an, betreff, raw: out.slice(0, 200) };
}

// --- Wetter: fester Handgriff statt Websuche --------------------------------
//
// Warum eigenes Werkzeug (gemessen 22.07.): Wetter ueber Sonnet+Websuche
// schwankte 10-33 s (das Modell suchte 4-5 mal, max_uses griff nicht). Wetter
// ist aber die haeufigste Sprachassistent-Frage und muss sofort da sein.
// open-meteo liefert es deterministisch in <1 s — kostenlos, ohne Schluessel.
// Standardort Dorfen ist fest hinterlegt (spart den Geocoding-Aufruf); andere
// Staedte werden bei Bedarf geokodiert.
const WMO = {
  0: "klar", 1: "meist klar", 2: "teils bewoelkt", 3: "bewoelkt",
  45: "neblig", 48: "Reifnebel", 51: "leichter Niesel", 53: "Niesel", 55: "starker Niesel",
  61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefrierender Regen", 67: "gefrierender Regen",
  71: "leichter Schnee", 73: "Schnee", 75: "starker Schnee", 77: "Schneegriesel",
  80: "Schauer", 81: "Schauer", 82: "kraeftige Schauer", 85: "Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "schweres Gewitter",
};

async function holen(url, timeoutMs = 4000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("Wetter-API " + r.status);
  return r.json();
}

async function koordinaten(ort) {
  const standard = (process.env.STANDORT_ORT || "Dorfen").split(",")[0].trim().toLowerCase();
  if (!ort || ort.trim().toLowerCase() === standard) {
    return { lat: 48.2667, lon: 12.1667, name: "Dorfen" }; // fest: spart Geocoding
  }
  const g = await holen("https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=" +
    encodeURIComponent(ort.trim()));
  const t = g.results?.[0];
  if (!t) throw new Error("Ort nicht gefunden: " + ort);
  return { lat: t.latitude, lon: t.longitude, name: t.name };
}

// tag: 0 = heute, 1 = morgen. Liefert einen fertigen Sprechsatz.
async function wetter(ort, tag = 1) {
  const k = await koordinaten(ort);
  const d = await holen("https://api.open-meteo.com/v1/forecast?timezone=Europe%2FBerlin&forecast_days=3" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&latitude=" + k.lat + "&longitude=" + k.lon);
  const i = Math.max(0, Math.min(2, tag));
  const code = d.daily.weather_code[i];
  const tmax = Math.round(d.daily.temperature_2m_max[i]);
  const tmin = Math.round(d.daily.temperature_2m_min[i]);
  const regen = d.daily.precipitation_probability_max?.[i];
  const wann = i === 0 ? "Heute" : i === 1 ? "Morgen" : "Uebermorgen";
  const lage = WMO[code] || "wechselhaft";
  let satz = `${wann} in ${k.name}: ${lage}, ${tmin} bis ${tmax} Grad`;
  if (typeof regen === "number") {
    satz += regen >= 50 ? `, Regen wahrscheinlich (${regen} Prozent)` :
      regen >= 20 ? `, geringe Regenchance` : `, trocken`;
  }
  return { ok: true, reply: satz + "." };
}

// --- Mails pruefen: fester Handgriff statt "checke ich gerade" ins Leere -----
//
// Warum eigenes Werkzeug (Testfund 22.07.): Die Schnellspur versprach "Mails
// checke ich dir gerade", hatte aber gar keinen Zugang — der vorgehaltene
// Zustand kennt nur Kalender und CRM. Nur Hermes konnte Mails lesen (langsam).
// Hier liest die Schnellspur den Posteingang direkt (gws-cli, gleiche Huelle
// wie der Kalender) und fasst ihn fuers Sprechen zusammen — in Sekunden.

function nurName(from) {
  return String(from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim() || "jemand";
}

function envelopeDaten(out) {
  // gws-cli verpackt externe Inhalte: { messages: { data: "<JSON-String>" } }.
  const o = JSON.parse(out);
  const roh = o?.messages?.data ?? o?.data ?? o?.events?.data ?? "[]";
  const liste = typeof roh === "string" ? JSON.parse(roh) : roh;
  return Array.isArray(liste) ? liste : [];
}

// stundenFenster: Zahl -> nur Mails der letzten N Stunden; null -> heute (1 Tag).
async function mailsPruefen({ stundenFenster = null, max = 12 } = {}) {
  const out = await gws(["gmail", "search", "in:inbox newer_than:1d", "--max", String(max)]);
  let liste = [];
  try { liste = envelopeDaten(out); } catch { liste = []; }

  const jetzt = Date.now();
  const sauber = liste.filter((m) => {
    const from = String(m.from || "").toLowerCase();
    const subj = String(m.subject || "").toLowerCase();
    // Rauschen raus: Zustellfehler, Google-Sicherheitsroutine, eigene Testmails.
    if (from.includes("mailer-daemon") || subj.includes("delivery status notification")) return false;
    if (subj === "test" && istIntern((from.match(/<([^>]+)>/) || [])[1] || from)) return false;
    if (stundenFenster) {
      const ts = Date.parse(m.date);
      if (!Number.isNaN(ts) && (jetzt - ts) > stundenFenster * 3600 * 1000) return false;
    }
    return true;
  });

  const wann = stundenFenster
    ? `in den letzten ${zahlWort(stundenFenster)} Stunden`
    : "heute";
  const n = sauber.length;
  if (!n) return { ok: true, anzahl: 0, reply: `Keine neuen Mails ${wann}.` };

  const top = sauber.slice(0, 3).map((m) => ({ name: nurName(m.from), betreff: String(m.subject || "").trim() }));
  let satz;
  if (n === 1) {
    satz = `Eine neue Mail ${wann}, von ${top[0].name}` + (top[0].betreff ? `: ${top[0].betreff}.` : ".");
  } else {
    const teile = top.map((t) => `von ${t.name}` + (t.betreff ? ` zu "${t.betreff}"` : ""));
    const rest = n > top.length ? `, und ${n - top.length} weitere` : "";
    satz = `${zahlWort(n)} neue Mails ${wann} — ${teile.join(", ")}${rest}.`;
  }
  return { ok: true, anzahl: n, reply: satz + " Soll ich zu einer was aufsetzen?" };
}

function zahlWort(n) {
  return ["null", "eine", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn"][n] || String(n);
}

module.exports = { mailSenden, mailsPruefen, istIntern, internAdressen, wetter, terminEintragen, zeitNormal, stundeSpaeter };
