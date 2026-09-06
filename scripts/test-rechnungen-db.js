// Rechnungen & Angebote gegen die TEST-Datenbank — der ganze Weg mit echter
// RLS: anlegen, stellen (Nummer, PDF eingefroren), Abschlag, Zahlung als
// Buchung, Teilzahlung, Storno, Umsatzsummen, Sicht eines Mitarbeiters.
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/test-rechnungen-db.js
//
// NICHT in pruefen.js: braucht die Datenbank. Legt zwei Testfirmen an und
// raeumt sie am Ende wieder weg (auch Buchungen und Vorgaenge). Verbraucht
// Nummern im Nummernkreis der Test-DB — deshalb NIE gegen Supabase laufen
// lassen; das Skript verweigert sich bei fremden Hosts.

process.env.ADS_PROBE = "1";                        // Mail wird abgefangen, nie gesendet
const os = require("os"), fs = require("fs"), path = require("path");
process.env.DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), "rg-test-"));
if (!process.env.DATABASE_URL) { console.log("DATABASE_URL fehlt — Test uebersprungen."); process.exit(0); }
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)) { console.log("Nur gegen eine lokale Test-DB."); process.exit(1); }

const crm = require("../lib/crm.js");
const rg = require("../lib/rechnungen.js");
const archiv = require("../lib/archiv.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

(async () => {
  const { rows: leute } = await crm.system(
    `select p.id, p.name, p.rolle, u.email from profiles p join auth.users u on u.id = p.id where u.email in ($1,$2)`,
    ["lukas.sehorz@svhconsult.de", "louis.tournier@svhconsult.de"]);
  const lukas = leute.find((p) => p.rolle === "admin"), louis = leute.find((p) => p.rolle !== "admin");
  if (!lukas || !louis) { console.log("Testkonten fehlen."); process.exit(1); }
  const firmen = [];
  const firmaAnlegen = async (name, besitzer) => {
    const { rows: [f] } = await crm.system(
      `insert into firmen (name, status, besitzer, email, adresse, plz, ort, geschaeftsfuehrer, tags) values ($1,'kunde',$2,'test@example.org','Weg 1','84405','Dorfen','Test Person',array['webdesign']) returning id`,
      [name, besitzer]);
    firmen.push(f.id); return f.id;
  };
  try {
    const fLouis = await firmaAnlegen("Test-RG Louis-Firma", louis.id);
    const fLukas = await firmaAnlegen("Test-RG Lukas-Firma", lukas.id);
    const vorher = await rg.umsatzFest(lukas);

    console.log("— Anlegen und Stellen —");
    const emp = { name: "Test-RG Louis-Firma", ansprechperson: "Test Person", strasse: "Weg 1", plz_ort: "84405 Dorfen", email: "test@example.org" };
    let erg = await rg.anlegen(lukas, { art: "angebot", firma_id: fLouis, empfaenger: emp, vorlage: "website", titel: "Webseite",
      positionen: [{ titel: "Konzeption", menge: 1, einheit: "pauschal", einzelpreis: "2.000,00" }, { titel: "Umsetzung", menge: 1, einzelpreis: 1000 }] });
    pruefe("Angebot als Entwurf angelegt", erg.ok, JSON.stringify(erg));
    const angebotId = erg.id;
    let a = await rg.eine(lukas, angebotId);
    pruefe("Entwurf: keine Nummer, Summe 3.000, Frist +30 Tage", a.status === "entwurf" && a.nummer === null && a.summe === 3000 && a.faellig === rg.tageSpaeter(a.datum, 30));
    pruefe("ohne Empfaengername wird abgelehnt", (await rg.anlegen(lukas, { art: "rechnung", empfaenger: {}, positionen: [{ titel: "x" }] })).grund === "empfaenger");
    pruefe("ohne Position wird abgelehnt", (await rg.anlegen(lukas, { art: "rechnung", empfaenger: emp, positionen: [] })).grund === "positionen");
    pruefe("Entwurf ohne Summe laesst sich nicht stellen", (await rg.stellen(lukas, (await rg.anlegen(lukas, { art: "rechnung", empfaenger: emp, positionen: [{ titel: "ohne Preis" }] })).id)).grund === "summe");
    pruefe("Mitarbeiter darf nicht anlegen (RLS)", !(await rg.anlegen(louis, { art: "rechnung", firma_id: fLouis, empfaenger: emp, positionen: [{ titel: "x", einzelpreis: 1 }] }).then((r) => r.ok).catch(() => false)));
    erg = await rg.stellen(lukas, angebotId);
    pruefe("Angebot gestellt mit Nummer im Format JJJJ-NNN", erg.ok && rg.nummerGueltig("angebot", erg.nummer), JSON.stringify(erg));
    a = await rg.eine(lukas, angebotId);
    pruefe("PDF eingefroren mit SHA-256", a.pdf_da && /^[0-9a-f]{64}$/.test(a.pdf_pruefsumme));
    const p = await rg.pdfHolen(lukas, angebotId);
    pruefe("pdfHolen liefert das eingefrorene PDF, Pruefsumme stimmt", p.eingefroren && p.daten.subarray(0, 5).toString() === "%PDF-" && archiv.pruefsumme(p.daten) === a.pdf_pruefsumme);
    pruefe("zweites Stellen wird abgelehnt", (await rg.stellen(lukas, angebotId)).grund === "schon-gestellt");
    pruefe("gestellter Vorgang laesst sich nicht mehr aendern", (await rg.aendern(lukas, angebotId, { empfaenger: emp, positionen: [{ titel: "x", einzelpreis: 1 }] })).grund === "nur-entwurf");

    console.log("\n— Abschlag und Zahlung —");
    erg = await rg.abschlag(lukas, angebotId, { prozent: 50 });
    pruefe("Abschlag 1 (50 %) = 1.500 als Entwurf", erg.ok && erg.betrag === 1500 && erg.nr === 1, JSON.stringify(erg));
    const ab1 = erg.id;
    let r1 = await rg.eine(lukas, ab1);
    pruefe("Abschlag traegt abschlag_von, angebot_id, Position 'Abschlag 1 (50 %)'", r1.abschlag_von === angebotId && r1.angebot_id === angebotId && /^Abschlag 1 \(50 %\)/.test(r1.positionen[0].titel) && r1.summe === 1500);
    pruefe("Zahlung auf einen Entwurf wird abgelehnt", (await rg.bezahlt(lukas, ab1, {})).grund === "status");
    erg = await rg.stellen(lukas, ab1);
    pruefe("Abschlag gestellt mit Rechnungsnummer R-JJJJ-N", erg.ok && rg.nummerGueltig("rechnung", erg.nummer), JSON.stringify(erg));
    erg = await rg.bezahlt(lukas, ab1, { am: "2026-09-05" });
    pruefe("Zahlung ohne Betrag = Rest -> bezahlt", erg.ok && erg.status === "bezahlt" && erg.betrag === 1500, JSON.stringify(erg));
    const { rows: b1 } = await crm.system(`select * from buchungen where quelle='rechnung' and quelle_schluessel like $1`, [`rechnung-${ab1}-%`]);
    pruefe("genau EINE Buchung fuer die Zahlung", b1.length === 1);
    pruefe("Buchung: einnahme, bezahlt, Zahltag, Firma, Kategorie Webdesign, Betrag 1.500", b1[0] && b1[0].art === "einnahme" && b1[0].bezahlt === true && rg.tagFeld(b1[0].bezahlt_am) === "2026-09-05" && Number(b1[0].firma_id) === Number(fLouis) && b1[0].kategorie === "Webdesign" && Number(b1[0].betrag) === 1500);
    pruefe("zweite Zahlung auf bezahlte Rechnung wird abgelehnt", (await rg.bezahlt(lukas, ab1, {})).grund === "status");
    pruefe("Abschlag 2 mit 60 % wird abgelehnt (ueber 100 %)", (await rg.abschlag(lukas, angebotId, { prozent: 60 })).grund === "prozent");
    erg = await rg.abschlag(lukas, angebotId, { betrag: "1.500,00" });
    pruefe("Abschlag 2 per Betrag = 50 %, Nr 2", erg.ok && erg.prozent === 50 && erg.nr === 2, JSON.stringify(erg));
    const ab2 = erg.id;
    await rg.stellen(lukas, ab2);
    pruefe("Teilzahlung 500 -> teilbezahlt", (await rg.bezahlt(lukas, ab2, { betrag: "500", am: "2026-09-06" })).status === "teilbezahlt");
    pruefe("zu hohe Zahlung wird abgelehnt", (await rg.bezahlt(lukas, ab2, { betrag: 2000 })).grund === "zuviel");
    pruefe("Unsinn als Betrag wird abgelehnt", (await rg.bezahlt(lukas, ab2, { betrag: "abc" })).grund === "betrag");
    const jf1 = await rg.rechnungenJeFirma(lukas, fLouis);
    pruefe("Firma: gestellt 3.000, bezahlt 2.000, offen 1.000, 2 Rechnungen, 67 %", jf1.gestellt === 3000 && jf1.bezahlt === 2000 && jf1.offen === 1000 && jf1.anzahl === 2 && jf1.prozent_bezahlt === 67, JSON.stringify({ g: jf1.gestellt, b: jf1.bezahlt, o: jf1.offen, n: jf1.anzahl, p: jf1.prozent_bezahlt }));
    pruefe("Firma: Auftrag mit 2 Abschlaegen, 67 % bezahlt, Angebot in der Liste", jf1.auftraege.length === 1 && jf1.auftraege[0].abschlaege.length === 2 && jf1.auftraege[0].prozent_bezahlt === 67 && jf1.liste.some((x) => x.art === "angebot"));
    const offen = await rg.offeneRechnungen(lukas);
    pruefe("offeneRechnungen enthaelt Abschlag 2 mit offen 1.000", offen.some((x) => x.id === ab2 && x.offen === 1000 && x.firma_name === "Test-RG Louis-Firma"));
    pruefe("Rest zahlen -> bezahlt, zwei Buchungen fuer zwei Zahlungen", (await rg.bezahlt(lukas, ab2, {})).status === "bezahlt"
      && Number((await crm.system(`select count(*) from buchungen where quelle='rechnung' and quelle_schluessel like $1`, [`rechnung-${ab2}-%`])).rows[0].count) === 2);
    const r2 = await rg.eine(lukas, ab2);
    pruefe("Zahlungen-Liste mit zwei Eintraegen und Buchungsnummern", r2.zahlungen.length === 2 && r2.zahlungen.every((z) => z.buchung_id) && r2.bezahlt_betrag === 1500);
    const nachher = await rg.umsatzFest(lukas);
    pruefe("umsatzFest: +3.000 gestellt, +3.000 bezahlt", nachher.gestellt - vorher.gestellt === 3000 && nachher.bezahlt - vorher.bezahlt === 3000 && nachher.anzahl - vorher.anzahl === 2);

    console.log("\n— Angebot: Status, Umwandeln, Storno, Duplikat —");
    pruefe("Angebot ist nach dem Abschlag noch 'gestellt'", (await rg.eine(lukas, angebotId)).status === "gestellt");
    pruefe("angenommen setzen", (await rg.statusSetzen(lukas, angebotId, "angenommen")).ok && (await rg.eine(lukas, angebotId)).status === "angenommen");
    pruefe("teilbezahlt ist fuer ein Angebot kein Status", !(await rg.statusSetzen(lukas, angebotId, "teilbezahlt")).ok);
    pruefe("statusSetzen auf einer Rechnung: kein-angebot", (await rg.statusSetzen(lukas, ab1, "angenommen")).grund === "kein-angebot");
    erg = await rg.umwandeln(lukas, angebotId);
    const schluss = erg.ok ? await rg.eine(lukas, erg.id) : null;
    pruefe("Schlussrechnung aus Angebot: Positionen + zwei Abzuege, Summe 0", schluss && schluss.art === "rechnung" && schluss.angebot_id === angebotId && schluss.positionen.length === 4 && schluss.summe === 0, schluss && JSON.stringify(schluss.positionen.map((x) => [x.titel, x.einzelpreis])));
    pruefe("Schlussrechnung ohne Rest laesst sich nicht stellen (Summe 0)", schluss && (await rg.stellen(lukas, schluss.id)).grund === "summe");
    pruefe("Entwurf loeschen", schluss && (await rg.loeschen(lukas, schluss.id)).ok && (await rg.eine(lukas, schluss.id)) === null);
    pruefe("gestellte Rechnung laesst sich nicht loeschen", (await rg.loeschen(lukas, ab1)).grund === "nur-entwurf");
    // Eigene Rechnung fuer die Lukas-Firma: stellen, offen, stornieren
    erg = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: { name: "Test-RG Lukas-Firma" }, vorlage: "ki", positionen: [{ titel: "KI", einzelpreis: 800 }] });
    const rLukas = erg.id; await rg.stellen(lukas, rLukas);
    pruefe("offene Rechnung erscheint bei offeneRechnungen", (await rg.offeneRechnungen(lukas)).some((x) => x.id === rLukas && x.offen === 800));
    pruefe("Storno ohne Grund wird abgelehnt", (await rg.stornieren(lukas, rLukas, "  ")).grund === "grund");
    pruefe("Storno mit Grund", (await rg.stornieren(lukas, rLukas, "Testlauf")).ok && (await rg.eine(lukas, rLukas)).status === "storniert");
    pruefe("stornierte Rechnung zaehlt nicht mehr (umsatzFest, offeneRechnungen)", (await rg.umsatzFest(lukas)).gestellt === nachher.gestellt && !(await rg.offeneRechnungen(lukas)).some((x) => x.id === rLukas));
    pruefe("Entwurf stornieren -> Hinweis 'loeschen'", (await rg.stornieren(lukas, (await rg.anlegen(lukas, { art: "rechnung", empfaenger: emp, positionen: [{ titel: "x", einzelpreis: 1 }] })).id, "x")).grund === "entwurf-loeschen");
    erg = await rg.duplizieren(lukas, ab1);
    const dup = erg.ok ? await rg.eine(lukas, erg.id) : null;
    pruefe("Duplikat: Entwurf ohne Nummer, ohne Abschlagsbezug, gleiche Positionen", dup && dup.status === "entwurf" && dup.nummer === null && dup.abschlag_von === null && dup.positionen[0].titel === r1.positionen[0].titel);
    pruefe("Duplikat aendern (Entwurf)", dup && (await rg.aendern(lukas, dup.id, { empfaenger: emp, positionen: [{ titel: "geaendert", einzelpreis: "10" }], datum: "2026-09-01" })).ok && (await rg.eine(lukas, dup.id)).summe === 10);

    console.log("\n— Versand im Probemodus —");
    erg = await rg.versenden(lukas, ab2, { an: "test@example.org" });
    pruefe("Senden wird abgefangen (ADS_PROBE), nicht als versendet markiert", erg.ok && erg.abgefangen && !(await rg.eine(lukas, ab2)).versendet_am, JSON.stringify(erg));
    const protokoll = fs.readFileSync(path.join(process.env.DATA_PATH, "probe-abgefangen.jsonl"), "utf-8");
    pruefe("Protokoll enthaelt die Mail mit Anhang", protokoll.includes('"kanal":"mail"') && protokoll.includes("Abschlagsrechnung") && protokoll.includes('"anhaenge":1'));
    pruefe("Senden ohne Adresse wird abgelehnt", (await rg.versenden(lukas, ab1, { an: "" })).grund === "mail" || (await rg.versenden(lukas, ab1, { an: "kaputt" })).grund === "mail");
    pruefe("Senden eines stornierten Vorgangs wird abgelehnt", (await rg.versenden(lukas, rLukas, { an: "test@example.org" })).grund === "storniert");
    erg = await rg.versenden(lukas, dup.id, { an: "test@example.org" });
    pruefe("Senden eines Entwurfs stellt ihn vorher (Nummer da)", erg.ok && erg.abgefangen && rg.nummerGueltig("rechnung", (await rg.eine(lukas, dup.id)).nummer));

    // ---------------------------------------------------------------- Befunde 1-5
    // Die vier Fehler, die der Pruefer am 05.09.2026 gefunden hat. Alle vier
    // brauchen die echte Datenbank: es geht um Sperren, Nummernkreis und
    // Fremdschluessel.
    console.log("\n— Wettlaeufe und umgangene Regeln (Pruefbefunde 1-6) —");

    // Befund 1: Doppelklick auf "Zahlung buchen"
    // Alle Proben hier haengen an der LUKAS-Firma: Der RLS-Test weiter unten
    // rechnet den Zahlstand der Louis-Firma auf den Cent nach.
    const empL = { ...emp, name: "Test-RG Lukas-Firma" };
    const wettlauf = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, vorlage: "website",
      titel: "Wettlauf", positionen: [{ titel: "Leistung", menge: 1, einheit: "pauschal", einzelpreis: 500 }] });
    await rg.stellen(lukas, wettlauf.id);
    const gleichzeitig = await Promise.all([
      rg.bezahlt(lukas, wettlauf.id, { betrag: "200" }),
      rg.bezahlt(lukas, wettlauf.id, { betrag: "500" }),
    ]);
    const nachWettlauf = await rg.eine(lukas, wettlauf.id);
    pruefe("zwei gleichzeitige Zahlungen buchen nie mehr als die Rechnung hergibt",
      nachWettlauf.bezahlt_betrag <= 500 && nachWettlauf.bezahlt_betrag > 0,
      `bezahlt=${nachWettlauf.bezahlt_betrag} · ${JSON.stringify(gleichzeitig.map((x) => x.ok ? x.status : x.grund))}`);
    const { rows: buchungenWettlauf } = await crm.system(
      `select betrag from buchungen where quelle = 'rechnung' and quelle_schluessel like $1`, [`rechnung-${wettlauf.id}-%`]);
    pruefe("Summe der Buchungen = Zahlstand der Rechnung (keine Geisterbuchung)",
      Math.abs(buchungenWettlauf.reduce((sum, b) => sum + Number(b.betrag), 0) - nachWettlauf.bezahlt_betrag) < 0.005,
      `Buchungen ${JSON.stringify(buchungenWettlauf.map((b) => b.betrag))} vs ${nachWettlauf.bezahlt_betrag}`);
    pruefe("Zahlungen tragen ihr Token", nachWettlauf.zahlungen.every((z) => "token" in z));
    // Idempotenz: dasselbe Blatt zweimal
    const rest = nachWettlauf.offen;
    if (rest > 0) {
      const t1 = await rg.bezahlt(lukas, wettlauf.id, { betrag: "50", token: "probe-token-1" });
      const t2 = await rg.bezahlt(lukas, wettlauf.id, { betrag: "50", token: "probe-token-1" });
      const nachToken = await rg.eine(lukas, wettlauf.id);
      pruefe("dasselbe Zahlungs-Token bucht nur einmal", t1.ok && t2.ok && t2.schon === true
        && nachToken.zahlungen.filter((z) => z.token === "probe-token-1").length === 1,
        JSON.stringify([t1, t2]));
    }

    // Der ECHTE Doppelklick-Weg, so wie ihn das Formular geht (06.09.2026).
    //
    // Das Sheet "Zahlung buchen" traegt ein verstecktes zahlung_token je Blatt.
    // Ein Doppelklick schickt deshalb ZWEIMAL DASSELBE Kennzeichen — und genau
    // das muss genau eine Buchung ergeben. Ohne Kennzeichen sind zwei Aufrufe
    // dagegen fachlich zwei echte Teilzahlungen und muessen beide durchgehen;
    // wer das als Fehler liest, jagt einem Gespenst nach (die Pruefungen 18-20
    // in scratchpad/qa-D1-pruefung/logik.js rufen bezahlt() ohne Kennzeichen
    // auf und erwarten trotzdem eine Sperre — ein Irrtum des Skripts, kein
    // Fehler des Moduls). Dieser Fall haelt den richtigen Weg fest, damit
    // niemand den Schutz wieder ins Modul verlegt.
    const klick = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, vorlage: "website",
      titel: "Doppelklick auf Zahlung buchen", positionen: [{ titel: "Leistung", menge: 1, einheit: "pauschal", einzelpreis: 700 }] });
    await rg.stellen(lukas, klick.id);
    const blatt = { betrag: "200", am: "2026-09-06", token: "blatt-doppelklick" };
    const beide = await Promise.all([rg.bezahlt(lukas, klick.id, blatt), rg.bezahlt(lukas, klick.id, blatt)]);
    const nachKlick = await rg.eine(lukas, klick.id);
    const { rows: buchungenKlick } = await crm.system(
      `select betrag from buchungen where quelle = 'rechnung' and quelle_schluessel like $1`, [`rechnung-${klick.id}-%`]);
    pruefe("Doppelklick mit demselben Kennzeichen: eine Buchung, 200 € bezahlt, zweite Antwort schon:true",
      beide.every((x) => x.ok) && beide.filter((x) => x.schon === true).length === 1
      && buchungenKlick.length === 1 && Math.abs(nachKlick.bezahlt_betrag - 200) < 0.005
      && nachKlick.status === "teilbezahlt"
      && nachKlick.zahlungen.filter((z) => z.token === "blatt-doppelklick").length === 1,
      `bezahlt=${nachKlick.bezahlt_betrag} · Buchungen=${buchungenKlick.length} · ${JSON.stringify(beide)}`);
    // Gegenprobe: OHNE Kennzeichen sind es zwei echte Teilzahlungen.
    const ohne1 = await rg.bezahlt(lukas, klick.id, { betrag: "200", am: "2026-09-06" });
    const ohne2 = await rg.bezahlt(lukas, klick.id, { betrag: "200", am: "2026-09-06" });
    const nachOhne = await rg.eine(lukas, klick.id);
    pruefe("ohne Kennzeichen sind zwei Teilzahlungen zwei Zahlungen (600 € von 700 €)",
      ohne1.ok && ohne2.ok && !ohne1.schon && !ohne2.schon && Math.abs(nachOhne.bezahlt_betrag - 600) < 0.005,
      `bezahlt=${nachOhne.bezahlt_betrag}`);

    // Befund 5: Doppelklick auf "Stellen" — es darf keine Nummer verbrennen
    const doppelt = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, vorlage: "website",
      titel: "Doppelklick", positionen: [{ titel: "Leistung", menge: 1, einheit: "pauschal", einzelpreis: 100 }] });
    const zweiStellen = await Promise.all([rg.stellen(lukas, doppelt.id), rg.stellen(lukas, doppelt.id)]);
    const erfolge = zweiStellen.filter((x) => x.ok);
    pruefe("zweimal Stellen: genau einmal Erfolg, einmal 'schon-gestellt'",
      erfolge.length === 1 && zweiStellen.some((x) => !x.ok && x.grund === "schon-gestellt"),
      JSON.stringify(zweiStellen.map((x) => x.ok ? x.nummer : x.grund)));
    const nummern = require("../lib/beleg-nummer.js");
    const standNach = await nummern.stand("rechnung");
    pruefe("kein Loch im Nummernkreis: die vergebene Nummer ist die zuletzt vergebene",
      erfolge.length === 1 && String(erfolge[0].nummer) === String(standNach.letzte),
      `${erfolge[0] && erfolge[0].nummer} vs Stand ${JSON.stringify(standNach)}`);

    // Befund 2: Rechnungs-Entwurf als Auftragsrahmen zaehlt doppelt
    const rahmen = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, vorlage: "website",
      titel: "Rahmen", positionen: [{ titel: "Gesamtauftrag", menge: 1, einheit: "pauschal", einzelpreis: 2000 }] });
    const rahmenAbschlag = await rg.abschlag(lukas, rahmen.id, { prozent: 50 });
    pruefe("Abschlag auf einen Rechnungs-Entwurf ist erlaubt", rahmenAbschlag.ok && rahmenAbschlag.betrag === 1000, JSON.stringify(rahmenAbschlag));
    pruefe("Rahmen mit offenem Abschlags-ENTWURF laesst sich nicht stellen",
      (await rg.stellen(lukas, rahmen.id)).grund === "abschlag-entwurf");
    await rg.stellen(lukas, rahmenAbschlag.id);
    const umsatzVorRahmen = await rg.umsatzFest(lukas);
    const rahmenGestellt = await rg.stellen(lukas, rahmen.id);
    const umsatzNachRahmen = await rg.umsatzFest(lukas);
    const rahmenJetzt = await rg.eine(lukas, rahmen.id);
    pruefe("gestellter Rahmen zieht den Abschlag ab (2.000 statt 3.000 Umsatz)",
      rahmenGestellt.ok && rahmenGestellt.mitAbzug && rahmenJetzt.summe === 1000
      && Math.abs(umsatzNachRahmen.gestellt - umsatzVorRahmen.gestellt - 1000) < 0.005,
      `Rahmen ${rahmenJetzt.summe} · Umsatz +${(umsatzNachRahmen.gestellt - umsatzVorRahmen.gestellt).toFixed(2)}`);

    // Befund 3: Abschlagsregeln ueber den Formularweg (anlegen) umgehen
    const frisch = await rg.anlegen(lukas, { art: "angebot", firma_id: fLukas, empfaenger: empL, vorlage: "website",
      titel: "Formularweg", positionen: [{ titel: "Auftrag", menge: 1, einheit: "pauschal", einzelpreis: 1000 }] });
    await rg.stellen(lukas, frisch.id);
    pruefe("150 % Abschlag ueber anlegen() wird abgelehnt",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: 9999 }],
        abschlag_von: frisch.id, abschlag_prozent: 150 })).grund === "prozent");
    pruefe("Abschlag auf eine GESTELLTE Rechnung wird abgelehnt",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: 10 }],
        abschlag_von: rahmen.id, abschlag_prozent: 10 })).grund === "kein-auftrag");
    pruefe("Abschlag ohne Prozentangabe wird abgelehnt",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: 10 }],
        abschlag_von: frisch.id })).grund === "prozent");
    pruefe("Abschlag auf ein voll verplantes Angebot wird abgelehnt",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLouis, empfaenger: emp, positionen: [{ titel: "x", einzelpreis: 10 }],
        abschlag_von: angebotId, abschlag_prozent: 5 })).grund === "prozent");
    pruefe("Abschlags-Nummer kommt vom Server, nicht aus dem Formular", await (async () => {
      const gemogelt = await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL,
        positionen: [{ titel: "x", einzelpreis: 10 }], abschlag_von: frisch.id, abschlag_prozent: 10, abschlag_nr: 99 });
      if (!gemogelt.ok) return false;
      const g = await rg.eine(lukas, gemogelt.id);
      await rg.loeschen(lukas, gemogelt.id);
      return g.abschlag_nr === 1;
    })());

    // Befund 6: Fremdschluessel, die es nicht gibt -> Meldung statt 500
    pruefe("firma_id, die es nicht gibt -> 'firma'",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: 999999999, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: 1 }] })).grund === "firma");
    pruefe("angebot_id, die es nicht gibt -> 'kein-angebot'",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: 1 }], angebot_id: 999999999 })).grund === "kein-angebot");
    // Frueher ein 500er, dann still auf heute gesetzt — beides falsch. Ein
    // Rechnungsdatum wird nicht heimlich geaendert, es wird abgelehnt
    // (06.09.2026, Pruefung 67).
    pruefe("Datum 2026-13-45 -> 'datum', nichts angelegt",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, datum: "2026-13-45", positionen: [{ titel: "x", einzelpreis: 1 }] })).grund === "datum");
    pruefe("Einzelpreis 99999999999 -> 'zu-gross' statt numeric overflow",
      (await rg.anlegen(lukas, { art: "rechnung", firma_id: fLukas, empfaenger: empL, positionen: [{ titel: "x", einzelpreis: "99999999999" }] })).grund === "zu-gross");

    // Befund 15: bezahlte Rechnung stornieren
    pruefe("bezahlte Rechnung laesst sich nicht stornieren",
      (await rg.stornieren(lukas, wettlauf.id, "Versehen")).grund === "storno-bezahlt");

    console.log("\n— Sicht des Mitarbeiters (RLS) —");
    const jl = await rg.rechnungenJeFirma(louis, fLouis);
    pruefe("Louis sieht den Zahlstand seiner Firma (3.000 gestellt, 3.000 bezahlt)", jl.gestellt === 3000 && jl.bezahlt === 3000 && jl.anzahl === 2, JSON.stringify(jl));
    pruefe("Louis sieht NICHTS von der Lukas-Firma", (await rg.rechnungenJeFirma(louis, fLukas)).anzahl === 0);
    const ul = await rg.umsatzFest(louis);
    pruefe("umsatzFest fuer Louis: nur seine 3.000 (+ ggf. andere sichtbare), weniger als Lukas", ul.gestellt >= 3000 && ul.gestellt <= nachher.gestellt);
    pruefe("Louis kann keine Zahlung buchen", !(await rg.bezahlt(louis, ab2, {}).then((x) => x.ok).catch(() => false)));
    pruefe("Louis bekommt das PDF seiner Firma (lesen erlaubt)", (await rg.pdfHolen(louis, ab1)) !== null && (await rg.pdfHolen(louis, rLukas)) === null);
  } catch (e) {
    pruefe("Testlauf ohne Ausnahme", false, String(e && e.stack).split("\n").slice(0, 3).join(" | "));
  } finally {
    if (firmen.length) {
      await crm.system(`delete from buchungen where firma_id = any($1::bigint[])`, [firmen]);
      await crm.system(`update rechnungen set abschlag_von = null, angebot_id = null where firma_id = any($1::bigint[]) or firma_id is null and empfaenger->>'name' like 'Test-RG%'`, [firmen]);
      await crm.system(`delete from rechnungen where firma_id = any($1::bigint[]) or (firma_id is null and empfaenger->>'name' like 'Test-RG%')`, [firmen]);
      await crm.system(`delete from firmen where id = any($1::bigint[])`, [firmen]);
    }
    try { fs.rmSync(process.env.DATA_PATH, { recursive: true, force: true }); } catch {}
    console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
    process.exit(fehler ? 1 : 0);
  }
})();
