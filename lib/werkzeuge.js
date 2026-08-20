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
const probemodus = require("./probemodus.js");
const { kalenderArgs } = require("./kalender-id.js");

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
//
// ACHTUNG, hier steckte ein Fehler (25.07., im Protokoll belegt): Die erste
// Fassung rechnete mit new Date(), las die Uhrzeit dann mit getHours() — also in
// der Zeitzone des PROZESSES — und schrieb anschliessend den Versatz des
// Eingabewerts (+02:00) darauf. Im Container (UTC) wurde die Zeitzone damit
// doppelt abgezogen: aus Start 14:00 wurde Ende 13:00, und Google lehnte den
// Termin ab ("Command failed"). Lokal fiel es nicht auf, weil der Entwickler-
// rechner auf Berliner Zeit laeuft und beides zufaellig zusammenpasste.
//
// Deshalb jetzt reine Wandzeit-Rechnung: Die Bestandteile werden aus dem String
// gelesen, ueber Date.UTC verrechnet (nur damit der Monats-/Tageswechsel stimmt)
// und mit UTC-Gettern zurueckgeschrieben. Der Versatz bleibt unveraendert
// stehen. Das Ergebnis ist unabhaengig von der Zeitzone des Servers.
function stundeSpaeter(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/);
  if (!m) return null;
  const [, jahr, monat, tag, std, min, sek, versatz] = m;
  const t = Date.UTC(+jahr, +monat - 1, +tag, +std, +min, +sek) + 3600000;
  const n = new Date(t);
  const p = (v) => String(v).padStart(2, "0");
  return `${n.getUTCFullYear()}-${p(n.getUTCMonth() + 1)}-${p(n.getUTCDate())}` +
    `T${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())}${versatz}`;
}

async function terminEintragen({ titel, start, ende, ganztags = false, ort = "", beschreibung = "" }) {
  const name = String(titel || "").trim();
  if (!name) return { ok: false, grund: "kein Titel" };

  const von = zeitNormal(start, { ganztags });
  if (!von) return { ok: false, grund: "Startzeit nicht lesbar: " + String(start).slice(0, 40) };

  let bis = ende ? zeitNormal(ende, { ganztags }) : null;
  if (!bis) bis = ganztags ? von : stundeSpaeter(von);
  if (!bis) return { ok: false, grund: "Endzeit nicht bestimmbar" };

  // Sicherung (nach dem Fehler vom 25.07.): Liegt das Ende vor dem Start, lehnt
  // Google den Termin ab — und man sieht dem Fehler nicht an, woran es lag.
  // Lieber hier abfangen und einen verstaendlichen Grund melden. Faengt auch
  // ab, wenn das Modell selbst eine unsinnige Endzeit vorschlaegt.
  if (!ganztags && Date.parse(bis) <= Date.parse(von)) {
    const nach = stundeSpaeter(von);
    if (nach && Date.parse(nach) > Date.parse(von)) bis = nach;
    else return { ok: false, grund: `Endzeit (${bis}) liegt nicht nach dem Start (${von})` };
  }

  const args = ["calendar", "create", name, von, bis];
  if (ganztags) args.push("--all-day");
  if (ort) args.push("-l", String(ort).slice(0, 200));
  if (beschreibung) args.push("-d", String(beschreibung).slice(0, 500));
  args.push(...kalenderArgs());

  try {
    const out = await gws(args, 20000);
    // Die Kennung des neuen Termins mitgeben (20.08.2026). Ohne sie kann der
    // Aufrufer den Eintrag nicht in den STAND legen, und terminFinden() —
    // das ausschliesslich aus dem STAND liest und auf .id filtert — findet
    // ihn im naechsten Zug nicht.
    //
    // Genau daran ist die Drehbuchszene gescheitert: eintragen klappte,
    // zwei Sekunden spaeter absagen antwortete "Ich finde keinen Termin".
    // Neu einzulesen half nicht: zustand.bauen(["kalender"]) braucht im
    // Container 8,7 s, der Deckel an der Fundstelle liegt bei 2,5.
    // gws-cli nennt das Feld "event_id", nicht "id" — nachgemessen an der
    // echten Antwort am 20.08.:
    //   { "status": "success", "operation": "calendar.create",
    //     "event_id": "s9fbflf1pce8ckjvpc4074epes", "summary": "…" }
    //
    // Meine erste Fassung suchte nur nach "id". Der Regex /"id"\s*:/ trifft
    // "event_id" NICHT, weil davor kein Anfuehrungszeichen steht. Also blieb
    // id leer, der Eintrag in den STAND unterblieb (er haengt an `erg.id`),
    // und die Drehbuchszene scheiterte weiter mit "Ich finde keinen Termin" —
    // obwohl der Termin im Kalender stand. Ein falscher Feldname, drei
    // Stunden Fehlersuche.
    let id = "";
    try {
      const j = JSON.parse(out);
      id = j.event_id || j.id || j.data?.event_id || j.data?.id || "";
    } catch {
      id = (out.match(/"event_id"\s*:\s*"([^"]+)"/) || out.match(/"id"\s*:\s*"([^"]+)"/) || [])[1] || "";
    }
    return { ok: true, id, titel: name, start: von, ende: bis, ganztags, roh: out.slice(0, 300) };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 200) };
  }
}

// Termin verschieben/aendern. Syntax am 25.07. am Server geprueft:
//   gws-cli calendar update {event_id} [-s titel] [--start ...] [--end ...] [-l ort]
async function terminAendern({ id, start, ende, titel, ort }) {
  if (!id) return { ok: false, grund: "keine Termin-ID" };
  const args = ["calendar", "update", String(id)];
  if (titel) args.push("-s", String(titel).slice(0, 200));
  if (start) {
    const von = zeitNormal(start);
    if (!von) return { ok: false, grund: "Startzeit nicht lesbar: " + String(start).slice(0, 40) };
    args.push("--start", von);
    // Google verlangt ein Ende, das zum neuen Start passt — sonst bleibt das
    // alte stehen und der Termin waere ploetzlich Stunden lang oder negativ.
    const bis = ende ? zeitNormal(ende) : stundeSpaeter(von);
    if (bis) args.push("--end", bis);
  } else if (ende) {
    const bis = zeitNormal(ende);
    if (bis) args.push("--end", bis);
  }
  if (ort) args.push("-l", String(ort).slice(0, 200));
  // Die Pruefung auf "nichts zu aendern" zaehlt Argumente. Der Kalender darf
  // deshalb ERST DANACH angehaengt werden — sonst waere die Liste immer laenger
  // als drei, und ein Aufruf ohne jede Aenderung ginge stumm an Google.
  if (args.length === 3) return { ok: false, grund: "nichts zu aendern" };
  args.push(...kalenderArgs());

  try {
    const out = await gws(args, 20000);
    return { ok: true, id, start: start ? zeitNormal(start) : null, roh: out.slice(0, 300) };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 200) };
  }
}

// Termin absagen.  gws-cli calendar delete {event_id}
async function terminAbsagen({ id }) {
  if (!id) return { ok: false, grund: "keine Termin-ID" };
  try {
    const out = await gws(["calendar", "delete", String(id), ...kalenderArgs()], 20000);
    return { ok: true, id, roh: out.slice(0, 300) };
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
  // Probelauf (20.08.2026): Alles davor laeuft normal — nur der Versand nicht.
  // Sonst haette der Anzeigen-Testlauf mit seinen sechzig Szenarien sechzig
  // echte Mails ausgeloest. Siehe lib/probemodus.js.
  if (probemodus.aktiv()) {
    probemodus.notieren("mail", { an, betreff, body: String(body || "").slice(0, 800) });
    return { ok: true, probe: true, an, betreff, raw: "[Probemodus: nicht gesendet]" };
  }
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

// EINMAL NACHFASSEN (08.08.2026). Im Chat-Test stand statt des Wetters:
// "Das hat nicht geklappt: Wetter-API 503". Zwei Minuten spaeter lief derselbe
// Abruf in 140 ms durch — der Dienst hatte kurz gehustet.
//
// Ein freier Wetterdienst ist gelegentlich weg; das ist normal und kein Grund,
// Lukas eine Fehlermeldung vorzulesen. Ein zweiter Versuch nach einer halben
// Sekunde kostet nichts und faengt genau diesen Fall.
//
// Nur bei 5xx und Netzfehlern. Ein 400 bedeutet, dass die Anfrage falsch ist —
// die wird beim zweiten Mal genauso falsch sein, und Wiederholen verschleiert
// nur den eigenen Fehler.
async function holen(url, timeoutMs = 4000) {
  let letzter = null;
  for (let versuch = 0; versuch < 2; versuch++) {
    if (versuch) await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return r.json();
      letzter = new Error("Wetter-API " + r.status);
      if (r.status < 500) break;        // unsere Schuld, nicht ihre
    } catch (e) {
      letzter = e;                      // Zeitueberschreitung oder Netz weg
    }
  }
  throw letzter || new Error("Wetter-API nicht erreichbar");
}

async function koordinaten(ort) {
  const standard = (process.env.STANDORT_ORT || "Dorfen").split(",")[0].trim().toLowerCase();
  // OHNE ORTSANGABE GILT, WO LUKAS GERADE IST (07.08.2026). Vorher war das
  // fest Dorfen — er stand in Nizza und bekam das Wetter fuer Oberbayern,
  // beziehungsweise eine Rueckfrage. Die Koordinaten kommen direkt vom
  // Browser, es braucht also nicht einmal ein Geocoding.
  if (!ort) {
    try {
      const hier = require("./standort.js").aktuell();
      if (hier) return { lat: hier.lat, lon: hier.lon, name: hier.name || "deinem Standort" };
    } catch { /* dann eben der Standardort */ }
  }
  if (!ort || ort.trim().toLowerCase() === standard) {
    return { lat: 48.2667, lon: 12.1667, name: "Dorfen" }; // fest: spart Geocoding
  }
  const g = await holen("https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=" +
    encodeURIComponent(ort.trim()));
  const t = g.results?.[0];
  if (!t) throw new Error("Ort nicht gefunden: " + ort);
  return { lat: t.latitude, lon: t.longitude, name: t.name };
}

// Tageszeiten als Stundenfenster (von, bis) in Ortszeit.
//
// Warum es das braucht (Lukas, 27.07.): Er fragte "wie wird das Wetter in
// Landshut am Nachmittag" und bekam "18 bis 28 Grad" — die Spanne des ganzen
// Tages. Das war kein Fehler in der Antwort, sondern in der Abfrage: Es wurden
// nur die Tageswerte temperature_2m_max/min geholt, stuendliche Werte gab es
// gar nicht. "Nachmittag" konnte deshalb prinzipiell nicht funktionieren.
// Reihenfolge: das Genauere zuerst. Und "morgen" ist der TAG, "morgens" die
// Tageszeit — das s ist Pflicht, sonst wird aus "Wetter morgen" faelschlich
// "morgen frueh" (im ersten Entwurf genau so passiert).
const TAGESZEIT = [
  [/\bnachmittags?\b/i, 14, 18, "nachmittags"],
  [/\bvormittags?\b/i, 9, 12, "vormittags"],
  [/\b(fr(ue|ü)h|morgens|am morgen)\b/i, 6, 10, "in der Frueh"],
  [/\bmittags?\b/i, 11, 14, "mittags"],
  [/\b(abends?|feierabend)\b/i, 18, 22, "abends"],
  [/\bnachts?\b/i, 22, 24, "nachts"],
];

function tageszeitAus(text) {
  for (const [muster, von, bis, wort] of TAGESZEIT) {
    if (muster.test(String(text || ""))) return { von, bis, wort };
  }
  return null;
}

// Wettercode und Regenwahrscheinlichkeit sind zwei UNABHAENGIGE Werte der API.
// Frueher wurden sie stumpf aneinandergehaengt — am 26.07. kam dabei heraus:
// "Schauer, 20 bis 25 Grad, trocken." Beides stimmte fuer sich, die Kombination
// war Unsinn.
//
// Der Code nennt die vorherrschende Wetterart, die Wahrscheinlichkeit sagt, ob
// es ueberhaupt nass wird. Unter 20 Prozent regnet es praktisch nicht — dann
// darf "Schauer" nicht als Lage dastehen.
function lageSatzBauen(code, regen) {
  const lage = WMO[code] || "wechselhaft";
  const nass = code >= 51;              // ab Niesel aufwaerts ist Niederschlag
  if (typeof regen !== "number") return lage;
  if (regen >= 50) return `${lage}, Regen wahrscheinlich, ${regen} Prozent`;
  if (regen >= 20) return `${lage}, geringe Regenchance`;
  if (nass) return `ueberwiegend trocken, hoechstens vereinzelt ${lage}`;
  return `${lage} und trocken`;
}

// tag: 0 = heute, 1 = morgen. zeit: optionales Fenster aus tageszeitAus().
// Liefert einen fertigen Sprechsatz.
async function wetter(ort, tag = 1, zeit = null) {
  const k = await koordinaten(ort);
  const d = await holen("https://api.open-meteo.com/v1/forecast?timezone=Europe%2FBerlin&forecast_days=3" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&hourly=weather_code,temperature_2m,precipitation_probability" +
    "&latitude=" + k.lat + "&longitude=" + k.lon);
  const i = Math.max(0, Math.min(2, tag));

  // Nach einer Tageszeit gefragt? Dann nur deren Stunden auswerten.
  if (zeit && Array.isArray(d.hourly?.time)) {
    const von = i * 24 + zeit.von;
    const bis = i * 24 + zeit.bis;
    const temps = d.hourly.temperature_2m.slice(von, bis).filter((x) => typeof x === "number");
    const regens = d.hourly.precipitation_probability.slice(von, bis).filter((x) => typeof x === "number");
    const codes = d.hourly.weather_code.slice(von, bis).filter((x) => typeof x === "number");
    if (temps.length) {
      const tmin = Math.round(Math.min(...temps));
      const tmax = Math.round(Math.max(...temps));
      const regen = regens.length ? Math.max(...regens) : null;
      // Die vorherrschende Wetterart im Fenster: die haeufigste, bei Gleichstand
      // die unfreundlichere (hoeherer Code) — lieber Regen ankuendigen als
      // verschweigen.
      const zaehler = new Map();
      for (const c of codes) zaehler.set(c, (zaehler.get(c) || 0) + 1);
      const code = [...zaehler.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
      const wann = i === 0 ? "Heute" : i === 1 ? "Morgen" : "Uebermorgen";
      const spanne = tmax - tmin <= 2 ? `${tmax} Grad` : `${tmin} bis ${tmax} Grad`;
      return { ok: true, reply: `${wann} ${zeit.wort} in ${k.name}: ${lageSatzBauen(code, regen)}, ${spanne}.` };
    }
  }

  const code = d.daily.weather_code[i];
  const tmax = Math.round(d.daily.temperature_2m_max[i]);
  const tmin = Math.round(d.daily.temperature_2m_min[i]);
  const regen = d.daily.precipitation_probability_max?.[i];
  const wann = i === 0 ? "Heute" : i === 1 ? "Morgen" : "Uebermorgen";

  return { ok: true, reply: `${wann} in ${k.name}: ${lageSatzBauen(code, regen)}, ${tmin} bis ${tmax} Grad.` };
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

module.exports = { mailSenden, mailsPruefen, istIntern, internAdressen, wetter, tageszeitAus,
  terminEintragen, terminAendern, terminAbsagen, zeitNormal, stundeSpaeter };
