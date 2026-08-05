// Testet die Weiche, die entscheidet: Dokument bauen oder an Hermes geben.
//
// Warum es das gibt (05.08.2026): Aus zwoelf Tagen Sprachlog — 21
// Hermes-Auftraege, 9 gescheitert (43 %), Median 142 Sekunden. Acht davon
// waren Dokumente, und sieben davon sind gescheitert oder brauchten ueber zwei
// Minuten. Hermes war im Kern eine Dokumenten-Werkstatt, die nicht
// funktioniert; die baut jetzt die Claude-API mit ihren eigenen Faehigkeiten.
//
// An dieser Weiche haengt alles: Wird ein Dokument nicht erkannt, geht es
// weiter an Hermes und scheitert wie bisher. Wird ein Systemkommando
// faelschlich als Dokument gedeutet, versucht die Werkstatt eine PowerPoint
// ueber "Modell auf sol umstellen" zu bauen.
//
// Aufruf: node scripts/test-dokument.js

const { istDokument, sorteAus } = require("../lib/dokument.js");

let fehler = 0;
function dok(frage, sorte) {
  const ok = istDokument(frage) && sorteAus(frage) === sorte;
  console.log((ok ? "✅" : "❌") + ` "${frage}"` +
    (ok ? "" : `\n   erwartet: ${sorte}   bekommen: ${istDokument(frage) ? sorteAus(frage) : "kein Dokument"}`));
  if (!ok) fehler++;
}
function keinDok(frage) {
  const ok = !istDokument(frage);
  console.log((ok ? "✅" : "❌") + ` (nicht) "${frage}"` + (ok ? "" : `\n   faelschlich erkannt als ${sorteAus(frage)}`));
  if (!ok) fehler++;
}

// --- Genau die Auftraege, an denen Hermes gescheitert ist ------------------
dok("Kurze PowerPoint-Präsentation über Performance Marketing", "pptx");
dok("Erstelle eine PowerPoint-Präsentation über den FC Bayern München", "pptx");
dok("Einen One-Pager über den FC Bayern München erstellen", "pptx");
dok("Kurzer Onepager über ChatGPT erstellen", "pptx");
dok("Kurze PowerPoint als One-Pager zum Thema KI in der Zukunft", "pptx");

// --- Die uebrigen Sorten ---------------------------------------------------
dok("mach mir ein PDF mit den Zahlen", "pdf");
dok("erstell eine Excel-Tabelle mit den Leads", "xlsx");
dok("schreib ein Angebot für Krotzer", "docx");
dok("verfass einen Bericht über den Monat", "docx");
dok("bau mir ein paar Folien für den Termin", "pptx");

// "Angebot als PDF" ist ein PDF, kein Word — die Reihenfolge der Erkennung
// entscheidet das, deshalb steht sie hier fest.
dok("mach das Angebot als PDF", "pdf");

// --- Was bei Hermes bleiben MUSS ------------------------------------------
//
// Das sind Systemkommandos. Wuerden sie hier landen, versuchte die Werkstatt
// eine Datei darueber zu bauen, statt die Einstellung zu aendern.
keinDok("ändere das Modell auf sol");
keinDok("wie ist der Server-Status");
keinDok("leg eine Routine an, die jeden Morgen die Mails prüft");
keinDok("starte den Agenten neu");
keinDok("was steht heute an");

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
