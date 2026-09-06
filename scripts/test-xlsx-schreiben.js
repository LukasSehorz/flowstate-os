// Prueft lib/xlsx-schreiben.js — den Excel-Schreiber ohne Fremdpaket.
//
// WARUM (05.09.2026): Das Excel geht an die Steuerkanzlei. Eine Datei, die
// Excel nicht oeffnet, faellt erst dort auf — und dann ist es peinlich. Hier
// wird die erzeugte Datei mit einem EIGENEN, unabhaengigen ZIP-Leser
// auseinandergenommen (nicht mit archiv.js, das sie geschrieben hat) und
// Stueck fuer Stueck gegen das geprueft, was Excel verlangt:
//
//   1. ein gueltiges ZIP: Signaturen, Laengen, CRC-32 je Eintrag, zentrales
//      Verzeichnis stimmt mit den lokalen Koepfen ueberein
//   2. die Pflichtteile: [Content_Types].xml, _rels/.rels, xl/workbook.xml,
//      xl/styles.xml, xl/worksheets/sheet1.xml (+ sheet2.xml)
//   3. jedes XML wohlgeformt: Tags schliessen in richtiger Reihenfolge,
//      kein nacktes "&", keine Steuerzeichen
//   4. Zahlen als Zahlen (<v>), Datum als Seriennummer mit Datumsformat,
//      Texte inline (t="inlineStr"), Umlaute und "&" korrekt kodiert
//   5. eingefrorene Kopfzeile, Spaltenbreiten, Filter, Summenzeile fett
//   6. VERKNUEPFUNGEN (06.09.2026): der <hyperlinks>-Block an der richtigen
//      Stelle im Blatt, eine Beziehungsdatei je Blatt mit Links, jede r:id aus
//      dem Blatt mit Entsprechung darin, Ziele als URI kodiert (Leerzeichen,
//      "&", Umlaute), kein leeres <hyperlinks> und keine ueberfluessige .rels
//      auf Blaettern ohne Links.
//
// Die Verknuepfung ist die Stelle, an der eine .xlsx am leichtesten kaputt
// geht: eine r:id ohne Beziehung, der Block an der falschen Stelle, ein rohes
// Leerzeichen im Target — und Excel fragt beim Oeffnen "Reparieren?". Danach
// ist die Datei fuer die Kanzlei wertlos. Darum hier besonders genau.
//
//   node scripts/test-xlsx-schreiben.js

const zlib = require("zlib");
const xlsx = require("../lib/xlsx-schreiben.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// ------------------------------------------------- Ein eigener ZIP-Leser
//
// Liest die lokalen Dateikoepfe der Reihe nach, entpackt (deflate oder
// unkomprimiert) und prueft die CRC-32. Danach das zentrale Verzeichnis
// gegenlesen: Anzahl und Namen muessen zu den lokalen Koepfen passen.
function zipLesen(buf) {
  const eintraege = [];
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const verfahren = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 14);
    const gepackt = buf.readUInt32LE(p + 18);
    const roh = buf.readUInt32LE(p + 22);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    const daten = buf.slice(start, start + gepackt);
    const inhalt = verfahren === 8 ? zlib.inflateRawSync(daten) : verfahren === 0 ? daten : null;
    eintraege.push({ name, verfahren, crc, roh, inhalt,
      crcOk: inhalt !== null && zlib.crc32(inhalt) === crc, laengeOk: inhalt !== null && inhalt.length === roh });
    p = start + gepackt;
  }
  // Zentrales Verzeichnis
  const zentral = [];
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const kommLen = buf.readUInt16LE(p + 32);
    zentral.push(buf.slice(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extraLen + kommLen;
  }
  const ende = p + 4 <= buf.length && buf.readUInt32LE(p) === 0x06054b50;
  const anzahlImEnde = ende ? buf.readUInt16LE(p + 10) : -1;
  return { eintraege, zentral, ende, anzahlImEnde };
}

// Wohlgeformtheit ohne XML-Bibliothek: Tag-Stapel, nacktes "&", Steuerzeichen.
// Attributwerte enthalten hier nie ">" (der Schreiber maskiert es), darum
// reicht ein einfacher Tag-Zerleger.
function xmlWohlgeformt(text) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return "Steuerzeichen im XML";
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) return "nacktes & im XML";
  const ohneKopf = text.replace(/<\?xml[^>]*\?>/, "");
  const stapel = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  let m, letztesEnde = 0;
  while ((m = re.exec(ohneKopf))) {
    // Alles zwischen den Tags darf kein "<" enthalten (sonst war ein Tag kaputt).
    if (/</.test(ohneKopf.slice(letztesEnde, m.index))) return "loses < im Text bei " + m.index;
    letztesEnde = m.index + m[0].length;
    if (m[1] === "/") {
      if (stapel.pop() !== m[2]) return "falsch geschlossen: </" + m[2] + ">";
    } else if (!m[4]) stapel.push(m[2]);
  }
  if (/</.test(ohneKopf.slice(letztesEnde))) return "loses < am Ende";
  return stapel.length ? "offen geblieben: " + stapel.join(",") : null;
}

// ------------------------------------------------------- Die Testdatei
const datei = xlsx.bauen({
  autor: "Testlauf",
  erstellt: new Date("2026-09-05T10:00:00Z"),
  blaetter: [
    {
      name: "Übersicht",
      kopf: [
        [{ wert: "Buchhaltung Juli 2026", stil: "titel" }],
        ["Müller & Söhne GbR · <Test>"],
        [],
      ],
      spalten: [
        { titel: "Beleg-Nr", breite: 10, typ: "zahl" },
        { titel: "Zahltag", breite: 12, typ: "datum" },
        { titel: "Betrag €", breite: 14, typ: "geld" },
        { titel: "USt %", breite: 9, typ: "prozent" },
        { titel: "Kunde / Lieferant", breite: 28 },
        { titel: "Beschreibung", breite: 36 },
      ],
      zeilen: [
        [42, "2026-07-09", 1234.5, 19, "Bäckerei Müller & Söhne", "Brötchen für's Team \"Frühstück\""],
        [43, new Date(2026, 6, 31), 0.1 + 0.2, "gemischt", "Ikea", ""],
        [44, null, 99, null, "Ohne Datum", "a < b > c"],
      ],
      summen: [
        ["Einnahmen", null, { wert: 1333.8, typ: "geld", fett: true }],
      ],
    },
    { name: "Offen", spalten: [{ titel: "Richtung" }, { titel: "Betrag €", typ: "geld" }], zeilen: [], leerText: "Zum Stichtag war nichts offen." },
    // Ein dritter Name, der Excel nicht gefaellt: zu lang und mit verbotenen Zeichen.
    { name: "Ein sehr langer Blattname mit [Klammern] und /Schrägstrich/ und noch mehr", spalten: [{ titel: "x" }], zeilen: [["y"]] },
    // Blatt 4: die Verknuepfungen. Bewusst ein eigenes Blatt — so pruefen die
    // Blaetter 1 bis 3 gleichzeitig, dass ein Blatt OHNE Links weder einen
    // <hyperlinks>-Block noch eine Beziehungsdatei bekommt.
    {
      name: "Verknüpfungen",
      spalten: [{ titel: "Datei", breite: 44 }, { titel: "Online", breite: 18 }],
      zeilen: [
        // Leerzeichen, "&" und Umlaut im Dateinamen — der Fall, an dem eine
        // Verknuepfung erfahrungsgemaess zerbricht.
        [{ wert: "0042 Müller & Söhne.pdf", link: "Belege/0042 Müller & Söhne.pdf", hinweis: "Beleg öffnen" },
         { wert: "Rechnung ansehen", link: "https://os.example.com/r/AbC-1_2" }],
        // Zweite Zeile auf DASSELBE Ziel: zwei eigene Beziehungen, beide gueltig.
        [{ wert: "0042 Müller & Söhne.pdf", link: "Belege/0042 Müller & Söhne.pdf" }, null],
        // Link ohne Wert: die Zelle entsteht gar nicht, also darf auch keine
        // Verknuepfung darauf zeigen (sonst zeigte sie auf eine leere Zelle).
        [{ wert: "", link: "Belege/gibt-es-nicht.pdf" }, null],
        // Eigener Stil schlaegt den Verknuepfungsstil, der Link bleibt.
        [{ wert: "mit eigenem Stil", link: "Belege/x.pdf", stil: "fett" }, null],
      ],
    },
  ],
});

console.log("— Das ZIP —");
pruefe("Ergebnis ist ein Buffer", Buffer.isBuffer(datei) && datei.length > 500, String(datei && datei.length));
pruefe("beginnt mit der ZIP-Signatur PK\\3\\4", datei.readUInt32LE(0) === 0x04034b50);
const z = zipLesen(datei);
pruefe("Ende-Eintrag vorhanden", z.ende);
pruefe("Anzahl im Ende = lokale Koepfe = zentrales Verzeichnis",
  z.anzahlImEnde === z.eintraege.length && z.zentral.length === z.eintraege.length,
  `${z.anzahlImEnde} / ${z.eintraege.length} / ${z.zentral.length}`);
pruefe("jeder Eintrag entpackt sich und die CRC stimmt",
  z.eintraege.every((e) => e.crcOk && e.laengeOk),
  z.eintraege.filter((e) => !e.crcOk || !e.laengeOk).map((e) => e.name).join(", "));
pruefe("zentrales Verzeichnis nennt dieselben Namen",
  JSON.stringify(z.zentral) === JSON.stringify(z.eintraege.map((e) => e.name)));

const teil = (name) => { const e = z.eintraege.find((x) => x.name === name); return e ? e.inhalt.toString("utf8") : null; };
console.log("\n— Die Pflichtteile —");
for (const n of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
  "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
  "docProps/core.xml", "docProps/app.xml"]) {
  pruefe(`${n} liegt im Paket`, teil(n) !== null);
}
pruefe("_rels/.rels behaelt den fuehrenden Punkt (archiv.zip namenBelassen)",
  z.eintraege.some((e) => e.name === "_rels/.rels") && !z.eintraege.some((e) => e.name === "_rels/rels"));

console.log("\n— Wohlgeformtes XML —");
for (const e of z.eintraege) {
  const grund = xmlWohlgeformt(e.inhalt.toString("utf8"));
  pruefe(`${e.name} ist wohlgeformt`, grund === null, grund);
}

console.log("\n— Inhalt von sheet1.xml —");
const s1 = teil("xl/worksheets/sheet1.xml");
pruefe("Titel in Zeile 1 als Inline-Text mit Titelstil",
  /<row r="1"><c r="A1" s="6" t="inlineStr"><is><t xml:space="preserve">Buchhaltung Juli 2026<\/t><\/is><\/c><\/row>/.test(s1));
pruefe("Umlaute stehen als UTF-8 im Text", /Bäckerei Müller/.test(s1));
pruefe("& ist als &amp; kodiert, < und > als &lt; &gt;",
  /Müller &amp; Söhne/.test(s1) && /a &lt; b &gt; c/.test(s1) && /&lt;Test&gt;/.test(s1) && !/[^&]& /.test(s1));
pruefe("Anfuehrungszeichen im Text sind kodiert", /&quot;Frühstück&quot;/.test(s1));
// Zeile 3 ist leer (kopf: []) und wird nicht geschrieben, Kopfzeile ist Zeile 4.
pruefe("Kopfzeile in Zeile 4 mit Kopfstil (s=1)", /<row r="4"><c r="A4" s="1" t="inlineStr"><is><t xml:space="preserve">Beleg-Nr<\/t>/.test(s1));
pruefe("Beleg-Nr 42 ist eine Zahl (kein inlineStr)", /<c r="A5" s="0"><v>42<\/v><\/c>/.test(s1));
pruefe("Zahltag 09.07.2026 ist die Seriennummer 46212 im Datumsformat (s=3)",
  /<c r="B5" s="3"><v>46212<\/v><\/c>/.test(s1), (s1.match(/<c r="B5"[^>]*>.*?<\/c>/) || [])[0]);
pruefe("Date-Objekt 31.07.2026 wird zu 46234", /<c r="B6" s="3"><v>46234<\/v><\/c>/.test(s1));
pruefe("Betrag 1234.5 ist eine Zahl im Geldformat (s=2)", /<c r="C5" s="2"><v>1234.5<\/v><\/c>/.test(s1));
pruefe("0.1+0.2 wird zu 0.3, nicht 0.30000000000000004", /<c r="C6" s="2"><v>0.3<\/v><\/c>/.test(s1));
pruefe("USt 19 ist eine Zahl im Prozentformat (s=4)", /<c r="D5" s="4"><v>19<\/v><\/c>/.test(s1));
pruefe("„gemischt“ in der Prozentspalte bleibt Text", /<c r="D6" s="0" t="inlineStr"><is><t xml:space="preserve">gemischt<\/t>/.test(s1));
pruefe("leere Zellen werden nicht geschrieben (B7, D7 fehlen)", !/<c r="B7"/.test(s1) && !/<c r="D7"/.test(s1));
pruefe("Summenzeile: Betrag fett im Geldformat (s=5), nach einer Leerzeile",
  /<row r="9"><c r="A9" s="0" t="inlineStr">.*?Einnahmen.*?<c r="C9" s="5"><v>1333.8<\/v><\/c><\/row>/.test(s1));
pruefe("Kopfzeile eingefroren (pane ySplit=4)", /<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"\/>/.test(s1));
pruefe("Spaltenbreiten gesetzt", /<col min="1" max="1" width="10" customWidth="1"\/>/.test(s1) && /<col min="6" max="6" width="36"/.test(s1));
pruefe("Filter ueber die Datenzeilen", /<autoFilter ref="A4:F7"\/>/.test(s1));
pruefe("dimension deckt alle Zeilen", /<dimension ref="A1:F9"\/>/.test(s1));
pruefe("erstes Blatt ist ausgewaehlt", /tabSelected="1"/.test(s1));

console.log("\n— Blatt 2 und 3 —");
const s2 = teil("xl/worksheets/sheet2.xml");
pruefe("leeres Blatt zeigt den Leertext im Hinweisstil (s=8)", /s="8" t="inlineStr"><is><t xml:space="preserve">Zum Stichtag war nichts offen\./.test(s2));
pruefe("leeres Blatt hat keinen Filter", !/<autoFilter/.test(s2));
pruefe("zweites Blatt ist nicht ausgewaehlt", !/tabSelected/.test(s2));
const wb = teil("xl/workbook.xml");
pruefe("Blattnamen: Übersicht und Offen", /<sheet name="Übersicht" sheetId="1" r:id="rId1"\/>/.test(wb) && /<sheet name="Offen" sheetId="2" r:id="rId2"\/>/.test(wb));
const dritter = (wb.match(/<sheet name="([^"]*)" sheetId="3"/) || [])[1] || "";
pruefe("dritter Blattname gekuerzt (31 Zeichen) und ohne [ ] /", dritter.length <= 31 && !/[[\]/]/.test(dritter), dritter);

console.log("\n— Paketbeschreibung —");
const ct = teil("[Content_Types].xml");
pruefe("[Content_Types] nennt Workbook, Styles und alle drei Blaetter",
  /workbook\.xml/.test(ct) && /styles\.xml/.test(ct) && /sheet1\.xml/.test(ct) && /sheet2\.xml/.test(ct) && /sheet3\.xml/.test(ct));
const st = teil("xl/styles.xml");
pruefe("styles: zehn Zellformate, Datum dd.mm.yyyy, Euro-Format",
  /<cellXfs count="10">/.test(st) && (st.match(/<xf /g) || []).length === 11 && /dd\.mm\.yyyy/.test(st) && /€/.test(st));
pruefe("styles: Verknuepfungsschrift blau #0563C1 und unterstrichen, fonts count stimmt",
  /<fonts count="5">/.test(st) && (st.match(/<font>/g) || []).length === 5
  && /<font><u\/><sz val="11"\/><color rgb="FF0563C1"\/><name val="Calibri"\/><\/font>/.test(st)
  && /<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"\/>/.test(st));
pruefe("core.xml traegt Autor und Erstellzeit", /<dc:creator>Testlauf<\/dc:creator>/.test(teil("docProps/core.xml")) && /2026-09-05T10:00:00Z/.test(teil("docProps/core.xml")));
pruefe("MIME-Typ exportiert", xlsx.MIME === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

console.log("\n— Verknuepfungen (Blatt 4) —");
const s4 = teil("xl/worksheets/sheet4.xml");
const r4 = teil("xl/worksheets/_rels/sheet4.xml.rels");
pruefe("Blatt mit Links hat eine Beziehungsdatei", r4 !== null);
pruefe("Blaetter ohne Links haben KEINE Beziehungsdatei",
  teil("xl/worksheets/_rels/sheet1.xml.rels") === null
  && teil("xl/worksheets/_rels/sheet2.xml.rels") === null
  && teil("xl/worksheets/_rels/sheet3.xml.rels") === null);
pruefe("Blaetter ohne Links haben KEIN (auch kein leeres) <hyperlinks>",
  !/<hyperlinks/.test(s1) && !/<hyperlinks/.test(s2) && !/<hyperlinks/.test(teil("xl/worksheets/sheet3.xml")));
// Die Reihenfolge im Blatt ist in OOXML vorgeschrieben: sheetData, autoFilter,
// hyperlinks, pageMargins. Steht der Block woanders, faellt Excel ueber das
// Schema — genau der Fall "Reparieren?".
pruefe("<hyperlinks> steht nach </sheetData>/autoFilter und vor <pageMargins>",
  s4.indexOf("</sheetData>") < s4.indexOf("<hyperlinks>")
  && s4.indexOf("<autoFilter") < s4.indexOf("<hyperlinks>")
  && s4.indexOf("<hyperlinks>") < s4.indexOf("<pageMargins"),
  `sheetData ${s4.indexOf("</sheetData>")} · autoFilter ${s4.indexOf("<autoFilter")} · hyperlinks ${s4.indexOf("<hyperlinks>")} · pageMargins ${s4.indexOf("<pageMargins")}`);

// Jede Verknuepfung im Blatt und jede Beziehung in der .rels — und dann beide
// Listen gegeneinander. Eine r:id ohne Beziehung ist der haeufigste Grund
// dafuer, dass Excel eine Mappe fuer beschaedigt haelt.
const imBlatt = [...s4.matchAll(/<hyperlink ref="([A-Z]+\d+)" r:id="(rId\d+)"(?: tooltip="([^"]*)")?\/>/g)]
  .map((m) => ({ ref: m[1], id: m[2], tooltip: m[3] }));
const inRels = new Map([...r4.matchAll(/<Relationship Id="(rId\d+)" Type="([^"]+)" Target="([^"]*)" TargetMode="([^"]+)"\/>/g)]
  .map((m) => [m[1], { typ: m[2], ziel: m[3], modus: m[4] }]));
pruefe("vier Verknuepfungen im Blatt (die leere Zelle bekommt keine)",
  imBlatt.length === 4, `gefunden: ${imBlatt.map((h) => h.ref).join(", ")}`);
pruefe("jede r:id im Blatt hat eine Beziehung in der .rels",
  imBlatt.every((h) => inRels.has(h.id)),
  imBlatt.filter((h) => !inRels.has(h.id)).map((h) => `${h.ref}=${h.id}`).join(", "));
pruefe("keine Beziehung ohne Verknuepfung im Blatt",
  inRels.size === imBlatt.length, `${inRels.size} Beziehungen / ${imBlatt.length} Verknuepfungen`);
pruefe("alle Beziehungen sind vom Typ hyperlink und TargetMode External",
  [...inRels.values()].every((b) => /\/relationships\/hyperlink$/.test(b.typ) && b.modus === "External"));
pruefe("Verknuepfung zeigt auf Zellen, die es im Blatt wirklich gibt",
  imBlatt.every((h) => new RegExp(`<c r="${h.ref}"`).test(s4)),
  imBlatt.filter((h) => !new RegExp(`<c r="${h.ref}"`).test(s4)).map((h) => h.ref).join(", "));
pruefe("keine Verknuepfung auf die leere Zelle A4 (Link ohne Wert)",
  !imBlatt.some((h) => h.ref === "A4") && !/<c r="A4"/.test(s4));
const zielA2 = inRels.get((imBlatt.find((h) => h.ref === "A2") || {}).id);
pruefe("relatives Ziel ist als URI kodiert: Leerzeichen %20, & %26, ö %C3%B6",
  zielA2 && zielA2.ziel === "Belege/0042%20M%C3%BCller%20%26%20S%C3%B6hne.pdf", zielA2 && zielA2.ziel);
pruefe("der Schraegstrich bleibt Trenner (Belege/ steht unkodiert)",
  zielA2 && zielA2.ziel.startsWith("Belege/") && !zielA2.ziel.includes("%2F"));
const zielB2 = inRels.get((imBlatt.find((h) => h.ref === "B2") || {}).id);
pruefe("Web-Ziel bleibt unveraendert (:// nicht kodiert)",
  zielB2 && zielB2.ziel === "https://os.example.com/r/AbC-1_2", zielB2 && zielB2.ziel);
pruefe("zwei Zeilen auf dasselbe Ziel bekommen zwei eigene Beziehungen",
  (() => { const a = imBlatt.find((h) => h.ref === "A2"), b = imBlatt.find((h) => h.ref === "A3");
    return a && b && a.id !== b.id && inRels.get(a.id).ziel === inRels.get(b.id).ziel; })());
pruefe("verknuepfte Zelle traegt den Verknuepfungsstil s=9 (blau, unterstrichen)",
  /<c r="A2" s="9" t="inlineStr">/.test(s4) && /<c r="B2" s="9" t="inlineStr">/.test(s4));
pruefe("eigener Stil schlaegt den Verknuepfungsstil, die Verknuepfung bleibt",
  /<c r="A5" s="7" t="inlineStr">/.test(s4) && imBlatt.some((h) => h.ref === "A5"));
pruefe("Hinweis landet als tooltip, ohne Hinweis kein Attribut",
  (imBlatt.find((h) => h.ref === "A2") || {}).tooltip === "Beleg öffnen"
  && (imBlatt.find((h) => h.ref === "A3") || {}).tooltip === undefined);
pruefe("Umlaut im Zellentext bleibt lesbar, & bleibt kodiert",
  /0042 Müller &amp; Söhne\.pdf/.test(s4) && !/[^&]& /.test(s4));

console.log("\n— zielUri —");
for (const [ein, soll] of [
  ["Belege/a b.pdf", "Belege/a%20b.pdf"],
  ["Belege/ä&b.pdf", "Belege/%C3%A4%26b.pdf"],
  ["https://x.de/r/A_b-1", "https://x.de/r/A_b-1"],
  ["https://x.de/a b", "https://x.de/a%20b"],
  ["mailto:a@b.de", "mailto:a@b.de"],
  // Kein Ausbrechen aus dem entpackten Ordner, kein doppelter Schraegstrich.
  ["../../etc/passwd", "etc/passwd"],
  ["/Belege/x.pdf", "Belege/x.pdf"],
  ["Belege//x.pdf", "Belege/x.pdf"],
  ["", ""],
  [null, ""],
]) {
  const ist = xlsx.zielUri(ein);
  pruefe(`zielUri(${JSON.stringify(ein)}) = ${JSON.stringify(ist)}`, ist === soll, `erwartet ${JSON.stringify(soll)}`);
}

console.log("\n— Hilfsfunktionen —");
pruefe("spaltenBuchstabe: 1=A, 26=Z, 27=AA, 52=AZ, 53=BA",
  ["A", "Z", "AA", "AZ", "BA"].join() === [1, 26, 27, 52, 53].map(xlsx.spaltenBuchstabe).join());
pruefe("datumSerie: 1900-03-01 = 61 (Excels Schaltjahr-Fehler eingerechnet), 2026-09-05 = 46270",
  xlsx.datumSerie("1900-03-01") === 61 && xlsx.datumSerie("2026-09-05") === 46270,
  `${xlsx.datumSerie("1900-03-01")} / ${xlsx.datumSerie("2026-09-05")}`);
pruefe("datumSerie: Unsinn ergibt null", xlsx.datumSerie("gestern") === null && xlsx.datumSerie(null) === null);
let ohneBlatt = false;
try { xlsx.bauen({ blaetter: [] }); } catch { ohneBlatt = true; }
pruefe("ohne Blatt wird laut abgebrochen", ohneBlatt);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
process.exit(fehler ? 1 : 0);
