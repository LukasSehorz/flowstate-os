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

module.exports = { kalenderArgs };
