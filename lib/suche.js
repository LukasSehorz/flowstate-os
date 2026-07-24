// lib/suche.js — Nachschlagen OHNE Modell-Umweg (Phase 4, 25.07.2026).
//
// Warum es diese Datei gibt: "Wer wurde letzte Saison Bundesliga-Meister?" lief
// ueber die Denk-Spur (Sonnet + serverseitige Websuche) und brach nach 40 s im
// Timeout ab — ohne jede Antwort. Gemessen am 25.07. um 00:38.
//
// Der Grund ist bauartbedingt: Bei der Modell-Websuche denkt das Modell, stellt
// eine Suche, wartet auf den Server, liest, sucht vielleicht nochmal, formuliert.
// Jede Runde kostet Sekunden. Fuer eine Faktenfrage ist das der falsche Weg.
//
// Hier laeuft es wie beim Wetter (werkzeuge.wetter): EIN direkter Abruf, unter
// einer Sekunde, kein Modell dazwischen. Das Modell kommt erst danach und macht
// aus dem gefundenen Text einen Satz — das ist die Aufgabenteilung aus dem
// Jarvis-Vorbild: schnelles Werkzeug vorn, Sprache hinten.
//
// Wikipedia deckt Faktenfragen ab (Personen, Orte, Ereignisse, Sport, Zahlen).
// Was es dort nicht gibt, geht weiter an die bisherige Denk-Spur — langsamer,
// aber vollstaendig. Kein Schluessel noetig, keine Anmeldung.

const WIKI = "https://de.wikipedia.org/w/api.php";
const KOPF = { "user-agent": "flowstate-os (Assistenz fuer Lukas Sehorz)" };

async function holen(url, timeoutMs = 4000) {
  const r = await fetch(url, { headers: KOPF, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Woerter, die fuer die Suche nichts beitragen. Ohne das sucht Wikipedia nach
// "kannst du mir sagen wer" und findet erwartungsgemaess Unsinn.
const FUELL = new Set([
  "kannst", "du", "mir", "mal", "bitte", "sagen", "sag", "weisst", "weiss", "wissen",
  "wer", "was", "wann", "wo", "wie", "warum", "wieso", "welche", "welcher", "welches",
  "ist", "war", "sind", "waren", "wurde", "wurden", "hat", "hatte", "haben", "habe",
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
  "und", "oder", "aber", "auch", "noch", "mal", "denn", "doch", "schon", "eigentlich",
  "in", "im", "am", "an", "auf", "bei", "fuer", "für", "von", "vom", "zu", "zum", "zur",
  "mit", "nach", "ueber", "über", "letzten", "letzte", "letzter", "aktuell", "aktuelle",
  "google", "recherchier", "recherchiere", "such", "suche", "nachschauen", "nachsehen",
]);

// Aus der Frage die tragenden Begriffe ziehen.
function begriffe(frage) {
  return String(frage)
    .replace(/[?!.,;:„“"'()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FUELL.has(w.toLowerCase()))
    .slice(0, 8);
}

// Aus einem langen Artikel die Saetze holen, die zur Frage passen. Ein
// Bundesliga-Artikel hat 15.000 Zeichen — die komplett ans Modell zu geben
// waere langsam und wuerde die Antwort verwaessern.
function passendeStellen(text, worte, max = 1400) {
  const saetze = String(text).split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 25);
  const klein = worte.map((w) => w.toLowerCase());
  const bewertet = saetze.map((s, i) => {
    const t = s.toLowerCase();
    let punkte = klein.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (i < 3) punkte += 0.5;          // die Einleitung beantwortet oft schon alles
    return { s, i, punkte };
  }).filter((x) => x.punkte > 0).sort((a, b) => b.punkte - a.punkte || a.i - b.i);

  const genommen = [];
  let laenge = 0;
  for (const x of bewertet.slice(0, 12).sort((a, b) => a.i - b.i)) {
    if (laenge + x.s.length > max) break;
    genommen.push(x.s.trim());
    laenge += x.s.length;
  }
  // Nichts getroffen? Dann wenigstens der Anfang des Artikels.
  return genommen.length ? genommen.join(" ") : saetze.slice(0, 4).join(" ").slice(0, max);
}

// Wikipedia nachschlagen. Liefert { ok, titel, text, quelle } oder { ok:false }.
async function wikipedia(frage, { timeoutMs = 4000 } = {}) {
  const worte = begriffe(frage);
  if (!worte.length) return { ok: false, grund: "keine Suchbegriffe" };

  const suche = await holen(
    `${WIKI}?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(worte.join(" "))}`,
    timeoutMs
  );
  const treffer = suche?.query?.search?.[0];
  if (!treffer) return { ok: false, grund: "kein Wikipedia-Treffer" };

  const seite = await holen(
    `${WIKI}?action=query&prop=extracts&explaintext&format=json&pageids=${treffer.pageid}`,
    timeoutMs
  );
  const roh = seite?.query?.pages?.[treffer.pageid]?.extract || "";
  if (roh.length < 120) return { ok: false, grund: "Artikel zu duenn" };

  return { ok: true, titel: treffer.title, quelle: "Wikipedia", text: passendeStellen(roh, worte) };
}

// Der Einstieg: schnell nachschlagen. Wirft nie — der Aufrufer entscheidet,
// ob er auf die langsame, aber vollstaendige Denk-Spur ausweicht.
async function schnellNachschlagen(frage, { timeoutMs = 4000 } = {}) {
  const start = Date.now();
  try {
    const w = await wikipedia(frage, { timeoutMs });
    return { ...w, dauerMs: Date.now() - start };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 120), dauerMs: Date.now() - start };
  }
}

module.exports = { schnellNachschlagen, wikipedia, begriffe, passendeStellen };
