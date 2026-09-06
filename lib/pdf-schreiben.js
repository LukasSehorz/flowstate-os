// Flowstate PDF-Schreiber — Rechnungen und Angebote ohne Fremdpaket (05.09.2026).
//
// Warum von Hand: Bisher entstanden Rechnungen aus DOCX-Vorlagen, die auf dem
// Server per LibreOffice in PDF gewandelt wurden (lib/beleg-pdf.js). Das
// braucht ein installiertes LibreOffice, 60 Sekunden Geduld und einen
// Host-Mount mit Vorlagen, den es nur auf dem Server gibt — lokal und in
// Tests fiel der Weg immer aus. Ein Rechnungs-PDF ist aber ein einfaches
// Dokument: Text, Linien, ein paar Flaechen. Dafuer reicht PDF 1.4 mit den
// eingebauten Standardschriften, wie lib/archiv.js fuer das ZIP-Format schon
// vorgemacht hat. Ein Paket weniger in einem Pfad, der Belege an Kunden
// ausliefert.
//
// Was er kann:
//   · Seiten in A4 (weitere Formate ueber `format`), Koordinaten in PUNKT
//     (1/72 Zoll) mit Ursprung OBEN LINKS — so denkt man beim Layout, die
//     Umrechnung in PDFs Ursprung unten links passiert beim Schreiben.
//   · Vier Standard-14-Schriften (jeder Betrachter hat sie), WinAnsiEncoding —
//     deckt Umlaute, ß, € und die typografischen Anfuehrungszeichen ab. Was
//     nicht in WinAnsi liegt, wird ersetzt (siehe ERSATZ), nie stillschweigend
//     verschluckt.
//       "sans"  = Helvetica / Helvetica-Bold  (Angebot; Word-Vorlage: Arial)
//       "serif" = Times-Roman / Times-Bold    (Rechnung; Word-Serifenschrift)
//     Warum beide (05.09.2026): Lukas' Hausvorlage setzt Angebote in Arial und
//     Rechnungen in der Word-Serifenschrift. Beide Familien sind Standard-14,
//     die zweite kostet also nur zwei Font-Objekte und zwei Breitentabellen —
//     keine eingebettete Schriftdatei.
//   · Textbreite und Zeilenumbruch nach Breite. Die Zeichenbreiten sind die
//     Adobe-AFM-Metriken der beiden Schriften (1000 Einheiten je Geviert).
//     Nachgemessen am 05.09.2026 gegen /System/Library/Fonts/Helvetica.ttc
//     und Times.ttc (hmtx/cmap, siehe scratch ttc-breiten.js): fuer alle
//     Buchstaben, Ziffern und Satzzeichen identisch. Abweichungen nur bei
//     drei seltenen Zeichen (€, µ, ÷).
//     BEIM EURO gilt hier NICHT der AFM-Wert (556 bzw. 500), sondern der
//     gemessene Systemwert 744 — in beiden Familien. Grund (06.09.2026):
//     Auf einem Beleg steht der € in fast jeder Zeile. Vorschau und Preview
//     auf dem Mac setzen ihn 188 bzw. 244 Einheiten breiter als gerechnet;
//     eine Zeile mit drei Betraegen lief dadurch bis zu 6 pt ueber die
//     berechnete Breite hinaus, und das Wort danach klebte am Euro-Zeichen
//     ("2.500,00 €(bisher"). Zu breit rechnen bricht eine Zeile hoechstens
//     einen Tick zu frueh um — zu schmal rechnen laesst Text ineinander
//     laufen. Im Zweifel also der groessere Wert.
//   · Linien, Rechtecke (Fuellung/Rand), mehrere Seiten, Fusszeilen
//     nachtraeglich auf jede Seite (Seite n von m), korrekte xref-Tabelle.
//   · Inhaltsstroeme mit FlateDecode (zlib gehoert zu Node) — ein Rechnungs-
//     PDF liegt damit bei ~5-8 KB statt 20-30 KB, und es liegt in der
//     Datenbank (rechnungen.pdf).
//
// Was er NICHT kann (bewusst): eingebettete Schriften, Bilder, Kerning,
// Unicode jenseits von WinAnsi (kein Kyrillisch, keine Emojis). Fuer eine
// Rechnung an einen bayerischen Handwerksbetrieb ist das die richtige Groesse.
//
//   const pdf = require("./pdf-schreiben.js");
//   const d = pdf.neu({ titel: "Rechnung R-2026-131" });
//   d.text(71, 100, "Rechnung", { groesse: 16, fett: true });
//   const y = d.absatz(71, 130, langerText, { breite: 450 });
//   d.linie(71, y, 520, y);
//   fs.writeFileSync("r.pdf", d.fertig());

const zlib = require("zlib");

// Seitenformate in Punkt (Breite, Hoehe).
const FORMATE = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792] };

// Zeichenbreiten fuer die WinAnsi-Codes 32..255 (Index 0 = Leerzeichen).
// Adobe Core-14-AFM (Helvetica.afm / Helvetica-Bold.afm), 1000 Einheiten je
// Geviert. Undefinierte Codes (0x81, 0x8D, 0x8F, 0x90, 0x9D) stehen mit 0;
// der Kodierer erzeugt sie nie.
const BREITE_NORMAL = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,744,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const BREITE_FETT = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,744,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

// Dieselben AFM-Metriken fuer Times-Roman / Times-Bold (Adobe Core-14). Aus
// den Glyphnamen ueber die WinAnsi-Kodierung aufgebaut (scratchpad/
// times-breiten.js, 05.09.2026) — nicht von Hand abgetippt, damit sich in 224
// Zahlen kein Zahlendreher versteckt.
const BREITE_SERIF = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,0,744,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500];
const BREITE_SERIF_FETT = [250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,0,744,0,333,500,500,1000,500,500,333,1000,556,333,1000,0,667,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500];

// Die beiden Familien. `pdf` = Name im PDF, `breiten` = Tabelle fuer die
// Breitenrechnung, `f` = der Ressourcenname im Inhaltsstrom.
const SCHRIFTEN = {
  sans:  { normal: { pdf: "Helvetica",   breiten: BREITE_NORMAL,     f: "F1" },
           fett:   { pdf: "Helvetica-Bold", breiten: BREITE_FETT,    f: "F2" } },
  serif: { normal: { pdf: "Times-Roman", breiten: BREITE_SERIF,      f: "F3" },
           fett:   { pdf: "Times-Bold",  breiten: BREITE_SERIF_FETT, f: "F4" } },
};
const familie = (name) => (SCHRIFTEN[name] ? name : "sans");

// Unicode -> WinAnsi-Byte fuer den Bereich 0x80..0x9F (cp1252). Der Rest
// (0x20..0x7E, 0xA0..0xFF) ist deckungsgleich mit Latin-1.
const WINANSI = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);
// Was nicht in WinAnsi liegt, aber in Texten vorkommt: sinnvoll ersetzen
// statt "?" zu drucken. Alles andere wird "?" — sichtbar, nicht verschluckt.
const ERSATZ = new Map([
  [0x00A0, " "], [0x202F, " "], [0x2009, " "], [0x2007, " "],       // geschuetzte/schmale Leerzeichen
  [0x2010, "-"], [0x2011, "-"], [0x2012, "-"], [0x2212, "-"],       // Bindestriche, Minus
  [0x2192, "->"], [0x2190, "<-"], [0x2713, "x"], [0x2714, "x"],     // Pfeile, Haken
  [0x2032, "'"], [0x2033, '"'], [0x00B4, "'"],
  [0x0141, "L"], [0x0142, "l"], [0x010C, "C"], [0x010D, "c"], [0x0158, "R"], [0x0159, "r"],
  [0x011B, "e"], [0x0148, "n"], [0x0165, "t"], [0x016F, "u"], [0x0107, "c"], [0x0119, "e"],
]);

// Text -> Bytes in WinAnsi. Gibt einen Buffer zurueck.
function kodieren(str) {
  const bytes = [];
  for (const zeichen of String(str ?? "")) {
    const cp = zeichen.codePointAt(0);
    if (cp === 0x0A || cp === 0x0D || cp === 0x09) { bytes.push(0x20); continue; }
    if (cp >= 0x20 && cp <= 0x7E) { bytes.push(cp); continue; }
    if (cp >= 0xA0 && cp <= 0xFF) { bytes.push(cp); continue; }
    if (WINANSI.has(cp)) { bytes.push(WINANSI.get(cp)); continue; }
    if (ERSATZ.has(cp)) { for (const c of ERSATZ.get(cp)) bytes.push(c.charCodeAt(0)); continue; }
    if (cp < 0x20) continue;
    bytes.push(0x3F); // "?"
  }
  return Buffer.from(bytes);
}

// Breite eines Textes in Punkt bei gegebener Schriftgroesse und Familie.
function textBreite(str, groesse = 10, fett = false, schrift = "sans") {
  const tab = SCHRIFTEN[familie(schrift)][fett ? "fett" : "normal"].breiten;
  let summe = 0;
  for (const b of kodieren(str)) summe += (b >= 32 ? tab[b - 32] : 0) || 0;
  return summe * groesse / 1000;
}

// Zeilenumbruch nach Breite. Absaetze (\n) bleiben erhalten; ein Wort, das
// allein breiter ist als die Zeile, wird zeichenweise getrennt — lieber ein
// haesslicher Umbruch als Text, der rechts aus der Seite laeuft.
//
// AN BINDESTRICHEN darf getrennt werden (06.09.2026): In den Leistungstexten
// stehen Woerter wie "On-Page-SEO-Optimierung" oder "KI-Such-Optimierung", und
// die sind zusammen so breit, dass die Zeile davor halb leer blieb — Word
// trennt dort, die Vorbild-Belege zeigen es. Der Bindestrich bleibt am
// Zeilenende stehen, es wird also keiner erfunden.
const anTrennern = (wort) => {
  const teile = wort.split(/(?<=-)(?=.)/);           // nach jedem Bindestrich schneiden
  return teile.length > 1 ? teile : [wort];
};
function umbrechen(str, breite, groesse = 10, fett = false, schrift = "sans") {
  const zeilen = [];
  for (const absatz of String(str ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const woerter = absatz.split(/[ \t]+/).filter((w) => w.length);
    if (!woerter.length) { zeilen.push(""); continue; }
    let zeile = "";
    for (let wort of woerter) {
      // Ueberlanges Wort zerlegen
      while (textBreite(wort, groesse, fett, schrift) > breite) {
        let n = wort.length - 1;
        while (n > 1 && textBreite(wort.slice(0, n), groesse, fett, schrift) > breite) n--;
        const kopf = wort.slice(0, n);
        if (zeile) { zeilen.push(zeile); zeile = ""; }
        zeilen.push(kopf);
        wort = wort.slice(n);
      }
      const probe = zeile ? zeile + " " + wort : wort;
      if (textBreite(probe, groesse, fett, schrift) <= breite) { zeile = probe; continue; }
      // Passt nicht mehr: erst an Bindestrichen versuchen, bevor die Zeile
      // umgebrochen wird — sonst bleibt sie unnoetig kurz. Gesucht ist das
      // laengste Stueck des Wortes, das noch dazupasst; mindestens ein Stueck
      // muss uebrig bleiben, sonst waere es kein Umbruch.
      const teile = anTrennern(wort);
      if (zeile && teile.length > 1) {
        let n = 0;
        while (n < teile.length - 1
          && textBreite(`${zeile} ${teile.slice(0, n + 1).join("")}`, groesse, fett, schrift) <= breite) n++;
        if (n > 0) {
          zeilen.push(`${zeile} ${teile.slice(0, n).join("")}`);
          zeile = teile.slice(n).join("");
          continue;
        }
      }
      if (zeile) zeilen.push(zeile);
      zeile = wort;
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

const zahl = (n) => {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
};
const farbeOp = (f, op) => `${zahl(f[0])} ${zahl(f[1])} ${zahl(f[2])} ${op}`;

// PDF-Zeichenkette: Klammern und Rueckstrich maskieren, Bytes >= 128 oktal —
// so bleibt der Inhaltsstrom auch ohne Kompression reiner 7-Bit-Text.
function pdfString(buf) {
  let s = "(";
  for (const b of buf) {
    if (b === 0x28 || b === 0x29 || b === 0x5C) s += "\\" + String.fromCharCode(b);
    else if (b < 32 || b >= 127) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

// Text fuer das Info-Woerterbuch: UTF-16BE mit BOM als Hex — Umlaute im
// Titel kommen so in jedem Betrachter richtig an.
function infoString(str) {
  const b = Buffer.from("\uFEFF" + String(str ?? ""), "utf16le");
  // utf16le -> BE drehen
  for (let i = 0; i + 1 < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  return "<" + b.toString("hex").toUpperCase() + ">";
}

function pdfDatum(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function neu({ titel = "", autor = "", betreff = "", format = "A4", komprimieren = true, schrift = "sans" } = {}) {
  const [B, H] = FORMATE[format] || FORMATE.A4;
  // Grundschrift des Dokuments. Einzelne Aufrufe koennen sie mit
  // { schrift: "serif" } bzw. "sans" ueberstimmen — die Fusszeile einer
  // Rechnung darf so serif bleiben, waehrend ein Sonderzeichen sans kommt.
  const grund = familie(schrift);
  const seiten = [];
  let aktuell = -1;

  const ops = () => {
    if (aktuell < 0) seite();
    return seiten[aktuell];
  };
  const yPdf = (y) => H - y;

  function seite() {
    seiten.push([]);
    aktuell = seiten.length - 1;
    return aktuell;
  }
  function seiteWaehlen(i) {
    if (i < 0 || i >= seiten.length) throw new Error(`Seite ${i} gibt es nicht`);
    aktuell = i;
  }

  // Eine Zeile Text. y ist die GRUNDLINIE. ausrichtung: links | rechts | mitte
  // (x ist dann der rechte Rand bzw. die Mitte).
  function text(x, y, str, { groesse = 10, fett = false, farbe = [0, 0, 0], ausrichtung = "links", schrift } = {}) {
    const s = String(str ?? "");
    if (!s.length) return 0;
    const fam = schrift ? familie(schrift) : grund;
    const breite = textBreite(s, groesse, fett, fam);
    let x0 = x;
    if (ausrichtung === "rechts") x0 = x - breite;
    else if (ausrichtung === "mitte") x0 = x - breite / 2;
    ops().push(
      `${farbeOp(farbe, "rg")} BT /${SCHRIFTEN[fam][fett ? "fett" : "normal"].f} ${zahl(groesse)} Tf ` +
      `1 0 0 1 ${zahl(x0)} ${zahl(yPdf(y))} Tm ${pdfString(kodieren(s))} Tj ET`);
    return breite;
  }

  // Absatz mit Umbruch. y ist die Grundlinie der ERSTEN Zeile. Gibt die
  // Grundlinie zurueck, auf der die naechste Zeile stuende.
  function absatz(x, y, str, { breite = B - x - 56.7, groesse = 10, fett = false, farbe, zeilenhoehe, ausrichtung = "links", schrift } = {}) {
    const fam = schrift ? familie(schrift) : grund;
    const zh = zeilenhoehe || Math.round(groesse * 1.4 * 100) / 100;
    const zeilen = umbrechen(str, breite, groesse, fett, fam);
    let yy = y;
    for (const z of zeilen) {
      if (z) {
        const xx = ausrichtung === "rechts" ? x + breite : ausrichtung === "mitte" ? x + breite / 2 : x;
        text(xx, yy, z, { groesse, fett, farbe, ausrichtung, schrift: fam });
      }
      yy += zh;
    }
    return yy;
  }

  function linie(x1, y1, x2, y2, { staerke = 0.5, farbe = [0, 0, 0] } = {}) {
    ops().push(`${farbeOp(farbe, "RG")} ${zahl(staerke)} w ${zahl(x1)} ${zahl(yPdf(y1))} m ${zahl(x2)} ${zahl(yPdf(y2))} l S`);
  }

  // y ist die OBERKANTE des Rechtecks.
  function rechteck(x, y, breite, hoehe, { fuellung = null, rand = null, staerke = 0.5 } = {}) {
    if (!fuellung && !rand) return;
    let s = "";
    if (fuellung) s += farbeOp(fuellung, "rg") + " ";
    if (rand) s += farbeOp(rand, "RG") + ` ${zahl(staerke)} w `;
    s += `${zahl(x)} ${zahl(yPdf(y + hoehe))} ${zahl(breite)} ${zahl(hoehe)} re ${fuellung && rand ? "B" : fuellung ? "f" : "S"}`;
    ops().push(s);
  }

  // Alles zusammensetzen: Objekte durchnummerieren, Byte-Versatz jedes
  // Objekts merken, xref schreiben. Die Versaetze muessen auf das Byte genau
  // stimmen — ein Betrachter, der sie nicht findet, "repariert" die Datei
  // stillschweigend oder zeigt eine leere Seite.
  function fertig() {
    if (!seiten.length) seite();
    const objekte = []; // Buffer je Objekt, Index+1 = Objektnummer
    const obj = (inhalt) => { objekte.push(inhalt); return objekte.length; };

    const nKatalog = obj(null);           // 1
    const nSeiten = obj(null);            // 2
    // Alle vier Standard-14-Schriften anmelden. Ein nicht benutztes Font-Objekt
    // kostet rund 90 Byte — billiger als die Buchfuehrung darueber, welche
    // Familie auf welcher Seite vorkommt.
    const nFont = {};
    for (const fam of Object.keys(SCHRIFTEN)) {
      for (const schnitt of ["normal", "fett"]) {
        const f = SCHRIFTEN[fam][schnitt];
        // /Widths mitgeben, obwohl Standard-14 auch ohne geht (06.09.2026):
        // Ohne die Tabelle setzt der Betrachter die Zeichen nach den
        // eingebauten Adobe-Metriken vor — zeichnet aber die Glyphen der
        // Systemschrift. Beim Euro gehen die auseinander (Adobe 500/556,
        // macOS 744), und das Zeichen ragte um 2-3 pt in das folgende
        // Leerzeichen: "2.500,00 €gemäß Angebot" (Befund 16 des Pruefers).
        // Mit eigener Breitentabelle rechnet der Betrachter mit unseren
        // Zahlen — und die sind dieselben, mit denen wir umbrechen.
        nFont[f.f] = obj(Buffer.from(
          `<< /Type /Font /Subtype /Type1 /BaseFont /${f.pdf} /Encoding /WinAnsiEncoding ` +
          `/FirstChar 32 /LastChar 255 /Widths [${f.breiten.join(" ")}] >>`));
      }
    }
    const fontRes = Object.entries(nFont).map(([name, nr]) => `/${name} ${nr} 0 R`).join(" ");
    const nInfo = obj(Buffer.from(
      `<< /Producer (Flowstate OS) /Creator (Flowstate OS) /CreationDate (${pdfDatum()})` +
      (titel ? ` /Title ${infoString(titel)}` : "") +
      (autor ? ` /Author ${infoString(autor)}` : "") +
      (betreff ? ` /Subject ${infoString(betreff)}` : "") + " >>"));

    const seitenNummern = [];
    for (const s of seiten) {
      const roh = Buffer.from(s.join("\n") + "\n", "latin1");
      const daten = komprimieren ? zlib.deflateSync(roh) : roh;
      const nInhalt = obj(Buffer.concat([
        Buffer.from(`<< /Length ${daten.length}${komprimieren ? " /Filter /FlateDecode" : ""} >>\nstream\n`, "latin1"),
        daten, Buffer.from("\nendstream", "latin1")]));
      const nSeite = obj(Buffer.from(
        `<< /Type /Page /Parent ${nSeiten} 0 R /MediaBox [0 0 ${zahl(B)} ${zahl(H)}] ` +
        `/Resources << /Font << ${fontRes} >> >> /Contents ${nInhalt} 0 R >>`));
      seitenNummern.push(nSeite);
    }
    objekte[nKatalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${nSeiten} 0 R >>`);
    objekte[nSeiten - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${seitenNummern.map((n) => `${n} 0 R`).join(" ")}] /Count ${seitenNummern.length} >>`);

    const teile = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let versatz = teile[0].length;
    const versaetze = [];
    objekte.forEach((inhalt, i) => {
      versaetze.push(versatz);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), inhalt, Buffer.from("\nendobj\n", "latin1")]);
      teile.push(b);
      versatz += b.length;
    });
    const xrefAb = versatz;
    let xref = `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
    for (const v of versaetze) xref += `${String(v).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${objekte.length + 1} /Root ${nKatalog} 0 R /Info ${nInfo} 0 R >>\nstartxref\n${xrefAb}\n%%EOF\n`;
    teile.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(teile);
  }

  return {
    B, H, seite, seiteWaehlen, seiten: () => seiten.length, aktuell: () => aktuell,
    text, absatz, linie, rechteck, fertig, schrift: grund,
    // Die Doc-Varianten rechnen mit der Grundschrift des Dokuments, wenn keine
    // andere genannt wird — sonst laege der Umbruch in Times auf Helvetica-
    // Breiten und die Tabellenzellen liefen ueber.
    textBreite: (str, groesse, fett, sch) => textBreite(str, groesse, fett, sch || grund),
    umbrechen: (str, breite, groesse, fett, sch) => umbrechen(str, breite, groesse, fett, sch || grund),
  };
}

// Millimeter -> Punkt, fuer Layouts, die in mm gedacht sind (DIN 5008).
const mm = (v) => v * 72 / 25.4;

module.exports = { neu, mm, textBreite, umbrechen, kodieren, FORMATE, BREITE_NORMAL, BREITE_FETT, BREITE_SERIF, BREITE_SERIF_FETT, SCHRIFTEN };
