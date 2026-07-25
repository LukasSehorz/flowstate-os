// Testet die vier CRM-Handgriffe der Sprachschicht (Phase 4, 25.07.).
//
// Hintergrund: Alexandra konnte ueber das CRM nur reden. Beim Nachbauen der
// vier Handgriffe (Lead, Notiz, Wiedervorlage, Anrufergebnis) lauern drei
// stille Fehler, die man im Gespraech NICHT hoert:
//   1. Zwei Firmen passen gleich gut -> geraten, Notiz bei der falschen.
//   2. crm.callErgebnis kennt nur vier Ausgaenge und macht bei allem anderen
//      nichts — meldet aber Erfolg ("notiert", im CRM steht nichts).
//   3. "spaeter" ohne Datum schreibt null in die Wiedervorlage und LOESCHT
//      damit eine bestehende, statt sie zu verschieben.
// Genau darauf zielt der Test.
//
// Laeuft ohne Datenbank: lib/crm.js wird geladen und seine Datenfunktionen
// werden ersetzt. Aufruf: node scripts/test-crm-sprache.js

const crm = require("../lib/crm.js");
const cs = require("../lib/crm-sprache.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

const LUKAS = { id: "u-lukas", name: "Lukas", rolle: "admin" };

// So kommen die Zeilen aus crm.firmenListe: Rechtsform dran, "&" im Namen,
// echte Umlaute — genau die Mischung, die im CRM steht.
const FIRMEN = [
  { id: 1, name: "Physio Schwabing GmbH", ort: "München", status: "lead" },
  { id: 2, name: "Krotzer & Eisele", ort: "Dorfen", status: "kunde" },
  { id: 3, name: "Müller Bau", ort: "Erding", status: "lead" },
  { id: 4, name: "Zahnarztpraxis Nord", ort: "Hamburg", status: "lead" },
];

// ---------------------------------------------------------------- Attrappen
//
// Jeder Aufruf wird mitgeschrieben, damit auch das Gegenteil pruefbar ist:
// dass bei Mehrdeutigkeit oder fehlendem Datum eben NICHT geschrieben wird.
let protokoll = [];
let firmenAntwort = () => FIRMEN;
let anlegenAntwort = () => ({ id: 99, dublette: null });
let callAntwort = () => true;

crm.firmenListe = async (nutzer, opt) => { protokoll.push(["firmenListe", nutzer && nutzer.id, opt]); return firmenAntwort(); };
crm.firmaAnlegen = async (nutzer, d) => { protokoll.push(["firmaAnlegen", nutzer && nutzer.id, d]); return anlegenAntwort(); };
crm.firmaAendern = async (nutzer, id, felder) => { protokoll.push(["firmaAendern", id, felder]); };
crm.notiz = async (nutzer, id, txt, art) => { protokoll.push(["notiz", id, txt, art]); };
crm.callErgebnis = async (nutzer, id, ausgang, extra) => { protokoll.push(["callErgebnis", id, ausgang, extra]); return callAntwort(); };

const frisch = () => { protokoll = []; firmenAntwort = () => FIRMEN; anlegenAntwort = () => ({ id: 99, dublette: null }); callAntwort = () => true; };
const rufe = (was) => protokoll.filter((p) => p[0] === was);
const letzter = (was) => rufe(was).slice(-1)[0];

// Nichts darf werfen — die Sprachschicht hat keinen Platz fuer Ausnahmen.
async function ruhig(fn) {
  try { return { erg: await fn(), geworfen: false }; }
  catch (e) { return { erg: null, geworfen: true, meldung: e.message }; }
}

(async () => {
  // ---------------------------------------------- Firma finden (ohne Datenbank)
  pruefe("Voller Name trifft eindeutig", cs.firmaFinden("Physio Schwabing", FIRMEN)?.id === 1);
  pruefe("Kleinschreibung stoert nicht", cs.firmaFinden("physio schwabing", FIRMEN)?.id === 1);
  pruefe("Teilwort reicht ('Krotzer')", cs.firmaFinden("Krotzer", FIRMEN)?.id === 2);
  pruefe("'und' gesprochen trifft '&' im Namen", cs.firmaFinden("Krotzer und Eisele", FIRMEN)?.id === 2);
  pruefe("Umlaut ausgeschrieben trifft ('Mueller')", cs.firmaFinden("Mueller", FIRMEN)?.id === 3);
  pruefe("Rechtsform muss nicht mitgesprochen werden", cs.firmaFinden("Physio Schwabing GmbH", FIRMEN)?.id === 1);
  pruefe("Wort mitten im Namen trifft", cs.firmaFinden("Schwabing", FIRMEN)?.id === 1);

  const zwei = [
    { id: 7, name: "Müller Bau", ort: "Erding", status: "lead" },
    { id: 8, name: "Müller Bau", ort: "Rosenheim", status: "kunde" },
  ];
  const m = cs.firmaFinden("Müller", zwei);
  pruefe("Zwei gleichnamige Firmen -> mehrdeutig statt geraten", Array.isArray(m?.mehrdeutig) && m.mehrdeutig.length === 2);
  pruefe("Mehrdeutig liefert keine id zum Schreiben", !m?.id);
  pruefe("Mehrdeutig nennt den Ort zum Nachfragen", m?.mehrdeutig?.[0]?.ort === "Erding");

  pruefe("Unbekannte Firma -> null", cs.firmaFinden("Xaver Unbekannt", FIRMEN) === null);
  pruefe("Leerer Suchbegriff -> null", cs.firmaFinden("", FIRMEN) === null);
  pruefe("Leere Firmenliste -> null", cs.firmaFinden("Krotzer", []) === null);
  pruefe("Keine Liste uebergeben -> null (kein Absturz)", cs.firmaFinden("Krotzer", undefined) === null);

  // ---------------------------------------------- 1. Lead anlegen
  frisch();
  let r = await cs.leadAnlegen(LUKAS, { name: "Physio Schwabing", quelle: "kam über Empfehlung", ort: "München" });
  pruefe("Lead angelegt", r.ok === true && r.id === 99);
  pruefe("Lead: Quelle auf 'empfehlung' abgebildet", letzter("firmaAnlegen")[2].quelle === "empfehlung");
  pruefe("Lead: Status ist 'lead'", letzter("firmaAnlegen")[2].status === "lead");
  pruefe("Lead: Nebensatz landet im 'stand'-Feld", (await (async () => {
    frisch();
    await cs.leadAnlegen(LUKAS, { name: "Testfirma", notiz: "wollen erst im September" });
    return letzter("firmaAnlegen")[2].stand;
  })()) === "wollen erst im September");

  frisch();
  anlegenAntwort = () => ({ id: 100, dublette: { id: 2, name: "Krotzer & Eisele" } });
  r = await cs.leadAnlegen(LUKAS, { name: "Krotzer & Eisele" });
  pruefe("Lead: Dublette wird durchgereicht (sonst zwei Karteikarten)", r.ok && r.dublette?.name === "Krotzer & Eisele");

  frisch();
  r = await cs.leadAnlegen(LUKAS, { quelle: "empfehlung" });
  pruefe("Lead ohne Namen -> ok:false", r.ok === false && /Firmenname/.test(r.grund));
  pruefe("Lead ohne Namen: nichts geschrieben", rufe("firmaAnlegen").length === 0);

  frisch();
  r = await cs.leadAnlegen(null, { name: "Physio Schwabing" });
  pruefe("Lead ohne Nutzer -> ok:false mit klarem Grund", r.ok === false && r.grund === "keine persoenliche Anmeldung");
  pruefe("Lead ohne Nutzer: nichts geschrieben", rufe("firmaAnlegen").length === 0);

  frisch();
  anlegenAntwort = () => { throw new Error("connect ECONNREFUSED"); };
  let z = await ruhig(() => cs.leadAnlegen(LUKAS, { name: "Physio Schwabing" }));
  pruefe("Lead: Datenbankfehler wird ok:false, kein Wurf", !z.geworfen && z.erg.ok === false && /ECONNREFUSED/.test(z.erg.grund));

  // ---------------------------------------------- 2. Notiz
  frisch();
  r = await cs.notizAnlegen(LUKAS, { firma: "Krotzer", text: "haben erst im September Budget" });
  pruefe("Notiz: Teilwort trifft die richtige Firma", r.ok === true && r.firma.id === 2);
  pruefe("Notiz: mit Art 'notiz' geschrieben", letzter("notiz")[1] === 2 && letzter("notiz")[3] === "notiz");
  pruefe("Notiz: Text unveraendert uebernommen", letzter("notiz")[2] === "haben erst im September Budget");

  frisch();
  r = await cs.notizAnlegen(LUKAS, { firma: "Krotzer" });
  pruefe("Notiz ohne Text -> ok:false", r.ok === false && /Notiz/.test(r.grund));
  pruefe("Notiz ohne Text: nichts geschrieben", rufe("notiz").length === 0);

  frisch();
  r = await cs.notizAnlegen(LUKAS, { firma: "Xaver Unbekannt", text: "irgendwas" });
  pruefe("Notiz bei unbekannter Firma -> ok:false, als unbekannt markiert", r.ok === false && r.unbekannt === true);
  pruefe("Notiz bei unbekannter Firma: nichts geschrieben", rufe("notiz").length === 0);

  frisch();
  firmenAntwort = () => zwei;
  r = await cs.notizAnlegen(LUKAS, { firma: "Müller", text: "ruft nochmal an" });
  pruefe("Notiz bei Mehrdeutigkeit -> Rueckfrage statt Rateschuss", r.ok === false && r.mehrdeutig?.length === 2);
  pruefe("Notiz bei Mehrdeutigkeit: nichts geschrieben", rufe("notiz").length === 0);

  frisch();
  r = await cs.notizAnlegen(null, { firma: "Krotzer", text: "irgendwas" });
  pruefe("Notiz ohne Nutzer -> ok:false", r.ok === false && r.grund === "keine persoenliche Anmeldung");

  frisch();
  firmenAntwort = () => { throw new Error("RLS: permission denied for table firmen"); };
  z = await ruhig(() => cs.notizAnlegen(LUKAS, { firma: "Krotzer", text: "irgendwas" }));
  pruefe("Notiz: Datenbankfehler wird ok:false, kein Wurf", !z.geworfen && z.erg.ok === false && /permission denied/.test(z.erg.grund));

  // ---------------------------------------------- 3. Wiedervorlage
  frisch();
  r = await cs.wiedervorlageSetzen(LUKAS, { firma: "Mueller", datum: "2026-08-01", notiz: "Angebot nachfassen" });
  pruefe("Wiedervorlage gesetzt", r.ok === true && r.datum === "2026-08-01");
  pruefe("Wiedervorlage: genau das Feld gesetzt", letzter("firmaAendern")[1] === 3 && letzter("firmaAendern")[2].wiedervorlage === "2026-08-01");
  pruefe("Wiedervorlage: Anlass steht in der Historie", /Angebot nachfassen/.test(letzter("notiz")[2]));

  frisch();
  r = await cs.wiedervorlageSetzen(LUKAS, { firma: "Mueller", datum: "in einer Woche" });
  pruefe("Wiedervorlage: 'in einer Woche' wird abgelehnt (kein Rechnen hier)", r.ok === false && /Datum/.test(r.grund));
  pruefe("Wiedervorlage: bei kaputtem Datum nichts geaendert", rufe("firmaAendern").length === 0);

  frisch();
  r = await cs.wiedervorlageSetzen(LUKAS, { firma: "Mueller" });
  pruefe("Wiedervorlage ohne Datum -> ok:false", r.ok === false);
  pruefe("Wiedervorlage ohne Datum: nichts geaendert (loescht sonst die alte)", rufe("firmaAendern").length === 0);

  frisch();
  r = await cs.wiedervorlageSetzen(LUKAS, { datum: "2026-08-01" });
  pruefe("Wiedervorlage ohne Firma -> ok:false", r.ok === false && /Firma/.test(r.grund));

  frisch();
  r = await cs.wiedervorlageSetzen(null, { firma: "Mueller", datum: "2026-08-01" });
  pruefe("Wiedervorlage ohne Nutzer -> ok:false", r.ok === false && r.grund === "keine persoenliche Anmeldung");

  frisch();
  const echtesAendern = crm.firmaAendern;
  crm.firmaAendern = async () => { throw new Error("timeout"); };
  z = await ruhig(() => cs.wiedervorlageSetzen(LUKAS, { firma: "Mueller", datum: "2026-08-01" }));
  pruefe("Wiedervorlage: Datenbankfehler wird ok:false, kein Wurf", !z.geworfen && z.erg.ok === false && /timeout/.test(z.erg.grund));
  crm.firmaAendern = echtesAendern;

  // ---------------------------------------------- 4. Anrufergebnis
  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "Erstgespräch gebucht" });
  pruefe("Anruf: 'Erstgespräch gebucht' -> Ausgang 'termin'", r.ok === true && letzter("callErgebnis")[2] === "termin");

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Mueller", ausgang: "erreicht", notiz: "will Angebot" });
  pruefe("Anruf: 'erreicht' wird als Anruf-Aktivitaet festgehalten", r.ok === true && letzter("notiz")[3] === "anruf");
  pruefe("Anruf: 'erreicht' verbiegt keinen Status", rufe("callErgebnis").length === 0);
  pruefe("Anruf: 'erreicht' nimmt die Notiz mit", /will Angebot/.test(letzter("notiz")[2]));

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "niemand ran, nicht erreicht" });
  pruefe("Anruf: 'nicht erreicht' wird NICHT zu 'erreicht'", r.ok === true && letzter("callErgebnis")[2] === "nicht-erreicht");

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "Absage, wollte keinen Termin", notiz: "kein Budget" });
  pruefe("Anruf: Absage schlaegt Terminwort", r.ok === true && letzter("callErgebnis")[2] === "absage");
  pruefe("Anruf: Absage traegt den Grund mit", letzter("callErgebnis")[3].grund === "kein Budget");

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "später nochmal anrufen", datum: "2026-08-10" });
  pruefe("Anruf: 'spaeter' mit Datum geht durch", r.ok === true && letzter("callErgebnis")[3].datum === "2026-08-10");

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "später nochmal anrufen" });
  pruefe("Anruf: 'spaeter' ohne Datum -> ok:false", r.ok === false && /Datum/.test(r.grund));
  pruefe("Anruf: 'spaeter' ohne Datum schreibt nichts (loescht sonst die Wiedervorlage)", rufe("callErgebnis").length === 0);

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "keine Ahnung" });
  pruefe("Anruf: unklarer Ausgang -> ok:false statt stiller Nichtstat", r.ok === false && /nicht eindeutig/.test(r.grund));
  pruefe("Anruf: unklarer Ausgang schreibt nichts", rufe("callErgebnis").length === 0);

  frisch();
  r = await cs.anrufErgebnis(LUKAS, { firma: "Xaver Unbekannt", ausgang: "termin" });
  pruefe("Anruf bei unbekannter Firma -> ok:false", r.ok === false && r.unbekannt === true);

  frisch();
  firmenAntwort = () => zwei;
  r = await cs.anrufErgebnis(LUKAS, { firma: "Müller", ausgang: "termin" });
  pruefe("Anruf bei Mehrdeutigkeit -> Rueckfrage", r.ok === false && r.mehrdeutig?.length === 2);
  pruefe("Anruf bei Mehrdeutigkeit: nichts geschrieben", rufe("callErgebnis").length === 0);

  frisch();
  r = await cs.anrufErgebnis(null, { firma: "Krotzer", ausgang: "termin" });
  pruefe("Anruf ohne Nutzer -> ok:false", r.ok === false && r.grund === "keine persoenliche Anmeldung");

  frisch();
  callAntwort = () => false;                    // Firma beim Schreiben nicht sichtbar
  r = await cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "termin" });
  pruefe("Anruf: 'nichts geschrieben' aus crm.js wird ok:false", r.ok === false && /nicht gefunden/.test(r.grund));

  frisch();
  callAntwort = () => { throw new Error("deadlock detected"); };
  z = await ruhig(() => cs.anrufErgebnis(LUKAS, { firma: "Krotzer", ausgang: "termin" }));
  pruefe("Anruf: Datenbankfehler wird ok:false, kein Wurf", !z.geworfen && z.erg.ok === false && /deadlock/.test(z.erg.grund));

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
