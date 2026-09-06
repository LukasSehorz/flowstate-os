// Prueft die Rechnerei von lib/rechnungen.js — ohne Datenbank.
//
// Summen, Positionen aus dem Formular, Statusfolge, Abschlag (Prozent oder
// Betrag), Nummernformat gegen lib/beleg-nummer.js, Fristen, Vorlagen
// (vollstaendig, Preise leer, §19-Satz), Mailtext, PDF-Aufbau (Seiten,
// Entwurfs-Kennung, keine erfundene Bankverbindung) und die Vertrags-Exporte,
// die nie werfen duerfen.
//
//   node scripts/test-rechnungen.js

const zlib = require("zlib");
delete process.env.FIRMA_IBAN; delete process.env.FIRMA_STRASSE; delete process.env.FIRMA_NAME;
const rg = require("../lib/rechnungen.js");
const nummern = require("../lib/beleg-nummer.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};
const inhalt = (buf) => {
  const s = buf.toString("latin1"); const raus = []; const re = /<<([^>]*)>>\s*stream\n/g; let m;
  while ((m = re.exec(s))) { const l = Number((m[1].match(/\/Length (\d+)/) || [])[1]); const roh = buf.subarray(m.index + m[0].length, m.index + m[0].length + l);
    raus.push(/FlateDecode/.test(m[1]) ? zlib.inflateSync(roh).toString("latin1") : roh.toString("latin1")); }
  return raus.join("\n");
};

// ---------------------------------------------------- 1. Vorlagen
console.log("— Vorlagen —");
pruefe("vier Vorlagen: website, ki, performance, frei", ["website", "ki", "performance", "frei"].every((k) => rg.VORLAGEN[k]));
for (const k of ["website", "ki", "performance"]) {
  const v = rg.VORLAGEN[k];
  pruefe(`${k}: Titel, mindestens zwei Positionen mit Titel/Beschreibung/Einheit`,
    v.titel && v.positionen.length >= 2 && v.positionen.every((p) => p.titel && p.beschreibung && p.einheit));
  pruefe(`${k}: keine erfundenen Preise (einzelpreis null)`, v.positionen.every((p) => p.einzelpreis === null));
  pruefe(`${k}: Einleitung fuer Angebot UND Rechnung`, v.einleitung.angebot && v.einleitung.rechnung);
}
pruefe("performance: Betreuung je Monat", rg.VORLAGEN.performance.positionen.some((p) => p.einheit === "Monat"));
pruefe("frei: keine Positionen", rg.VORLAGEN.frei.positionen.length === 0);
pruefe("§19-Satz steht fest (PARAGRAF19, nicht im editierbaren Schluss)", /§ 19 Abs\. 1 UStG/.test(rg.PARAGRAF19) && !/§ 19/.test(rg.SCHLUSS.angebot) && !/§ 19/.test(rg.SCHLUSS.rechnung) && rg.SCHLUSS.rechnung.length > 10);
const t = rg.texte("website", "angebot");
pruefe("texte() liefert Kopie der Positionen (kein Durchgriff auf die Vorlage)", t.positionen !== rg.VORLAGEN.website.positionen && t.positionen[0] !== rg.VORLAGEN.website.positionen[0]);
pruefe("texte() mit unbekannter Vorlage faellt auf 'frei' zurueck", rg.texte("quatsch", "rechnung").einleitung === rg.VORLAGEN.frei.einleitung.rechnung);
pruefe("Kategorie je Vorlage passt zu den Einnahmekategorien", rg.KATEGORIE_JE_VORLAGE.website === "Webdesign" && rg.KATEGORIE_JE_VORLAGE.ki === "KI-Projekte" && rg.KATEGORIE_JE_VORLAGE.performance === "Performance Marketing");
pruefe("kategorieFuer: frei + Firmen-Tag performance -> Performance Marketing", rg.kategorieFuer({ vorlage: "frei", firma_tags: ["performance"] }) === "Performance Marketing");
pruefe("kategorieFuer: nichts bekannt -> Sonstiges", rg.kategorieFuer({ vorlage: "frei", firma_tags: [] }) === "Sonstiges");

// ---------------------------------------------------- 2. Summen & Positionen
console.log("\n— Summen —");
pruefe("summe: 2 × 100 + 1 × 0,10 = 200,10", rg.summe([{ menge: 2, einzelpreis: 100 }, { menge: 1, einzelpreis: 0.1 }]) === 200.1);
pruefe("summe: Rundung auf Cent (3 × 33,333)", rg.summe([{ menge: 3, einzelpreis: 33.333 }]) === 100);
pruefe("summe: leer = 0", rg.summe([]) === 0 && rg.summe(null) === 0);
pruefe("summe: Abzug (negativer Preis) wird verrechnet", rg.summe([{ menge: 1, einzelpreis: 3000 }, { menge: 1, einzelpreis: -1500 }]) === 1500);
const form = { 0: { titel: "Konzeption", beschreibung: "", menge: "1", einheit: "pauschal", einzelpreis: "1.250,00" },
  1: { titel: "", beschreibung: "", menge: "", einheit: "", einzelpreis: "" },
  2: { titel: "Betreuung", menge: "3", einheit: "Monat", einzelpreis: "400" } };
const pos = rg.positionenSaeubern(form);
pruefe("positionenSaeubern: leere Zeile fliegt raus", pos.length === 2);
pruefe("positionenSaeubern: deutscher Betrag wird gelesen", pos[0].einzelpreis === 1250 && pos[0].menge === 1);
pruefe("positionenSaeubern: Menge 3 × 400 = 1200", rg.positionSumme(pos[1]) === 1200 && rg.summe(pos) === 2450);
pruefe("positionenSaeubern: Array-Eingabe und JSON-Text gehen auch", rg.positionenSaeubern([{ titel: "A", einzelpreis: 5 }]).length === 1 && rg.positionenSaeubern(JSON.stringify([{ titel: "B" }])).length === 1);
pruefe("positionenSaeubern: Unsinn wird leer, nicht Fehler", rg.positionenSaeubern(undefined).length === 0 && rg.positionenSaeubern("kaputt").length === 0);
pruefe("zuBetrag: 1.234,56 / 37.30 / 1.234 / -5", rg.zuBetrag("1.234,56") === 1234.56 && rg.zuBetrag("37.30") === 37.3 && rg.zuBetrag("1.234") === 1234 && rg.zuBetrag("-5") === -5);
pruefe("zuBetrag: leer und Text sind null", rg.zuBetrag("") === null && rg.zuBetrag("abc") === null);

// ---------------------------------------------------- 3. Status
console.log("\n— Statusfolge —");
const ja = [["rechnung", "entwurf", "gestellt"], ["rechnung", "gestellt", "teilbezahlt"], ["rechnung", "gestellt", "bezahlt"],
  ["rechnung", "teilbezahlt", "bezahlt"], ["rechnung", "teilbezahlt", "teilbezahlt"], ["rechnung", "gestellt", "storniert"],
  ["rechnung", "bezahlt", "storniert"], ["angebot", "entwurf", "gestellt"], ["angebot", "gestellt", "angenommen"],
  ["angebot", "gestellt", "abgelehnt"], ["angebot", "abgelehnt", "angenommen"], ["angebot", "angenommen", "storniert"]];
const nein = [["rechnung", "entwurf", "bezahlt"], ["rechnung", "entwurf", "storniert"], ["rechnung", "storniert", "gestellt"],
  ["rechnung", "bezahlt", "gestellt"], ["rechnung", "gestellt", "angenommen"], ["angebot", "gestellt", "teilbezahlt"],
  ["angebot", "gestellt", "bezahlt"], ["angebot", "entwurf", "angenommen"], ["angebot", "storniert", "angenommen"]];
pruefe("erlaubte Uebergaenge", ja.every(([a, v, n]) => rg.uebergangErlaubt(a, v, n)), ja.filter(([a, v, n]) => !rg.uebergangErlaubt(a, v, n)).map((x) => x.join(">")).join(", "));
pruefe("verbotene Uebergaenge", nein.every(([a, v, n]) => !rg.uebergangErlaubt(a, v, n)), nein.filter(([a, v, n]) => rg.uebergangErlaubt(a, v, n)).map((x) => x.join(">")).join(", "));
pruefe("jeder Status hat Text und Pillenfarbe", Object.keys(rg.STATUS_TEXT).every((s) => rg.STATUS_FARBE[s]));
pruefe("ZAEHLT = gestellt, teilbezahlt, bezahlt", rg.ZAEHLT.join() === "gestellt,teilbezahlt,bezahlt");

// ---------------------------------------------------- 4. Abschlag
console.log("\n— Abschlag —");
pruefe("50 % von 3.000 = 1.500", JSON.stringify(rg.abschlagBetrag(3000, { prozent: 50 })) === JSON.stringify({ betrag: 1500, prozent: 50 }));
pruefe("Betrag 1.000,00 von 3.000 = 33,33 %", JSON.stringify(rg.abschlagBetrag(3000, { betrag: "1.000,00" })) === JSON.stringify({ betrag: 1000, prozent: 33.33 }));
pruefe("Betrag schlaegt Prozent, wenn beides da ist", rg.abschlagBetrag(1000, { prozent: 50, betrag: 200 }).betrag === 200);
pruefe("Prozent als Text '33,3' wird gelesen", rg.abschlagBetrag(3000, { prozent: "33,3" }).betrag === 999);
pruefe("ohne Angabe: null", rg.abschlagBetrag(3000, {}) === null && rg.abschlagBetrag(3000, { prozent: "0" }) === null);
pruefe("Auftrag ohne Summe: null", rg.abschlagBetrag(0, { prozent: 50 }) === null);

// ---------------------------------------------------- 5. Nummern & Fristen
console.log("\n— Nummern und Fristen —");
pruefe("R-2026-131 ist eine Rechnungsnummer", rg.nummerGueltig("rechnung", "R-2026-131"));
pruefe("2026-024 ist eine Angebotsnummer", rg.nummerGueltig("angebot", "2026-024"));
pruefe("Formate nicht vertauschbar", !rg.nummerGueltig("rechnung", "2026-024") && !rg.nummerGueltig("angebot", "R-2026-131"));
pruefe("altes Angebotsformat A-2026-119 gilt nicht mehr", !rg.nummerGueltig("angebot", "A-2026-119"));
pruefe("passt zu beleg-nummer.FORM (Rechnung)", rg.nummerGueltig("rechnung", nummern.FORM.rechnung(2026, 131)));
pruefe("passt zu beleg-nummer.FORM (Angebot)", rg.nummerGueltig("angebot", nummern.FORM.angebot(2026, 24)));
pruefe("Rechnung: 14 Tage Zahlungsziel", rg.frist("rechnung", "2026-09-05") === "2026-09-19");
pruefe("Angebot: 30 Tage gueltig", rg.frist("angebot", "2026-09-05") === "2026-10-05");
pruefe("Monatswechsel: 31.01. + 1 = 01.02.", rg.tageSpaeter("2026-01-31", 1) === "2026-02-01");
pruefe("Jahreswechsel: 20.12. + 14 = 03.01.", rg.tageSpaeter("2026-12-20", 14) === "2027-01-03");
pruefe("datumDe: 2026-09-05 -> 05.09.2026", rg.datumDe("2026-09-05") === "05.09.2026");
pruefe("tagFeld: Date-Objekt wird lokal gelesen (kein UTC-Vortag)", rg.tagFeld(new Date(2026, 0, 1, 0, 30)) === "2026-01-01");
pruefe("euro: 1234.5 -> 1.234,50 €", rg.euro(1234.5).replace(/ /g, " ") === "1.234,50 €");

// ---------------------------------------------------- 6. Empfaenger, Absender, Mail
console.log("\n— Empfaenger, Absender, Mail —");
const emp = rg.empfaengerAusFirma({ name: " Müller GmbH ", geschaeftsfuehrer: "Max Müller", adresse: "Hauptstr. 1", plz: "84405", ort: "Dorfen", email: "info@mueller.de", geschlecht: "m" });
pruefe("Anrede aus geschlecht: m -> Herr, w -> Frau, d/leer -> keine", emp.anrede === "Herr" && rg.empfaengerAusFirma({ geschlecht: "w" }).anrede === "Frau" && rg.empfaengerAusFirma({ geschlecht: "d" }).anrede === "");
pruefe("Angebot-PDF: 'Sehr geehrter Herr Müller,' / ohne Anrede 'Guten Tag Max Müller,'", /Sehr geehrter Herr M\\374ller,/.test(inhalt(rg.pdfBauen({ art: "angebot", empfaenger: { name: "x", ansprechperson: "Max Müller", anrede: "Herr" }, positionen: [], summe: 0 }))) && /Guten Tag Max M\\374ller,/.test(inhalt(rg.pdfBauen({ art: "angebot", empfaenger: { name: "x", ansprechperson: "Max Müller" }, positionen: [], summe: 0 }))));
// Die Rechnung traegt KEINE Anrede — Vorbild R-2026-139 geht von der
// Nummernzeile direkt in die Tabelle (06.09.2026).
pruefe("Rechnungs-PDF: keine Anrede, aber die Einleitung aus dem Formular", !/Sehr geehrter|Guten Tag|Sehr geehrte Damen/.test(inhalt(rg.pdfBauen({ art: "rechnung", empfaenger: { name: "x", ansprechperson: "Max Müller", anrede: "Herr" }, positionen: [], summe: 0 })))
  && /wie besprochen/.test(inhalt(rg.pdfBauen({ art: "rechnung", einleitung: "wie besprochen", empfaenger: { name: "x", ansprechperson: "Max Müller", anrede: "Herr" }, positionen: [], summe: 0 }))));
pruefe("Empfaenger aus Firma: Name, Ansprechperson, Strasse, PLZ Ort, Mail", emp.name === "Müller GmbH" && emp.ansprechperson === "Max Müller" && emp.strasse === "Hauptstr. 1" && emp.plz_ort === "84405 Dorfen" && emp.email === "info@mueller.de");
pruefe("Empfaenger ohne Firma: leere Felder, kein Fehler", rg.empfaengerAusFirma(null).name === "");
// ZWEI Briefkoepfe, gemessen an Lukas' echten Belegen (D1-vorlagen-
// spezifikation.md): Rechnungen gehen unter SVH Consulting GbR, Angebote unter
// Flowstate AI Solutions — beide Am Anger 3, 84539 Zangberg. Die alte
// PRODUCT.md-Vorgabe "84405 Dorfen" gilt fuer Belege nicht mehr; sie stand in
// keiner der 30 Rechnungen und keinem der 18 Angebote.
const abs = rg.absender("rechnung");
const absA = rg.absender("angebot");
pruefe("Absender Rechnung: SVH Consulting GbR, Am Anger 3, 84539 Zangberg",
  abs.name === "SVH Consulting GbR" && abs.strasse === "Am Anger 3" && abs.plz_ort === "84539 Zangberg" && abs.unterschrift === "Jannik vom Hofe");
pruefe("Absender Rechnung: Bank, Steuernummer und USt-IdNr. der Hausvorlage",
  abs.iban === "DE21 7115 1020 0032 0980 71" && abs.bic === "BYLADEM1MDF" && abs.kontoinhaber === "Jannik vom Hofe" && abs.steuernr === "141/174/10707" && abs.ustid === "DE464385333");
pruefe("Absender Angebot: Flowstate AI Solutions, ohne Bank und ohne Steuernummer",
  absA.name === "Flowstate AI Solutions" && absA.plz_ort === "84539 Zangberg" && absA.iban === "" && absA.steuernr === "" && absA.unterschrift === "Lukas Sehorz");
pruefe("Absender: unbekannte Art -> Rechnungsbriefkopf", rg.absender("quatsch").name === abs.name);
pruefe("Absender: RECHNUNG_ABSENDER_* uebersteuert und trifft das Angebot nicht", (() => {
  process.env.RECHNUNG_ABSENDER_NAME = "Andere GbR";
  const x = rg.absender("rechnung"), y = rg.absender("angebot");
  delete process.env.RECHNUNG_ABSENDER_NAME;
  return x.name === "Andere GbR" && y.name === "Flowstate AI Solutions";
})());
const r = { art: "rechnung", nummer: "R-2026-131", summe: 1500, faellig: "2026-09-19", titel: "Webseite",
  empfaenger: { name: "Müller GmbH", ansprechperson: "Max Müller" } };
const m = rg.mailTexten(r, { name: "Jannik vom Hofe" });
pruefe("Betreff: 'Rechnung R-2026-131 – Müller GmbH'", m.betreff === "Rechnung R-2026-131 – Müller GmbH");
pruefe("Text nennt Betrag, Frist, Verwendungszweck und Absender", /1\.500,00/.test(m.text) && /19\. September 2026/.test(m.text) && /R-2026-131/.test(m.text) && /Jannik vom Hofe/.test(m.text));
pruefe("Anrede mit Ansprechperson", /^Hallo Max Müller,/.test(m.text));
const ma = rg.mailTexten({ ...r, art: "angebot", nummer: "2026-024", empfaenger: { name: "Müller GmbH" } }, null);
pruefe("Angebot: 'Angebot 2026-024 – …', 'gültig bis', Anrede ohne Namen", /^Angebot 2026-024/.test(ma.betreff) && /gültig bis/.test(ma.text) && /^Guten Tag,/.test(ma.text));
pruefe("Abschlag: Betreff 'Abschlagsrechnung'", /^Abschlagsrechnung R-/.test(rg.mailTexten({ ...r, abschlag_von: 3 }, null).betreff));

// ---------------------------------------------------- 7. PDF
console.log("\n— PDF —");
const basis = { art: "rechnung", nummer: "R-2026-131", status: "gestellt", firma_id: 7, datum: "2026-09-05", faellig: "2026-09-19",
  titel: "Webseite", einleitung: "wie vereinbart stellen wir Ihnen in Rechnung:", schluss: rg.SCHLUSS.rechnung,
  empfaenger: { name: "Müller GmbH", ansprechperson: "Max Müller", strasse: "Hauptstr. 1", plz_ort: "84405 Dorfen" },
  positionen: [{ titel: "Konzeption & Design", beschreibung: "Struktur und Design.", menge: 1, einheit: "pauschal", einzelpreis: 1500 }], summe: 1500 };
const p1 = rg.pdfBauen(basis, rg.absender(), { unterschrift: "Lukas Sehorz" });
const i1 = inhalt(p1);
pruefe("PDF beginnt mit %PDF und endet mit %%EOF", p1.subarray(0, 5).toString() === "%PDF-" && /%%EOF\s*$/.test(p1.toString("latin1")));
pruefe("eine Seite bei einer Position", /\/Count 1/.test(p1.toString("latin1")));
pruefe("Nummer, Betrag und Frist stehen im Blatt", /R-2026-131/.test(i1) && /1\.500,00/.test(i1) && /19\.09\.2026/.test(i1));
pruefe("§19-Satz im Blatt", /19 Abs\. 1 UStG/.test(i1));
pruefe("Briefkopf SVH CONSULTING, Tabelle ohne Menge/Einheit-Spalten",
  /\(SVH\)/.test(i1) && /\(CONSULTING\)/.test(i1) && /\(Einzelpreis\)/.test(i1) && !/\(Menge\)/.test(i1) && !/\(Einheit\)/.test(i1));
pruefe("Zahlungsblock der Hausvorlage: Ziel, IBAN, BIC, Verwendungszweck, Kontoinhaber",
  /\(Zahlungsziel:\)/.test(i1) && /\(IBAN:\)/.test(i1) && /DE21 7115/.test(i1) && /\(BIC:\)/.test(i1) && /BYLADEM1MDF/.test(i1) && /\(Verwendungszweck:\)/.test(i1) && /\(Kontoinhaber:\)/.test(i1));
pruefe("Fusszeile mit Steuernummer und USt-IdNr.", /Steuernummer: 141\/174\/10707/.test(i1) && /USt-IdNr\.: DE464385333/.test(i1));
pruefe("Einleitung steht ueber der Tabelle, die Anrede nicht", !/Guten Tag Max M\\374ller,/.test(i1) && /wie vereinbart stellen wir Ihnen in Rechnung:/.test(i1));
pruefe("gestellte Rechnung traegt kein ENTWURF", !/ENTWURF/.test(i1));
pruefe("Unterschrift des Senders", /Lukas Sehorz/.test(i1));
const p2 = rg.pdfBauen({ ...basis, nummer: null, status: "entwurf" });
pruefe("Entwurf traegt die Kennung ENTWURF und keinen Nummerntext", /ENTWURF/.test(inhalt(p2)) && !/R-2026-131/.test(inhalt(p2)));
process.env.RECHNUNG_ABSENDER_IBAN = "DE00 1234 5678 9012 3456 78";
const p3 = rg.pdfBauen(basis, rg.absender("rechnung"));
pruefe("RECHNUNG_ABSENDER_IBAN uebersteuert die Bankverbindung", /DE00 1234/.test(inhalt(p3)) && !/DE21 7115/.test(inhalt(p3)));
delete process.env.RECHNUNG_ABSENDER_IBAN;
const viele = { ...basis, positionen: Array.from({ length: 28 }, (_, i) => ({ titel: `Position ${i + 1}`, beschreibung: "Eine Beschreibung, die zwei Zeilen lang ist, damit die Tabelle wirklich umbricht und die Seite voll wird.", menge: 1, einheit: "pauschal", einzelpreis: 100 })), summe: 2800 };
const p4 = rg.pdfBauen(viele, rg.absender());
const seiten4 = Number((p4.toString("latin1").match(/\/Type \/Pages [^>]*\/Count (\d+)/) || [])[1]);
pruefe("28 Positionen brauchen mehrere Seiten", seiten4 >= 2, `${seiten4} Seiten`);
pruefe("jede Seite traegt 'Seite n von m'", new RegExp(`Seite ${seiten4} von ${seiten4}`).test(inhalt(p4)) && /Seite 1 von/.test(inhalt(p4)));
pruefe("Tabellenkopf wird auf der Folgeseite wiederholt", (inhalt(p4).match(/\(Einzelpreis\)/g) || []).length >= 2);
const angebotV = rg.texte("website", "angebot");
const pa = rg.pdfBauen({ ...basis, art: "angebot", nummer: "2026-024", faellig: "2026-10-05",
  einleitung: angebotV.einleitung, schluss: angebotV.schluss, nutzen: angebotV.nutzen }, rg.absender("angebot"));
const ia = inhalt(pa);
pruefe("Angebot: Briefkopf FLOWSTATE AI SOLUTIONS, Nummer, ausgeschriebenes Datum, 'Gültig bis'",
  /\(FLOWSTATE\)/.test(ia) && /\(AI SOLUTIONS\)/.test(ia) && /\(Angebot-Nr\.\)/.test(ia) && /\(2026-024\)/.test(ia) && /05\. Oktober 2026/.test(ia) && /G\\374ltig bis/.test(ia));
pruefe("Angebot: Nutzenliste, Balken 'Gesamtpaket', kein §19 und keine Bankverbindung",
  /mobiloptimierter Auftritt/.test(ia) && /\(Gesamtpaket\)/.test(ia) && !/19 Abs\. 1 UStG/.test(ia) && !/IBAN/.test(ia));

// ------------------------------------------- 7b. Eingaben, die frueher 500 gaben
// Alle vier Faelle stammen aus der Pruefung vom 05.09.2026 (Befunde 6, 12, 13).
console.log("\n— Sichtbar scheitern statt 500 —");
const eingabe = (aend) => ({ art: "rechnung", empfaenger: { name: "Müller GmbH" }, datum: "2026-09-05",
  positionen: [{ titel: "Leistung", menge: "1", einheit: "pauschal", einzelpreis: "100" }], ...aend });
pruefe("Datum 2026-13-45 wird nicht durchgereicht", rg.tagFeld("2026-13-45") === "" && rg.tagFeld("2026-02-30") === "" && rg.tagFeld("2026-02-28") === "2026-02-28");
// Frueher wurde "2026-13-45" still auf heute gesetzt. Kein 500er mehr, aber ein
// stillschweigend geaendertes Rechnungsdatum ist falsch (06.09.2026).
pruefe("ungueltiges Datum -> 'datum' statt stiller Korrektur", rg.pruefen(eingabe({ datum: "2026-13-45" }), "rechnung").grund === "datum"
  && rg.pruefen(eingabe({ datum: "2026-02-30" }), "rechnung").grund === "datum"
  && rg.pruefen(eingabe({ faellig: "2026-13-45" }), "rechnung").grund === "datum");
pruefe("leeres Datum bleibt erlaubt und heisst heute", rg.pruefen(eingabe({ datum: "" }), "rechnung").werte.datum === rg.heute());
pruefe("Einzelpreis 99999999999 -> 'zu-gross'", rg.pruefen(eingabe({ positionen: [{ titel: "X", menge: 1, einheit: "pauschal", einzelpreis: "99999999999" }] }), "rechnung").grund === "zu-gross");
pruefe("Summe ueber der Grenze -> 'zu-gross'", rg.pruefen(eingabe({ positionen: [{ titel: "X", menge: "1000", einheit: "Stück", einzelpreis: "999999" }] }), "rechnung").grund === "zu-gross");
pruefe("Betrag knapp unter der Grenze geht", rg.pruefen(eingabe({ positionen: [{ titel: "X", menge: 1, einheit: "pauschal", einzelpreis: rg.BETRAG_MAX }] }), "rechnung").ok === true);
pruefe("Position mit Preis, aber ohne Titel wird abgelehnt", rg.pruefen(eingabe({ positionen: [{ titel: "", menge: 1, einheit: "pauschal", einzelpreis: "500" }] }), "rechnung").grund === "positionen");
pruefe("Nutzenliste nur beim Angebot", rg.pruefen({ ...eingabe({}), nutzen: "Ein Punkt\nNoch einer" }, "rechnung").werte.nutzen === ""
  && rg.pruefen({ ...eingabe({ art: "angebot" }), nutzen: "Ein Punkt\nNoch einer" }, "angebot").werte.nutzen === "Ein Punkt\nNoch einer");
const routen = require("../lib/rechnungen-routes.js");
pruefe("?fehler=__proto__ / ?ok=constructor liefern keinen Prototyp-Inhalt",
  !/prototype|function|\[object/i.test(routen.fehlerText("__proto__")) && /Meldung/.test(routen.fehlerText("__proto__"))
  && !Object.hasOwn(routen.OKTEXTE, "constructor") && !Object.hasOwn(routen.FEHLERTEXTE, "__proto__"));
pruefe("jeder neue Fehlercode hat einen Text", ["firma", "zu-gross", "abschlag-entwurf", "rest-null", "storno-bezahlt", "datum"].every((c) => Object.hasOwn(routen.FEHLERTEXTE, c)));
pruefe("Anrede: Herr/Frau mit Nachname, sonst ganzer Name, sonst Damen und Herren",
  rg.anredeZeile({ ansprechperson: "Max Müller", anrede: "Herr" }) === "Sehr geehrter Herr Müller,"
  && rg.anredeZeile({ ansprechperson: "Eva Klein", anrede: "Frau" }) === "Sehr geehrte Frau Klein,"
  && rg.anredeZeile({ ansprechperson: "Alex Klein" }) === "Guten Tag Alex Klein,"
  && rg.anredeZeile({}) === "Sehr geehrte Damen und Herren,");

// ---------------------------------------------------- 8. Vertrag: werfen nie
console.log("\n— Vertrags-Exporte ohne Datenbank —");
pruefe("URL_NEU(5, 'angebot')", rg.URL_NEU(5, "angebot") === "/buchhaltung/rechnungen/neu?art=angebot&firma=5");
pruefe("URL_NEU ohne Firma, Art unbekannt -> Rechnung", rg.URL_NEU(null, "x") === "/buchhaltung/rechnungen/neu?art=rechnung");
(async () => {
  const leerFirma = await rg.rechnungenJeFirma(null, 1);
  pruefe("rechnungenJeFirma ohne Nutzer: Nullen und leere Liste", leerFirma.gestellt === 0 && leerFirma.offen === 0 && Array.isArray(leerFirma.liste) && leerFirma.liste.length === 0);
  pruefe("umsatzFest ohne Nutzer: Nullen", JSON.stringify(await rg.umsatzFest(null)) === JSON.stringify({ gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0 }));
  pruefe("offeneRechnungen ohne Nutzer: leere Liste", (await rg.offeneRechnungen(null)).length === 0);
  // Mit Nutzer, aber ohne erreichbare Datenbank: darf nicht werfen.
  const nutzer = { id: "00000000-0000-0000-0000-000000000000", name: "Test", rolle: "admin" };
  let geworfen = false, ergebnis = null;
  const wache = new Promise((f) => setTimeout(() => f("zeit"), 8000));
  try { ergebnis = await Promise.race([rg.umsatzFest(nutzer), wache]); } catch { geworfen = true; }
  pruefe("umsatzFest ohne Datenbank wirft nicht (Nullen oder Zeitwache)", !geworfen && (ergebnis === "zeit" || ergebnis.gestellt === 0));
  const jf = await Promise.race([rg.rechnungenJeFirma(nutzer, 1), wache]).catch(() => "geworfen");
  pruefe("rechnungenJeFirma ohne Datenbank wirft nicht", jf !== "geworfen");
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
