// Welches Modell gehoert ans Telefon?
//
// Warum (Lukas, 08.08.2026): "Wählt immer das beste Modell aus und das
// schnellste, damit alles flüssig funktioniert. Der Preis ist da egal [...]
// Aber natürlich soll man auch nicht unnötig Geld verschwenden."
//
// AM TELEFON ZAEHLT EINE ANDERE ZAHL ALS IM CHAT. Im Browser ist wichtig, wann
// die Antwort FERTIG ist. Am Telefon ist wichtig, wann das ERSTE WORT kommt —
// alles davor ist Stille in der Leitung, und Stille am Telefon wirkt doppelt so
// lang wie eine Wartezeit auf dem Bildschirm. Deshalb wird hier vor allem "bis
// zum ersten Satz" gemessen, nicht die Gesamtdauer.
//
// Gemessen wird gegen die ECHTE Schnittstelle mit dem ECHTEN System-Prompt.
// Eine Messung mit einem verkuerzten Prompt waere wertlos: Der Prompt ist
// 7.000 Token gross und bestimmt die Anlaufzeit mit.
//
// Aufruf: node scripts/messwerte-telefon.js [durchgaenge]

const schnell = require("../lib/schnell.js");
const stimme = require("../lib/stimme.js");
const zustand = require("../lib/zustand.js");
const { WERKZEUGE } = require("../lib/sprache-werkzeuge.js");

// NACHGESCHAERFT (08.08.): Der erste Lauf mass mit aufwand "high" und
// eingeschaltetem Nachdenken — die Sprachroute laeuft aber auf "low". Die
// Messung sagte also nichts ueber den Betrieb aus.
//
// Und sie mass die falsche Stellschraube: Nicht nur das MODELL entscheidet ueber
// die Stille in der Leitung, sondern vor allem, ob das Modell vor dem Antworten
// nachdenkt. Beim Nachdenken kommt bis zum ersten Token gar nichts — am
// Bildschirm ein Zoegern, am Telefon eine Leitung, in der niemand ist.
//
// Haiku 4.5 ist raus: Er scheiterte in ALLEN acht Durchgaengen an den 24
// Werkzeugen. Kein Grenzfall, sondern durchgehend.
const MODELLE = [
  { name: "Sonnet, denkt", id: "claude-sonnet-5", denken: "adaptiv", aufwand: "low" },
  { name: "Sonnet, direkt", id: "claude-sonnet-5", denken: "aus", aufwand: "low" },
  { name: "Opus, denkt", id: "claude-opus-5", denken: "adaptiv", aufwand: "low" },
  { name: "Opus, direkt", id: "claude-opus-5", denken: "aus", aufwand: "low" },
];

// Saetze, wie sie am Telefon fallen. Bewusst gemischt: eine reine Auskunft,
// eine mit Werkzeug, eine mit mehreren Auftraegen auf einmal — das ist der
// Fall aus der Anzeige.
const FRAGEN = [
  "Wie viele offene Aufgaben habe ich?",
  "Was steht heute noch an?",
  "Schick Jannik eine WhatsApp, dass ich mich später melde.",
  "Trag mir morgen um zehn einen Termin mit Krotzer ein und schreib Jannik, dass ich später komme.",
];

const DURCHGAENGE = Number(process.argv[2]) || 2;

const mittel = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

(async () => {
  if (!schnell.verfuegbar()) { console.log("Kein Zugang zum Modell."); process.exit(0); }

  const system = String(await stimme.laden() || stimme.NOTNAGEL || "");
  if (system.length < 200) { console.log("System-Prompt nicht ladbar — Messung waere wertlos."); process.exit(1); }
  const stand = (() => { try { return zustand.alsText(); } catch { return ""; } })();
  const voll = system + "\n\n" + stand;
  console.log(`System-Prompt + STAND: ${voll.length} Zeichen\n`);

  const ergebnis = [];

  for (const m of MODELLE) {
    const ersteSaetze = [], gesamt = [], werkzeuge = [];
    let beispiel = "";
    let kaputt = 0;

    for (let d = 0; d < DURCHGAENGE; d++) {
      for (const frage of FRAGEN) {
        const los = Date.now();
        let erster = 0, text = "";
        try {
          const r = await schnell.mitWerkzeugenStrom(voll, frage, WERKZEUGE,
            { maxTokens: 1000, model: m.id, timeoutMs: 45000, denken: m.denken, aufwand: m.aufwand },
            (satz) => { if (!erster) erster = Date.now() - los; text += (text ? " " : "") + satz; });
          gesamt.push(Date.now() - los);
          if (erster) ersteSaetze.push(erster);
          werkzeuge.push((r.aufrufe || []).length);
          if (!beispiel && text) beispiel = text;
        } catch (e) {
          kaputt++;
          console.log(`   ⚠ ${m.name}: ${String(e.message).slice(0, 80)}`);
        }
      }
    }

    const e = {
      name: m.name,
      erster: median(ersteSaetze), ersterSchnitt: mittel(ersteSaetze),
      gesamt: median(gesamt), werkzeuge: mittel(werkzeuge), kaputt, beispiel,
      stumm: gesamt.length - ersteSaetze.length,
    };
    ergebnis.push(e);
    console.log(`${m.name.padEnd(15)} erstes Wort ${String(e.erster).padStart(5)} ms (Median) · ` +
      `fertig ${String(e.gesamt).padStart(5)} ms · Werkzeuge ${e.werkzeuge}` +
      (e.stumm ? ` · ${e.stumm}× gar kein Satz vorab` : "") +
      (e.kaputt ? ` · ${e.kaputt} Fehlschlaege` : ""));
    if (e.beispiel) console.log(`            „${e.beispiel.slice(0, 110)}"`);
  }

  // --- Was das fuers Telefon heisst ------------------------------------------
  console.log("\n--- Fuers Telefon ---");
  const brauchbar = ergebnis.filter((e) => e.erster > 0 && !e.kaputt);
  if (!brauchbar.length) { console.log("Keine brauchbare Messung."); process.exit(1); }
  const schnellstes = brauchbar.reduce((a, b) => (a.erster <= b.erster ? a : b));
  console.log(`Schnellstes erstes Wort: ${schnellstes.name} (${schnellstes.erster} ms)`);
  for (const e of brauchbar) {
    const mehr = e.erster - schnellstes.erster;
    console.log(`  ${e.name.padEnd(15)} ${mehr === 0 ? "—" : "+" + mehr + " ms Stille"} gegenüber dem schnellsten`);
  }
  // Die Schwelle stammt nicht aus dem Bauch: Unter einer Sekunde klingt eine
  // Antwort wie eine Antwort, ab etwa zwei Sekunden wie ein Aussetzer.
  console.log("\nRichtwert: unter 1000 ms klingt es wie ein Gespräch, ab 2000 ms wie ein Aussetzer.");
  process.exitCode = 0;
})().catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; });
