// Die drei Zahlen, an denen sich jede Sprach-Aenderung messen lassen muss.
//
//   node scripts/messwerte.js                  # aktuellen Stand zeigen
//   node scripts/messwerte.js --festschreiben  # als Ausgangswert speichern
//   node scripts/messwerte.js --vergleich      # gegen den Ausgangswert stellen
//   node scripts/messwerte.js <ordner>         # anderen Log-Ordner lesen
//
// Warum es das gibt (Befund 25.07.2026): Neun Monate lang war jede Aenderung am
// Sprachbereich einzeln richtig und hat das Gefuehl nicht verbessert, weil sie
// am Symptom ansetzte. Das Gegenmittel war die ganze Zeit da — das
// Sprachprotokoll — es wurde nur nie ausgewertet.
//
// Ab jetzt gilt: Bewegt eine Aenderung keine dieser drei Zahlen, war sie
// kosmetisch. Dann zurueckrollen, nicht nachbessern.
//
//   1. SPRECHAKTE PRO FRAGE   heute 6 (median), Ziel 1
//   2. ZEIT BIS ERSTER TON    heute 4,1 s (median), Ziel unter 1 s
//   3. FEHLERKENNUNGSRATE     bisher ungemessen, Ziel unter 5 %

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");

// Der Ausgangswert gehoert ins Repo, nicht nach data/ — dort liegt Laufzeitkram
// und der Ordner ist in .gitignore. Wir messen wochenlang gegen diese eine
// Datei; sie muss bei Lukas und Jannik identisch sein.
const AUSGANGSWERT = path.join(WURZEL, "docs", "messwerte-ausgangswert.json");

// Wie lange nach einer Frage noch Sprechakte zu ihr gezaehlt werden. Lange
// Auftraege reden ueber Minuten nach (Erzaehlspur alle 5 s), deshalb nicht zu
// knapp — aber die naechste Frage beendet das Fenster in jedem Fall, sonst
// werden Sprechakte doppelt gezaehlt.
const FENSTER_MS = 120_000;

// Saetze, mit denen Alexandra zugibt, dass sie akustisch nichts verstanden hat.
// Woertlich aus dem Protokoll vom 24./25.07. gezogen — nicht erfunden:
//   "Ich glaub, das kam wieder verstuemmelt an"
//   "Das hab ich akustisch nicht ganz zusammengekriegt"
//   "Da fehlt mir der Sinn — 'ein kleiner Mann ist' klingt nach einem Wortfetzen"
const NICHT_VERSTANDEN = new RegExp([
  "verst[uü]mmelt",
  "nicht verstanden",
  "akustisch",
  "nicht (ganz )?(rund )?(bei mir )?angekommen",
  "fehlt mir der sinn",
  "wortfetzen",
  "sag (mir )?(das )?nochmal",
  "nochmal sagen",
  "worum('s| es)? (ging|geht)",
].join("|"), "i");

// ---------------------------------------------------------------- Einlesen

function logsLesen(ordner) {
  if (!fs.existsSync(ordner)) return { zeilen: [], dateien: [] };
  const dateien = fs.readdirSync(ordner).filter((d) => d.endsWith(".jsonl")).sort();
  const zeilen = [];
  for (const d of dateien) {
    const roh = fs.readFileSync(path.join(ordner, d), "utf-8");
    for (const z of roh.split("\n")) {
      if (!z.trim()) continue;
      try { zeilen.push(JSON.parse(z)); } catch { /* halbe Zeile am Dateiende */ }
    }
  }
  // Nach Zeit sortieren: Die Tagesdateien sind es einzeln, zusammen nicht
  // zwingend (Zeitumstellung, nachgetragene Eintraege).
  zeilen.sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)));
  return { zeilen, dateien };
}

const ms = (a, b) => new Date(b).getTime() - new Date(a).getTime();

function kennzahlen(werte) {
  if (!werte.length) return null;
  const v = [...werte].sort((a, b) => a - b);
  return {
    n: v.length,
    median: v[Math.floor(v.length / 2)],
    p90: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))],
    max: v[v.length - 1],
  };
}

// ---------------------------------------------------------------- Auswerten

function auswerten(zeilen) {
  // Index der Frage-Eintraege — sie gliedern das Protokoll in Runden.
  const fragen = [];
  zeilen.forEach((d, i) => { if (d.art === "frage") fragen.push(i); });

  const sprechakte = [];
  const ersterTon = [];
  const bisInhalt = [];
  const verstehen = [];
  let nichtVerstanden = 0;
  let reserve = 0;       // wie oft Sonnet ausfiel und Haiku einsprang
  let parseFehler = 0;   // wie oft die Antwort kein sauberes JSON war

  for (let k = 0; k < fragen.length; k++) {
    const i = fragen[k];
    const d = zeilen[i];
    const start = d.zeit;
    const ende = k + 1 < fragen.length ? zeilen[fragen[k + 1]].zeit : null;

    // --- 1. Sprechakte dieser Runde
    // Gezaehlt wird alles, was hoerbar wird: die Blitz-Zusage und jeder
    // TTS-Aufruf (art "stimme") sowie jeder Erzaehlspur-Satz.
    let zahl = 0;
    // Die Blitz-Zusage steht VOR dem Frage-Eintrag (sie feuert sofort bei
    // Ankunft, der Frage-Eintrag erst nach dem Verstehen) — deshalb rueckwaerts
    // bis zur vorigen Runde suchen.
    const vorherigeRunde = k > 0 ? fragen[k - 1] : -1;
    let zusageZeit = null;
    let zusageDauer = 0;
    for (let j = i - 1; j > vorherigeRunde; j--) {
      if (zeilen[j].art === "zusage") {
        zahl++;
        zusageZeit = zeilen[j].zeit;
        zusageDauer = zeilen[j].dauerMs || 0;
        break;
      }
    }
    for (let j = i + 1; j < zeilen.length; j++) {
      const e = zeilen[j];
      if (ende && e.zeit >= ende) break;
      if (ms(start, e.zeit) > FENSTER_MS) break;
      if (e.art === "stimme" || e.art === "erzaehlspur") zahl++;
    }
    sprechakte.push(zahl);

    // --- 2. Zeit bis zum ersten hoerbaren Ton
    // t0 ist die Ankunft der Frage am Server. Direkt geloggt wird sie heute
    // nicht; die Blitz-Zusage feuert unmittelbar danach und ist damit der
    // beste verfuegbare Anker. Faellt sie weg (A1), traegt der Verteiler
    // stattdessen einen "runde"-Eintrag mit t0 — dann wird das hier exakt.
    const t0 = zeilen.find((e) => e.art === "runde" && e.zeit >= (zusageZeit || start) && e.zeit <= start)?.zeit
      || zusageZeit || start;
    for (let j = i - 3 < 0 ? 0 : i - 3; j < zeilen.length; j++) {
      const e = zeilen[j];
      if (e.art !== "stimme") continue;
      if (e.zeit < t0) continue;
      if (ende && e.zeit >= ende) break;
      ersterTon.push(ms(t0, e.zeit));
      break;
    }

    // --- 2b. Zeit bis zur INHALTLICHEN Antwort — die Zahl, auf die es ankommt.
    //
    // "Erster Ton" oben misst heute nur, wann die Blitz-Zusage hoerbar wird —
    // also eine Floskel. Wer darauf optimiert, optimiert die Floskel. Was Lukas
    // erlebt, ist die Zeit, bis etwas mit Inhalt kommt.
    //
    // Ankunft der Frage am Server = Zeitpunkt der Zusage minus ihrer eigenen
    // Erzeugungsdauer. Fertig ist der Inhalt, wenn der Frage-Eintrag steht.
    if (zusageZeit) {
      const ankunft = new Date(zusageZeit).getTime() - zusageDauer;
      bisInhalt.push(new Date(start).getTime() - ankunft);
    }

    // --- 3. Hat sie akustisch nichts verstanden?
    if (typeof d.gesagt === "string" && NICHT_VERSTANDEN.test(d.gesagt)) nichtVerstanden++;

    // --- Nebenbefunde aus dem Verstehen-Schritt
    const v = d.verstehen || {};
    if (v.dauerMs) verstehen.push(v.dauerMs);
    if (v.reserve) reserve++;
    if (v.parse && v.parse !== "ok") parseFehler++;
  }

  return {
    runden: fragen.length,
    sprechakte: kennzahlen(sprechakte),
    ersterTonMs: kennzahlen(ersterTon),
    bisInhaltMs: kennzahlen(bisInhalt),
    verstehenMs: kennzahlen(verstehen),
    nichtVerstandenAnteil: fragen.length ? nichtVerstanden / fragen.length : null,
    nichtVerstandenZahl: nichtVerstanden,
    reserve,
    parseFehler,
  };
}

// ---------------------------------------------------------------- Ausgeben

const sek = (v) => (v / 1000).toFixed(2).replace(".", ",") + " s";
const proz = (v) => (v * 100).toFixed(1).replace(".", ",") + " %";

function zeile(name, ist, ziel, form) {
  if (!ist) return `${name.padEnd(24)} —`;
  const f = form || String;
  return `${name.padEnd(24)} median ${f(ist.median).padStart(9)}   p90 ${f(ist.p90).padStart(9)}   max ${f(ist.max).padStart(9)}   (n=${ist.n})   Ziel ${ziel}`;
}

function bericht(e, titel) {
  console.log("\n" + titel);
  console.log("─".repeat(titel.length));
  console.log(`Runden im Protokoll:     ${e.runden}`);
  console.log("");
  console.log(zeile("1. Sprechakte/Frage", e.sprechakte, "1"));
  console.log(zeile("2. Bis Inhalt kommt", e.bisInhaltMs, "< 1 s", sek));
  console.log("");
  console.log("Nebenbefunde:");
  console.log(zeile("   Bis erster Ton", e.ersterTonMs, "—", sek) + "   (heute nur die Floskel)");
  console.log(zeile("   Verstehen (Modell)", e.verstehenMs, "—", sek));
  console.log(`   3. Nicht verstanden     ${e.nichtVerstandenAnteil === null ? "—" : proz(e.nichtVerstandenAnteil)} (${e.nichtVerstandenZahl} von ${e.runden})   Ziel < 5 %`);
  console.log(`   Haiku-Reserve sprang ein ${e.reserve}×   ·   Antwort war kein JSON: ${e.parseFehler}×`);
}

function pfeil(neu, alt, kleinerIstBesser = true) {
  if (alt == null || neu == null) return "";
  if (alt === neu) return "  =";
  const besser = kleinerIstBesser ? neu < alt : neu > alt;
  const faktor = alt === 0 ? "" : ` (${(neu / alt).toFixed(2).replace(".", ",")}×)`;
  return besser ? `  ✅ besser${faktor}` : `  ❌ schlechter${faktor}`;
}

function vergleich(jetzt, basis) {
  console.log("\nVergleich mit dem Ausgangswert vom " + basis.stand);
  console.log("─".repeat(48));
  const paare = [
    ["Sprechakte/Frage", jetzt.sprechakte?.median, basis.werte.sprechakte?.median, String],
    ["Bis Inhalt kommt", jetzt.bisInhaltMs?.median, basis.werte.bisInhaltMs?.median, sek],
    ["Verstehen (Modell)", jetzt.verstehenMs?.median, basis.werte.verstehenMs?.median, sek],
    ["Nicht verstanden", jetzt.nichtVerstandenAnteil, basis.werte.nichtVerstandenAnteil, proz],
  ];
  for (const [name, neu, alt, f] of paare) {
    const l = `${name.padEnd(22)} ${alt == null ? "—" : f(alt).padStart(9)}  →  ${neu == null ? "—" : f(neu).padStart(9)}`;
    console.log(l + pfeil(neu, alt));
  }
  const bewegt = paare.some(([, neu, alt]) => alt != null && neu != null && neu !== alt);
  console.log("");
  console.log(bewegt
    ? "Mindestens eine Zahl hat sich bewegt."
    : "KEINE Zahl hat sich bewegt — die Aenderung war kosmetisch. Zurueckrollen, nicht nachbessern.");
}

// ---------------------------------------------------------------- Start

const args = process.argv.slice(2);
const schalter = args.filter((a) => a.startsWith("--"));
const ordnerArg = args.find((a) => !a.startsWith("--"));
const ordner = ordnerArg || path.join(process.env.DATA_PATH || path.join(WURZEL, "data"), "sprachlog");

const { zeilen, dateien } = logsLesen(ordner);
if (!zeilen.length) {
  console.log(`Keine Protokolleintraege in ${ordner}.`);
  console.log("Auf dem Server liegen sie unter /data/sprachlog im Dashboard-Container:");
  console.log("  ssh flowstate 'docker exec flowstate-dashboard sh -c \"cat /data/sprachlog/*.jsonl\"' > /tmp/sprachlog.jsonl");
  process.exit(0);
}

console.log(`Gelesen: ${zeilen.length} Eintraege aus ${dateien.length || 1} Datei(en) in ${ordner}`);
const jetzt = auswerten(zeilen);

if (jetzt.runden === 0) {
  console.log("\nKeine Sprachrunden (art \"frage\") gefunden — nichts zu messen.");
  process.exit(0);
}

bericht(jetzt, "Messwerte");

if (schalter.includes("--festschreiben")) {
  const inhalt = {
    stand: new Date().toISOString().slice(0, 10),
    ordner,
    eintraege: zeilen.length,
    werte: jetzt,
    hinweis: "Ausgangswert VOR dem Umbau der Gespraechsschicht (Stufe A). Nicht ueberschreiben.",
  };
  fs.mkdirSync(path.dirname(AUSGANGSWERT), { recursive: true });
  fs.writeFileSync(AUSGANGSWERT, JSON.stringify(inhalt, null, 2) + "\n", "utf-8");
  console.log(`\nAls Ausgangswert festgeschrieben: ${AUSGANGSWERT}`);
}

if (schalter.includes("--vergleich")) {
  if (!fs.existsSync(AUSGANGSWERT)) {
    console.log(`\nKein Ausgangswert vorhanden. Einmal mit --festschreiben laufen lassen.`);
    process.exit(0);
  }
  vergleich(jetzt, JSON.parse(fs.readFileSync(AUSGANGSWERT, "utf-8")));
}
