// Prueft, dass aus einem Betrag derselbe Betrag wird.
//
// WARUM (Fehler gefunden am 21.08.2026): zuBetrag() in lib/buchhaltung.js war
// fuer das Formularfeld gebaut — "1.234,56" heisst dort tausendzweihundert.
// Also: alle Punkte weg, Komma wird Punkt. Richtig fuer Getipptes.
//
// Der Belegleser gibt betrag aber als ZAHL zurueck, und lib/beleg-telegram.js
// reicht sie unveraendert an /buchhaltung/beleg/buchen weiter. Aus 37.3 wurde
// dort "37.3", daraus "373". Gemessen mit dem echten Bon vom Asia-Imbiss:
// 37,30 Euro auf dem Papier, 373,00 Euro in der Datenbank. Betroffen war jeder
// per Telegram gebuchte Beleg mit Nachkommastellen — also praktisch jeder.
//
// Aufgefallen ist es nur, weil derselbe Beleg im Anzeigen-Dreh vor laufender
// Kamera eingelesen wird und die Zahl dabei im Bild steht. Ohne diesen Test
// faellt so etwas beim naechsten Umbau genauso still wieder hinein.
//
//   node scripts/test-betrag.js

const buch = require("../lib/buchhaltung.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

const faelle = [
  // Was der Belegleser liefert: fertige Zahlen. Die duerfen sich nicht aendern.
  [37.3, 37.3, "Zahl vom Belegleser bleibt, wie sie ist"],
  [259.8, 259.8, "Zahl mit einer Nachkommastelle"],
  [8000, 8000, "runde Zahl"],
  [0, 0, "null"],

  // Was im Formular steht: deutsche Schreibweise.
  ["37,30", 37.3, "Komma trennt die Cent"],
  ["1.234,56", 1234.56, "Punkt ist Tausender, Komma trennt"],
  ["12,00 €", 12, "Eurozeichen und Leerzeichen stoeren nicht"],
  ["1234,5", 1234.5, "ohne Tausenderpunkt"],

  // Nur Punkte — hier lag der Fehler.
  ["37.3", 37.3, "ein Punkt mit einer Ziffer trennt die Nachkommastellen"],
  ["37.30", 37.3, "ein Punkt mit zwei Ziffern ebenso"],
  ["1.234", 1234, "ein Punkt mit DREI Ziffern ist ein Tausenderpunkt"],
  ["1.234.567", 1234567, "mehrere Tausenderpunkte"],
  [" 8.000 ", 8000, "Leerzeichen aussen herum"],

  // Was abgelehnt gehoert.
  ["-5", null, "ein negativer Belegbetrag wird abgelehnt"],
  ["abc", null, "Text ist kein Betrag"],
];

console.log("— Aus einem Betrag wird derselbe Betrag —");
for (const [ein, soll, was] of faelle) {
  const ist = buch.zuBetrag(ein);
  pruefe(`${JSON.stringify(ein)} → ${soll}   (${was})`, ist === soll,
    `bekommen: ${ist}`);
}

// Der konkrete Fall, an dem es aufgefallen ist.
pruefe("der Bon vom 31.07. bleibt bei 37,30 und wird nicht zu 373",
  buch.zuBetrag(37.3) === 37.3 && buch.zuBetrag(37.3) !== 373);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
process.exit(fehler ? 1 : 0);
