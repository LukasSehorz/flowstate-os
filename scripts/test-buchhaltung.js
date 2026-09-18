// Prueft die reine Rechnerei der Buchhaltung — ohne Datenbank.
//
// WARUM (05.09.2026): Das Kosten-Dashboard sagt "Fixkosten je Monat 412 €"
// und "noch zu zahlen 1.980 €, aelteste Faelligkeit 12.08.". Das sind
// Summen, die niemand nachrechnet, solange sie plausibel aussehen. Hier
// werden die Funktionen, die sie bilden, mit erfundenen Listen gefuettert,
// bei denen das richtige Ergebnis bekannt ist:
//
//   fixkostenJeMonat    monatlich voll, jaehrlich ein Zwoelftel, sonst nichts
//   offeneSummen        nur Unbezahltes, aelteste Faelligkeit, ueberfaellig
//   monatsStatus        offen / excel / zip / kanzlei / laufend aus dem Protokoll
//   quelleAus           Kopfzeile X-Quelle -> web | handy | telegram | mail | akte
//   naechsteFaelligkeit Monatsende (31.01. + 1 Monat = 28.02., nicht 03.03.)
//   monatsExcelBauen    das Excel aus Monatsdaten, ohne Datenbank
//
//   node scripts/test-buchhaltung.js

const buch = require("../lib/buchhaltung.js");
const { quelleAus, naechsteFaelligkeit, fixkostenJeMonat, offeneSummen, monatsStatus, tagText, nochOffen } = buch.rechnen;

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

console.log("— Belegquelle —");
for (const [kopf, soll] of [
  ["handy", "handy"], ["MAIL", "mail"], [" telegram ", "telegram"], ["akte", "akte"], ["web", "web"],
  ["", "web"], [undefined, "web"], ["drop table", "web"], ["Handy; x", "web"],
]) {
  const ist = quelleAus(kopf);
  pruefe(`X-Quelle ${JSON.stringify(kopf)} -> ${ist}`, ist === soll, `erwartet ${soll}`);
}

console.log("\n— Sammelbuchung: bezahlt oder offen —");
// Eine Rechnung mit Zahlungsziel in der Zukunft ist mit einiger Sicherheit
// noch nicht ueberwiesen — sie wird offen gebucht, nicht mit erfundenem Zahltag.
for (const [faellig, heute, soll] of [
  ["2026-09-30", "2026-09-18", true], ["2026-09-18", "2026-09-18", true],
  ["2026-09-17", "2026-09-18", false], [null, "2026-09-18", false], ["", "2026-09-18", false],
]) pruefe(`faellig ${JSON.stringify(faellig)} am ${heute} -> ${soll ? "offen" : "bezahlt"}`, nochOffen(faellig, heute) === soll);

console.log("\n— Naechste Faelligkeit —");
for (const [datum, intervall, soll, anker = null] of [
  ["2026-01-15", "monatlich", "2026-02-15"],
  ["2026-01-31", "monatlich", "2026-02-28"],       // Monatsende abgefangen
  ["2028-01-31", "monatlich", "2028-02-29"],       // Schaltjahr
  ["2026-12-05", "monatlich", "2027-01-05"],       // Jahreswechsel
  ["2026-03-31", "monatlich", "2026-04-30"],
  ["2026-02-28", "jaehrlich", "2027-02-28"],
  ["2028-02-29", "jaehrlich", "2029-02-28"],
  [new Date(2026, 8, 5), "monatlich", "2026-10-05"],
  ["2026-09-05", "woechentlich", null],
  ["", "monatlich", null],
  ["kein datum", "monatlich", null],
  // Ankertag: nach dem kurzen Februar zurueck auf den 31. (DB-Test 05.09.)
  ["2026-02-28", "monatlich", "2026-03-31", 31],
  ["2026-04-30", "monatlich", "2026-05-31", 31],
  ["2026-03-31", "monatlich", "2026-04-30", 31],
  ["2026-02-28", "monatlich", "2026-03-28", null],
]) {
  const ist = naechsteFaelligkeit(datum, intervall, anker);
  pruefe(`${tagText(datum) || JSON.stringify(datum)} + ${intervall}${anker ? " (Anker " + anker + ".)" : ""} -> ${ist}`, ist === soll, `erwartet ${soll}`);
}

console.log("\n— Fixkosten je Monat —");
pruefe("leer = 0", fixkostenJeMonat([]) === 0 && fixkostenJeMonat(null) === 0);
pruefe("monatlich zaehlt voll: 59,99 + 12 = 71,99",
  fixkostenJeMonat([{ betrag: 59.99, intervall: "monatlich" }, { betrag: "12", intervall: "monatlich" }]) === 71.99);
pruefe("jaehrlich zaehlt ein Zwoelftel: 1200 / 12 = 100",
  fixkostenJeMonat([{ betrag: 1200, intervall: "jaehrlich" }]) === 100);
pruefe("gemischt: 50 monatlich + 600 jaehrlich = 100",
  fixkostenJeMonat([{ betrag: 50, intervall: "monatlich" }, { betrag: 600, intervall: "jaehrlich" }]) === 100);
pruefe("ohne Intervall zaehlt nicht mit (keine Vorlage)",
  fixkostenJeMonat([{ betrag: 999, intervall: null }, { betrag: 10, intervall: "monatlich" }]) === 10);
pruefe("Rundung auf Cent: 100 / 12 jaehrlich = 8,33",
  fixkostenJeMonat([{ betrag: 100, intervall: "jaehrlich" }]) === 8.33);

console.log("\n— Offene Summen —");
const heute = "2026-09-05";
const liste = [
  { betrag: 100, bezahlt: false, faellig: "2026-09-20" },
  { betrag: 250.5, bezahlt: false, faellig: "2026-08-12" },   // ueberfaellig
  { betrag: 30, bezahlt: false, faellig: null },              // ohne Faelligkeit
  { betrag: 1000, bezahlt: true, faellig: "2026-01-01" },     // bezahlt: zaehlt nicht
  { betrag: 19.5, bezahlt: false, faellig: "2026-09-04" },    // gestern: ueberfaellig
];
const o = offeneSummen(liste, heute);
pruefe("Summe nur der Unbezahlten: 400", o.summe === 400, String(o.summe));
pruefe("Anzahl 4", o.anzahl === 4);
pruefe("aelteste Faelligkeit 2026-08-12", o.aelteste === "2026-08-12", o.aelteste);
pruefe("2 ueberfaellig (12.08. und gestern), Summe 270", o.ueberfaellig === 2 && o.ueberfaelligSumme === 270,
  `${o.ueberfaellig} / ${o.ueberfaelligSumme}`);
pruefe("heute faellig ist NICHT ueberfaellig",
  offeneSummen([{ betrag: 1, bezahlt: false, faellig: heute }], heute).ueberfaellig === 0);
pruefe("leere Liste: Nullen und keine Faelligkeit",
  JSON.stringify(offeneSummen([], heute)) === JSON.stringify({ summe: 0, anzahl: 0, aelteste: null, ueberfaellig: 0, ueberfaelligSumme: 0 }));
pruefe("Faelligkeit als Date-Objekt wird verstanden",
  offeneSummen([{ betrag: 5, bezahlt: false, faellig: new Date(2026, 7, 1) }], heute).aelteste === "2026-08-01");

console.log("\n— Monatsstatus —");
const jetzt = new Date(2026, 8, 5);       // 05.09.2026
const st = (m, exporte) => monatsStatus(m, exporte, jetzt);
pruefe("laufender Monat: laufend", st({ jahr: 2026, monat: 9 }, []).status === "laufend");
pruefe("Zukunft: laufend", st({ jahr: 2027, monat: 1 }, []).status === "laufend");
pruefe("Vormonat ohne Protokoll: offen", st({ jahr: 2026, monat: 8 }, []).status === "offen");
pruefe("nur ZIP geholt: zip",
  st({ jahr: 2026, monat: 8 }, [{ jahr: 2026, monat: 8, erstellt: "2026-09-02T10:00:00Z" }]).status === "zip");
pruefe("Excel geholt: excel, mit Zeitpunkt",
  (() => { const r = st({ jahr: 2026, monat: 8 }, [{ jahr: 2026, monat: 8, erstellt: "2026-09-02T10:00:00Z", excel_geholt_am: "2026-09-02T10:00:00Z" }]);
    return r.status === "excel" && r.am === "2026-09-02T10:00:00Z"; })());
pruefe("ZIP nach Excel: zip (juengste Handlung)",
  st({ jahr: 2026, monat: 8 }, [
    { jahr: 2026, monat: 8, erstellt: "2026-09-01T10:00:00Z", excel_geholt_am: "2026-09-01T10:00:00Z" },
    { jahr: 2026, monat: 8, erstellt: "2026-09-02T10:00:00Z" },
  ]).status === "zip");
pruefe("Kanzlei schlaegt alles, auch ein spaeteres Excel",
  (() => { const r = st({ jahr: 2026, monat: 8 }, [
    { jahr: 2026, monat: 8, erstellt: "2026-09-01T10:00:00Z", an_kanzlei_am: "2026-09-01T10:00:00Z" },
    { jahr: 2026, monat: 8, erstellt: "2026-09-03T10:00:00Z", excel_geholt_am: "2026-09-03T10:00:00Z" },
  ]); return r.status === "kanzlei" && r.am === "2026-09-01T10:00:00Z" && r.excel === "2026-09-03T10:00:00Z"; })());
pruefe("Protokoll eines anderen Monats zaehlt nicht",
  st({ jahr: 2026, monat: 8 }, [{ jahr: 2026, monat: 7, an_kanzlei_am: "2026-08-01T10:00:00Z", erstellt: "2026-08-01T10:00:00Z" }]).status === "offen");
pruefe("Kanzlei auch im laufenden Monat sichtbar (jemand hat frueh verschickt)",
  st({ jahr: 2026, monat: 9 }, [{ jahr: 2026, monat: 9, an_kanzlei_am: "2026-09-04T10:00:00Z", erstellt: "2026-09-04T10:00:00Z" }]).status === "kanzlei");
pruefe("Jahr/Monat als Text im Protokoll (pg liefert manchmal Text) wird verstanden",
  st({ jahr: 2026, monat: 8 }, [{ jahr: "2026", monat: "8", erstellt: "2026-09-02T10:00:00Z" }]).status === "zip");

console.log("\n— Das Monats-Excel aus Monatsdaten —");
const d = {
  jahr: 2026, monat: 7,
  zeilen: [
    { laufnummer: 12, bezahlt_am: "2026-07-03", datum: "2026-07-01", art: "ausgabe", betrag: 59.99, steuersatz: 19,
      gegenstelle: "Adobe", kategorie: "Software & Tools", notiz: "Creative Cloud", belegnummer: "INV-1", hat_datei: true, dateiname: "adobe.pdf", beleg_id: 5 },
    { laufnummer: 13, bezahlt_am: "2026-07-15", datum: "2026-07-10", art: "einnahme", betrag: 2400, steuersatz: 0,
      gegenstelle: null, firma_name: "Müller & Co", kategorie: "Webdesign", notiz: "", belegnummer: "R-2026-131", hat_datei: false },
    { laufnummer: null, bezahlt_am: "2026-07-20", datum: "2026-07-20", art: "ausgabe", betrag: 37.3, steuersatz: -1,
      gegenstelle: "Asia-Imbiss", kategorie: "Essen & Getränke", notiz: "Team-Essen", hat_datei: false },
  ],
  summe_ein: 2400, summe_aus: 97.29, mitBeleg: 1, ohneBeleg: 2,
};
const offene = [{ art: "einnahme", datum: "2026-07-25", faellig: "2026-08-08", gegenstelle: "Schmidt GmbH", betrag: 800,
  kategorie: "Webdesign", notiz: "", tage_ueber: -8, bezahlt_am: null, stichtag: "2026-07-31" }];
let excel = null, grund = "";
try { excel = buch.monatsExcelBauen(d, offene); } catch (e) { grund = e.message; }
pruefe("monatsExcelBauen liefert ein ZIP (PK)", Buffer.isBuffer(excel) && excel.readUInt32LE(0) === 0x04034b50, grund);
if (excel) {
  const zlib = require("zlib");
  // Das erste Blatt herausziehen (lokaler Kopf mit dem Namen sheet1.xml).
  const teil = (name) => {
    let p = 0;
    while (p + 30 <= excel.length && excel.readUInt32LE(p) === 0x04034b50) {
      const gepackt = excel.readUInt32LE(p + 18), nameLen = excel.readUInt16LE(p + 26), extraLen = excel.readUInt16LE(p + 28);
      const n = excel.slice(p + 30, p + 30 + nameLen).toString("utf8");
      const start = p + 30 + nameLen + extraLen;
      if (n === name) return zlib.inflateRawSync(excel.slice(start, start + gepackt)).toString("utf8");
      p = start + gepackt;
    }
    return "";
  };
  const s1 = teil("xl/worksheets/sheet1.xml"), s2 = teil("xl/worksheets/sheet2.xml");
  pruefe("Blatt Übersicht: Titel Juli 2026", /Buchhaltung Juli 2026/.test(s1));
  pruefe("Blatt Übersicht: Betrag 59.99 als Zahl im Geldformat", /s="2"><v>59\.99<\/v>/.test(s1));
  pruefe("Blatt Übersicht: Zahltag 03.07.2026 als Seriennummer 46206", /s="3"><v>46206<\/v>/.test(s1));
  // Der Steuersatz steht seit dem 06.09. als TEXT ("19 %") statt als Zahl mit
  // dem Format 0" %": Apples Betrachter las das Prozentzeichen als Rechenzeichen
  // und zeigte "1900 %". Eine Datei an die Steuerkanzlei darf nicht vom
  // Betrachter abhaengen (siehe Kommentar in lib/buchhaltung.js).
  pruefe("Blatt Übersicht: USt als Text, gemischt als Wort", /gemischt/.test(s1) && /<t[^>]*>19 %<\/t>/.test(s1) && !/s="4"><v>19<\/v>/.test(s1));
  pruefe("Blatt Übersicht: Firma aus firma_name, & kodiert", /Müller &amp; Co/.test(s1));
  pruefe("Blatt Übersicht: Dateiname mit Laufnummer, sonst „keine Datei“", /0012_2026-07-03_adobe\.pdf/.test(s1) && /keine Datei/.test(s1));
  pruefe("Blatt Übersicht: Summen Einnahmen 2400 / Ausgaben 97.29 / Ergebnis 2302.71 fett",
    /s="5"><v>2400<\/v>/.test(s1) && /s="5"><v>97\.29<\/v>/.test(s1) && /s="5"><v>2302\.71<\/v>/.test(s1));
  pruefe("Blatt Übersicht: Kopfzeile eingefroren", /state="frozen"/.test(s1));
  pruefe("Blatt Offen: Stichtag 31.07.2026 und die offene Rechnung",
    /Offene Posten zum 31\.07\.2026/.test(s2) && /Schmidt GmbH/.test(s2) && /s="2"><v>800<\/v>/.test(s2));
  pruefe("Blatt Offen: Summe offene Einnahmen 800", /s="5"><v>800<\/v>/.test(s2));
  const leer = buch.monatsExcelBauen({ ...d, zeilen: [], summe_ein: 0, summe_aus: 0, mitBeleg: 0, ohneBeleg: 0 }, []);
  pruefe("ohne offene Posten steht der Leertext", /nichts offen/.test((() => { excel = leer; return teil("xl/worksheets/sheet2.xml"); })()));
}

// ---------------------------------------------------------------------------
// Die Verknuepfung in der Monats-Excel (06.09.2026)
//
// Lukas: "Wichtig ist, dass die Kanzlei die Rechnung gleich sehen und öffnen
// kann — sonst brauchen wir das gar nicht zu schicken." Die Spalte "Datei"
// enthaelt darum keine Namen mehr, sondern Verknuepfungen auf Belege/<datei>.
//
// Das Gefaehrliche daran ist nicht die Verknuepfung selbst, sondern der
// Auseinanderlauf: Steht in der Tabelle ein anderer Name als im Ordner, geht
// der Klick ins Leere — und niemand merkt es, bis die Kanzlei anruft. Deshalb
// wird hier das ENTPACKTE Ziel gegen den Namen gehalten, den das ZIP fuer
// dieselbe Zeile bekaeme.
// ---------------------------------------------------------------------------
console.log("\n— Die Verknüpfung in der Monats-Excel —");
const zlibV = require("zlib");
// Ein Teil aus der .xlsx holen, unabhaengig von archiv.js/xlsx-schreiben.js.
function xlsxTeil(buf, name) {
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const gepackt = buf.readUInt32LE(p + 18), nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
    const n = buf.slice(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    if (n === name) return zlibV.inflateRawSync(buf.slice(start, start + gepackt)).toString("utf8");
    p = start + gepackt;
  }
  return null;
}
// Verknuepfungen eines Blattes aufloesen: Zelle -> entpacktes Ziel.
function verknuepfungen(buf, blatt = 1) {
  const s = xlsxTeil(buf, `xl/worksheets/sheet${blatt}.xml`) || "";
  const rels = xlsxTeil(buf, `xl/worksheets/_rels/sheet${blatt}.xml.rels`);
  const ziele = new Map(rels
    ? [...rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]*)" TargetMode="External"\/>/g)].map((m) => [m[1], m[2]])
    : []);
  const raus = [];
  for (const m of s.matchAll(/<hyperlink ref="([A-Z]+\d+)" r:id="(rId\d+)"/g)) {
    raus.push({ ref: m[1], roh: ziele.get(m[2]), ziel: ziele.has(m[2]) ? decodeURIComponent(ziele.get(m[2])) : null,
      zelleDa: new RegExp(`<c r="${m[1]}"`).test(s) });
  }
  return { blattXml: s, relsDa: rels !== null, links: raus };
}

const dv = {
  jahr: 2026, monat: 8,
  zeilen: [
    // Eingangsbeleg mit Leerzeichen und Umlaut im Dateinamen.
    { buchung_id: 101, laufnummer: 42, bezahlt_am: "2026-08-01", datum: "2026-08-01", art: "ausgabe", betrag: 12.9,
      steuersatz: 19, gegenstelle: "Hetzner Online & Co", kategorie: "Software & Tools", notiz: "Server",
      hat_datei: true, dateiname: "Rechnung Hetzner ä.pdf", beleg_id: 9 },
    // Eigene Ausgangsrechnung: keine Belegdatei, aber ein PDF aus dem
    // Rechnungsmodul (so setzt monatsDaten -> rechnungenAnhaengen das Feld).
    { buchung_id: 102, laufnummer: null, bezahlt_am: "2026-08-12", datum: "2026-08-05", art: "einnahme", betrag: 1500,
      steuersatz: 0, gegenstelle: "Beispiel GmbH", kategorie: "Webdesign", notiz: "Rechnung RE-2026-0007",
      hat_datei: false, rechnung_id: 7, rechnung_datei: "R_RE-2026-0007_2026-08-05_Beispiel GmbH.pdf" },
    // Bewegung ganz ohne Datei — bleibt Text, bekommt keine Verknuepfung.
    { buchung_id: 103, laufnummer: 43, bezahlt_am: "2026-08-20", datum: "2026-08-20", art: "ausgabe", betrag: 8,
      steuersatz: 7, gegenstelle: "Bäcker", kategorie: "Essen & Getränke", notiz: "", hat_datei: false },
  ],
  summe_ein: 1500, summe_aus: 20.9, mitBeleg: 2, ohneBeleg: 1,
};
const ohneOnline = buch.monatsExcelBauen(dv, []);
const v = verknuepfungen(ohneOnline, 1);
pruefe("Blatt Übersicht hat eine Beziehungsdatei mit Verknüpfungen", v.relsDa && v.links.length === 2,
  `${v.links.length} Verknüpfung(en)`);
pruefe("die Zeile ohne Datei bekommt keine Verknüpfung, nur das Wort",
  /keine Datei/.test(v.blattXml) && v.links.length === 2);
pruefe("jede Verknüpfung zeigt auf eine Zelle, die es im Blatt gibt", v.links.every((l) => l.zelleDa),
  v.links.filter((l) => !l.zelleDa).map((l) => l.ref).join(", "));
pruefe("jede Verknüpfung hat ein aufgelöstes Ziel (keine tote r:id)", v.links.every((l) => l.ziel));
// Die Probe aufs Exempel: Ziel == "Belege/" + der Name, unter dem die Datei im
// ZIP liegt. Genau hier faellt auf, wenn Tabelle und Ordner auseinanderlaufen.
const sollNamen = ["0042_2026-08-01_Rechnung Hetzner ä.pdf", "R_RE-2026-0007_2026-08-05_Beispiel GmbH.pdf"];
pruefe("Ziele zeigen relativ auf Belege/<datei> — Eingangsbeleg UND eigene Rechnung",
  JSON.stringify(v.links.map((l) => l.ziel)) === JSON.stringify(sollNamen.map((n) => `Belege/${n}`)),
  v.links.map((l) => l.ziel).join(" | "));
pruefe("Sonderzeichen im Ziel sind kodiert (Leerzeichen %20, ä %C3%A4), Schrägstrich nicht",
  v.links[0] && v.links[0].roh === "Belege/0042_2026-08-01_Rechnung%20Hetzner%20%C3%A4.pdf", v.links[0] && v.links[0].roh);
pruefe("verknüpfte Zellen tragen den Verknüpfungsstil s=9",
  (v.blattXml.match(/<c r="K\d+" s="9" t="inlineStr">/g) || []).length === 2);
pruefe("der Satz „ZIP entpacken“ steht ganz oben im Blatt",
  /Die Spalte „Datei“ ist verknüpft — ZIP entpacken, dann öffnet ein Klick den Beleg\./.test(v.blattXml));
pruefe("ohne Links-Karte gibt es KEINE Spalte „Online“",
  !/>Online</.test(v.blattXml) && !/Rechnung ansehen/.test(v.blattXml));

// Mit OS_URL: die Spalte "Online" kommt dazu. Die Karte kommt von
// monatsExcel(); hier wird nur geprueft, was monatsExcelBauen daraus macht.
const mitOnline = buch.monatsExcelBauen(dv, [], { links: new Map([[102, "https://os.example.de/r/AbC_1-2"]]) });
const vo = verknuepfungen(mitOnline, 1);
pruefe("mit Links-Karte: Spalte „Online“ und drei Verknüpfungen",
  /Online/.test(vo.blattXml) && vo.links.length === 3, `${vo.links.length} Verknüpfung(en)`);
pruefe("die Online-Zelle zeigt auf OS_URL/r/<schlüssel>",
  vo.links.some((l) => l.roh === "https://os.example.de/r/AbC_1-2" && l.ref.startsWith("L")),
  vo.links.map((l) => `${l.ref}=${l.roh}`).join(" | "));
pruefe("nur die Zeile mit eigener Rechnung bekommt einen Online-Link",
  (vo.blattXml.match(/Rechnung ansehen/g) || []).length === 1);
pruefe("die relativen Verknüpfungen bleiben daneben bestehen",
  vo.links.filter((l) => l.ziel && l.ziel.startsWith("Belege/")).length === 2);
pruefe("Hinweis zur Gültigkeit der Online-Links (180 Tage) steht im Kopf",
  /180 Tage/.test(vo.blattXml));
// Und die ganze Datei bleibt ein gültiges Paket.
for (const [name, buf] of [["ohne Online", ohneOnline], ["mit Online", mitOnline]]) {
  pruefe(`${name}: gültiges ZIP mit Blatt-Beziehungsdatei`,
    Buffer.isBuffer(buf) && buf.readUInt32LE(0) === 0x04034b50
    && xlsxTeil(buf, "xl/worksheets/_rels/sheet1.xml.rels") !== null
    && xlsxTeil(buf, "xl/worksheets/sheet2.xml") !== null);
  pruefe(`${name}: Blatt „Offen“ ohne Links hat keine Beziehungsdatei und kein <hyperlinks>`,
    xlsxTeil(buf, "xl/worksheets/_rels/sheet2.xml.rels") === null
    && !/<hyperlinks/.test(xlsxTeil(buf, "xl/worksheets/sheet2.xml") || ""));
}

console.log("\n— Konstanten —");
pruefe("QUELLEN und INTERVALLE exportiert",
  JSON.stringify(buch.QUELLEN) === JSON.stringify(["web", "handy", "telegram", "mail", "akte"])
  && JSON.stringify(buch.INTERVALLE) === JSON.stringify(["monatlich", "jaehrlich"]));
pruefe("zuBetrag weiterhin exportiert (test-betrag.js haengt daran)", typeof buch.zuBetrag === "function" && buch.zuBetrag("1.234,56") === 1234.56);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
process.exit(fehler ? 1 : 0);
