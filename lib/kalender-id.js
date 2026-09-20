// Welchen Google-Kalender das OS liest und beschreibt.
//
// Normalfall: den Hauptkalender des Kontos ("primary"). Dann ist KALENDER_ID
// leer, es wird kein zusaetzliches Argument angehaengt, und alles verhaelt sich
// exakt wie vorher.
//
// WARUM ES DAS GIBT (20.08.2026): Fuer die Werbeaufnahmen laeuft das Dashboard
// gegen eine Dreh-Datenbank mit erfundenen Firmen und Zahlen. Der Kalender
// steckt aber nicht in der Datenbank — er kommt ueber gws-cli aus Lukas'
// Google-Konto. In Creative 2 geht die Tagesansicht auf, und dort standen
// seine echten Termine.
//
// Ein zweites Google-Konto waere der schwere Weg gewesen (neue Anmeldung, neue
// Zustimmung). gws-cli kann aber jeden Kalender desselben Kontos ansprechen:
// list, create, update und delete nehmen alle -c <kalender-id>. Fuer den Dreh
// gibt es also einen zweiten Kalender im selben Konto, und KALENDER_ID zeigt
// darauf. Der echte wird nicht gelesen und nicht veraendert.
//
// BEWUSST EIN ARRAY statt eines Wertes: Die Aufrufstellen haengen es an ihre
// Argumentliste an. Ist nichts gesetzt, ist es leer — dann steht auch kein
// "-c primary" im Aufruf, und der Befehl sieht aus wie eh und je.
//
// NICHT ZWISCHENSPEICHERN: Beim Umschalten zwischen Betrieb und Dreh wird der
// Container neu gestartet, aber ein zwischengespeicherter Wert waere genau die
// Art Fehler, die man erst in der Aufnahme sieht.

const kalenderArgs = () => {
  const id = String(process.env.KALENDER_ID || "").trim();
  return id ? ["-c", id] : [];
};

// JEDER IN SEINEN EIGENEN KALENDER (18.09.2026)
//
// Lukas: "Aktuell werden die Termine von Jannik aber auch in mein Kalender
// gebucht, kann man das fixen, dass die Termine von Jannik auch in seinen
// Kalender gebucht werden?" — Ja. Der Kommentar in lib/crm.js sagte bisher,
// es gebe genau EINEN Zugang und fremde Termine landeten zwangslaeufig bei
// Lukas. Das stimmt fuer den ZUGANG, aber nicht fuer die KALENDER: Sein Konto
// ist "owner" auch auf jannikvomhofe@svhconsult.de, und gws-cli nimmt an jedem
// Schreibbefehl ein "-c <kalender-id>".
//
// Am 18.09.2026 am Server nachgemessen, nicht angenommen: ein Testtermin in
// Janniks Kalender wurde angelegt und wieder geloescht — beides erfolgreich.
// (Der erste Versuch scheiterte an "Bad Request"; Ursache war das fehlende
// Zeitzonen-Suffix im Zeitstempel, nicht das Recht. zeitNormal() in
// werkzeuge.js setzt es ohnehin.)
//
// WIE ZUGEORDNET WIRD: ueber die Anmelde-Mail. Die Konten heissen genauso wie
// die Kalender (lukas.sehorz@svhconsult.de, jannikvomhofe@svhconsult.de), die
// Mail IST also die Kalender-Kennung. Kein zweites Feld, das man pflegen
// muesste und das dann veraltet.
//
// WER KEINEN KALENDER HAT, BEKOMMT KEINEN EINTRAG. Fuer Ioannis, Louis und
// Okan gibt es im Konto keinen Kalender. Ihre Termine gingen bisher in Lukas'
// Kalender — das war der Grund fuer seine Frage. Entscheidung vom 18.09.:
// lieber kein Eintrag als ein fremder im eigenen Kalender. Die Aufgabe steht
// weiterhin im CRM und auf dem Whiteboard, es geht nichts verloren. Sobald
// jemand ein Konto mit Kalender hat, greift die Zuordnung von selbst.
//
// KALENDER_ID GEWINNT: Waehrend der Werbeaufnahmen zeigt sie auf den
// Drehkalender. Dann muss ALLES dorthin, auch fremde Aufgaben — sonst stuenden
// echte Termine in der Aufnahme.
const KALENDER_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Die Liste der beschreibbaren Kalender wird EINMAL geholt und gemerkt: Sie
// aendert sich hoechstens, wenn ein Konto dazukommt, und dann wird der
// Container neu gestartet. Ohne das Merken fragte jeder Termin erneut bei
// Google nach (rund eine Sekunde) — beim Hochladen einer Liste mit vielen
// Follow-ups summiert sich das.
let eigene = null;

async function schreibbareKalender() {
  if (eigene) return eigene;
  eigene = new Set();
  try {
    const { execFile } = require("child_process");
    const out = await new Promise((ok, fehler) => {
      execFile("gws-cli", ["calendar", "calendars"],
        { env: { ...process.env, GWS_ENCRYPTION: "none" }, timeout: 20000 },
        (e, so, se) => (e ? fehler(new Error(String(se || e.message).slice(0, 200))) : ok(String(so || ""))));
    });
    const roh = JSON.parse(out);
    const liste = JSON.parse(String((roh.calendars || {}).data || "[]"));
    for (const k of liste) {
      // owner und writer duerfen schreiben, reader nicht (Feiertagskalender).
      if (["owner", "writer"].includes(String(k.access_role || ""))) {
        eigene.add(String(k.id || "").toLowerCase());
      }
    }
  } catch (e) {
    // Kein Zugang, kein gws-cli, kein Netz: leere Menge. Dann faellt jeder
    // Aufruf auf den Hauptkalender zurueck — also genau das Verhalten von
    // vorher, statt gar keiner Termine.
    console.log("Kalenderliste nicht gelesen:", String((e && e.message) || e).slice(0, 120));
    eigene = null;
    return new Set();
  }
  return eigene;
}

// -> { args, ok, grund }
//   args   was an den gws-cli-Aufruf angehaengt wird
//   ok     false = fuer diese Person gibt es keinen Kalender, NICHT eintragen
async function kalenderFuer(mail) {
  const fest = String(process.env.KALENDER_ID || "").trim();
  if (fest) return { args: ["-c", fest], ok: true, grund: "kalender-id" };
  const m = String(mail || "").trim().toLowerCase();
  if (!m || !KALENDER_MAIL.test(m)) return { args: [], ok: true, grund: "keine-mail" };
  const da = await schreibbareKalender();
  // Leere Menge heisst "nicht ermittelbar" — dann wie bisher der Hauptkalender.
  if (!da.size) return { args: [], ok: true, grund: "liste-unbekannt" };
  if (da.has(m)) return { args: ["-c", m], ok: true, grund: "eigener" };
  return { args: [], ok: false, grund: "kein-kalender" };
}

module.exports = { kalenderArgs, kalenderFuer, schreibbareKalender };
