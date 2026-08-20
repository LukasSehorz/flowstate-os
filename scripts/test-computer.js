// Prueft die Aufbereitung der Flugsuche — ohne Netz, ohne Browser.
//
// WARUM ES DAS GIBT (20.08.2026): Die Suche selbst hat vom ersten Versuch an
// funktioniert; kaputt war, was danach kam. Am laufenden Server las Alexandra
// die Zeile vor, die Google Fluege anzeigt:
//
//   "185 € — 12:10, –, 20:20, IberiaDurchgeführt von Air Nostrum for Iberia,
//    8 Std. 10 Min., MUC–BCN, 1 Stopp, 4 Std. 5 Min. MAD, 234 kg CO2e,
//    +119 % (geschätzt), 185 €, Hin und zurück"
//
// Der Preis war richtig. Gehoert hat es trotzdem niemand. Genau dieser Schritt
// — Rohtext zu Sprache — wird hier festgenagelt, mit den ECHTEN Zeilen von
// diesem Tag als Vorlage. Er braucht kein Netz, laeuft also in scripts/pruefen.js
// mit und faellt auf, bevor jemand vor der Kamera steht.
//
// Aufruf:  node scripts/test-computer.js

const path = require("path");
const c = require(path.join(__dirname, "..", "lib", "computer.js"));
const { fuerStimme } = require(path.join(__dirname, "..", "lib", "aussprache.js"));

let fehler = 0;
const pruefe = (name, wahr, dazu = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !dazu ? "" : "\n   " + dazu));
  if (!wahr) fehler++;
};

// Echte Zeilen, am 20.08.2026 aus der Seite gelesen.
const MIT_STOPP = "12:10 |  –  | 20:20 | IberiaDurchgeführt von Air Nostrum for Iberia | 8 Std. 10 Min. | MUC–BCN | 1 Stopp | 4 Std. 5 Min. MAD | 234 kg CO2e | +119 % (geschätzt) | 185 € | Hin und zurück";
const NONSTOP = "21:10 |  –  | 23:30 | VuelingIberia | 2 Std. 20 Min. | MUC–BCN | Nonstop | 110 kg CO2e | -6 % (geschätzt) | 189 € | Hin und zurück";
const LUFTHANSA = "06:15 |  –  | 08:25 | Lufthansa City AirlinesLufthansa | 2 Std. 10 Min. | MUC–BCN | Nonstop | 95 kg CO2e | -11 % (geschätzt) | 230 € | Hin und zurück";

// --- Zerlegen ---------------------------------------------------------------
const a = c.angebotZerlegen(MIT_STOPP);
pruefe("Preis erkannt", a.preis === 185, "war: " + a.preis);
pruefe("Abflug/Ankunft erkannt", a.ab === "12:10" && a.an === "20:20", `war: ${a.ab}/${a.an}`);
pruefe("Dauer erkannt", a.dauer === "8 Std. 10 Min.", "war: " + a.dauer);
pruefe("Ein Stopp erkannt", a.stopps === 1, "war: " + a.stopps);
pruefe("Umsteigeflughafen erkannt", a.umstieg === "MAD", "war: " + a.umstieg);
pruefe("Fluglinie entklebt", a.linie === "Iberia", "war: " + a.linie);

const b = c.angebotZerlegen(NONSTOP);
pruefe("Nonstop erkannt", b.stopps === 0, "war: " + b.stopps);
pruefe("Doppelname getrennt (VuelingIberia)", b.linie === "Vueling", "war: " + b.linie);

const d = c.angebotZerlegen(LUFTHANSA);
pruefe("Leerzeichen im Namen bleiben (Lufthansa City Airlines)",
  d.linie === "Lufthansa City Airlines", "war: " + d.linie);

// --- Was NICHT mehr vorkommen darf ------------------------------------------
//
// Jeder Eintrag hier stand am 20.08. woertlich in der Sprachantwort.
const MUELL = [/CO2/i, /gesch(ä|ae)tzt/i, /Durchgef(ü|ue)hrt von/i, /%/, /MUC–BCN/, /Hin und zur(ü|ue)ck/i];
for (const roh of [MIT_STOPP, NONSTOP, LUFTHANSA]) {
  const zeile = c.angebotZeile(c.angebotZerlegen(roh));
  const satz = c.satzSprechen(c.angebotZerlegen(roh), { ort: "Barcelona", hin: "2026-08-22", grund: "" });
  const treffer = MUELL.filter((m) => m.test(zeile) || m.test(satz)).map(String);
  pruefe("Keine Rohdaten mehr in Zeile und Satz", !treffer.length, "gefunden: " + treffer.join(", ") +
    "\n   Zeile: " + zeile + "\n   Satz: " + satz);
}

// --- Der gesprochene Satz ---------------------------------------------------
const satz = c.satzSprechen(c.angebotZerlegen(MIT_STOPP),
  { ort: "Barcelona", hin: "2026-08-22", zurueck: "2026-08-25",
    grund: "weil du Freitag das Erstgespräch mit Albion hast" });
console.log("\n   Satz: " + satz);
pruefe("Preis steht drin", /185 Euro/.test(satz), satz);
pruefe("Stopp wird als Ort gesagt", /Stopp in Madrid/.test(satz), satz);
pruefe("Hin- und Ruecktag als Wochentag", /Hin am Samstag/.test(satz) && /zurück am Dienstag/.test(satz), satz);
pruefe("Dauer gerundet und hoerbar gerundet", /gut acht Stunden/.test(satz), satz);

// Einzahl. Ein Wiener Flug dauert "1 Std. 5 Min." — die erste Fassung sagte
// dazu "gut eins Stunden unterwegs" (gemessen 20.08.).
pruefe("Eine Stunde in der Einzahl", c.dauerSprechbar("1 Std. 5 Min.") === "gut eine Stunde",
  "war: " + c.dauerSprechbar("1 Std. 5 Min."));
pruefe("Halbe Stunden als Wort", c.dauerSprechbar("2 Std. 20 Min.") === "zweieinhalb Stunden",
  "war: " + c.dauerSprechbar("2 Std. 20 Min."));
pruefe("Kalendergrund steht drin", /weil du Freitag/.test(satz), satz);
pruefe("Die Absage steht drin", /Gebucht hab ich nichts/.test(satz), satz);
pruefe("Ein Satzgefuege, keine Liste", !satz.includes("\n") && !/^\d\./m.test(satz), satz);

// --- Und wie es klingt ------------------------------------------------------
//
// Der eigentliche Pruefpunkt: Was lib/aussprache.js daraus macht, ist das, was
// Lukas hoert. Zahlen, Uhrzeiten und Euro muessen ausgeschrieben ankommen —
// sonst buchstabiert die Stimme "1 8 5".
const gesprochen = fuerStimme(satz);
console.log("   Gehört: " + gesprochen);
pruefe("Preis wird ausgeschrieben", /einhundertfünfundachtzig Euro/.test(gesprochen), gesprochen);
// Wochentage statt Datum (Vorgabe Agent 2): "Hin am Samstag" spricht sich
// kuerzer als "am zweiundzwanzigsten August" und ist beim Hoeren merkbarer.
pruefe("Wochentage statt Datum", /Hin am Samstag/.test(gesprochen) && !/August/.test(gesprochen), gesprochen);
pruefe("Keine Ziffern mehr uebrig", !/\d/.test(gesprochen), gesprochen);

// --- Der gesprochene Text muss echte Umlaute tragen -------------------------
//
// In diesem Projekt sind Kommentare und interne Bezeichner ASCII ("naechste",
// "fuer"). Was gesprochen wird, darf das nicht sein — lib/aussprache.js kennt
// keine Wortliste, die "Guenstigster" wieder herstellt. Live gehoert wurde
// genau das: "Guenstigster Flug", "Google Fluege", "grundsaetzlich".
const ASCII_UMLAUT = /\w*(ae|oe|ue)\w*/g;
// Woerter, in denen ae/oe/ue echt vorkommen und kein Ersatz sind.
const ECHT = /^(Aeroflot|Duette|Douglas|Museum|neue[rnms]?|neu|Aequator|Manuel|Emanuel|aktuell\w*|individuell\w*|Queen\w*|Blue\w*|Vueling|Tuesday|virtuell\w*|eventuell\w*|Samuel|Genueg\w*)$/i;

for (const roh of [MIT_STOPP, NONSTOP, LUFTHANSA]) {
  const satz = c.satzSprechen(c.angebotZerlegen(roh),
    { ort: "Barcelona", hin: "2026-08-22", zurueck: "2026-08-25", grund: "" });
  const reste = (satz.match(ASCII_UMLAUT) || []).filter((w) => !ECHT.test(w));
  pruefe("Keine ASCII-Umlaute im Sprechtext", !reste.length,
    "gefunden: " + reste.join(", ") + " — " + satz);
  pruefe("Keine Adresse im Sprechtext", !/https?:|www\./.test(satz), satz);
  pruefe("Keine Uhrzeit-Minuten im Sprechtext", !/Min\./.test(satz), satz);
  // Agent 2s Mass: unter 45 gesprochenen Woertern. Gezaehlt wird, was die
  // Stimme sagt — ausgeschriebene Zahlen sind laenger als ihre Ziffern.
  const woerter = fuerStimme(satz).split(/\s+/).filter(Boolean).length;
  pruefe(`Unter 45 gesprochenen Woertern (${woerter})`, woerter < 45, fuerStimme(satz));
}

// Genau die Wendungen, die live falsch klangen.
pruefe("Kein 'eins Stopp'", !/eins Stopp/.test(c.satzSprechen(c.angebotZerlegen(MIT_STOPP), { ort: "x", hin: "2026-08-22" })), "");
pruefe("Kein 'eins Stunden'", !/eins Stunden/.test(c.dauerSprechbar("1 Std. 45 Min.")),
  "war: " + c.dauerSprechbar("1 Std. 45 Min."));

// --- Kalendertitel kuerzen --------------------------------------------------
//
// Echter Titel vom laufenden Server. Die Klammer ist Lukas' Notiz an sich
// selbst und wurde am 20.08. mit vorgelesen.
pruefe("Kalendertitel geputzt",
  c.terminKurz("Erstgespräch Albion (Seite muss noch gemacht werden +Zoom)") === "Erstgespräch Albion",
  "war: " + c.terminKurz("Erstgespräch Albion (Seite muss noch gemacht werden +Zoom)"));

// --- Das Skript, das IN der Seite laeuft -------------------------------------
//
// angeboteLesen() wird an page.evaluate uebergeben und dort ausgefuehrt. Hier
// laeuft es gegen ein nachgebautes document — so faellt ein Tippfehler auf,
// ohne dass ein Browser starten muss.
const machDoc = (texte) => ({
  querySelectorAll: () => texte.map((t) => ({ innerText: t })),
});
global.document = machDoc([
  "12:10\n–\n20:20\nIberia\n8 Std. 10 Min.\nMUC–BCN\n1 Stopp\n185 €\nHin und zurück",
  "12:10\n–\n20:20\nIberia\n8 Std. 10 Min.\nMUC–BCN\n1 Stopp\n185 €\nHin und zurück",  // dieselbe nochmal
  "ohne Preis, darf nicht durchkommen",
]);
const gelesen = c.angeboteLesen();
delete global.document;
pruefe("Seiten-Skript liest Angebote und wirft Doppelte weg", gelesen.length === 1,
  "gelesen: " + JSON.stringify(gelesen));

console.log(fehler ? `\n${fehler} Fall/Faelle durchgefallen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
