// Prueft den Tabellen-Import der Anrufliste (lib/crm-routes.js) — die Stelle
// in der Datei, die seit 06.10.2026 als Position mitwandert (Migration 0079).
//
// Lukas: "Wenn ich bei Nr. 10 telefoniere, muss im CRM an Position 10 derselbe
// Betrieb stehen." Faellt die Nr beim naechsten Umbau des Imports still weg,
// sieht die Liste weiterhin ganz normal aus — nur in falscher Reihenfolge.
// Darum hier, ohne Datenbank.
//
//   node scripts/test-lead-import.js

const { zeilenZuLeads, csvZerlegen } = require("../lib/crm-routes.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};
const tsv = (zeilen) => csvZerlegen(zeilen.map((z) => z.join("\t")).join("\n"), "\t");

// 1) Kopfzeile wie in der KI-Regional-Liste vom 06.10.: Nr vorne, mit Luecke.
{
  const leads = zeilenZuLeads(tsv([
    ["Nr", "Stufe", "Branche", "Firma", "Telefon", "Chef (laut Webseite)", "Ort", "Webseite"],
    ["1", "A · große Lücke", "Heizung/Sanitär", "Kaspar Haustechnik", "+49 89 1", "", "Vaterstetten", "kaspar.de"],
    ["2", "A · große Lücke", "Kosmetik", "Tina beauty lounge", "+49 160 2", "", "Neuötting", ""],
    ["5", "B · Lücke", "PV", "Sonnen GmbH", "+49 8081 5", "", "Dorfen", ""],
  ]));
  pruefe("Nr-Spalte: drei Leads gelesen", leads.length === 3, JSON.stringify(leads.map((l) => l.name)));
  pruefe("Nr-Spalte: Nr wird uebernommen (1, 2, 5)", leads.map((l) => l.nr).join(",") === "1,2,5",
    leads.map((l) => l.nr).join(","));
  pruefe("Nr-Spalte: Zeilenfolge daneben (1, 2, 3)", leads.map((l) => l.zeile).join(",") === "1,2,3");
  pruefe("Nr-Spalte: Firma/Telefon/Ort bleiben richtig zugeordnet",
    leads[0].name === "Kaspar Haustechnik" && leads[0].telefon === "+49 89 1" && leads[0].ort === "Vaterstetten");
}

// 2) Ohne Nr-Spalte: nur die Zeilenfolge.
{
  const leads = zeilenZuLeads(tsv([
    ["Firma", "Ort", "Telefon"],
    ["Alpha", "München", "+49 89 1"],
    ["", "", ""],
    ["Beta", "Erding", "+49 8122 2"],
  ]));
  pruefe("Ohne Nr: keine nr gesetzt", leads.every((l) => l.nr === undefined));
  pruefe("Ohne Nr: Zeilenfolge 1 und 2 (Leerzeile faellt raus)", leads.map((l) => l.zeile).join(",") === "1,2",
    leads.map((l) => l.zeile).join(","));
}

// 3) Andere Schreibweisen der Nummer und kaputte Werte.
{
  const leads = zeilenZuLeads(tsv([
    ["Lfd. Nr.", "Firma", "Ort", "Telefon"],
    ["7.", "Alpha", "München", "+49 89 1"],
    ["8a", "Beta", "Erding", "+49 8122 2"],
    ["", "Gamma", "Dorfen", "+49 8081 3"],
  ]));
  pruefe("'Lfd. Nr.' wird erkannt, '7.' gilt als 7", leads[0].nr === 7, String(leads[0].nr));
  pruefe("'8a' und leer sind keine Nr (Rueckfall auf die Zeile)", leads[1].nr === undefined && leads[2].nr === undefined);
}

// 4) "Position" ist in Lead-Listen meist die Rolle — darf NICHT als Nr gelten.
{
  const leads = zeilenZuLeads(tsv([
    ["Firma", "Ansprechpartner", "Position", "Telefon"],
    ["Alpha", "Max Muster", "Geschäftsführer", "+49 89 1"],
  ]));
  pruefe("'Position' wird nicht als Nr gelesen", leads[0].nr === undefined);
}

// 5) Ohne erkennbare Kopfzeile (feste Reihenfolge) — die Kopfzeile "Firma"
//    wird verworfen, die Zeilenfolge beginnt trotzdem bei 1.
{
  const leads = zeilenZuLeads(tsv([
    ["Firma", "Ort"],
    ["Alpha", "München"],
    ["Beta", "Erding"],
  ]));
  pruefe("Feste Reihenfolge: zwei Leads ab Zeile 1", leads.length === 2 && leads[0].zeile === 1 && leads[1].zeile === 2,
    JSON.stringify(leads.map((l) => [l.name, l.zeile])));
}

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles richtig.");
process.exit(fehler ? 1 : 0);
