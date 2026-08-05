// Testet, dass veraltete Zahlen NICHT im STAND landen.
//
// Warum es das gibt (05.08.2026, aus dem grossen Durchlauf): Auf "sind noch
// Rechnungen offen?" antwortete Alexandra ueberzeugt "Nein, alles beglichen" —
// aus Zahlen, die 11.056 Minuten alt waren. 7,7 Tage.
//
// Zwei Fehler steckten dahinter, beide behoben:
//
//   1. Die Auffrischung erneuerte nur den Kalender. CRM, Buchhaltung und Ads
//      hatten zwar Frischegrenzen, aber niemand hat sie je abgerufen
//      (server.js, ["kalender"] statt veraltet()).
//   2. Selbst veraltete Zahlen standen im STAND — mit einem Hinweis "(Stand
//      vor 11056 Min.)", den kein Modell als Warnung liest.
//
// Der zweite ist der wichtigere. Ein Hinweis verlangt, dass das Modell RICHTIG
// ENTSCHEIDET; eine Luecke macht die falsche Antwort UNMOEGLICH — dann greift
// Alexandra zum Werkzeug und bekommt in 100 ms den echten Wert.
//
// Eine falsche Zahl, selbstbewusst vorgetragen, ist schlimmer als keine.
//
// Aufruf: node scripts/test-zustand-frische.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname;
const zustand = require("../lib/zustand.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

const vorMin = (m) => Date.now() - m * 60000;
const KENNZAHLEN = {
  leads: 23, kunden: 6, offene_deals: 8, pipeline_wert: 25000,
  gewonnen_monat: 6, umsatz_monat: 5000, wiedervorlagen: 2, offene_aufgaben: 6,
};
const drin = (z, marker) => zustand.alsText(z).includes(marker);

// --- Genau der Fall aus dem Durchlauf --------------------------------------
pruefe("Buchhaltung von vor 7,7 Tagen faellt raus",
  !drin({ stand: { buchhaltung: vorMin(11056) }, buchhaltung: { anzahl: 0, summe: 0 } }, "BUCHHALTUNG"));

// --- Frisches bleibt drin, sonst waere die Kur schlimmer als die Krankheit --
pruefe("Buchhaltung von vor 2 Stunden bleibt",
  drin({ stand: { buchhaltung: vorMin(120) }, buchhaltung: { anzahl: 3, summe: 900 } }, "BUCHHALTUNG"));
pruefe("CRM von vor 10 Minuten bleibt",
  drin({ stand: { crm: vorMin(10) }, crm: { kennzahlen: KENNZAHLEN } }, "## CRM"));

// --- Abgelaufenes faellt raus ----------------------------------------------
pruefe("CRM von vor 8 Stunden faellt raus (Frische 1 h, dreifach = 3 h)",
  !drin({ stand: { crm: vorMin(480) }, crm: { kennzahlen: KENNZAHLEN } }, "## CRM"));

// --- Ohne Zeitstempel gibt es nichts zu behaupten --------------------------
pruefe("Nie geholte Daten stehen nicht im STAND",
  !drin({ stand: {}, buchhaltung: { anzahl: 0, summe: 0 } }, "BUCHHALTUNG"));

// --- Der Denkfehler aus meinem ersten Entwurf ------------------------------
//
// Er gab "brauchbar" zurueck, wenn KEINE Frischegrenze definiert war — und
// FRISCHE.buchhaltung existiert nur mit gesetzter DATABASE_URL. Ohne sie galt
// die 7,7 Tage alte Zahl als "ohne Frischeanspruch" und damit ewig gueltig.
// Was einen Zeitstempel traegt, kann veralten. Ausnahmslos.
pruefe("Auch ohne definierte Frischegrenze gilt eine Vorgabe",
  !drin({ stand: { irgendwas: vorMin(11056) }, irgendwas: {} }, "irgendwas"));

// --- Der Kalender darf davon nicht betroffen sein --------------------------
//
// Er wird alle 5 Minuten aufgefrischt und ist das Herz des Tagesgeschaefts.
pruefe("Kalender von vor 3 Minuten bleibt",
  drin({ stand: { kalender: vorMin(3) }, kalender: [{ start: new Date().toISOString(), titel: "Testtermin" }] }, "KALENDER"));

// --- veraltet() muss melden, was aufzufrischen ist -------------------------
//
// Es gab die Funktion schon; sie wurde nur nie aufgerufen. Genau deshalb sind
// die Zahlen 7,7 Tage alt geworden.
const alt = zustand.veraltet({ stand: { kalender: vorMin(60), crm: vorMin(600) } });
pruefe("veraltet() meldet den abgelaufenen Kalender", alt.includes("kalender"));
pruefe("veraltet() meldet das abgelaufene CRM", alt.includes("crm"));

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
