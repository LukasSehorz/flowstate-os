// Testet den Weg "Rechnung per Telegram" — ohne Telegram und ohne Datenbank.
//
// Warum (Lukas, 07.08.2026): "Ein Agent, der automatisch, wenn ich auf Telegram
// eine Rechnung schicke, das auswertet, ablegt und das System abbucht."
//
// Geprueft wird die REIHENFOLGE und was bei Teilausfaellen passiert. Genau da
// liegt das Risiko: Der Beleg muss abgelegt sein, BEVOR gelesen wird — sonst
// ist er bei einem Lesefehler weg. Und gebucht werden darf erst nach einer
// ausdruecklichen Bestaetigung; ein falsch erkannter Betrag, still gebucht,
// faellt erst beim Steuerberater auf.
//
// Aufruf: node scripts/test-beleg-telegram.js

const beleg = require("../lib/beleg-telegram.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// --- Welche Datei wird aus einer Nachricht gezogen? ------------------------
const fotoNachricht = {
  photo: [
    { file_id: "klein", file_size: 900 },
    { file_id: "mittel", file_size: 9000 },
    { file_id: "gross", file_size: 90000 },
  ],
};
// Telegram liefert Fotos in mehreren Aufloesungen. Wer die erste nimmt, bekommt
// eine Vorschau von ~90 Pixeln — darauf ist kein Betrag zu lesen.
pruefe("Vom Foto wird die GROESSTE Aufloesung genommen",
  beleg.dateiAus(fotoNachricht)?.fileId === "gross");
pruefe("PDF als Dokument wird erkannt",
  beleg.dateiAus({ document: { file_id: "x", file_name: "Rechnung.pdf", mime_type: "application/pdf" } })?.name === "Rechnung.pdf");
pruefe("Reine Textnachricht ist keine Datei", beleg.dateiAus({ text: "hallo" }) === null);

// --- Was ist ueberhaupt ein Beleg? ----------------------------------------
const alsDatei = (name, typ, groesse = 1000) => ({ fileId: "x", name, typ, groesse });
pruefe("Foto gilt als moeglicher Beleg", beleg.koennteBelegSein(alsDatei("Foto.jpg", "image/jpeg")));
pruefe("PDF gilt als moeglicher Beleg", beleg.koennteBelegSein(alsDatei("R.pdf", "application/pdf")));
pruefe("PDF ohne MIME-Typ gilt trotzdem", beleg.koennteBelegSein(alsDatei("Rechnung.pdf", null)));
pruefe("Video ist kein Beleg", !beleg.koennteBelegSein(alsDatei("clip.mp4", "video/mp4")));
pruefe("Tabelle ist kein Beleg", !beleg.koennteBelegSein(alsDatei("liste.xlsx", null)));

// --- Der Ablauf, mit gestellten Antworten ---------------------------------
function stelle({ hochladen, lesen, buchen } = {}) {
  const gesagt = [];
  const gerufen = [];
  const koerper = [];          // was an /buchen mitgegeben wurde
  const dash = async (pfad, body) => {
    gerufen.push(pfad);
    koerper.push(body);
    if (pfad.endsWith("/hochladen")) return { json: async () => hochladen ?? { ok: true, id: 7, laufnummer: 42 } };
    if (pfad.endsWith("/lesen")) return { json: async () => lesen ?? { ok: true, werte: { betrag: 119.99, datum: "2026-08-01", gegenstelle: "Hetzner", kategorie: "Hosting" } } };
    if (pfad.endsWith("/buchen")) return buchen ?? { status: 302, headers: { get: () => "/buchhaltung?gebucht=7" } };
    return { json: async () => ({}) };
  };
  return {
    gesagt, gerufen, koerper, dash,
    sagen: (t) => { gesagt.push(String(t)); },
    holeDatei: async () => Buffer.from("PDFDATEN"),
  };
}

(async () => {
  // Der Normalfall.
  let s = stelle();
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Rechnung.pdf", "application/pdf"), ...s });
  pruefe("Erst ablegen, DANN lesen",
    s.gerufen[0].endsWith("/hochladen") && s.gerufen[1].endsWith("/lesen"),
    "gerufen: " + s.gerufen.join(" -> "));
  const rueck = s.gesagt.join(" ");
  pruefe("Die gelesenen Werte werden genannt",
    /Hetzner/.test(rueck) && /119,99/.test(rueck) && /1\. August/.test(rueck), rueck);
  pruefe("Es wird NICHT von selbst gebucht", !s.gerufen.some((p) => p.endsWith("/buchen")));
  pruefe("Es wird nach der Buchung gefragt", /Soll ich das so buchen/.test(rueck), rueck);

  // "passt" bucht.
  const behandelt = await beleg.antwortAuf("passt", s);
  pruefe("'passt' wird als Antwort erkannt", behandelt === true);
  pruefe("Danach wird gebucht", s.gerufen.some((p) => p.endsWith("/buchen")));
  pruefe("Erfolg wird gemeldet", /Gebucht/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));

  // Zweimal "passt" darf nicht zweimal buchen.
  const nochmal = await beleg.antwortAuf("passt", s);
  pruefe("Ein zweites 'passt' bucht NICHT nochmal", nochmal === false);

  // Eine echte Frage ist keine Bestaetigung.
  s = stelle();
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Eine normale Frage laeuft weiter zu Alexandra",
    (await beleg.antwortAuf("was steht heute an?", s)) === false);
  pruefe("'nein' verwirft, ohne zu buchen",
    (await beleg.antwortAuf("nein", s)) === true && !s.gerufen.some((p) => p.endsWith("/buchen")));

  // --- Teilausfaelle: der Beleg darf nie verloren gehen --------------------
  s = stelle({ lesen: { ok: false } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Lesefehler: Beleg liegt trotzdem im Eingang, Nummer wird genannt",
    /42/.test(s.gesagt.join(" ")) && /Eingang/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));
  pruefe("Lesefehler: keine Buchungsfrage (es gibt nichts zu bestaetigen)",
    !/Soll ich das so buchen/.test(s.gesagt.join(" ")));

  s = stelle({ hochladen: { ok: true, doppelt: true, id: 3, laufnummer: 11 } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Derselbe Beleg zweimal: Hinweis statt Doppelbuchung",
    /schon/.test(s.gesagt.join(" ")) && !s.gerufen.some((p) => p.endsWith("/lesen")), s.gesagt.join(" | "));

  s = stelle({ hochladen: { ok: false, grund: "zu-gross" } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Ablagefehler wird ehrlich gemeldet", /nicht ablegen/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));

  // Zu grosse Datei gar nicht erst hochladen — Telegram gibt nur 20 MB heraus.
  s = stelle();
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf", 25 * 1024 * 1024), ...s });
  pruefe("Zu grosse Datei: Hinweis, kein Upload-Versuch",
    /zu groß/.test(s.gesagt.join(" ")) && s.gerufen.length === 0, s.gesagt.join(" | "));

  // Eine neue Datei hebt eine offene Rueckfrage auf — sonst bucht ein spaeteres
  // "ja" den falschen Beleg.
  s = stelle();
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("A.pdf", "application/pdf"), ...s });
  beleg.vergessen();
  pruefe("Nach vergessen() bucht 'ja' nichts mehr",
    (await beleg.antwortAuf("ja", s)) === false);

  // --- Was nicht gelesen werden konnte, wird GEFRAGT (20.08.2026) ----------
  //
  // Der Fall, der vorher ins Leere lief: Der Leser erkennt den Haendler, aber
  // nicht den Betrag. Frueher kam trotzdem "Soll ich das so buchen?", und das
  // "ja" darauf endete in der Buchhaltung mit "fehler=betrag" — bestaetigt,
  // nichts gebucht, kein Wort dazu.
  console.log("\n— Betrag und Datum nachfragen —");

  pruefe("Betrag: deutsches Komma", beleg.betragAus("19,90") === 19.9);
  pruefe("Betrag: Tausenderpunkt", beleg.betragAus("1.234,56 €") === 1234.56);
  pruefe("Betrag: Tastaturpunkt", beleg.betragAus("19.90 Euro") === 19.9);
  pruefe("Betrag: glatte Zahl", beleg.betragAus("42 euro") === 42);
  pruefe("Betrag: ohne Zahl kein Betrag", beleg.betragAus("keine Ahnung ehrlich gesagt") === null);
  pruefe("Betrag: null Euro ist kein Betrag", beleg.betragAus("0") === null);

  // --- JEDE ZAHL WAR EIN BETRAG (Fehler gefunden am 20.08.2026) ------------
  //
  // Der Kommentar ueber betragAus() sagte wortwoertlich, das duerfe nicht
  // passieren — der Code hielt sich nicht daran. Gemessen:
  //   BOT>   Den Betrag konnte ich nicht lesen — was hat's gekostet?
  //   LUKAS> sag mal, wie war das mit den 3 Terminen morgen
  //   BOT>   Beleg 4711: · EDEKA · 3,00 Euro — Soll ich das so buchen?
  // Doppelt schlimm: Die Nachricht galt als beantwortet und erreichte
  // Alexandra nie.
  console.log("\n— Was KEIN Betrag ist —");
  pruefe("„sag mal, wie war das mit den 3 Terminen morgen“ ist kein Betrag",
    beleg.betragAus("sag mal, wie war das mit den 3 Terminen morgen") === null,
    String(beleg.betragAus("sag mal, wie war das mit den 3 Terminen morgen")));
  pruefe("„von der Tankstelle an der B15“ ist kein Betrag",
    beleg.betragAus("von der Tankstelle an der B15") === null,
    String(beleg.betragAus("von der Tankstelle an der B15")));
  pruefe("„um 14 Uhr“ ist kein Betrag",
    beleg.betragAus("um 14 Uhr") === null, String(beleg.betragAus("um 14 Uhr")));
  // Ein Belegbetrag ist nie negativ. Das Vorzeichen wegzuwerfen hiesse, eine
  // Gutschrift als Ausgabe zu buchen.
  pruefe("„minus 12,00“ ist kein Betrag (statt 12,00 mit verlorenem Vorzeichen)",
    beleg.betragAus("minus 12,00") === null, String(beleg.betragAus("minus 12,00")));
  pruefe("„wie viele Leads hat Ioannis heute“ ist kein Betrag",
    beleg.betragAus("wie viele Leads hat Ioannis heute bekommen") === null);
  pruefe("„fahr mal 20 Minuten früher los“ ist kein Betrag",
    beleg.betragAus("fahr mal 20 Minuten früher los") === null,
    String(beleg.betragAus("fahr mal 20 Minuten früher los")));

  console.log("\n— Was weiterhin ein Betrag ist —");
  pruefe("„ca. 20 Euro“", beleg.betragAus("ca. 20 Euro") === 20, String(beleg.betragAus("ca. 20 Euro")));
  pruefe("„68,50“", beleg.betragAus("68,50") === 68.5, String(beleg.betragAus("68,50")));
  // Vorher: 8,00 € — die Cent standen hinter dem Waehrungswort und fielen weg.
  pruefe("„das waren 8 Euro 50“ MIT Cent",
    beleg.betragAus("das waren 8 Euro 50") === 8.5, String(beleg.betragAus("das waren 8 Euro 50")));
  pruefe("„8 Euro 50“ MIT Cent",
    beleg.betragAus("8 Euro 50") === 8.5, String(beleg.betragAus("8 Euro 50")));
  pruefe("„der hat 129,99 EUR gekostet“",
    beleg.betragAus("der hat 129,99 EUR gekostet") === 129.99,
    String(beleg.betragAus("der hat 129,99 EUR gekostet")));
  pruefe("„waren glaub ich 45 Euro“ (langer Satz, aber mit Geldzeichen)",
    beleg.betragAus("waren glaub ich 45 Euro") === 45, String(beleg.betragAus("waren glaub ich 45 Euro")));
  pruefe("nackte Zahl im Kurzsatz", beleg.betragAus("39") === 39);

  // Und der Kern des Fehlers: die Nachricht muss WEITERLAUFEN.
  s = stelle({ lesen: { ok: true, werte: { betrag: null, datum: "2026-08-01", gegenstelle: "EDEKA" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Bon.jpg", "image/jpeg"), ...s });
  const durchgereicht = await beleg.antwortAuf("sag mal, wie war das mit den 3 Terminen morgen", s);
  pruefe("... und die Nachricht läuft an Alexandra weiter, statt gebucht zu werden",
    durchgereicht === false, "antwortAuf gab " + durchgereicht + " zurück");
  pruefe("... die Rückfrage nach dem Betrag bleibt stehen",
    beleg.wasOffen()?.frage === "betrag");

  const AM = new Date("2026-08-20T10:00:00");
  pruefe("Datum: heute", beleg.datumAus("heute", AM) === "2026-08-20");
  pruefe("Datum: gestern", beleg.datumAus("gestern", AM) === "2026-08-19");
  pruefe("Datum: 12.08.", beleg.datumAus("vom 12.08.", AM) === "2026-08-12");
  pruefe("Datum: 12.08.2026", beleg.datumAus("12.08.2026", AM) === "2026-08-12");
  // Ein Bon vom 28.12., im Januar hochgeladen, gehoert ins ALTE Steuerjahr.
  pruefe("Datum ohne Jahr, das in der Zukunft laege, faellt aufs Vorjahr",
    beleg.datumAus("28.12.", new Date("2026-01-10T10:00:00")) === "2025-12-28",
    String(beleg.datumAus("28.12.", new Date("2026-01-10T10:00:00"))));
  pruefe("Datum: Unsinn wird nicht geraten", beleg.datumAus("weiß nicht mehr", AM) === null);
  // KEIN UEBERLAUF IN DEN FOLGEMONAT (20.08.2026): datumAus("31.02.2026") gab
  // bisher 2026-03-03 zurueck — ein verhoertes Datum buchte still in den
  // falschen Monat, und ein falscher Monat im Ordner fuer die Steuerberaterin
  // faellt niemandem mehr auf.
  pruefe("Datum: den 31. Februar gibt es nicht (kein 03.03.)",
    beleg.datumAus("31.02.2026", AM) === null, String(beleg.datumAus("31.02.2026", AM)));
  pruefe("Datum: auch der 31.04. nicht",
    beleg.datumAus("31.04.2026", AM) === null, String(beleg.datumAus("31.04.2026", AM)));
  pruefe("Datum: 2026-02-30 als ISO ebenfalls nicht",
    beleg.datumAus("2026-02-30", AM) === null, String(beleg.datumAus("2026-02-30", AM)));
  // Ein echter Schalttag muss durchkommen — die Pruefung darf nicht zu scharf sein.
  pruefe("Datum: der 29.02.2024 ist echt und bleibt",
    beleg.datumAus("29.02.2024", AM) === "2024-02-29", String(beleg.datumAus("29.02.2024", AM)));
  pruefe("Datum: der 29.02.2026 gab es nie",
    beleg.datumAus("29.02.2026", AM) === null, String(beleg.datumAus("29.02.2026", AM)));
  pruefe("Datum: 31.01. bleibt der 31.01.",
    beleg.datumAus("31.01.2026", AM) === "2026-01-31", String(beleg.datumAus("31.01.2026", AM)));

  // Betrag fehlt -> Rueckfrage statt Buchungsfrage.
  s = stelle({ lesen: { ok: true, werte: { betrag: null, datum: "2026-08-01", gegenstelle: "Shell", kategorie: "Fahrzeug & Tanken" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Bon.jpg", "image/jpeg"), ...s });
  pruefe("Fehlender Betrag: es wird gefragt, nicht gebucht",
    /was hat's gekostet/i.test(s.gesagt.join(" ")) && !/Soll ich das so buchen/.test(s.gesagt.join(" ")),
    s.gesagt.join(" | "));
  pruefe("Der Beleg liegt trotzdem schon im Eingang (Nummer genannt)", /42/.test(s.gesagt.join(" ")));
  pruefe("Der Haendler wird mitgenannt", /Shell/.test(s.gesagt.join(" ")));

  // Eine echte Frage waehrend der Rueckfrage gehoert Alexandra, nicht dem Beleg.
  pruefe("Fremde Frage waehrend der Betragsfrage laeuft weiter",
    (await beleg.antwortAuf("was steht heute an?", s)) === false);
  pruefe("Und die Rueckfrage bleibt stehen", beleg.wasOffen()?.frage === "betrag");

  const angenommen = await beleg.antwortAuf("19,90", s);
  pruefe("Der genannte Betrag wird angenommen", angenommen === true);
  pruefe("Danach kommt die Buchungsfrage mit dem Betrag drin",
    /19,90/.test(s.gesagt.join(" ")) && /Soll ich das so buchen/.test(s.gesagt.join(" ")),
    s.gesagt.join(" | "));
  pruefe("Immer noch NICHT gebucht", !s.gerufen.some((p) => p.endsWith("/buchen")));

  await beleg.antwortAuf("passt", s);
  const gebucht = s.koerper[s.gerufen.findIndex((p) => p.endsWith("/buchen"))];
  pruefe("Erst das 'passt' bucht — mit dem nachgereichten Betrag",
    gebucht && gebucht.betrag === 19.9, JSON.stringify(gebucht));

  // Datum fehlt -> dieselbe Mechanik.
  s = stelle({ lesen: { ok: true, werte: { betrag: 59.9, datum: "", gegenstelle: "Hetzner" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Fehlendes Datum: es wird gefragt", /welches Datum/i.test(s.gesagt.join(" ")), s.gesagt.join(" | "));
  await beleg.antwortAuf("heute", s);
  pruefe("„heute“ wird uebernommen und dann gebucht gefragt",
    /Soll ich das so buchen/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));
  await beleg.antwortAuf("ja", s);
  const g2 = s.koerper[s.gerufen.findIndex((p) => p.endsWith("/buchen"))];
  const heute = new Date();
  const heuteTag = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
  pruefe("Das Datum steht in der Buchung", g2 && g2.datum === heuteTag, JSON.stringify(g2));

  // "weiß nicht" beendet die Rueckfrage, ohne etwas zu erfinden.
  s = stelle({ lesen: { ok: true, werte: { betrag: null, datum: "2026-08-01", gegenstelle: "Shell" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Bon.jpg", "image/jpeg"), ...s });
  const auf = await beleg.antwortAuf("weiß nicht", s);
  pruefe("„weiß nicht“ beendet die Rueckfrage, ohne zu buchen",
    auf === true && !s.gerufen.some((p) => p.endsWith("/buchen")) && beleg.wasOffen() === null,
    s.gesagt.join(" | "));

  // Der Buchungsfehler wird im Klartext gemeldet — und NICHT zusaetzlich an
  // Alexandra durchgereicht (antwortAuf muss true zurueckgeben).
  s = stelle({ buchen: { status: 302, headers: { get: () => "/buchhaltung?fehler=betrag" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  const gemeldet = await beleg.antwortAuf("passt", s);
  pruefe("Buchungsfehler: Grund im Klartext",
    /der Betrag fehlt/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));
  pruefe("Buchungsfehler: laeuft NICHT zusaetzlich an Alexandra", gemeldet === true);

  // --- DER LESER WARNT — DIE RUECKFRAGE MUSS ES SAGEN (20.08.2026) ---------
  //
  // lib/belegleser.js setzt bei Zweifeln ein `hinweis`-Feld und stuft
  // `sicherheit` herunter. naechsteFrage() hat beides nie angefasst. Gemessen:
  //   Leser: betrag=259.8, hinweis="Betrag in USD (259,80 USD), nicht EUR."
  //   Bot:   "· ACME Software Inc. · 259,80 Euro — Soll ich das so buchen?"
  //   Nach "ja" gebucht: 259,80 € statt rund 240 €.
  console.log("\n— Was der Belegleser selbst anmerkt —");

  const USD = { ok: true, werte: { betrag: 259.8, datum: "2026-08-03",
    gegenstelle: "ACME Software Inc.", kategorie: "Software & Tools",
    sicherheit: "hoch", hinweis: "Betrag in USD (259,80 USD), nicht EUR." } };

  s = stelle({ lesen: USD });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Invoice.pdf", "application/pdf"), ...s });
  let sagt = s.gesagt.join(" | ");
  console.log("   " + s.gesagt[s.gesagt.length - 1]);
  pruefe("Fremdwährung wird NICHT als Euro angeboten", !/259,80 Euro/.test(sagt), sagt);
  pruefe("„259,80 US-Dollar — soll ich umrechnen?“",
    /259,80 US-Dollar — soll ich umrechnen\?/.test(sagt), sagt);
  pruefe("Der Hinweis des Lesers steht mit drin", /nicht EUR/.test(sagt), sagt);
  pruefe("Es wird nicht „so buchen?“ gefragt", !/Soll ich das so buchen/.test(sagt), sagt);
  pruefe("Und gebucht ist nichts", !s.gerufen.some((p) => p.endsWith("/buchen")));

  // Ein "ja" darauf darf keinen Kurs erfinden.
  await beleg.antwortAuf("ja", s);
  sagt = s.gesagt.join(" | ");
  pruefe("„ja“ erfindet keinen Wechselkurs, sondern fragt nach dem Euro-Betrag",
    /Wechselkurs hab ich hier nicht/.test(sagt) && !s.gerufen.some((p) => p.endsWith("/buchen")), sagt);
  await beleg.antwortAuf("239,40 Euro", s);
  sagt = s.gesagt.join(" | ");
  pruefe("Der nachgereichte Euro-Betrag führt zur normalen Buchungsfrage",
    /239,40 Euro/.test(sagt) && /Soll ich das so buchen/.test(sagt), sagt);
  await beleg.antwortAuf("passt", s);
  const usdGebucht = s.koerper[s.gerufen.findIndex((p) => p.endsWith("/buchen"))];
  pruefe("Gebucht wird der EURO-Betrag, nicht der Dollarbetrag",
    usdGebucht && usdGebucht.betrag === 239.4, JSON.stringify(usdGebucht));

  // Der direkte Weg: Lukas nennt den Euro-Betrag sofort.
  s = stelle({ lesen: USD });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Invoice.pdf", "application/pdf"), ...s });
  await beleg.antwortAuf("das sind 239,40", s);
  pruefe("Ein sofort genannter Euro-Betrag übernimmt",
    /239,40 Euro/.test(s.gesagt.join(" ")) && /Soll ich das so buchen/.test(s.gesagt.join(" ")),
    s.gesagt.join(" | "));

  // Niedrige Sicherheit: der Zweifel gehoert in die Frage.
  s = stelle({ lesen: { ok: true, werte: { betrag: 43.2, datum: "2026-08-02",
    gegenstelle: "Shell", sicherheit: "niedrig", hinweis: "" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("Bon.jpg", "image/jpeg"), ...s });
  sagt = s.gesagt.join(" | ");
  console.log("   " + s.gesagt[s.gesagt.length - 1]);
  pruefe("Niedrige Sicherheit: kein „Soll ich das so buchen?“",
    !/Soll ich das so buchen/.test(sagt), sagt);
  pruefe("Niedrige Sicherheit: der Zweifel wird genannt",
    /schlecht lesbar/.test(sagt), sagt);
  // Statt "nein" reicht der richtige Betrag — er korrigiert und fragt neu.
  await beleg.antwortAuf("nee, das waren 34,20 Euro", s);
  sagt = s.gesagt.join(" | ");
  pruefe("Ein korrigierter Betrag wird übernommen statt an Alexandra gereicht",
    /34,20 Euro/.test(sagt), sagt);
  pruefe("... und danach ist der Zweifel weg („Soll ich das so buchen?“)",
    /Soll ich das so buchen/.test(sagt), sagt);

  // Ein MwSt-Widerspruch ist derselbe Weg.
  s = stelle({ lesen: { ok: true, werte: { betrag: 119, datum: "2026-08-02",
    gegenstelle: "Baumarkt", sicherheit: "mittel",
    hinweis: "Ausgewiesene MwSt passt nicht zum Bruttobetrag." } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  sagt = s.gesagt.join(" | ");
  pruefe("MwSt-Widerspruch: der Hinweis steht in der Frage",
    /MwSt passt nicht/.test(sagt) && !/Soll ich das so buchen/.test(sagt), sagt);

  // Ohne Zweifel bleibt alles wie vorher — das ist der Normalfall.
  s = stelle({ lesen: { ok: true, werte: { betrag: 119.99, datum: "2026-08-01",
    gegenstelle: "Hetzner", kategorie: "Hosting", sicherheit: "hoch", hinweis: "" } } });
  beleg.vergessen();
  await beleg.verarbeiten({ datei: alsDatei("R.pdf", "application/pdf"), ...s });
  pruefe("Ohne Zweifel bleibt es bei „Soll ich das so buchen?“",
    /Soll ich das so buchen/.test(s.gesagt.join(" ")), s.gesagt.join(" | "));

  pruefe("USD im Hinweis wird als Fremdwährung erkannt",
    beleg.fremdwaehrung("Betrag in USD (259,80 USD), nicht EUR.") === "US-Dollar");
  pruefe("CHF ebenfalls", beleg.fremdwaehrung("Rechnung in CHF ausgestellt.") === "Schweizer Franken");
  pruefe("Ein Hinweis ohne Währung ist keine Fremdwährung",
    beleg.fremdwaehrung("Beleg leicht geknickt, Datum schwer lesbar.") === null);
  pruefe("Kein Hinweis, keine Fremdwährung", beleg.fremdwaehrung("") === null);

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
