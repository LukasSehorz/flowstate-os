// Excel-Dateien (.xlsx) schreiben — ohne Fremdpaket.
//
// WARUM VON HAND (05.09.2026): Lukas will den Monatsabschluss "am besten als
// Excel" fuer die Steuerkanzlei. Eine .xlsx ist ein ZIP mit ein paar
// XML-Dateien drin (ECMA-376 / OOXML). Den ZIP-Schreiber gibt es schon
// (lib/archiv.js, seit 28.07. fuer den Monatsordner); was fehlt, sind die
// XML-Teile. Das sind rund zweihundert Zeilen — ein Paket dafuer waere eine
// weitere Abhaengigkeit in genau dem Pfad, der Steuerunterlagen ausliefert.
//
// WAS DIE DATEI KANN:
//   - mehrere Blaetter, jedes mit Kopfzeilen (Titel, Hinweis), einer fetten
//     Spaltenueberschrift, Datenzeilen und Summenzeilen
//   - Zahlen als Zahlen (Excel kann damit rechnen), Betraege im Waehrungs-
//     format, Daten als echte Excel-Daten (sortierbar), Prozent
//   - Spaltenbreiten, eingefrorene Ueberschrift, Filterpfeile
//   - Umlaute und Sonderzeichen: alles UTF-8, XML-Sonderzeichen werden
//     maskiert (& < > ")
//
// WAS SIE BEWUSST NICHT KANN: Formeln, Diagramme, verbundene Zellen,
// Farbverlaeufe. Die Kanzlei braucht eine saubere Tabelle, kein Kunstwerk.
//
// TECHNISCHE ENTSCHEIDUNGEN:
//   - Texte als "inlineStr" direkt in der Zelle, nicht ueber die geteilte
//     Zeichenkettentabelle (sharedStrings.xml). Beides ist gueltig; die
//     Inline-Form spart ein ganzes Teil im Paket und laesst sich pruefen,
//     ohne zwei Dateien gegeneinander zu lesen.
//   - Datum als Seriennummer (Tage seit 30.12.1899 — Excels Zaehlung samt
//     dem beruehmten Schaltjahr-Fehler von 1900, den alle Programme
//     nachbauen), mit Zahlformat "dd.mm.yyyy". So sortiert und filtert Excel
//     richtig; ein Datum als Text ("05.09.2026") koennte es nicht.
//   - Spaltenbreiten in Zeichen (Excels Einheit), Standard 12.
//
// Aufruf:
//   bauen({ blaetter: [{ name, kopf, spalten, zeilen, summen, leerText }], autor })
//     name     Blattname (max. 31 Zeichen, ohne [ ] : * ? / \)
//     kopf     Zeilen ueber der Tabelle: [[zelle, ...], ...]; leere Zeile = []
//     spalten  [{ titel, breite, typ }]  typ: text | zahl | geld | datum | prozent
//     zeilen   [[zelle, ...], ...]  Zelle: Zahl, Text, Date, "JJJJ-MM-TT",
//              null (leer) oder { wert, typ, fett, stil }
//     summen   Zeilen unter der Tabelle, gleiche Form wie zeilen
//     leerText Text, der statt der Tabelle steht, wenn zeilen leer ist
//   -> Buffer (die fertige .xlsx)

const archiv = require("./archiv.js");

// XML-Sonderzeichen maskieren. Steuerzeichen (ausser Tab/Zeilenumbruch)
// fliegen raus — sie sind in XML 1.0 schlicht verboten, und Excel weigert
// sich dann, die ganze Datei zu oeffnen.
const x = (s) => String(s ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Spaltennummer (1-basiert) -> Buchstaben: 1 = A, 26 = Z, 27 = AA.
function spaltenBuchstabe(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Excel-Seriennummer eines Datums. Aus Date (lokale Bestandteile — nie
// toISOString, das dreht oestlich von UTC auf den Vortag) oder "JJJJ-MM-TT".
function datumSerie(v) {
  let j, m, t;
  if (v instanceof Date) { if (Number.isNaN(v.getTime())) return null; j = v.getFullYear(); m = v.getMonth() + 1; t = v.getDate(); }
  else {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    if (!p) return null;
    j = Number(p[1]); m = Number(p[2]); t = Number(p[3]);
  }
  return Math.round((Date.UTC(j, m - 1, t) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Die Zellenformate (cellXfs in styles.xml). Die Reihenfolge hier ist die
// Nummer, die jede Zelle traegt — beides muss zusammenpassen.
const STIL = {
  text: 0, kopf: 1, geld: 2, datum: 3, prozent: 4, geldFett: 5, titel: 6, fett: 7, hinweis: 8, zahl: 0,
};

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>
<numFmt numFmtId="165" formatCode="#,##0.00&quot; €&quot;"/>
<numFmt numFmtId="166" formatCode="0&quot; %&quot;"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B6B70"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// Eine Zelle als XML. Gibt "" zurueck, wenn nichts drinsteht — leere Zellen
// werden gar nicht geschrieben, das haelt die Datei klein.
//   ref   z. B. "C7"
//   wert  Rohwert (siehe Kopf)
//   typ   Spaltentyp als Vorgabe
function zelle(ref, wert, typ = "text") {
  let v = wert, t = typ, fett = false, stil = null;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    ({ wert: v, typ: t = typ, fett = false, stil = null } = v);
  }
  if (v === null || v === undefined || v === "") return "";

  // Zahlformat waehlen. Ein Text in einer Zahlenspalte bleibt Text ("gemischt"
  // in der USt-Spalte) — lieber ein Wort als eine erfundene Zahl.
  if (t === "datum") {
    const serie = datumSerie(v);
    if (serie !== null) return `<c r="${ref}" s="${STIL.datum}"><v>${serie}</v></c>`;
    if (typeof v === "number") return `<c r="${ref}" s="${STIL.datum}"><v>${v}</v></c>`;
    t = "text";
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    const s = stil ? STIL[stil] : t === "geld" ? (fett ? STIL.geldFett : STIL.geld)
      : t === "prozent" ? STIL.prozent : (fett ? STIL.fett : STIL.zahl);
    // Bis zu zehn Nachkommastellen, ohne Gleitkomma-Muell wie 0.1+0.2.
    return `<c r="${ref}" s="${s}"><v>${Number(v.toFixed(10))}</v></c>`;
  }
  if (v instanceof Date) {
    const serie = datumSerie(v);
    return serie === null ? "" : `<c r="${ref}" s="${STIL.datum}"><v>${serie}</v></c>`;
  }
  const s = stil && STIL[stil] !== undefined ? STIL[stil] : fett ? STIL.fett : STIL.text;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
}

function blattXml(blatt, erstes) {
  const spalten = blatt.spalten || [];
  const kopf = blatt.kopf || [];
  const zeilen = blatt.zeilen || [];
  const summen = blatt.summen || [];
  const anzahlSpalten = Math.max(spalten.length, 1,
    ...kopf.map((z) => z.length), ...zeilen.map((z) => z.length), ...summen.map((z) => z.length));
  const rows = [];
  let r = 0;

  const zeileSchreiben = (werte, typen, stilAlle) => {
    r += 1;
    const zellen = werte.map((w, i) => {
      const ref = `${spaltenBuchstabe(i + 1)}${r}`;
      if (stilAlle) return w === null || w === undefined || w === "" ? "" : zelle(ref, { wert: w, stil: stilAlle });
      return zelle(ref, w, typen ? (typen[i] || "text") : "text");
    }).filter(Boolean);
    if (zellen.length) rows.push(`<row r="${r}">${zellen.join("")}</row>`);
  };

  for (const z of kopf) zeileSchreiben(z || [], null, null);
  const kopfZeile = r + 1;
  zeileSchreiben(spalten.map((s) => s.titel), null, "kopf");
  const typen = spalten.map((s) => s.typ || "text");
  const ersteDaten = r + 1;
  for (const z of zeilen) zeileSchreiben(z, typen, null);
  const letzteDaten = r;
  if (!zeilen.length && blatt.leerText) zeileSchreiben([{ wert: blatt.leerText, stil: "hinweis" }], null, null);
  if (summen.length) { r += 1; for (const z of summen) zeileSchreiben(z, typen, null); }
  const letzteZeile = Math.max(r, 1);
  const letzteSpalte = spaltenBuchstabe(anzahlSpalten);

  const cols = spalten.length ? `<cols>${spalten.map((s, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${Number(s.breite) > 0 ? Number(s.breite) : 12}" customWidth="1"/>`).join("")}</cols>` : "";
  // Eingefrorene Ueberschrift: alles bis einschliesslich der Kopfzeile bleibt
  // beim Scrollen stehen.
  const pane = `<pane ySplit="${kopfZeile}" topLeftCell="A${kopfZeile + 1}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="A${kopfZeile + 1}" sqref="A${kopfZeile + 1}"/>`;
  const filter = zeilen.length && spalten.length
    ? `<autoFilter ref="A${kopfZeile}:${spaltenBuchstabe(spalten.length)}${letzteDaten}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${letzteSpalte}${letzteZeile}"/>
<sheetViews><sheetView workbookViewId="0"${erstes ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${rows.join("")}</sheetData>
${filter}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape"/>
</worksheet>`;
}

// Blattnamen, die Excel annimmt: hoechstens 31 Zeichen, ohne [ ] : * ? / \,
// nicht leer, nicht doppelt.
function blattName(name, i, vergeben) {
  let n = String(name || `Blatt${i + 1}`).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Blatt${i + 1}`;
  let k = 2;
  while (vergeben.has(n.toLowerCase())) { const basis = n.slice(0, 31 - String(k).length - 1); n = `${basis} ${k}`; k++; }
  vergeben.add(n.toLowerCase());
  return n;
}

module.exports.bauen = function ({ blaetter = [], autor = "Flowstate OS", erstellt = new Date() } = {}) {
  if (!blaetter.length) throw new Error("Ein Excel braucht mindestens ein Blatt.");
  const vergeben = new Set();
  const namen = blaetter.map((b, i) => blattName(b.name, i, vergeben));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
<sheets>${namen.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const zeit = (erstellt instanceof Date && !Number.isNaN(erstellt.getTime()) ? erstellt : new Date())
    .toISOString().replace(/\.\d{3}Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>${x(autor)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${zeit}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${zeit}</dcterms:modified>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${x(autor)}</Application></Properties>`;

  const eintraege = [
    { name: "[Content_Types].xml", daten: contentTypes },
    { name: "_rels/.rels", daten: rels },
    { name: "docProps/core.xml", daten: core },
    { name: "docProps/app.xml", daten: app },
    { name: "xl/workbook.xml", daten: workbook },
    { name: "xl/_rels/workbook.xml.rels", daten: workbookRels },
    { name: "xl/styles.xml", daten: stylesXml() },
    ...blaetter.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, daten: blattXml(b, i === 0) })),
  ];
  return archiv.zip(eintraege, erstellt, { namenBelassen: true });
};

// Fuer den Test einzeln pruefbar.
module.exports.datumSerie = datumSerie;
module.exports.spaltenBuchstabe = spaltenBuchstabe;
module.exports.MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
