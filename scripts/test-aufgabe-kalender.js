// scripts/test-aufgabe-kalender.js — CRM-Aufgabe -> Google Kalender, OHNE
// Datenbank und OHNE gws-cli.
//
//   node scripts/test-aufgabe-kalender.js
//
// Laeuft in scripts/pruefen.js mit. Geprueft wird die ENTSCHEIDUNG, nicht das
// Schreiben: Bekommt diese Aufgabe einen eigenen Kalendereintrag, an welchem
// Tag, unter welchem Titel? Das Schreiben selbst (werkzeuge.terminEintragen,
// kalender-akte.verknuepfungSetzen) ist anderswo geprueft und braucht ein
// echtes Google-Konto.
//
// Der wichtigste Fall steht in Abschnitt 2: Ein gebuchtes Erstgespraech steht
// ueber erstgespraechSynchronisieren SCHON mit Uhrzeit im Kalender. Es darf
// KEINEN zweiten, ganztaegigen Eintrag geben. Erkannt wird das an der
// 'erstgespraech'-Verknuepfung der Firma, nicht am Titel — der Titel ist
// Anzeigetext (dieselbe Lehre wie in Migration 0066).
//
// Abschnitt 4 prueft die andere Haelfte des Auftrags: dass die Aufgaben aus
// einem Anrufergebnis in der fuenften Whiteboard-Kategorie "crm" landen und
// von Hand angelegte weiterhin bei "kunden" — und dass die fuenf festen
// Plaetze im Server dieselben sind wie im Client.

const crm = require("../lib/crm.js");
const bruecke = require("../lib/aufgaben-tafel.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };
const gleich = (a, b, text) => melde(JSON.stringify(a) === JSON.stringify(b),
  text + (JSON.stringify(a) === JSON.stringify(b) ? "" : `  (war ${JSON.stringify(a)}, erwartet ${JSON.stringify(b)})`));

const aufgabe = (extra = {}) => ({
  id: 7, titel: "Nochmal anrufen", firma_id: 42, firma_name: "Muster GmbH",
  geplant_am: "2026-09-12", faellig: "2026-09-12", anlass: "anruf:keine-zeit",
  erledigt: false, notiz: "", ...extra,
});

// ------------------------------------------------ 1. Wer bekommt einen Eintrag
const p1 = crm.aufgabeKalenderPlan(aufgabe());
melde(p1.eintrag === true && p1.ganztags === true, "Aufgabe mit Firma und Datum: ganztaegiger Eintrag");
gleich(p1.tag, "2026-09-12", "Tag kommt aus geplant_am");
gleich(p1.titel, "CRM: Nochmal anrufen — Muster GmbH", "Titel: CRM: <Titel> — <Firma>");

gleich(crm.aufgabeKalenderPlan(aufgabe({ firma_id: null })).grund, "keine-firma",
  "ohne Firma kein Eintrag");
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_am: null, faellig: null })).grund, "kein-datum",
  "ohne Datum kein Eintrag (niemand wuesste, wohin damit)");
gleich(crm.aufgabeKalenderPlan(aufgabe({ erledigt: true })).grund, "erledigt",
  "erledigte Aufgabe: kein Eintrag (der vorhandene wird abgesagt)");
gleich(crm.aufgabeKalenderPlan(aufgabe(), { an: false }).grund, "abgeschaltet",
  "KALENDER_AUFGABEN=aus: kein Eintrag");

// geplant_am geht vor faellig — der geplante Tag ist der, an dem gearbeitet wird.
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_am: "2026-09-14", faellig: "2026-09-30" })).tag,
  "2026-09-14", "geplant_am geht vor faellig");
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_am: null, faellig: "2026-09-30" })).tag,
  "2026-09-30", "ohne geplant_am zaehlt faellig");

// Ein date-Feld kommt aus Postgres als Date auf LOKALE Mitternacht. Wer hier
// toISOString() nimmt, macht daraus in Berlin den Vortag.
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_am: new Date(2026, 8, 12, 0, 0, 0) })).tag,
  "2026-09-12", "Date-Objekt: lokaler Tag, kein UTC-Rutsch");
// Ein voller Zeitstempel als Text wird auf den Tag gekuerzt.
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_am: "2026-09-12T00:00:00.000Z" })).tag,
  "2026-09-12", "Zeitstempel als Text: nur der Tag zaehlt");

// ------------------------------------------------ 2. Kein zweiter Erstgespraechs-Termin
const gebucht = aufgabe({ anlass: "anruf:gebucht", titel: "Erstgespräch am 12.09. um 10:00" });
gleich(crm.aufgabeKalenderPlan(gebucht, { erstgespraechImKalender: true }).grund, "erstgespraech-steht",
  "gebuchtes Erstgespräch mit Termin: KEIN zweiter Eintrag");
melde(crm.aufgabeKalenderPlan(gebucht, { erstgespraechImKalender: false }).eintrag === true,
  "gebucht, aber (noch) kein Termin im Kalender: Eintrag ja");
// "Gebucht ohne Zeitpunkt" gibt es — dann ist die Aufgabe eine andere
// ("Termin nachtragen") und es gibt nichts, was doppelt waere.
melde(crm.aufgabeKalenderPlan(
  aufgabe({ anlass: "anruf:gebucht", titel: "Erstgespräch — Termin nachtragen" }),
  { erstgespraechImKalender: false }).eintrag === true,
  "gebucht ohne Zeitpunkt: eigener ganztaegiger Eintrag");
// Die Sperre greift NUR beim Anlass 'anruf:gebucht'. Ein Follow-up bei einer
// Firma, die vor Wochen schon ein Erstgespräch hatte, bekommt seinen eigenen.
melde(crm.aufgabeKalenderPlan(aufgabe({ anlass: "anruf:follow-up" }),
  { erstgespraechImKalender: true }).eintrag === true,
  "Follow-up bei Firma mit altem Erstgespräch: eigener Eintrag");

// ------------------------------------------------ 3. Wessen Kalender
// Es gibt genau EINEN Google-Zugang (Lukas'). Aufgaben anderer landen darum
// ebenfalls dort — und tragen deren Vornamen vorn, damit er sie unterscheidet.
gleich(crm.aufgabeKalenderPlan(aufgabe(), { personName: "Louis Tournier" }).titel,
  "CRM: Louis — Nochmal anrufen — Muster GmbH", "fremde Aufgabe: Vorname vorn");
gleich(crm.aufgabeKalenderPlan(aufgabe(), { personName: "" }).titel,
  "CRM: Nochmal anrufen — Muster GmbH", "eigene Aufgabe: kein Vorsatz");
melde(crm.aufgabeKalenderPlan(aufgabe({ titel: "x".repeat(300) }), {}).titel.length <= 200,
  "Titel auf 200 Zeichen gedeckelt (Grenze von werkzeuge.terminEintragen)");

// Die Beschreibung: Notiz und Verantwortlicher. Die Akte-Zeile haengt
// kalender-akte.beschreibungMitAkte danach an — sie ist dort geprueft.
const text = crm.aufgabeKalenderText(aufgabe({ notiz: "Ruft ab 14 Uhr an" }), "Louis Tournier");
melde(/Aufgabe aus dem CRM: Nochmal anrufen/.test(text), "Beschreibung nennt die Aufgabe");
melde(/Verantwortlich: Louis Tournier/.test(text), "Beschreibung nennt den Verantwortlichen");
melde(/Notiz: Ruft ab 14 Uhr an/.test(text), "Beschreibung traegt die Notiz");

// ------------------------------------------------ 4. Anlass -> Kategorie -> Platz
gleich(crm.kategorieFuerAnlass("anruf:gebucht"), "crm", "anruf:gebucht -> CRM-Block");
gleich(crm.kategorieFuerAnlass("anruf:follow-up"), "crm", "anruf:follow-up -> CRM-Block");
gleich(crm.kategorieFuerAnlass("anruf:keine-zeit"), "crm", "anruf:keine-zeit -> CRM-Block");
gleich(crm.kategorieFuerAnlass(null), "kunden", "von Hand angelegt -> Kunden-Block");
gleich(crm.kategorieFuerAnlass(""), "kunden", "leerer Anlass -> Kunden-Block");

// Drei Ergebnisse legen eine Aufgabe an, drei nicht.
gleich(Object.keys(crm.ANRUF_ANLASS).sort(), ["follow-up", "gebucht", "keine-zeit"],
  "genau drei Ergebnisse erzeugen eine Aufgabe");
for (const ohne of ["nicht-erreicht", "absage", "webseite-zu-gut"])
  melde(!crm.ANRUF_ANLASS[ohne], `"${ohne}" erzeugt weiterhin keine Aufgabe`);

// "Später nochmal": Titel und Tag.
const spaeter = crm.anrufAufgabePlanen("keine-zeit", { datum: "2026-09-15", notiz: "" });
gleich(spaeter.titel, "Nochmal anrufen", "Später nochmal: Titel");
gleich(spaeter.tag, "2026-09-15", "Später nochmal: Tag aus der Wiedervorlage");
const spaeterNotiz = crm.anrufAufgabePlanen("keine-zeit", { datum: "2026-09-15", notiz: "Ruft ab 14 Uhr an" });
gleich(spaeterNotiz.titel, "Nochmal anrufen · Ruft ab 14 Uhr an", "Später nochmal: Notiz als Stichpunkt");
// Ohne Wiedervorlage: drei Werktage voraus, nie Samstag oder Sonntag.
const ohneDatum = crm.anrufAufgabePlanen("keine-zeit", {});
const wochentag = new Date(ohneDatum.tag + "T12:00:00").getDay();
melde(wochentag !== 0 && wochentag !== 6, "ohne Wiedervorlage: drei Werktage, kein Wochenende");

// Die fuenf festen Plaetze — der Server (lib/aufgaben-tafel.js) muss dieselben
// Zahlen kennen wie der Client (public/lib/whiteboard.js, platzVon/ORD_X/ORD_Y),
// sonst legt er einen neuen Block woandershin, als der Client beim Ordnen.
gleich(bruecke.KATEGORIEN, ["kunden", "vertrieb", "content", "intern", "crm"],
  "fuenf Kategorien in der Rangfolge");
gleich(bruecke.platzVon("kunden"),   { x: 130,  y: 100 }, "Platz 1 Kunden");
gleich(bruecke.platzVon("vertrieb"), { x: 900,  y: 100 }, "Platz 2 Vertrieb");
gleich(bruecke.platzVon("content"),  { x: 1670, y: 100 }, "Platz 3 Content");
gleich(bruecke.platzVon("intern"),   { x: 130,  y: 760 }, "Platz 4 Intern");
gleich(bruecke.platzVon("crm"),      { x: 900,  y: 760 }, "Platz 5 CRM");
gleich(bruecke.platzVon("gibtsnicht"), { x: 130, y: 100 },
  "unbekannte Kategorie faellt auf den Kunden-Platz zurueck");

// Kein Platz ragt ueber die Tafel: x + Blockbreite bleibt innerhalb 2400.
for (const k of bruecke.KATEGORIEN) {
  const p = bruecke.platzVon(k);
  melde(p.x + bruecke.BLOCK_BREITE <= bruecke.TAFEL.breite,
    `Platz ${k}: ${p.x} + ${bruecke.BLOCK_BREITE} = ${p.x + bruecke.BLOCK_BREITE} passt auf 2400`);
}

// Und der Client kennt genau dieselben Zahlen — nachgelesen im Quelltext,
// weil public/lib/whiteboard.js ein Browser-Modul ist und hier nicht laeuft.
{
  const fs = require("fs");
  const path = require("path");
  const quelle = fs.readFileSync(
    path.join(__dirname, "..", "public", "lib", "whiteboard.js"), "utf8");
  const x = (quelle.match(/const ORD_X = \[([^\]]+)\]/) || [])[1] || "";
  const y = (quelle.match(/const ORD_Y = \[([^\]]+)\]/) || [])[1] || "";
  const zahlen = (s) => s.split(",").map((t) => Number(t.trim()));
  gleich(zahlen(x), bruecke.ORD_X, "ORD_X im Client = ORD_X im Server");
  gleich(zahlen(y), bruecke.ORD_Y, "ORD_Y im Client = ORD_Y im Server");
  const katListe = (quelle.match(/wert: "([a-z]+)",/g) || []).map((t) => t.slice(7, -2));
  gleich(katListe, bruecke.KATEGORIEN, "Kategorien im Client = Kategorien im Server");
}

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gut.");
process.exit(fehler ? 1 : 0);
