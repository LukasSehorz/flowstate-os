// Probemodus — der Riegel vor allem, was das Haus verlaesst (20.08.2026).
//
// WARUM ES DAS GIBT: Ab morgen wird gedreht. Vorher muessen die Szenarien aus
// dem Anzeigen-Konzept durchgespielt werden, und zwar mit dem ECHTEN Weg —
// derselbe Endpunkt, dieselben Werkzeuge, dieselbe Datenbank. Nur eines darf
// dabei NICHT passieren: dass eine Probe-WhatsApp bei Jannik landet, eine
// Probe-Mail bei der Steuerberaterin oder ein Probe-Anruf auf Lukas' Handy.
//
// Der bestehende Schutz reicht dafuer nicht:
//   - WhatsApp fragt zwar vor jedem Senden nach ("ja" -> raus). Ein Testlauf,
//     der eine Bestaetigung durchspielt, wuerde aber genau dieses "ja" sagen.
//   - Mail hat einen harten Riegel nur fuer EXTERNE Empfaenger. An Lukas selbst
//     ginge sie ungefragt raus — bei sechzig Proben sechzig Mails.
//   - Der Anruf hat eine Tagesbremse, keinen Aus-Schalter.
//
// Deshalb hier EIN Schalter, den nur ein Testlauf setzt: ADS_PROBE=1. Er wirkt
// an den drei Stellen, an denen etwas wirklich rausgeht, und nirgends sonst.
// Alles davor — Verstehen, Werkzeugwahl, Formulierung, Freigabe-Rueckfrage —
// laeuft unveraendert. Genau das soll ja geprueft werden.
//
// BEWUSST NICHT still: Jede abgefangene Sendung wird protokolliert und dem
// Aufrufer als solche zurueckgemeldet. Ein Testmodus, der so tut, als waere
// alles rausgegangen, macht den Test wertlos — man wuesste nicht mehr, ob der
// Weg gehalten haette.
//
// BEWUSST KEIN Standard: Ohne die Umgebungsvariable ist der Riegel offen. Der
// Server im Betrieb kennt sie nicht und verhaelt sich exakt wie vorher.

const fs = require("fs");
const path = require("path");

const AN = process.env.ADS_PROBE === "1";

// Wohin die abgefangenen Sendungen geschrieben werden. Im Probemodus zeigt
// DATA_PATH ohnehin in einen Wegwerf-Ordner — die Datei liegt also neben dem
// Sprachprotokoll desselben Laufs und ist danach mit ihm verschwunden.
const DATEI = () => path.join(process.env.DATA_PATH || path.join(__dirname, "..", "data"),
  "probe-abgefangen.jsonl");

function notieren(kanal, daten) {
  try {
    fs.mkdirSync(path.dirname(DATEI()), { recursive: true });
    fs.appendFileSync(DATEI(),
      JSON.stringify({ zeit: new Date().toISOString(), kanal, ...daten }) + "\n");
  } catch { /* ein kaputtes Protokoll darf den Lauf nicht anhalten */ }
}

// true = der Aufrufer soll NICHT senden, sondern die mitgelieferte
// Ersatzantwort zurueckgeben.
const aktiv = () => AN;

module.exports = { aktiv, notieren };
