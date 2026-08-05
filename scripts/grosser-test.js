// Der grosse Durchlauf: 30 Fragen, wie sie eine Assistentin wirklich bekommt.
//
// Warum (Lukas, 05.08.2026): "Ich will mit Alexandra so sprechen als waere es
// eine sehr sehr gute Assistentin die alles ueber das Unternehmen von uns weiss
// und immer richtig antwortet. Es soll nicht nach Bausteinen klingen sondern
// wirklich professionell, fluessig, und soll auch individuell auf meine Fragen
// antworten und nicht dass jedes Mal die gleiche Antwort kommt."
//
// Geprueft wird deshalb DREIERLEI, nicht nur das Uebliche:
//   1. Waehlt sie das richtige Werkzeug?
//   2. Wie lange dauert es?
//   3. Klingt die Antwort nach Mensch oder nach Baustein?
//
// Dazu die offene Frage aus demselben Gespraech: Bei uns versteht SONNET und
// Haiku ist nur Reserve. Lukas hat den umgekehrten Aufbau gesehen (Haiku
// orchestriert, groessere Modelle fuehren aus). Der Test laeuft deshalb mit
// beiden Modellen ueber dieselben Fragen — dann ist es eine Messung statt
// einer Meinung.
//
// SCHREIBENDE AKTIONEN WERDEN NICHT AUSGEFUEHRT. Bei "trag mir einen Termin
// ein" wird nur geprueft, ob sie es richtig VERSTEHT — sonst stehen nach dem
// Test dreissig erfundene Termine im Kalender.
//
// Aufruf (auf dem Server):
//   docker compose exec -T dashboard node scripts/grosser-test.js
//   ... --modell claude-haiku-4-5     (fuer den Vergleich)

process.env.VAULT_PATH = process.env.VAULT_PATH || "/vault";
const { ausZustand } = require("../lib/sprache-routes.js");
const zustand = require("./../lib/zustand.js");

const nurModell = (() => {
  const i = process.argv.indexOf("--modell");
  return i > 0 ? process.argv[i + 1] : null;
})();
if (nurModell) process.env.SPRACHE_VERSTEHEN_MODEL = nurModell;

// erwartet: das Werkzeug, das kommen MUSS. "" heisst: gar keins — die Antwort
// steht im STAND und soll direkt kommen.
const FRAGEN = [
  // --- Tagesgeschaeft: muss ohne jeden Aufruf gehen ------------------------
  { f: "Was steht heute an?", erw: "" },
  { f: "Wann hab ich morgen Zeit?", erw: "" },
  { f: "Hab ich diese Woche noch was Wichtiges?", erw: "" },
  { f: "Was kostet bei uns die Betreuung?", erw: "" },

  // --- Stand einer Sache ---------------------------------------------------
  { f: "Wie ist der Stand bei Sykora?", erw: "nachschlagen" },
  { f: "Was läuft gerade bei Krotzer und Eisele?", erw: "nachschlagen" },
  { f: "Welche Projekte laufen gerade?", erw: "nachschlagen" },
  { f: "Wie sieht es in der Buchhaltung aus?", erw: "nachschlagen" },
  { f: "Wie viele Abonnenten haben wir inzwischen?", erw: "nachschlagen" },
  { f: "Sind noch Rechnungen offen?", erw: "nachschlagen" },

  // --- Was hat sich geaendert ---------------------------------------------
  { f: "Was ist heute neu im CRM?", erw: "neuigkeiten" },
  { f: "Was hat sich diese Woche getan?", erw: "neuigkeiten" },
  { f: "Gab es gestern neue Leads?", erw: "neuigkeiten" },

  // --- Wissen aus dem Gehirn ----------------------------------------------
  { f: "Was wurde am 16. Juli entschieden?", erw: "gehirn_suchen" },
  { f: "Wie ist unser Regelwerk für Freigaben?", erw: "gehirn_suchen" },
  { f: "Was haben wir zum Thema Google Workspace festgelegt?", erw: "gehirn_suchen" },

  // --- Nachrichten und Termine --------------------------------------------
  { f: "Gibt's ungelesene WhatsApp-Nachrichten?", erw: "whatsapp_lesen" },
  { f: "Sind neue Mails da?", erw: "mail_lesen" },
  { f: "Wie wird das Wetter morgen Nachmittag in Landshut?", erw: "wetter" },

  // --- Handeln: wird VERSTANDEN, nicht ausgefuehrt -------------------------
  { f: "Trag mir übermorgen um zehn einen Zahnarzttermin ein.", erw: "termin_eintragen" },
  { f: "Schieb den Zahnarzt auf halb zwölf.", erw: "termin_verschieben" },
  { f: "Setz Steuerunterlagen sortieren auf die Liste.", erw: "aufgabe_anlegen" },
  { f: "Schreib Jannik, dass ich mich morgen melde.", erw: "whatsapp_senden" },
  { f: "Notier bei Sykora, dass sie erst im Herbst Budget haben.", erw: "crm_notiz" },
  { f: "Erinner mich in zwei Wochen an Krotzer.", erw: "crm_wiedervorlage" },

  // --- Lange Arbeit --------------------------------------------------------
  { f: "Bau mir eine kurze Präsentation über Meta Ads für Handwerker.", erw: "lange_arbeit" },

  // --- Allgemeines, was eine Assistentin auch koennen muss -----------------
  { f: "Was gibt es heute Neues in der Wirtschaft?", erw: "recherchieren" },
  { f: "Was verlangt die Konkurrenz für Social-Media-Betreuung?", erw: "recherchieren" },

  // --- Mehrere Absichten in einem Satz ------------------------------------
  { f: "Wie wird das Wetter morgen, und sind neue Mails da?", erw: "wetter", auch: "mail_lesen" },
  { f: "Was steht morgen an und was hat sich im CRM getan?", erw: "neuigkeiten" },

  // --- Wo die ehrliche Antwort "weiss ich nicht" ist -----------------------
  { f: "Wie hoch war unser Umsatz im Jahr 2019?", erw: null },
  { f: "Wann hat Jannik Geburtstag?", erw: null },
];

// Klingt eine Antwort nach Baustein? Die Muster stammen aus echten Antworten,
// die Lukas als "nach Bausteinen" beanstandet hat.
const BAUSTEIN = [
  [/^Dazu steht nichts im Gehirn\./i, "Formelsatz aus dem Prompt"],
  [/\*\*|^#|^\s*[-*+]\s/m, "Markdown im gesprochenen Text"],
  [/\b(hermes|sonnet|haiku|werkzeug|prompt|token|json|datenbank|abfrage)\b/i, "interner Begriff"],
  [/^(Klar|Alles klar|Gerne|Selbstverständlich)[,.!]\s*$/i, "reine Floskel ohne Inhalt"],
];

(async () => {
  const modell = nurModell || process.env.SPRACHE_VERSTEHEN_MODEL || "claude-sonnet-5";
  console.log(`Verstehen laeuft auf: ${modell}\n${"=".repeat(78)}`);
  const stand = zustand.alsText();

  let richtig = 0, falsch = 0;
  const dauern = [];
  const probleme = [];
  const antworten = [];

  for (const [nr, fall] of FRAGEN.entries()) {
    const a = await ausZustand(fall.f, stand, []);
    const d = a._diag;
    const gerufen = d.aufrufe || [];
    dauern.push(d.dauerMs);

    let ok;
    if (fall.erw === "") ok = gerufen.length === 0;
    else if (fall.erw === null) ok = true;                       // beides vertretbar
    else ok = gerufen.includes(fall.erw) && (!fall.auch || gerufen.includes(fall.auch));
    ok ? richtig++ : falsch++;

    const text = String(a.text || "");
    const maengel = BAUSTEIN.filter(([re]) => re.test(text)).map(([, w]) => w);
    if (maengel.length) probleme.push([fall.f, maengel.join(", ")]);
    if (text) antworten.push(text);

    console.log(`${String(nr + 1).padStart(2)}. ${ok ? "✅" : "❌"} ${String(d.dauerMs).padStart(5)} ms  ` +
      `[${gerufen.join(", ") || "kein Aufruf"}]` +
      (ok ? "" : `   ERWARTET: ${fall.erw === "" ? "kein Aufruf" : fall.erw}`));
    console.log(`     "${fall.f}"`);
    if (text) console.log(`     → ${text.replace(/\s+/g, " ").slice(0, 150)}`);
    if (maengel.length) console.log(`     ⚠ ${maengel.join(", ")}`);
    if (d.fehler) console.log(`     ⚠ Fehler: ${d.fehler}`);
  }

  const s = [...dauern].sort((x, y) => x - y);
  console.log("\n" + "=".repeat(78));
  console.log(`Modell:      ${modell}`);
  console.log(`Werkzeuge:   ${richtig} von ${FRAGEN.length} richtig  (${Math.round(richtig / FRAGEN.length * 100)} %)`);
  console.log(`Tempo:       Median ${s[Math.floor(s.length / 2)]} ms · schnellste ${s[0]} · langsamste ${s[s.length - 1]}`);
  console.log(`Über 3 s:    ${dauern.filter((x) => x > 3000).length} von ${dauern.length}`);
  console.log(`Bausteinhaft: ${probleme.length} Antwort(en)`);
  for (const [f, w] of probleme) console.log(`   · "${f.slice(0, 50)}" — ${w}`);

  // Kommen Saetze woertlich mehrfach vor? Genau das meint "jedes Mal die
  // gleiche Antwort".
  const zaehler = new Map();
  for (const t of antworten) {
    for (const satz of t.split(/(?<=[.!?])\s+/)) {
      const k = satz.trim().toLowerCase();
      if (k.length > 15) zaehler.set(k, (zaehler.get(k) || 0) + 1);
    }
  }
  const doppelt = [...zaehler.entries()].filter(([, n]) => n > 1);
  console.log(`Wiederholte Saetze: ${doppelt.length}`);
  for (const [satz, n] of doppelt.slice(0, 5)) console.log(`   · ${n}x "${satz.slice(0, 60)}"`);

  process.exit(0);
})();
