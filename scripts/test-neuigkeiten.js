// Testet die Zuordnung von Bereich und Zeitraum fuer "was ist neu?".
//
// Warum es das gibt (Lukas, 05.08.2026): "Wenn ich anrufe: was ist heute neu im
// CRM im Vergleich zu gestern, dann soll da die richtige Antwort schnell
// kommen. Und das fuer alle Systeme vom Operating System."
//
// Geprueft wird hier die Deutung, nicht die Datenbank — welcher Bereich ist
// gemeint, welcher Zeitraum. Genau daran haengt, ob die Antwort passt: "im CRM"
// darf nicht die Buchhaltung mitziehen, und "diese Woche" nicht bei gestern
// aufhoeren. Die Abfragen selbst pruefe ich gegen die echte Datenbank
// (scripts/rauchtest-sprache.js laeuft dort ohnehin).
//
// Aufruf: node scripts/test-neuigkeiten.js

const { zeitraumAus, bereichAus } = require("../lib/neuigkeiten.js");

let fehler = 0;
function pruefe(name, wahr, bekommen) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr ? "" : `   bekommen: ${bekommen}`));
  if (!wahr) fehler++;
}
const b = (t) => bereichAus(t);
const z = (t) => zeitraumAus(t).wort;

// --- Bereiche: so, wie Lukas sie im Auto nennt ----------------------------
pruefe("CRM ueber 'CRM'", b("was ist neu im CRM") === "crm", b("was ist neu im CRM"));
pruefe("CRM ueber 'Kunden'", b("gibt es was Neues bei den Kunden") === "crm");
pruefe("CRM ueber 'Leads'", b("neue Leads?") === "crm");
pruefe("CRM ueber 'Deals'", b("hat sich bei den Deals was getan") === "crm");
pruefe("Buchhaltung ueber 'Rechnungen'", b("neue Rechnungen?") === "buchhaltung");
pruefe("Buchhaltung ueber 'Belege'", b("sind Belege reingekommen") === "buchhaltung");
pruefe("Marketing ueber 'Content'", b("was lief beim Content") === "marketing");
pruefe("Marketing ueber 'Kampagnen'", b("gibt es neue Kampagnen") === "marketing");
pruefe("Projekte", b("was ist bei den Projekten passiert") === "projekte");
pruefe("Ohne Bereich: alles", b("was ist neu") === "alles", b("was ist neu"));
pruefe("Ohne Bereich: alles (zweite Form)", b("hat sich was getan") === "alles");

// --- Zeitraeume -----------------------------------------------------------
pruefe("'heute' ist heute", z("was ist heute neu") === "heute", z("was ist heute neu"));
pruefe("'gestern' ist seit gestern", z("was seit gestern") === "seit gestern");
pruefe("'diese Woche' sind sieben Tage",
  z("was gab es diese Woche") === "in den letzten sieben Tagen", z("was gab es diese Woche"));
pruefe("'Monat' sind dreissig Tage", z("was im letzten Monat") === "im letzten Monat");

// Vorgabe ist BEWUSST "seit gestern", nicht "heute": Wer morgens um acht fragt,
// soll nicht "nichts Neues" hoeren, waehrend gestern Abend zehn Dinge passiert
// sind. Lieber eine Stunde zu viel als eine leere Antwort.
pruefe("Ohne Zeitangabe: seit gestern, nicht heute",
  z("was ist neu im CRM") === "seit gestern", z("was ist neu im CRM"));

// --- Der Fall aus Lukas' Frage --------------------------------------------
const f = "was ist heute neu im CRM im Vergleich zu gestern";
pruefe("Lukas' Satz: Bereich CRM", b(f) === "crm", b(f));
pruefe("Lukas' Satz: Zeitraum greift", ["heute", "seit gestern"].includes(z(f)), z(f));

// Die Grenze ist ein Tagesbeginn, kein "vor 24 Stunden" — sonst faellt bei
// einer Frage um 9 Uhr alles von gestern frueh heraus.
const g = zeitraumAus("seit gestern").seit;
pruefe("Grenze liegt auf Mitternacht", g.getHours() === 0 && g.getMinutes() === 0,
  g.toLocaleString("de-DE"));

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
