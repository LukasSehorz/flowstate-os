// Prueft den Aussprache-Umwandler gegen die Formen, die im echten Zustand
// vorkommen (gemessen am 20.07.2026 auf dem VPS).
// Aufruf: node scripts/aussprache-test.js

const { fuerStimme, zahlWort, ordnungsWort } = require("../lib/aussprache.js");

const zahlen = [
  [0, "null"], [1, "eins"], [7, "sieben"], [11, "elf"], [16, "sechzehn"],
  [21, "einundzwanzig"], [30, "dreißig"], [47, "siebenundvierzig"],
  [100, "einhundert"], [134, "einhundertvierunddreißig"],
  [1000, "eintausend"], [2000, "zweitausend"],
  [12400, "zwölftausendvierhundert"],
  [34500, "vierunddreißigtausendfünfhundert"],
];

const saetze = [
  ["Morgen um 11:00 Uhr steht der Call an.",
   "Morgen um elf Uhr steht der Call an."],
  ["Von 08:00-09:30 Physio, dann 16:00 WM Bau.",
   "Von acht Uhr bis neun Uhr dreißig Physio, dann sechzehn Uhr WM Bau."],
  ["Die Pipeline liegt bei 34.500 EUR.",
   "Die Pipeline liegt bei vierunddreißigtausendfünfhundert Euro."],
  ["Umsatz 12.400 EUR, 3 Deals gewonnen, 47 Leads.",
   "Umsatz zwölftausendvierhundert Euro, drei Deals gewonnen, siebenundvierzig Leads."],
  ["Stand vor 40 Min.",
   "Stand vor vierzig Minuten"],
  ["Am 2026-07-21 ist ein Termin.",
   "Am einundzwanzigster Juli ist ein Termin."],
  ["ROAS stieg um 12,5 %.",
   "ROAS stieg um zwölf Komma fünf Prozent."],
  ["Das war 2026 ein gutes Jahr.",
   "Das war 2026 ein gutes Jahr."],          // Jahreszahl bleibt
  ["Leads: 47 · Kunden: 12",
   "Leads: siebenundvierzig, Kunden: zwölf"],
];

let fehler = 0;

console.log("── Zahlen ──");
for (const [n, soll] of zahlen) {
  const ist = zahlWort(n);
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? "✓" : "✗"} ${String(n).padStart(6)} → ${ist}${ok ? "" : `   (erwartet: ${soll})`}`);
}

console.log("\n── Sätze ──");
for (const [ein, soll] of saetze) {
  const ist = fuerStimme(ein);
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? "✓" : "✗"} ${ein}`);
  console.log(`    → ${ist}`);
  if (!ok) console.log(`    erwartet: ${soll}`);
}

console.log(fehler ? `\n${fehler} Fall/Fälle fehlgeschlagen` : "\nAlle Fälle bestanden");
process.exit(fehler ? 1 : 0);
