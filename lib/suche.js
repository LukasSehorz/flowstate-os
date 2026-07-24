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

// ---------------------------------------------------------------- Google
//
// Ueber Serper (serper.dev): echte Google-Treffer ueber einen legitimen
// Anbieter, ein POST, typischerweise unter einer Sekunde. Google selbst
// abzufragen wie im Browser waere ein Verstoss gegen die Nutzungsbedingungen
// und wuerde nach kurzer Zeit blockiert — also bewusst nicht.
//
// Das Wertvollste sind answerBox und knowledgeGraph: Dort steht die Antwort
// oft schon fertig ("FC Bayern Muenchen"), ohne dass jemand Treffer lesen muss.

// Gespraechs-Vorspann weg, der Rest bleibt: Google versteht ganze Fragen besser
// als Stichwoerter — anders als die Wikipedia-Suche.
function frageSaeubern(frage) {
  return String(frage)
    .replace(/^\s*(?:hey\s+\w+[,!.]?\s*)?/i, "")
    .replace(/^\s*(?:kannst du (?:mir )?(?:mal )?(?:kurz )?(?:sagen|nachschauen|nachsehen|raussuchen|googeln)|google(?:st du)?(?: mal)?|such(?:e|st du)?(?: mal)?|recherchier(?:e|st du)?(?: mal)?|weisst du)\b[,:]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim() || String(frage).trim();
}

async function serper(frage, { timeoutMs = 4000 } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { ok: false, grund: "kein Serper-Schluessel" };

  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: frageSaeubern(frage), gl: "de", hl: "de", num: 6 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error("Serper HTTP " + r.status);
  const d = await r.json();

  const teile = [];
  // 1. Direkte Antwort, wenn Google eine hat.
  const box = d.answerBox;
  if (box) {
    const a = box.answer || box.snippet || box.snippetHighlighted?.join(", ") || "";
    if (a) teile.push(`Direkte Antwort: ${a}`);
  }
  // 2. Wissensbereich (Personen, Vereine, Orte) mit den Eckdaten.
  const kg = d.knowledgeGraph;
  if (kg) {
    const eck = Object.entries(kg.attributes || {}).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(" · ");
    const z = [kg.title, kg.type, kg.description, eck].filter(Boolean).join(" — ");
    if (z) teile.push(z);
  }
  // 3. Die besten Treffer als Belege.
  for (const t of (d.organic || []).slice(0, 5)) {
    if (t.snippet) teile.push(`${t.title}: ${t.snippet}`);
  }

  const text = teile.join("\n").slice(0, 1600);
  if (!text.trim()) return { ok: false, grund: "Serper ohne verwertbare Treffer" };
  return { ok: true, titel: d.answerBox?.title || d.knowledgeGraph?.title || "Google", quelle: "Google", text };
}

// Der Einstieg: schnell nachschlagen. Wirft nie — der Aufrufer entscheidet,
// ob er auf die langsame, aber vollstaendige Denk-Spur ausweicht.
//
// Reihenfolge: erst Google (deckt auch Aktuelles ab, braucht einen Schluessel),
// dann Wikipedia (kostenlos, stark bei stabilen Fakten, schwach bei "was ist
// gerade"). Faellt eine Quelle aus, uebernimmt die naechste.
async function schnellNachschlagen(frage, { timeoutMs = 4000 } = {}) {
  const start = Date.now();
  const quellen = [];
  if (process.env.SERPER_API_KEY) quellen.push(["Google", serper]);
  quellen.push(["Wikipedia", wikipedia]);

  let letzterGrund = "keine Quelle";
  for (const [name, fn] of quellen) {
    try {
      const r = await fn(frage, { timeoutMs });
      if (r.ok) return { ...r, dauerMs: Date.now() - start };
      letzterGrund = `${name}: ${r.grund}`;
    } catch (e) {
      letzterGrund = `${name}: ${String(e.message).slice(0, 100)}`;
    }
  }
  return { ok: false, grund: letzterGrund, dauerMs: Date.now() - start };
}

module.exports = { schnellNachschlagen, wikipedia, serper, begriffe, passendeStellen, frageSaeubern };
