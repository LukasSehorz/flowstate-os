// Prueft die Rechnerei von Kalender <-> Kundenakte (lib/kalender-akte.js) und
// den behobenen Feldbruch am Direktweg (lib/kalender-direkt.js umformen).
//
//   node scripts/test-kalender-akte.js
//
// Laeuft ohne Datenbank und ohne gws-cli — nur reine Funktionen. Die Stellen,
// an denen so etwas STILL falsch wird:
//   - die Akte-Zeile in der Beschreibung: einmal, am Ende, nie doppelt, und
//     sie ueberlebt den 500-Zeichen-Deckel von gws-cli
//   - die Ganztags-Regel: Mitternacht heisst "Uhrzeit unbekannt" (Migration
//     0051) -> ganztaegig, nicht "00:00 Uhr"
//   - Zuordnung Verknuepfung <-> Google-Termin, fehlende bleiben sichtbar
//   - umformen() liefert ende/ort (vorher fiel dauer() auf 60 Minuten zurueck)
//   - der gws-cli-Weg traegt Beschreibung/Link/Farbe nach (anreichern)

const akte = require("../lib/kalender-akte.js");
const direkt = require("../lib/kalender-direkt.js");
const kal = require("../lib/kalender.js");

let fehler = 0;
const pruefe = (name, wahr, extra = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (!wahr && extra ? "\n   " + extra : ""));
  if (!wahr) fehler++;
};
const gleich = (name, ist, soll) => pruefe(name, JSON.stringify(ist) === JSON.stringify(soll),
  `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);

// --- Akte-Zeile in der Beschreibung ---------------------------------------
console.log("\nAkte-Zeile");
delete process.env.OS_URL;
gleich("ohne OS_URL relativer Link", akte.akteUrl(42), "/crm/firma/42");
process.env.OS_URL = "https://os.flowstate-ai.net/";
gleich("OS_URL ohne Schraegstrich am Ende", akte.akteUrl(42), "https://os.flowstate-ai.net/crm/firma/42");

const b1 = akte.beschreibungMitAkte("Worum es geht", 42);
gleich("Zeile haengt hinten dran", b1, "Worum es geht\n\nKundenakte: https://os.flowstate-ai.net/crm/firma/42");
gleich("leere Beschreibung -> nur die Zeile", akte.beschreibungMitAkte("", 7), "Kundenakte: https://os.flowstate-ai.net/crm/firma/7");
gleich("ohne Firma bleibt der Text wie er ist", akte.beschreibungMitAkte("Nur Text", null), "Nur Text");
gleich("umhaengen ersetzt die alte Zeile, keine zwei", akte.beschreibungMitAkte(b1, 99),
  "Worum es geht\n\nKundenakte: https://os.flowstate-ai.net/crm/firma/99");
gleich("ohne Firma wird die alte Zeile entfernt", akte.beschreibungMitAkte(b1, 0), "Worum es geht");
gleich("Zeile herauslesen", akte.akteAusBeschreibung(b1), 42);
gleich("Zeile herauslesen — Gross/Klein egal", akte.akteAusBeschreibung("kundenakte: /crm/firma/5"), 5);
gleich("kein Link -> null", akte.akteAusBeschreibung("Treffen im Cafe"), null);
gleich("Notizfeld zeigt nur den Freitext", akte.beschreibungOhneAkte(b1), "Worum es geht");
const lang = akte.beschreibungMitAkte("x".repeat(700), 42);
pruefe("500-Zeichen-Deckel: Zeile ueberlebt", lang.length <= 500 && akte.akteAusBeschreibung(lang) === 42,
  `Laenge ${lang.length}, Akte ${akte.akteAusBeschreibung(lang)}`);
pruefe("Zeile auch bei Windows-Zeilenumbruechen erkannt",
  akte.akteAusBeschreibung("Text\r\nKundenakte: https://os.flowstate-ai.net/crm/firma/3\r\n") === 3);

// --- Ganztags-Regel ---------------------------------------------------------
console.log("\nZeitplan / Ganztags-Regel");
// 30 Minuten seit 08.09.2026 (vorher 45) — ERSTGESPRAECH_DAUER_MIN.
gleich("Uhrzeit bekannt -> 30 Minuten", akte.zeitplan("2026-09-10T14:00"),
  { ganztags: false, start: "2026-09-10T14:00", ende: "2026-09-10T14:30", tag: "2026-09-10", uhrzeit: "14:00" });
gleich("Vorgabe ist die Hauskonstante", akte.ERSTGESPRAECH_DAUER_MIN, 30);
gleich("eigene Dauer", akte.zeitplan("2026-09-10T14:00", 90).ende, "2026-09-10T15:30");
gleich("Mitternacht -> ganztaegig", akte.zeitplan("2026-09-10T00:00"),
  { ganztags: true, start: "2026-09-10", ende: "2026-09-10", tag: "2026-09-10", uhrzeit: "" });
gleich("nur Tag -> ganztaegig", akte.zeitplan("2026-09-10").ganztags, true);
// timestamptz aus Postgres kommt als Date: 2026-09-10 00:00 Berlin = 22:00 UTC am Vortag.
gleich("Date auf Berliner Mitternacht -> ganztaegig am richtigen Tag",
  akte.zeitplan(new Date("2026-09-09T22:00:00Z")), { ganztags: true, start: "2026-09-10", ende: "2026-09-10", tag: "2026-09-10", uhrzeit: "" });
gleich("Date mit Uhrzeit -> Berliner Wandzeit", akte.zeitplan(new Date("2026-09-10T12:00:00Z")).start, "2026-09-10T14:00");
gleich("Winter: Date mit Uhrzeit -> +01:00", akte.zeitplan(new Date("2026-01-15T09:30:00Z")).start, "2026-01-15T10:30");
gleich("ISO mit Zone wird umgerechnet", akte.zeitplan("2026-09-10T12:00:00+00:00").start, "2026-09-10T14:00");
gleich("Ende ueber Mitternacht", akte.plusMinuten("2026-09-10T23:30", 45), "2026-09-11T00:15");
gleich("Unsinn -> null", akte.zeitplan("irgendwann"), null);
gleich("leer -> null", akte.zeitplan(""), null);

// Die Wandzeit-Rechnung darf nicht von der Zeitzone des Prozesses abhaengen
// (die Lehre vom 25.07. in werkzeuge.js). Dasselbe in Kindprozessen pruefen.
if (!process.env.AKTE_TEST_KIND) {
  const { execFileSync } = require("child_process");
  const skript = `const a=require(${JSON.stringify(require.resolve("../lib/kalender-akte.js"))});` +
    `console.log(JSON.stringify([a.zeitplan(new Date("2026-09-09T22:00:00Z")).start,` +
    `a.zeitplan(new Date("2026-09-10T12:00:00Z")).start,a.plusMinuten("2026-09-10T23:30",45)]));`;
  const erwartet = JSON.stringify(["2026-09-10", "2026-09-10T14:00", "2026-09-11T00:15"]);
  for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/Berlin"]) {
    let raus = "";
    try {
      raus = execFileSync(process.execPath, ["-e", skript],
        { env: { ...process.env, TZ: tz, AKTE_TEST_KIND: "1" }, encoding: "utf-8" }).trim();
    } catch (e) { raus = "FEHLER: " + String(e.message).slice(0, 80); }
    pruefe(`Zeitzonen-unabhaengig in ${tz}`, raus === erwartet, `erwartet ${erwartet}, bekommen ${raus}`);
  }
}

// --- Zuordnung Verknuepfung <-> Termin ---------------------------------------
console.log("\nZuordnung");
const vk = [
  { event_id: "b", art: "erstgespraech" },
  { event_id: "a", art: "termin" },
  { event_id: "weg", art: "termin" },
];
const termine = [
  { id: "a", titel: "Kick-off", start: "2026-09-12T09:00:00+02:00", ende: "2026-09-12T10:00:00+02:00", ort: "Zoom", htmlLink: "https://g/a" },
  { id: "b", titel: "Erstgespräch X", start: "2026-09-10", ende: "2026-09-11", ort: "" },
  { id: "fremd", titel: "Zahnarzt", start: "2026-09-11T08:00:00+02:00" },
];
const zu = akte.zuordnen(vk, termine);
gleich("Reihenfolge: chronologisch, fehlende zuletzt", zu.map((t) => t.id), ["b", "a", "weg"]);
gleich("Felder laut Vertrag", Object.keys(zu[1]).sort(),
  ["art", "ende", "ganztags", "htmlLink", "id", "ort", "start", "titel"]);
gleich("art kommt aus der Verknuepfung", zu[0].art, "erstgespraech");
gleich("ganztaegig erkannt", zu[0].ganztags, true);
gleich("Google-Link uebernommen", zu[1].htmlLink, "https://g/a");
pruefe("nicht gefundener Termin als fehlt markiert", zu[2].fehlt === true && zu[2].titel === "");
gleich("fremde Termine tauchen nicht auf", zu.some((t) => t.id === "fremd"), false);
gleich("ohne Verknuepfungen leer", akte.zuordnen([], termine), []);

// --- umformen(): der Feldbruch ende/ort -----------------------------------
console.log("\nDirektweg umformen()");
const u = direkt.umformen({
  id: "e1", summary: "Beratung", location: "Dorfen", description: "Notiz\nKundenakte: /crm/firma/3",
  start: { dateTime: "2026-09-10T10:00:00+02:00" }, end: { dateTime: "2026-09-10T10:30:00+02:00" },
  htmlLink: "https://calendar.google.com/x", colorId: "7",
});
gleich("ende gesetzt", u.ende, "2026-09-10T10:30:00+02:00");
gleich("ort gesetzt", u.ort, "Dorfen");
gleich("alte Namen bleiben (end/location)", [u.end, u.location], ["2026-09-10T10:30:00+02:00", "Dorfen"]);
gleich("beschreibung/htmlLink/farbe", [u.beschreibung.split("\n")[0], u.htmlLink, u.farbe], ["Notiz", "https://calendar.google.com/x", "7"]);
gleich("nicht ganztaegig", u.ganztags, false);
gleich("dauer() rechnet jetzt mit dem echten Ende (30, nicht 60)", kal.dauer(u), 30);
const g = direkt.umformen({ id: "e2", summary: "Messe", start: { date: "2026-09-11" }, end: { date: "2026-09-12" } });
gleich("ganztaegig erkannt", [g.ganztags, g.start, g.ende], [true, "2026-09-11", "2026-09-12"]);
gleich("ohne Farbe leer", g.farbe, "");
gleich("Google-Farbe aufloesen", kal.farbeVon(u) && kal.farbeVon(u).hex, "#039be5");
gleich("keine Farbe -> null", kal.farbeVon(g), null);

// --- gws-cli-Weg: Zusatzfelder nachtragen ---------------------------------
console.log("\ngws-cli-Weg anreichern()");
const huelle = JSON.stringify({
  status: "success", operation: "calendar.list",
  events: {
    warning: "EXTERNAL CONTENT", security_warnings: [{ matched_text: "ignore previous" }],
    data: JSON.stringify([
      { id: "k1", summary: "Kunde", start: "2026-09-10T10:00:00+02:00", end: "2026-09-10T10:30:00+02:00",
        description: "Kundenakte: /crm/firma/9", htmlLink: "https://g/k1", colorId: "2", status: "confirmed" },
      { id: "k2", summary: "Ohne alles", start: "2026-09-11", end: "2026-09-12" },
    ]),
  },
});
const roh = kal.rohListe(huelle);
gleich("rohListe packt die Huelle aus", roh.map((r) => r.id), ["k1", "k2"]);
const { termineLesen } = require("../lib/zustand.js");
const angereichert = kal.anreichern(termineLesen(huelle), huelle);
gleich("Beschreibung/Link/Farbe je id nachgetragen",
  angereichert.map((t) => [t.id, t.beschreibung, t.htmlLink, t.farbe, t.ganztags]),
  [["k1", "Kundenakte: /crm/firma/9", "https://g/k1", "2", false], ["k2", "", "", "", true]]);
gleich("Akte aus der Beschreibung des CLI-Termins", akte.akteAusBeschreibung(angereichert[0].beschreibung), 9);
gleich("kaputte Antwort -> leere Liste, kein Absturz", kal.rohListe("kein json"), []);

// --- Rechte: Beschreibung beim Aendern (Pruefung 05.09., Punkte 1–3) -------
//
// Die Akte-Zeile in Google darf nur mit dem Faden zusammen entstehen oder
// verschwinden. Ein Mitarbeiter, der die Firma nicht sieht, aendert die Notiz
// — die Zeile muss bleiben. Kein "akte_geaendert" im Formular — die Zeile
// bleibt. Nur wer wirklich gewaehlt/entfernt hat UND es darf, aendert sie.
console.log("\nBeschreibung beim Aendern (Rechte)");
const VOLL = "Lange Notiz\n\nKundenakte: /crm/firma/1";
let b = akte.beschreibungBeimAendern({ darfAkte: false, akteGeaendert: true, firmaNeu: 0, beschreibungVoll: VOLL, notizNeu: "Lange Notiz geaendert", notizAlt: "Lange Notiz" });
gleich("Mitarbeiter ohne Akte-Recht aendert Notiz -> Zeile bleibt", b.beschreibung, "Lange Notiz geaendert\n\nKundenakte: /crm/firma/1");
b = akte.beschreibungBeimAendern({ darfAkte: true, akteGeaendert: false, firmaNeu: 0, beschreibungVoll: VOLL, notizNeu: "Neu", notizAlt: "Lange Notiz" });
gleich("Formular ohne Akte-Aenderung -> Zeile bleibt", b.beschreibung, "Neu\n\nKundenakte: /crm/firma/1");
b = akte.beschreibungBeimAendern({ darfAkte: true, akteGeaendert: true, firmaNeu: 10, beschreibungVoll: VOLL, notizNeu: "Lange Notiz", notizAlt: "Lange Notiz" });
gleich("Umhaengen mit Recht -> neue Zeile, Notiz unveraendert", b.beschreibung, "Lange Notiz\n\nKundenakte: /crm/firma/10");
b = akte.beschreibungBeimAendern({ darfAkte: true, akteGeaendert: true, firmaNeu: 0, beschreibungVoll: VOLL, notizNeu: "Lange Notiz", notizAlt: "Lange Notiz" });
gleich("Entfernen mit Recht -> Zeile weg, Notiz erhalten", b.beschreibung, "Lange Notiz");
b = akte.beschreibungBeimAendern({ darfAkte: true, akteGeaendert: false, firmaNeu: 0, beschreibungVoll: VOLL, notizNeu: "Lange Notiz", notizAlt: "Lange Notiz" });
gleich("Nichts geaendert -> Google-Text bleibt unangetastet (undefined)", b.beschreibung, undefined);
b = akte.beschreibungBeimAendern({ darfAkte: true, akteGeaendert: true, firmaNeu: 1, beschreibungVoll: VOLL, notizNeu: "Lange Notiz", notizAlt: "Lange Notiz" });
gleich("Dieselbe Firma neu gewaehlt -> nichts zu schreiben", b.beschreibung, undefined);

console.log("\nUmhaengen erlaubt?");
gleich("kein Faden -> erlaubt", akte.umhaengenErlaubt(null, null), true);
gleich("Faden vorhanden und sichtbar -> erlaubt", akte.umhaengenErlaubt({ firma_id: 1 }, { firma_id: 1 }), true);
gleich("Faden vorhanden, fuer den Nutzer unsichtbar -> verweigert", akte.umhaengenErlaubt({ firma_id: 1 }, null), false);

// --- Traegt das Formular eine Akte-Wahl? -----------------------------------
// Die Frage entscheidet, ob eine bestehende Verknuepfung ueberhaupt angefasst
// wird. Ein leeres firma_id ohne die Meldung des Dialogs darf nie zaehlen —
// sonst loescht die blosse Notizaenderung eines Mitarbeiters die Akte.
console.log("\nAkte-Wahl im Formular?");
gleich("Dialog meldet die Wahl", akte.akteWahlImFormular({ akteGeaendert: true, firmaId: "", firmaAlt: "7" }), true);
gleich("leeres Feld ohne Meldung -> keine Wahl", akte.akteWahlImFormular({ akteGeaendert: false, firmaId: "", firmaAlt: "7" }), false);
gleich("dieselbe Firma wie beim Oeffnen -> keine Wahl", akte.akteWahlImFormular({ akteGeaendert: false, firmaId: "7", firmaAlt: "7" }), false);
gleich("neue Firma ohne Meldung -> Wahl", akte.akteWahlImFormular({ akteGeaendert: false, firmaId: "7", firmaAlt: "" }), true);
gleich("umgehaengt ohne Meldung -> Wahl", akte.akteWahlImFormular({ akteGeaendert: false, firmaId: "8", firmaAlt: "7" }), true);
gleich("Unsinn im Feld -> keine Wahl", akte.akteWahlImFormular({ akteGeaendert: false, firmaId: "abc", firmaAlt: "" }), false);
gleich("ohne Angaben -> keine Wahl", akte.akteWahlImFormular(), false);

// --- Deckel: Scheiben fuer grosse Fenster (Punkt 4) ------------------------
console.log("\nScheiben");
const sch = akte.scheiben("2026-08-06", "2027-03-04", 30);
gleich("erste Scheibe beginnt am Anfang", sch[0][0], "2026-08-06");
gleich("letzte Scheibe endet am Ende", sch[sch.length - 1][1], "2027-03-04");
pruefe("lueckenlos und ohne Ueberlappung", sch.every((s, i) => i === 0 || kal.tagPlus(sch[i - 1][1], 1) === s[0]),
  JSON.stringify(sch));
pruefe("jede Scheibe hoechstens 30 Tage", sch.every(([a, z]) => kal.tagPlus(a, 29) >= z));
gleich("kurzes Fenster -> eine Scheibe", akte.scheiben("2026-09-10", "2026-09-12", 30), [["2026-09-10", "2026-09-12"]]);

// --- Vertragsfunktionen werfen nie ----------------------------------------
console.log("\nVertrag: wirft nie");
(async () => {
  const alt = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let r = await akte.erstgespraechSynchronisieren({ id: "x" }, 1, { wann: "2026-09-10T14:00" });
  pruefe("ohne Datenbank/Kalender: { ok:false, grund } statt Fehler", r && r.ok === false && typeof r.grund === "string", JSON.stringify(r));
  r = await akte.erstgespraechSynchronisieren(null, 0, {});
  pruefe("ohne Firma: sauberer Grund", r && r.ok === false && /Firma/i.test(r.grund), JSON.stringify(r));
  r = await akte.erstgespraechSynchronisieren({ id: "x" }, 1, { wann: "nie" });
  pruefe("ohne lesbaren Termin: sauberer Grund", r && r.ok === false && /Termin/i.test(r.grund), JSON.stringify(r));
  const liste = await akte.termineVonFirma({ id: "x" }, 1);
  gleich("termineVonFirma ohne Datenbank -> leere Liste", liste, []);
  const suche = await akte.firmenSuchen({ id: "x" }, "abc");
  gleich("firmenSuchen ohne Datenbank -> leere Liste", suche, []);
  const kurz = await akte.firmaKurz({ id: "x" }, 1);
  gleich("firmaKurz ohne Datenbank -> null", kurz, null);
  // Schreibfunktionen: immer { ok, grund } — nichts wird geschluckt (Punkt 1/2).
  const setzen = await akte.verknuepfungSetzen({ id: "x" }, { eventId: "e1", firmaId: 1 });
  pruefe("verknuepfungSetzen ohne Datenbank -> { ok:false, grund }", setzen && setzen.ok === false && setzen.grund === "keine-datenbank", JSON.stringify(setzen));
  const loeschen = await akte.verknuepfungLoeschen({ id: "x" }, "e1");
  pruefe("verknuepfungLoeschen ohne Datenbank -> { ok:false, grund }", loeschen && loeschen.ok === false && loeschen.grund === "keine-datenbank", JSON.stringify(loeschen));
  const ohneAngaben = await akte.verknuepfungSetzen({ id: "x" }, { eventId: "", firmaId: 0 });
  pruefe("verknuepfungSetzen ohne Angaben -> sauberer Grund", ohneAngaben.ok === false && /Angaben/.test(ohneAngaben.grund), JSON.stringify(ohneAngaben));
  gleich("firmaSichtbar ohne Datenbank -> false", await akte.firmaSichtbar({ id: "x" }, 1), false);
  gleich("fadenSystem ohne Datenbank -> null", await akte.fadenSystem("e1"), null);
  const sv = await akte.spanneVoll("2026-09-01", "2026-09-30");
  pruefe("spanneVoll ohne gws-cli/Token -> { ok:false } statt Absturz", sv && sv.ok === false, JSON.stringify(sv).slice(0, 120));
  gleich("terminNachId ohne Direktweg -> null", await akte.terminNachId("e1"), null);

  // --- Jeder in seinen eigenen Kalender (18.09.2026) ----------------------
  // Lukas: "kann man das fixen, dass die Termine von Jannik auch in seinen
  // Kalender gebucht werden?" Zugeordnet wird ueber die Anmelde-Mail; die
  // Konten heissen genauso wie die Kalender.
  //
  // Geprueft wird hier der RUECKFALL, denn er entscheidet, ob im Zweifel ein
  // Termin ausfaellt: Ohne gws-cli (wie in dieser Pruefung) bleibt die
  // Kalenderliste unbekannt, und dann MUSS der Hauptkalender genommen werden.
  // Wuerde hier ok:false herauskommen, entstuenden bei einem Google-Aussetzer
  // stillschweigend gar keine Termine mehr — schlimmer als der Zustand, den
  // die Aenderung behebt.
  const kid = require("../lib/kalender-id.js");
  const ohneGoogle = await kid.kalenderFuer("jannikvomhofe@svhconsult.de");
  pruefe("Kalenderliste unbekannt -> Hauptkalender, Termin faellt nicht aus",
    ohneGoogle.ok === true && ohneGoogle.args.length === 0, JSON.stringify(ohneGoogle));
  const ohneMail = await kid.kalenderFuer("");
  pruefe("ohne Mail -> Hauptkalender", ohneMail.ok === true && ohneMail.args.length === 0,
    JSON.stringify(ohneMail));
  pruefe("Unsinn statt Mail -> Hauptkalender",
    (await kid.kalenderFuer("keine-mail")).grund === "keine-mail", "");
  // Waehrend der Werbeaufnahmen zeigt KALENDER_ID auf den Drehkalender. Dann
  // muss ALLES dorthin, auch fremde Aufgaben — sonst stehen echte Termine im Bild.
  const altKal = process.env.KALENDER_ID;
  process.env.KALENDER_ID = "dreh@example.com";
  const dreh = await kid.kalenderFuer("jannikvomhofe@svhconsult.de");
  pruefe("KALENDER_ID gewinnt (Drehkulisse)",
    dreh.ok === true && dreh.args[1] === "dreh@example.com", JSON.stringify(dreh));
  gleich("kalenderArgs mit KALENDER_ID", kid.kalenderArgs(), ["-c", "dreh@example.com"]);
  if (altKal === undefined) delete process.env.KALENDER_ID; else process.env.KALENDER_ID = altKal;
  gleich("kalenderArgs ohne KALENDER_ID: leer", kid.kalenderArgs(), []);

  // --- Beschreibung des Erstgespraechs (16.09.2026) -----------------------
  // Zwei Wuensche von Lukas an derselben Stelle: KEIN Akte-Link mehr im
  // Termin, und die Gespraechsnotiz soll vollstaendig drinstehen. Vorher war
  // sie fest auf 200 Zeichen geschnitten — bei den echten Notizen (bis 487
  // Zeichen) fiel damit der zweite Teil weg, in dem steht, was vereinbart
  // wurde. Jetzt wird der Platz gerechnet, und ein Rechenfehler hier wuerde
  // still Text abschneiden: darum geprueft.
  const firma = { name: "Muster GmbH", ansprechperson: "Anna Muster",
    telefon: "+4989123", ort: "München" };
  const kurzeNotiz = akte.beschreibungErstgespraech(firma, "Braucht neue Seite");
  pruefe("Erstgespräch: kein Akte-Link in der Beschreibung",
    !/Kundenakte:/.test(kurzeNotiz), kurzeNotiz);
  pruefe("Erstgespräch: Notiz steht drin", /Notiz: Braucht neue Seite/.test(kurzeNotiz), kurzeNotiz);
  pruefe("Erstgespräch: Ansprechperson steht drin",
    /Ansprechperson: Anna Muster/.test(kurzeNotiz), kurzeNotiz);
  // Eine Notiz in der Laenge der laengsten echten (487 Zeichen) muss ungekuerzt
  // durchgehen — genau dieser Fall war vorher abgeschnitten.
  const lang = "A".repeat(400);
  const langeNotiz = akte.beschreibungErstgespraech(firma, lang);
  pruefe("Erstgespräch: 400-Zeichen-Notiz bleibt ganz",
    langeNotiz.includes(lang) && !/…/.test(langeNotiz), String(langeNotiz.length));
  // Der Deckel bleibt aber: Google nimmt nur 500 Zeichen, mehr wird mit … gekuerzt.
  const zuLang = akte.beschreibungErstgespraech(firma, "B".repeat(900));
  pruefe("Erstgespräch: zu lange Notiz wird gekuerzt, nicht abgehackt",
    zuLang.length <= 500 && /…$/.test(zuLang), String(zuLang.length));
  gleich("Erstgespräch ohne Notiz: keine Notizzeile",
    /Notiz:/.test(akte.beschreibungErstgespraech(firma, "")), false);

  if (alt) process.env.DATABASE_URL = alt;

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
