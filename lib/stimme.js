// Der Charakter — eine Quelle fuer alle, die in Alexandras Namen sprechen.
//
// Warum es diese Datei gibt (07.08.2026): Lukas hatte den Charakter gerade
// festgelegt (schlagfertig, rechte Hand, eigene Meinung) und merkte beim Testen
// "in der Tonalitaet noch nicht so einen Unterschied". Der Grund stand im
// Protokoll: Das Modell schreibt nur das Bindegewebe, die eigentlichen
// Antworten baut der SERVER zusammen — und der kannte den Charakter nicht.
//
//   Modell:  "Noe, alles Newsletter und Domain-Bestaetigungen."
//   Server:  "Morgen in Villefranche-sur-Mer: teils bewoelkt und trocken,
//             27 bis 30 Grad."
//
// Der zweite Satz ist ein Wetterbericht, keine Person. Wer ihn hoert, hoert
// keinen Charakter — egal, wie gut die STIMME-Datei ist.
//
// Geladen wird mit mtime-Pruefung: Die Datei liegt im Vault und ist ohne Deploy
// aenderbar. Wer sie bearbeitet, soll die Wirkung im naechsten Satz hoeren und
// nicht nach dem naechsten Neustart.

const fs = require("fs");
const path = require("path");

const VAULT_PATH = () => process.env.VAULT_PATH || "/vault";
const DATEI = () => path.join(VAULT_PATH(), "instanzen", "lukas", "STIMME-alexandra.md");

let cache = { text: "", mtime: 0 };

// Der Notnagel, falls die Vault-Datei fehlt. Bewusst knapp und bewusst mit
// Charakter — ein tonloser Rueckfall waere schlimmer als gar keiner, weil
// niemand merkt, dass die eigentliche Datei nicht gefunden wurde.
const NOTNAGEL =
  "Du bist Alexandra, Lukas' rechte Hand bei Flowstate. Du duzt ihn, sprichst kurz " +
  "(2-4 Saetze) und schlagfertig, wertest und priorisierst. Ernst, sobald etwas " +
  "schiefging. Nie vorlesen: Adressen, IDs, Betreffzeilen. Zahlen gerundet und " +
  "ausgeschrieben.";

function laden() {
  try {
    const st = fs.statSync(DATEI());
    if (st.mtimeMs !== cache.mtime) {
      cache = { text: fs.readFileSync(DATEI(), "utf-8"), mtime: st.mtimeMs };
    }
    return cache.text;
  } catch {
    return NOTNAGEL;
  }
}

module.exports = { laden, DATEI, NOTNAGEL };
