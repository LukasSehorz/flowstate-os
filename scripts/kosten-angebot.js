// Was kostet ein Angebot?
//
// Warum (Lukas, 07.08.2026): "Nun kannst du mir sagen, wie viel die Erstellung
// eines Angebotes über den Server kostet, weil wir ja so mit API-Token zahlen
// müssen."
//
// GEMESSEN, NICHT GESCHAETZT. Ein Angebot braucht ZWEI Modellaufrufe, und der
// zweite haengt daran, wie viel Text die Kundenwebsite hergibt — das laesst
// sich nicht ausrechnen, das muss man laufen lassen.
//
// Die drei Eingabearten werden getrennt gezaehlt. Sie unterscheiden sich im
// Preis um mehr als das Zehnfache, und der grosse System-Prompt liegt beim
// zweiten Aufruf im Zwischenspeicher — eine einzige "Eingabe"-Zahl waere
// deshalb irrefuehrend.
//
// Die PREISE stehen unten und muessen gepflegt werden. Sie kommen nicht aus dem
// System, sondern aus der Preisliste — wenn sie sich aendert, aendert sich diese
// Datei mit. Deshalb steht das Datum dabei.
//
// Aufruf: node scripts/kosten-angebot.js ["Firmenname"]

const schnell = require("./../lib/schnell.js");
const angebotText = require("../lib/angebot-text.js");
const firmaNach = require("../lib/firma-nachschlagen.js");
const webseite = require("../lib/website-lesen.js");
const { WERKZEUGE } = require("../lib/sprache-werkzeuge.js");

// Stand 07.08.2026, Sonnet 5, US-Dollar je Million Token.
const PREIS = {
  rein: 3.00,             // frisch gelesene Eingabe
  speicherNeu: 3.75,      // in den Zwischenspeicher geschrieben (+25 %)
  speicherGelesen: 0.30,  // aus dem Zwischenspeicher gelesen (-90 %)
  raus: 15.00,            // Ausgabe
};
const EURO_JE_DOLLAR = 0.92;

function kosten(v) {
  return (v.tokenRein * PREIS.rein
    + v.tokenSpeicherNeu * PREIS.speicherNeu
    + v.tokenSpeicherGelesen * PREIS.speicherGelesen
    + v.tokenRaus * PREIS.raus) / 1e6;
}

const zeile = (name, v, ms) => {
  const d = kosten(v);
  console.log(
    `  ${name.padEnd(22)} ` +
    `rein ${String(v.tokenRein).padStart(6)}  ` +
    `Speicher neu ${String(v.tokenSpeicherNeu).padStart(6)}  ` +
    `gelesen ${String(v.tokenSpeicherGelesen).padStart(6)}  ` +
    `raus ${String(v.tokenRaus).padStart(5)}  ` +
    `${(ms / 1000).toFixed(1)}s  ` +
    `${(d * 100).toFixed(3)} ct`);
  return d;
};

const FIRMA = process.argv[2] || "Physiotherapie Bergmann";
const SATZ = `Stell mir ein Angebot für ${FIRMA}. Die brauchen eine neue Website mit Online-Terminanfrage. 1900 Euro.`;

(async () => {
  if (!schnell.verfuegbar()) { console.log("Kein Zugang zum Modell — nichts zu messen."); process.exit(0); }

  console.log(`Angebot für "${FIRMA}"\n`);
  let summe = 0;

  // --- Aufruf 1: den Satz verstehen und die Felder fuellen ------------------
  // Der echte System-Prompt, nicht eine Naeherung: Er ist der groesste
  // Einzelposten der Eingabe, und mit einem Platzhalter waere die ganze
  // Messung wertlos.
  const stimme = require("../lib/stimme.js");
  const system = String(await stimme.laden() || stimme.NOTNAGEL || "");
  if (system.length < 200) { console.log("System-Prompt nicht ladbar — Messung waere wertlos."); process.exit(1); }
  let t = Date.now();
  const a1 = await schnell.mitWerkzeugen(system, SATZ, WERKZEUGE,
    { maxTokens: 1000, model: process.env.SPRACHE_VERSTEHEN_MODEL || "claude-sonnet-5", timeoutMs: 30000 });
  summe += zeile("1. Satz verstehen", a1, Date.now() - t);

  // --- Was ohne Modell laeuft ------------------------------------------------
  t = Date.now();
  const e = await firmaNach.ergaenzen({ firma: FIRMA });
  const msCrm = Date.now() - t;
  console.log(`  ${"CRM nachschlagen".padEnd(22)} ${(msCrm / 1000).toFixed(1)}s  0 Token — Datenbank, kein Modell`);

  let gelesen = null;
  if (e.quelle?.website) {
    t = Date.now();
    const w = await webseite.lesen(e.quelle.website);
    const msWeb = Date.now() - t;
    if (w.ok) gelesen = w;
    console.log(`  ${"Website lesen".padEnd(22)} ${(msWeb / 1000).toFixed(1)}s  0 Token — ` +
      (w.ok ? `${w.text.length} Zeichen geholt (die zaehlen erst unten als Eingabe)` : `nicht gelesen: ${w.grund}`));
  }

  // --- Aufruf 2: den Angebotstext schreiben ---------------------------------
  //
  // Hier wird schnell.mitWerkzeugen direkt aufgerufen statt angebotText.schreiben,
  // weil nur so die Verbrauchswerte zurueckkommen.
  const echteSchreiben = schnell.mitWerkzeugen;
  let a2 = null, ms2 = 0;
  schnell.mitWerkzeugen = async (...args) => {
    const los = Date.now();
    const r = await echteSchreiben(...args);
    ms2 = Date.now() - los; a2 = r;
    return r;
  };
  try {
    await angebotText.schreiben({
      firma: e.auftrag.firma || FIRMA, projekt: "Neue Website mit Online-Terminanfrage",
      sparte: "Website", betrag: 1900, ansprechpartner: e.auftrag.anrede || "",
      ort: e.auftrag.plz_ort || "", crm: firmaNach.alsText(e.quelle), website: gelesen,
    });
  } catch (err) { console.log("  Angebotstext:", err.message); }
  schnell.mitWerkzeugen = echteSchreiben;
  if (a2) summe += zeile("2. Angebotstext", a2, ms2);

  // --- Zusammen ---------------------------------------------------------------
  console.log(`\n  Ein Angebot: ${(summe * 100).toFixed(2)} US-Cent  ≈ ${(summe * EURO_JE_DOLLAR * 100).toFixed(2)} Euro-Cent`);
  console.log(`  100 Angebote: ${(summe * 100).toFixed(2)} $  ≈ ${(summe * 100 * EURO_JE_DOLLAR).toFixed(2)} €`);
  console.log(`\n  (Preise Stand 07.08.2026, Sonnet 5. Vorlage füllen, PDF wandeln und Mailversand kosten nichts —`);
  console.log(`   das sind Datei- und Netzvorgänge auf dem eigenen Server.)`);
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
