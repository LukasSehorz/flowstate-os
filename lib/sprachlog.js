// Sprachprotokoll — jede Sprachanfrage als eine Zeile JSON (JSONL, eine Datei
// pro Tag). Warum es das gibt (Analyse 24.07.2026): Bis hierher hatte das
// Sprachmodul KEIN Protokoll — wenn Alexandra daneben lag, gab es nichts zum
// Nachsehen: keine Frage, kein Modell, keine Dauer, kein Fehler. Jede Diagnose
// war Raten. Jetzt liegt unter data/sprachlog/JJJJ-MM-TT.jsonl der ganze
// Gespraechsfluss: Frage, Stand-Frische, Modell + Dauer, was gesagt wurde,
// welche Auftraege liefen und woran etwas scheiterte.
//
// data/ steht in .gitignore — die Inhalte bleiben auf der Maschine, nichts
// davon landet im Repo. Schluessel/Tokens werden hier nie hineingeschrieben.
//
// Bewusst: schreiben() wirft NIE und blockiert NIE (appendFile, Fehler
// verschluckt) — ein kaputtes Protokoll darf niemals das Gespraech anhalten.

const fs = require("fs");
const path = require("path");

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const LOG_PFAD = path.join(DATA_PATH, "sprachlog");
const BEHALTEN_TAGE = Number(process.env.SPRACHLOG_TAGE || 30);

function tagBerlin(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// Alte Tagesdateien entfernen — einmal pro Prozessstart reicht.
let aufgeraeumt = false;
function aufraeumen() {
  try {
    const grenze = Date.now() - BEHALTEN_TAGE * 86400000;
    for (const name of fs.readdirSync(LOG_PFAD)) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && Date.parse(m[1]) < grenze) fs.unlink(path.join(LOG_PFAD, name), () => {});
    }
  } catch {}
}

function schreiben(eintrag) {
  try {
    fs.mkdirSync(LOG_PFAD, { recursive: true });
    if (!aufgeraeumt) { aufgeraeumt = true; aufraeumen(); }
    const zeile = JSON.stringify({ zeit: new Date().toISOString(), ...eintrag });
    fs.appendFile(path.join(LOG_PFAD, tagBerlin() + ".jsonl"), zeile + "\n", () => {});
  } catch {}
}

module.exports = { schreiben, LOG_PFAD };
