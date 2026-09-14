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
// Abschnitt 5 prueft die Platzsuche am Tag (08.09.2026): Follow-ups sind
// 10-Minuten-Bloecke und keine Ganztagseintraege mehr, und sie legen sich in
// das erste freie Fenster ab 9:00. Auch das ist reine Rechnerei —
// ersterFreierPlatz() bekommt die Terminliste uebergeben und fragt Google
// nicht selbst, genau damit es hier ohne Netz pruefbar ist.
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
melde(p1.eintrag === true, "Aufgabe mit Firma und Datum: eigener Eintrag");
melde(p1.ganztags === undefined, "kein Ganztagseintrag mehr (Lukas: nicht den ganzen Tag)");
gleich(p1.dauerMin, 10, "Follow-up / Nochmal anrufen: 10 Minuten");
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
  "gebucht ohne Zeitpunkt: eigener kurzer Eintrag");
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
melde(!/Hinweis:/.test(text), "ohne Hinweis keine Hinweiszeile");
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

// FOLLOW-UP MIT VERABREDETEM TERMIN (14.09.2026).
//
// Der Gespraechs-Dialog der Leads-Maske bietet das Terminfeld bei "gebucht"
// UND "follow-up" an und schickt es immer als "termin" — nie als "datum".
// anrufAufgabePlanen las bis heute nur extra.datum: Ein Follow-up, fuer das
// eine Uhrzeit ausgehandelt war, stand trotzdem "in drei Werktagen" auf der
// Tafel, und der Titel behauptete "kein Termin". Nachgemessen an echten
// Daten: 15 Follow-up-Leads, 15 mit Deal, 0 mit Wiedervorlage.
const fuTermin = crm.anrufAufgabePlanen("follow-up", { termin: "2026-09-21T10:00", notiz: "" });
gleich(fuTermin.tag, "2026-09-21", "Follow-up: Tag kommt aus dem Termin, nicht aus drei Werktagen");
gleich(fuTermin.titel, "Nachfassen am 21.09. um 10:00", "Follow-up: Uhrzeit steht im Titel");
// Ohne Uhrzeit (Mitternacht gilt als keine, wie im Kalender): nur der Tag.
const fuTag = crm.anrufAufgabePlanen("follow-up", { termin: "2026-09-21T00:00", notiz: "" });
gleich(fuTag.titel, "Nachfassen am 21.09.", "Follow-up ohne Uhrzeit: Tag ohne Zeitangabe");
// Ganz ohne Termin bleibt es bei der alten Aussage — sie ist dann richtig.
const fuOhne = crm.anrufAufgabePlanen("follow-up", { notiz: "" });
gleich(fuOhne.titel, "Nachfassen — kein Termin", "Follow-up ohne Termin: unveraendert");
// extra.datum bleibt Rueckfall fuer Wege, die nur einen Tag kennen (Sprache, Akte).
const fuDatum = crm.anrufAufgabePlanen("follow-up", { datum: "2026-09-18", notiz: "" });
gleich(fuDatum.tag, "2026-09-18", "Follow-up: extra.datum wirkt weiterhin");
// Und die Notiz haengt auch mit Termin hinten an.
const fuNotiz = crm.anrufAufgabePlanen("follow-up", { termin: "2026-09-21T10:00", notiz: "Meldet sich Freitag" });
gleich(fuNotiz.titel, "Nachfassen am 21.09. um 10:00 · Meldet sich Freitag",
  "Follow-up: Termin und Notiz zusammen");
// "Später nochmal" liest denselben Vorrang — der Dialog schickt dort zwar
// keinen Termin, aber wenn doch, darf er nicht ignoriert werden.
const szTermin = crm.anrufAufgabePlanen("keine-zeit", { termin: "2026-09-21T10:00", notiz: "" });
gleich(szTermin.tag, "2026-09-21", "Später nochmal: Termin gewinnt vor drei Werktagen");

// DIE VERABREDETE UHRZEIT (0068, 14.09.2026).
//
// Ohne geplant_um entscheidet ersterFreierPlatz() wie bisher (erstes freies
// Fenster ab 9:00) — der Plan gibt dann gar kein "von" mit. Mit Uhrzeit wird
// ab ihr gesucht: Bei KFZ Holzer war 10:00 verabredet, der Block landete
// trotzdem auf 9:00, weil die Aufgabe die Uhrzeit nirgends tragen konnte.
melde(crm.aufgabeKalenderPlan(aufgabe()).von === undefined,
  "ohne geplant_um: kein Wunschfenster, ersterFreierPlatz entscheidet");
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_um: "10:00:00" })).von, 600,
  "geplant_um aus der Datenbank (10:00:00) -> 600 Minuten");
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_um: "10:00" })).von, 600,
  "geplant_um aus der Maske (10:00) -> 600 Minuten");
gleich(crm.aufgabeKalenderPlan(aufgabe({ geplant_um: "14:27:00" })).von, 867,
  "geplant_um 14:27 -> 867 Minuten");
// Unsinn faellt auf null zurueck, statt den Block auf 0:00 zu legen.
for (const murks of ["", null, "abc", "25:00", "99:99"])
  melde(crm.aufgabeKalenderPlan(aufgabe({ geplant_um: murks })).von === undefined,
    `geplant_um ${JSON.stringify(murks)}: kein Wunschfenster`);
// Und die Platzwahl selbst: ab der Wunschzeit, nicht ab 9:00.
// Eigener Tag hier — die Konstante TAG des Platz-Abschnitts steht weiter
// unten und existiert an dieser Stelle noch nicht.
const UHRTAG = "2026-09-21";
gleich(crm.ersterFreierPlatz([], UHRTAG, 10, { von: 600 }).uhrzeit, "10:00",
  "freie Wunschzeit: der Termin steht genau dort");
// Belegt: die naechste Luecke DANACH — nicht in den bestehenden Termin hinein.
gleich(crm.ersterFreierPlatz(
  [{ id: "x", start: `${UHRTAG}T10:00`, ende: `${UHRTAG}T10:30` }], UHRTAG, 10, { von: 600 }).uhrzeit,
  "10:30", "belegte Wunschzeit: rutscht dahinter, nicht hinein");
// Ein Termin VOR der Wunschzeit blockiert sie nicht.
gleich(crm.ersterFreierPlatz(
  [{ id: "x", start: `${UHRTAG}T09:00`, ende: `${UHRTAG}T09:30` }], UHRTAG, 10, { von: 600 }).uhrzeit,
  "10:00", "Termin vor der Wunschzeit stoert nicht");

// Und der Weg von der Notiz bis zur Spalte: anrufAufgabePlanen gibt die
// Uhrzeit mit hinaus, damit anrufAufgabe sie nach geplant_um schreiben kann.
gleich(crm.anrufAufgabePlanen("follow-up", { termin: "2026-09-21T10:00" }).uhrzeit, "10:00",
  "Follow-up: Plan traegt die Uhrzeit fuer geplant_um");
melde(crm.anrufAufgabePlanen("follow-up", { termin: "2026-09-21T00:00" }).uhrzeit === undefined,
  "Follow-up um Mitternacht: keine Uhrzeit (Tag ohne Zeit)");
melde(crm.anrufAufgabePlanen("follow-up", {}).uhrzeit === undefined,
  "Follow-up ohne Termin: keine Uhrzeit");
gleich(crm.anrufAufgabePlanen("keine-zeit", { termin: "2026-09-21T10:00" }).uhrzeit, "10:00",
  "Später nochmal: Uhrzeit geht ebenfalls mit");

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

// ------------------------------------------------ 5. Wo am Tag steht der Block
//
// Lukas: "nicht den ganzen Tag, sondern Erstgespräch 30 Minuten und Follow-up
// maximal 10 Minuten." Die Aufgabe hat nur ein Datum — die Uhrzeit sucht
// ersterFreierPlatz(): erstes freies Fenster ab 9:00, Arbeitsfenster bis 18:00.
const TAG = "2026-09-12";
const t = (von, bis, extra = {}) => ({ id: "t" + von, start: `${TAG}T${von}`, ende: `${TAG}T${bis}`, ...extra });
const platz = (termine, dauer = 10, o = {}) => crm.ersterFreierPlatz(termine, TAG, dauer, o);

gleich(crm.ARBEIT_VON_MIN, 9 * 60, "Arbeitsfenster beginnt 9:00");
gleich(crm.ARBEIT_BIS_MIN, 18 * 60, "Arbeitsfenster endet 18:00");
gleich(crm.AUFGABE_DAUER_MIN, 10, "Aufgabenblock: 10 Minuten");

// Leerer Tag: der frueheste Platz.
gleich(platz([]).start, `${TAG}T09:00`, "leerer Tag: 9:00");
gleich(platz([]).ende, `${TAG}T09:10`, "leerer Tag: 10 Minuten lang");
melde(platz([]).voll === false && platz([]).ohneGoogle === false, "leerer Tag: kein Hinweis noetig");

// 9:00-9:30 belegt -> direkt danach.
gleich(platz([t("09:00", "09:30")]).uhrzeit, "09:30", "9:00-9:30 belegt: 9:30");

// Mehrere Luecken: die erste, in die der Block PASST. Zwischen 9:35 und 9:40
// sind nur fuenf Minuten — zu wenig, also erst nach dem zweiten Termin.
gleich(platz([t("09:00", "09:35"), t("09:40", "10:00")]).uhrzeit, "10:00",
  "zu kleine Luecke wird uebersprungen");
// Passt die Luecke genau, wird sie genutzt.
gleich(platz([t("09:00", "09:30"), t("09:40", "10:00")]).uhrzeit, "09:30",
  "genau passende Luecke wird genutzt");
// Reihenfolge der Antwort ist egal — sortiert wird hier.
gleich(platz([t("09:40", "10:00"), t("09:00", "09:35")]).uhrzeit, "10:00",
  "unsortierte Terminliste aendert nichts");

// Mehrere Follow-ups an einem Tag stapeln sich HINTEREINANDER, nicht
// uebereinander: der Eintrag von eben zaehlt als belegt.
gleich(platz([t("09:00", "09:10"), t("09:10", "09:20")]).uhrzeit, "09:20",
  "drittes Follow-up: 9:20 statt noch einmal 9:00");

// Ganztaegige Fremdtermine (Urlaub, Feiertag, Geburtstag) blockieren NICHT —
// sonst waere jeder Tag mit einem Feiertagseintrag verbaut.
gleich(platz([{ id: "u", start: TAG, ende: "2026-09-13", titel: "Urlaub" }]).uhrzeit, "09:00",
  "ganztaegiger Fremdtermin blockiert nicht");
// Ein mehrtaegiger ganztaegiger genauso wenig.
gleich(platz([{ id: "f", start: "2026-09-10", ende: "2026-09-20" }]).uhrzeit, "09:00",
  "mehrtaegiger Ganztagstermin blockiert nicht");

// Termine anderer Tage zaehlen nicht.
gleich(platz([{ id: "x", start: "2026-09-11T09:00", ende: "2026-09-11T17:00" }]).uhrzeit, "09:00",
  "Termin am Vortag zaehlt nicht");
// Einer, der vom Vortag hereinragt, schon — ab 0:00 bis zu seinem Ende.
gleich(platz([{ id: "n", start: "2026-09-11T22:00", ende: `${TAG}T09:20` }]).uhrzeit, "09:20",
  "Nachtschicht vom Vortag belegt den Morgen");

// Der eigene Termin der Aufgabe zaehlt beim Umplanen nicht mit — sonst
// wanderte er bei jedem Speichern zehn Minuten weiter nach hinten.
gleich(platz([t("09:00", "09:10", { id: "eigen" })], 10, { ausser: "eigen" }).uhrzeit, "09:00",
  "eigener Termin blockiert sich beim Verschieben nicht selbst");
gleich(platz([t("09:00", "09:10", { id: "eigen" })], 10, { ausser: "fremd" }).uhrzeit, "09:10",
  "ein fremder Termin an derselben Stelle sehr wohl");

// Voller Tag: 9:00 mit Hinweis. Lieber eine Ueberschneidung als kein Eintrag.
const voll = platz([t("09:00", "18:00")]);
melde(voll.voll === true, "voller Tag: als voll erkannt");
gleich(voll.uhrzeit, "09:00", "voller Tag: trotzdem ein Eintrag, auf 9:00");
melde(/ueberschneidet/.test(crm.platzHinweis(voll)), "voller Tag: Grund steht in der Beschreibung");
// Der Block muss bis 18:00 fertig sein.
gleich(platz([t("09:00", "17:50")]).uhrzeit, "17:50", "letzter Platz endet punkt 18:00");
melde(platz([t("09:00", "17:55")]).voll === true, "fuenf Minuten Rest reichen nicht mehr");

// Google nicht erreichbar (spanne hat kein ok geliefert): 9:00 mit Hinweis.
const stumm = platz(null);
melde(stumm.ohneGoogle === true && stumm.uhrzeit === "09:00", "Google stumm: 9:00 statt gar nichts");
melde(/nicht erreichbar/.test(crm.platzHinweis(stumm)), "Google stumm: Grund steht in der Beschreibung");
melde(crm.platzHinweis(platz([])) === "", "glatter Fall: keine Hinweiszeile");
// Und der Hinweis landet wirklich im Text des Termins.
melde(/Hinweis:/.test(crm.aufgabeKalenderText(aufgabe(), "", crm.platzHinweis(stumm))),
  "Hinweis steht in der Terminbeschreibung");

// Dauer 30 (Erstgespraech) gegen 10 (Follow-up).
gleich(platz([], 30).ende, `${TAG}T09:30`, "30 Minuten: 9:00-9:30");
gleich(platz([], 10).ende, `${TAG}T09:10`, "10 Minuten: 9:00-9:10");
// Das Erstgespraech selbst legt nicht diese Funktion, sondern
// kalender-akte.zeitplan() — mit der gebuchten Uhrzeit und 30 Minuten.
{
  const akte = require("../lib/kalender-akte.js");
  gleich(akte.ERSTGESPRAECH_DAUER_MIN, 30, "Erstgespräch: 30 Minuten (vorher 45)");
  gleich(akte.zeitplan("2026-09-12T10:00").ende, "2026-09-12T10:30",
    "Erstgespräch um 10:00 endet 10:30");
}

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gut.");
process.exit(fehler ? 1 : 0);
