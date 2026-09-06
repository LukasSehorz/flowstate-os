// Prueft lib/beleg-diktat.js — ohne Datenbank und ohne Sprachmodell.
//
// Getestet wird das, was das Modell NICHT entscheiden darf: die Nachpruefung
// in saeubern() und die Datumsauflösung. Dafuer stehen hier erfundene
// Modellantworten — falsche Betraege, ein Datum in der Zukunft, eine unbekannte
// Vorlage, eine Positionssumme, die nicht zum genannten Gesamtbetrag passt,
// ein Abschlag von 150 %, eine leere Antwort und ein Modell, das wirft.
//
// lib/schnell.js und lib/crm.js sind ATTRAPPEN (unten in require.cache
// gelegt): Der Test darf weder ins Netz noch in die Datenbank, sonst laeuft er
// nicht in scripts/pruefen.js mit.
//
//   node scripts/test-beleg-diktat.js

const path = require("path");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// ---------------------------------------------------------------- Attrappen
// Muessen VOR dem require von beleg-diktat.js stehen: das Modul zieht rechnungen.js
// und crm.js beim Laden, und crm.js wuerde sonst einen echten Pool aufbauen wollen.
const attrappe = { da: true, antwort: null, wirft: null, letzterAufruf: null };
require.cache[require.resolve("../lib/schnell.js")] = {
  id: "schnell-attrappe", filename: require.resolve("../lib/schnell.js"), loaded: true, children: [], paths: [],
  exports: {
    verfuegbar: () => attrappe.da,
    kenntAufwand: () => true,
    async frage() { return ""; },
    async denke() { return ""; },
    async mitWerkzeugenStrom() { return { text: "", aufrufe: [] }; },
    async mitWerkzeugen(system, nutzer, werkzeuge, opts) {
      attrappe.letzterAufruf = { system, nutzer, werkzeuge, opts };
      if (attrappe.wirft) throw new Error(attrappe.wirft);
      return attrappe.antwort || { text: "", aufrufe: [], tokenRaus: 0 };
    },
  },
};

const FIRMEN = [
  { id: 7, name: "Anderka GmbH", geschaeftsfuehrer: "Gottfried Anderka", adresse: "Isener Str. 6", plz: "83527", ort: "Kirchdorf", email: "info@anderka.de", geschlecht: "m", mobil: "+4915112345", telefon: "08071 1234" },
  { id: 8, name: "Anderka Bau GmbH", geschaeftsfuehrer: "Sepp Anderka", adresse: "Hauptstr. 1", plz: "83527", ort: "Kirchdorf", email: "bau@anderka.de", geschlecht: "m" },
  { id: 9, name: "Elektro Albonni", geschaeftsfuehrer: "Mohamad Albonni", adresse: "Lilienstraße 12", plz: "86825", ort: "Bad Wörishofen", email: "info@albonni.de", geschlecht: "m" },
];
require.cache[require.resolve("../lib/crm.js")] = {
  id: "crm-attrappe", filename: require.resolve("../lib/crm.js"), loaded: true, children: [], paths: [],
  exports: {
    async alsNutzer() { throw new Error("Der Test spricht nicht mit der Datenbank."); },
    async system() { throw new Error("Der Test spricht nicht mit der Datenbank."); },
    async firmenListe(user, { suche = "", limit = 200 } = {}) {
      const t = String(suche).toLowerCase();
      return FIRMEN.filter((f) => !t || f.name.toLowerCase().includes(t)).slice(0, limit);
    },
  },
};

process.env.SCHNELL_PROVIDER = "anthropic";
const bd = require("../lib/beleg-diktat.js");
const rg = require("../lib/rechnungen.js");

const HEUTE = "2026-09-06";
const NUTZER = { id: "00000000-0000-0000-0000-000000000001", name: "Lukas", rolle: "admin" };
const warnt = (e, muster) => (e.warnungen || []).some((w) => muster.test(w));

// ------------------------------------------------------------ 1. Werkzeug-Schema
console.log("— Werkzeug-Schema —");
pruefe("heisst beleg_entwurf", bd.SCHEMA.name === "beleg_entwurf");
const P = bd.SCHEMA.input_schema.properties;
const PFLICHT = ["art", "firma", "ansprechpartner", "anrede", "titel", "vorlage", "datum", "leistungsdatum",
  "faellig_tage", "abschlag_prozent", "gesamtbetrag", "positionen", "einleitung", "nutzen", "schluss",
  "hinweis", "sicherheit"];
pruefe("alle 17 Felder aus dem Auftrag sind da", PFLICHT.every((k) => P[k]),
  PFLICHT.filter((k) => !P[k]).join(", "));
pruefe("alle Felder sind Pflicht (required)", PFLICHT.every((k) => bd.SCHEMA.input_schema.required.includes(k)));
pruefe("art kennt genau angebot und rechnung", JSON.stringify(P.art.enum) === JSON.stringify(["angebot", "rechnung"]));
pruefe("vorlage kennt genau die vier Hausvorlagen",
  JSON.stringify(P.vorlage.enum) === JSON.stringify(["website", "ki", "performance", "frei"]));
pruefe("anrede laesst leer zu (nicht raten)", P.anrede.enum.includes(""));
pruefe("abschlag_prozent und gesamtbetrag duerfen null sein",
  JSON.stringify(P.abschlag_prozent.anyOf) === JSON.stringify([{ type: "number" }, { type: "null" }])
  && JSON.stringify(P.gesamtbetrag.anyOf) === JSON.stringify([{ type: "number" }, { type: "null" }]));
const PP = P.positionen.items.properties;
pruefe("Position hat titel, beschreibung, menge, einheit, einzelpreis",
  ["titel", "beschreibung", "menge", "einheit", "einzelpreis"].every((k) => PP[k]));
pruefe("Positionseinheiten decken sich mit rechnungen.EINHEITEN",
  JSON.stringify(PP.einheit.enum) === JSON.stringify(rg.EINHEITEN));
pruefe("einzelpreis darf null sein (kein geratener Preis)",
  JSON.stringify(PP.einzelpreis.anyOf) === JSON.stringify([{ type: "number" }, { type: "null" }]));

// ------------------------------------------------------------ 2. Systemanweisung
console.log("— Systemanweisung —");
const A = bd.anweisung(HEUTE);
pruefe("nennt das heutige Datum in beiden Formen", A.includes(HEUTE) && A.includes("06. September 2026"));
pruefe("verbietet Raten ausdruecklich", /RATE NICHTS/.test(A));
pruefe("sagt: Endpreise, § 19, keine Umsatzsteuer", /ENDPREISE/i.test(A) && /§ 19/.test(A) && /keine Umsatzsteuer/.test(A));
pruefe("erklaert deutsche Zahlformate inkl. ausgeschrieben",
  /2\.500 €/.test(A) && /zweitausendfünfhundert/.test(A));
pruefe("erklaert Datumsangaben (heute, nächsten Montag, 15.9.)",
  /heute/.test(A) && /nächsten Montag/.test(A) && /15\.9\./.test(A));
pruefe("rechnet den Abschlag im Beispiel richtig vor (1250 statt 2500)",
  /abschlag_prozent = 50/.test(A) && /Position trägt 1250/.test(A));
pruefe("traegt beide Hausvorlagen als Vorbild (Anderka-Rechnung, Albonni-Angebot)",
  /R-2026-139/.test(A) && /2026-026/.test(A) && /Abschlagsrechnung \(50 %\)/.test(A));
pruefe("sagt, dass die Rechnung keine Anrede/Nutzenpunkte hat", /Die RECHNUNG hat keine Anrede/.test(A));

// ------------------------------------------------------------ 3. Datumsauflösung
console.log("— Datumsauflösung —");
const d = (x) => bd.datumAufloesen(x, HEUTE);
pruefe('"heute" -> 2026-09-06', d("heute") === HEUTE, d("heute"));
pruefe('"morgen" -> 2026-09-07', d("morgen") === "2026-09-07", d("morgen"));
pruefe('"übermorgen" -> 2026-09-08', d("übermorgen") === "2026-09-08", d("übermorgen"));
pruefe('"gestern" -> 2026-09-05', d("gestern") === "2026-09-05", d("gestern"));
pruefe('"15.9." -> 2026-09-15', d("15.9.") === "2026-09-15", d("15.9."));
pruefe('"15.09." -> 2026-09-15', d("15.09.") === "2026-09-15", d("15.09."));
pruefe('"15.09.2026" -> 2026-09-15', d("15.09.2026") === "2026-09-15", d("15.09.2026"));
pruefe('"15.9.27" -> 2027-09-15 (zweistelliges Jahr)', d("15.9.27") === "2027-09-15", d("15.9.27"));
pruefe('"15. September" -> 2026-09-15', d("15. September") === "2026-09-15", d("15. September"));
// 06.09.2026 ist ein Sonntag -> der naechste Montag ist der 7.
pruefe('"nächsten Montag" -> 2026-09-07', d("nächsten Montag") === "2026-09-07", d("nächsten Montag"));
pruefe('"in 2 Wochen" -> 2026-09-20', d("in 2 Wochen") === "2026-09-20", d("in 2 Wochen"));
pruefe('"15.1." ohne Jahr im September -> naechstes Jahr', d("15.1.") === "2027-01-15", d("15.1."));
pruefe('"01.09." ohne Jahr bleibt dieses Jahr (rueckdatiert)', d("01.09.") === "2026-09-01", d("01.09."));
pruefe("ISO geht unveraendert durch", d("2026-12-24") === "2026-12-24");
pruefe('"31.2." gibt es nicht -> leer', d("31.2.") === "", d("31.2."));
pruefe("Unsinn -> leer", d("irgendwann mal") === "" && d("") === "" && d(null) === "");
pruefe("2026-02-31 ist kein echter Tag", bd.istEchterTag("2026-02-31") === false && bd.istEchterTag("2026-02-28") === true);
pruefe("Plausibilitaet: 2019 nein, 2030 nein, heute ja",
  !bd.datumPlausibel("2019-05-01", HEUTE) && !bd.datumPlausibel("2030-01-01", HEUTE) && bd.datumPlausibel(HEUTE, HEUTE));

// ------------------------------------------------------------ 4. Nachpruefung
console.log("— Nachprüfung (saeubern) —");
const GUT = {
  art: "rechnung", firma: "Anderka GmbH", ansprechpartner: "Gottfried Anderka", anrede: "Herr",
  titel: "Webseite", vorlage: "website", datum: "2026-09-06", leistungsdatum: "2026-09-06",
  faellig_tage: 14, abschlag_prozent: null, gesamtbetrag: 2500,
  positionen: [{ titel: "Erstellung der neuen Webseite", beschreibung: "Individuelles, responsives Webdesign.", menge: 1, einheit: "pauschal", einzelpreis: 2500 }],
  einleitung: "", nutzen: [], schluss: "", hinweis: "", sicherheit: "hoch",
};
let e = bd.saeubern(GUT, { art: "rechnung", heute: HEUTE });
pruefe("guter Fall: Summe 2500, keine Warnung", e.summe === 2500 && e.warnungen.length === 0, JSON.stringify(e.warnungen));
pruefe("guter Fall: faellig = Datum + 14 Tage", e.faellig === "2026-09-20", e.faellig);
pruefe("guter Fall: Anrede und Ansprechpartner uebernommen", e.anrede === "Herr" && e.ansprechpartner === "Gottfried Anderka");

e = bd.saeubern({ ...GUT, positionen: [{ ...GUT.positionen[0], einzelpreis: 0 }] }, { art: "rechnung", heute: HEUTE });
pruefe("Preis 0 fliegt raus (Zeile ohne Preis wird nicht uebernommen)", e.positionen.length === 0 && e.summe === 0);
pruefe("Preis 0: es steht eine Warnung da", warnt(e, /keine Position mit Titel und Preis/));

e = bd.saeubern({ ...GUT, positionen: [{ ...GUT.positionen[0], einzelpreis: 99999999999 }] }, { art: "rechnung", heute: HEUTE });
pruefe("Betrag ueber der Spaltengrenze wird entfernt", e.positionen.length === 0 && warnt(e, /nicht plausibel/));

e = bd.saeubern({ ...GUT, positionen: [{ ...GUT.positionen[0], einzelpreis: -50 }] }, { art: "rechnung", heute: HEUTE });
pruefe("negativer Preis wird entfernt", e.positionen.length === 0);

e = bd.saeubern({ ...GUT, positionen: [{ titel: "", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: 500 }] }, { art: "rechnung", heute: HEUTE });
pruefe("Position ohne Titel fliegt raus", e.positionen.length === 0 && warnt(e, /keinen Titel oder keinen Preis/));

e = bd.saeubern({ ...GUT, datum: "2029-01-01" }, { art: "rechnung", heute: HEUTE });
pruefe("Datum weit in der Zukunft -> heute + Warnung", e.datum === HEUTE && warnt(e, /außerhalb des Plausiblen/), e.datum);
e = bd.saeubern({ ...GUT, datum: "2018-01-01" }, { art: "rechnung", heute: HEUTE });
pruefe("Datum vor 2020 -> heute + Warnung", e.datum === HEUTE && warnt(e, /außerhalb des Plausiblen/));
e = bd.saeubern({ ...GUT, datum: "2026-02-31" }, { art: "rechnung", heute: HEUTE });
pruefe("Datum, das es nicht gibt -> heute", e.datum === HEUTE);
e = bd.saeubern({ ...GUT, datum: "heute" }, { art: "rechnung", heute: HEUTE });
pruefe('Datum "heute" wird noch im Code aufgeloest', e.datum === HEUTE);

e = bd.saeubern({ ...GUT, vorlage: "flyer" }, { art: "rechnung", heute: HEUTE });
pruefe("unbekannte Vorlage -> frei", e.vorlage === "frei");

e = bd.saeubern({ ...GUT, gesamtbetrag: 3000 }, { art: "rechnung", heute: HEUTE });
pruefe("Positionssumme != Gesamtbetrag -> Warnung, nichts wird stillschweigend korrigiert",
  e.summe === 2500 && e.gesamtbetrag === 3000 && warnt(e, /Bitte prüfen, welche Zahl stimmt/));

e = bd.saeubern({ ...GUT, abschlag_prozent: 50, gesamtbetrag: 2500,
  positionen: [{ titel: "Abschlagsrechnung (50 %)", beschreibung: "…", menge: 1, einheit: "pauschal", einzelpreis: 1250 }] },
  { art: "rechnung", heute: HEUTE });
pruefe("Abschlag 50 % von 2.500 mit Position 1.250 -> keine Warnung", e.summe === 1250 && e.warnungen.length === 0, JSON.stringify(e.warnungen));

e = bd.saeubern({ ...GUT, abschlag_prozent: 50, gesamtbetrag: 2500 }, { art: "rechnung", heute: HEUTE });
pruefe("Abschlag 50 %, Position traegt aber den GESAMTbetrag -> Warnung",
  warnt(e, /50 % von .* wären aber/), JSON.stringify(e.warnungen));

e = bd.saeubern({ ...GUT, abschlag_prozent: 150 }, { art: "rechnung", heute: HEUTE });
pruefe("Abschlag 150 % -> entfernt + Warnung", e.abschlag_prozent === null && warnt(e, /nicht möglich/));
e = bd.saeubern({ ...GUT, abschlag_prozent: 0 }, { art: "rechnung", heute: HEUTE });
pruefe("Abschlag 0 % -> entfernt", e.abschlag_prozent === null);
e = bd.saeubern({ ...GUT, abschlag_prozent: 50 }, { art: "rechnung", heute: HEUTE }).abschlag_prozent;
pruefe("Abschlag 50 % bleibt", e === 50);

e = bd.saeubern({}, { art: "angebot", heute: HEUTE });
pruefe("leere Modellantwort: vollstaendiges Objekt, art aus der Vorgabe",
  e.art === "angebot" && e.positionen.length === 0 && e.summe === 0 && e.datum === HEUTE && e.vorlage === "frei");
pruefe("leere Modellantwort: Angebotsfrist 30 Tage", e.faellig === "2026-10-06", e.faellig);
pruefe("leere Modellantwort: Warnung, dass keine Position lesbar war", warnt(e, /keine Position/));
pruefe("Muell als Eingabe wirft nicht", (() => { try { bd.saeubern(null); bd.saeubern("hallo"); bd.saeubern(42); return true; } catch { return false; } })());

e = bd.saeubern({ ...GUT, faellig_tage: 999 }, { art: "rechnung", heute: HEUTE });
pruefe("Zahlungsziel 999 Tage -> zurueck auf 14", e.faellig_tage === 14);
e = bd.saeubern({ ...GUT, faellig_tage: -3 }, { art: "rechnung", heute: HEUTE });
pruefe("negatives Zahlungsziel -> zurueck auf 14", e.faellig_tage === 14);
e = bd.saeubern({ ...GUT, faellig_tage: 30 }, { art: "rechnung", heute: HEUTE });
pruefe("Zahlungsziel 30 Tage bleibt", e.faellig_tage === 30 && e.faellig === "2026-10-06");

e = bd.saeubern({ ...GUT, art: "rechnung", einleitung: "Sehr geehrter Herr Anderka,", nutzen: ["Punkt eins ist lang genug"], schluss: "Viele Grüße" }, { art: "rechnung", heute: HEUTE });
pruefe("Rechnung: Einleitung, Nutzen und Schluss bleiben leer (Hausvorlage)",
  e.einleitung === "" && e.nutzen.length === 0 && e.schluss === "");

e = bd.saeubern({ ...GUT, art: "angebot", nutzen: ["kurz", "Ein ausreichend langer Nutzenpunkt eins", "Ein ausreichend langer Nutzenpunkt zwei.", "Drei ist auch lang genug so", "Vier ist ebenfalls lang genug", "Fünf ist noch dabei bitte", "Sechs faellt raus hier"] },
  { art: "angebot", heute: HEUTE });
pruefe("Angebot: zu kurze Punkte raus, hoechstens fuenf, ohne Schlusspunkt",
  e.nutzen.length === 5 && !e.nutzen.some((n) => /\.$/.test(n)) && !e.nutzen.includes("kurz"), JSON.stringify(e.nutzen));

e = bd.saeubern({ ...GUT, titel: "x".repeat(500), hinweis: "y".repeat(900),
  positionen: [{ titel: "t".repeat(400), beschreibung: "b".repeat(3000), menge: 1, einheit: "Faß", einzelpreis: 100 }] },
  { art: "rechnung", heute: HEUTE });
pruefe("Texte werden gekuerzt", e.titel.length === 120 && e.hinweis.length === 400
  && e.positionen[0].titel.length === 160 && e.positionen[0].beschreibung.length === 1200);
pruefe("unbekannte Einheit -> pauschal", e.positionen[0].einheit === "pauschal");
pruefe("Menge 0/negativ -> 1",
  bd.saeubern({ ...GUT, positionen: [{ ...GUT.positionen[0], menge: 0 }] }, { heute: HEUTE }).positionen[0].menge === 1);
pruefe("deutsche Zahltexte werden gelesen (2.500,50 €)",
  bd.saeubern({ ...GUT, positionen: [{ ...GUT.positionen[0], einzelpreis: "2.500,50 €" }] }, { heute: HEUTE }).summe === 2500.5);
pruefe("Sicherheit ausserhalb der Liste -> mittel", bd.saeubern({ ...GUT, sicherheit: "sehr hoch" }, { heute: HEUTE }).sicherheit === "mittel");

// ------------------------------------------------------------ 5. Firma zuordnen
console.log("— Firma zuordnen —");
(async () => {
  let f = await bd.firmaZuordnen(NUTZER, "Elektro Albonni");
  pruefe("ein Treffer -> eindeutig", f.eindeutig && f.firma.id === 9);
  f = await bd.firmaZuordnen(NUTZER, "Anderka");
  pruefe("zwei Treffer -> nicht raten, Auswahl anbieten", !f.eindeutig && f.firma === null && f.treffer.length === 2);
  f = await bd.firmaZuordnen(NUTZER, "Anderka GmbH");
  pruefe("exakter Name unter mehreren -> eindeutig", f.eindeutig && f.firma.id === 7);
  f = await bd.firmaZuordnen(NUTZER, "Gibt es nicht");
  pruefe("kein Treffer -> null, keine Ausrede", !f.eindeutig && f.firma === null && f.treffer.length === 0);
  f = await bd.firmaZuordnen(NUTZER, "Elektro Albonni", "8");
  pruefe("von Hand gewaehlte Firma schlaegt den Namen aus dem Diktat", f.firma.id === 8 && f.gewaehlt === true);

  // ---------------------------------------------------------- 6. Verstehen
  console.log("— Verstehen (mit Attrappe) —");
  const DIKTAT = "Rechnung für Anderka GmbH, Website 2.500 €, Abschlag 50 %, Ansprechpartner Gottfried Anderka, Leistung heute, Zahlungsziel 14 Tage";

  attrappe.da = true;
  attrappe.wirft = null;
  attrappe.antwort = { text: "", tokenRaus: 300, aufrufe: [{ name: "beleg_entwurf", input: {
    ...GUT, abschlag_prozent: 50, gesamtbetrag: 2500,
    positionen: [{ titel: "Abschlagsrechnung (50 %) – Erstellung der Website", beschreibung: "Umfasst 50 % des vereinbarten Gesamtbetrags von 2.500,00 €.", menge: 1, einheit: "pauschal", einzelpreis: 1250 }],
  } }] };
  let v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "rechnung", heute: HEUTE });
  pruefe("guter Lauf: ok, Summe 1.250, Firma erkannt", v.ok && v.entwurf.summe === 1250 && v.firma.id === 7);
  pruefe("guter Lauf: keine Warnung", v.entwurf.warnungen.length === 0, JSON.stringify(v.entwurf.warnungen));
  pruefe("das Diktat geht wortwoertlich ans Modell", attrappe.letzterAufruf.nutzer.includes(DIKTAT));
  pruefe("das Werkzeug-Schema geht mit", attrappe.letzterAufruf.werkzeuge[0].name === "beleg_entwurf");
  pruefe("es laeuft auf Sonnet, nicht auf Haiku", /sonnet/.test(attrappe.letzterAufruf.opts.model));

  attrappe.antwort = { text: "", aufrufe: [] };
  v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "rechnung", heute: HEUTE });
  pruefe("keine Werkzeugantwort -> leerer Entwurf statt Absturz",
    !v.ok && v.grund === "keine-antwort" && v.entwurf.leer && v.entwurf.notiz === DIKTAT);

  attrappe.wirft = "Werkzeuge 529: overloaded";
  v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "rechnung", heute: HEUTE });
  pruefe("Modell wirft -> kein Absturz, Text bleibt als Notiz stehen",
    !v.ok && v.grund === "modell" && v.entwurf.notiz === DIKTAT && warnt(v.entwurf, /529/));
  attrappe.wirft = null;

  attrappe.da = false;
  pruefe("ohne Schluessel meldet bereit() false", bd.bereit() === false);
  v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "angebot", heute: HEUTE });
  pruefe("ohne Modellzugang: ruhiger Hinweis, Textfeld-Inhalt bleibt erhalten",
    !v.ok && v.grund === "kein-modell" && v.entwurf.art === "angebot" && v.entwurf.notiz === DIKTAT
    && warnt(v.entwurf, /Ohne Sprachmodell/));
  attrappe.da = true;

  v = await bd.verstehen(NUTZER, { text: "   ", art: "rechnung", heute: HEUTE });
  pruefe("leeres Textfeld -> Grund leer, kein Modellaufruf", !v.ok && v.grund === "leer");

  attrappe.antwort = { text: "", aufrufe: [{ name: "beleg_entwurf", input: { ...GUT, firma: "Anderka" } }] };
  v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "rechnung", heute: HEUTE });
  pruefe("mehrdeutige Firma -> keine gewaehlt, Warnung mit Auswahl-Aufforderung",
    v.ok && v.firma === null && v.treffer.length === 2 && warnt(v.entwurf, /mehrere Kunden/));

  attrappe.antwort = { text: "", aufrufe: [{ name: "beleg_entwurf", input: { ...GUT, firma: "Schreinerei Ohnename" } }] };
  v = await bd.verstehen(NUTZER, { text: DIKTAT, art: "rechnung", heute: HEUTE });
  pruefe("unbekannte Firma -> Warnung, aber Entwurf bleibt nutzbar",
    v.ok && v.firma === null && warnt(v.entwurf, /steht nicht im CRM/));

  // ---------------------------------------------------------- 7. Entwurf anlegen
  console.log("— Entwurf anlegen —");
  let gesehen = null;
  rg.anlegen = async (user, dd) => { gesehen = dd; return { ok: true, id: 4711 }; };

  let r = await bd.entwurfAnlegen(NUTZER, bd.saeubern(GUT, { art: "rechnung", heute: HEUTE }), { firma: FIRMEN[0] });
  pruefe("legt ueber rechnungen.anlegen an und gibt die id zurueck", r.ok && r.id === 4711);
  pruefe("Empfaenger kommt aus der Akte (Adresse, Mail, Anrede)",
    gesehen.empfaenger.name === "Anderka GmbH" && gesehen.empfaenger.strasse === "Isener Str. 6"
    && gesehen.empfaenger.plz_ort === "83527 Kirchdorf" && gesehen.empfaenger.email === "info@anderka.de"
    && gesehen.empfaenger.anrede === "Herr", JSON.stringify(gesehen.empfaenger));
  pruefe("firma_id wird verknuepft", gesehen.firma_id === 7);
  pruefe("Rechnung bekommt keine Einleitung und keinen Schluss", gesehen.einleitung === "" && gesehen.schluss === "" && gesehen.nutzen === "");
  pruefe("Positionen und Datum gehen durch", gesehen.positionen.length === 1 && gesehen.datum === HEUTE && gesehen.faellig === "2026-09-20");

  const angebot = bd.saeubern({ ...GUT, art: "angebot", vorlage: "website",
    nutzen: ["Ein ausreichend langer Nutzenpunkt eins", "Ein ausreichend langer Nutzenpunkt zwei"] },
    { art: "angebot", heute: HEUTE });
  await bd.entwurfAnlegen(NUTZER, angebot, { firma: FIRMEN[0] });
  pruefe("Angebot: Nutzenpunkte gehen zeilenweise mit", gesehen.nutzen.split("\n").length === 2);
  pruefe("Angebot ohne eigene Einleitung nimmt die der Vorlage",
    gesehen.einleitung === rg.VORLAGEN.website.einleitung.angebot, gesehen.einleitung);

  const leer = bd.leererEntwurf("Rechnung Huber, 900 Euro, Website", { art: "rechnung", heute: HEUTE });
  await bd.entwurfAnlegen(NUTZER, { ...leer, firma: "Schreinerei Huber" }, { firma: null });
  pruefe("ohne Modell: Empfaengername kommt aus dem Diktat", gesehen.empfaenger.name === "Schreinerei Huber");
  pruefe("ohne Modell: eine Position mit dem Diktat als Notiz, ohne Preis",
    gesehen.positionen.length === 1 && gesehen.positionen[0].einzelpreis === null
    && /Rechnung Huber, 900 Euro, Website/.test(gesehen.positionen[0].beschreibung));

  r = await bd.entwurfAnlegen(NUTZER, bd.leererEntwurf("", { heute: HEUTE }), { firma: null });
  pruefe("ganz ohne Empfaenger wird nicht angelegt", !r.ok && r.grund === "empfaenger");

  console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gruen.");
  process.exit(fehler ? 1 : 0);
})().catch((err) => { console.error("❌ Unerwartet:", err); process.exit(1); });
