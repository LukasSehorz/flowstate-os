// Ein fotografierter Beleg wird zum PDF.
//
// WARUM (Lukas, 30.09.2026): "Wenn ich ein Bild hochlade, entweder über das
// Handy oder über den Laptop, soll automatisch die Rechnung im PDF-Format
// abgespeichert werden, weil unsere Steuerberaterin so ist."
//
// Die Kanzlei bekommt am Monatsende einen Ordner mit allen Belegen
// (lib/archiv.js). Lagen darin JPEGs neben PDFs, musste dort jemand von Hand
// wandeln — bei jedem Monat aufs Neue. Ab jetzt ist im Archiv jeder Beleg ein
// PDF, egal ob er aus der Kamera, aus Telegram oder aus dem Postfach kam.
//
// WAS HIER NICHT PASSIERT: Das Bild wird NICHT neu kodiert. Die JPEG-Daten
// wandern unveraendert in das PDF (DCTDecode ist derselbe Datenstrom), es
// entsteht also kein zweiter Qualitaetsverlust und kein zweites Bild mit
// anderem Inhalt. Fuer die GoBD ist das der springende Punkt: die bildliche
// Wiedergabe bleibt identisch, das PDF ist nur eine andere Huelle um
// dieselben Pixel.
//
// Das ORIGINAL bleibt erhalten (Migration 0072: belege.original,
// original_dateiname, original_dateityp). Ein Pruefer, der das Kamerabild
// sehen will, bekommt es — und wir koennen jederzeit zeigen, dass PDF und
// Original dasselbe zeigen.
//
// PDFs bleiben unangetastet. HEIC ebenfalls: Die Pixel liegen dort in einem
// Format, das weder PDF noch unser Schreiber kennt; ein HEIC-Beleg wird wie
// bisher unveraendert abgelegt (und ist ohnehin selten, weil die Scan-Seite
// im Browser nach JPEG wandelt).

const pdf = require("./pdf-schreiben.js");

// A4 mit 15 mm Rand. Ein Kassenbon ist schmal und lang, eine Rechnung breit —
// beide sollen auf eine Seite passen, ohne dass etwas abgeschnitten wird.
const RAND = pdf.mm(15);

const istJpeg = (typ, name) => /jpe?g/i.test(String(typ || "")) || /\.jpe?g$/i.test(String(name || ""));
const istPdf = (typ, name) => /pdf/i.test(String(typ || "")) || /\.pdf$/i.test(String(name || ""));

// Kann aus dieser Datei ein PDF werden?
function wandelbar(typ, name) {
  if (istPdf(typ, name)) return false;          // ist schon eines
  return istJpeg(typ, name);
}

// Aus einem Foto ein einseitiges PDF machen.
//
// Das Bild wird so gross wie moeglich auf die Seite gelegt, ohne sein
// Seitenverhaeltnis zu veraendern — ein verzerrter Beleg waere in der
// Buchfuehrung wertlos. Hochformat-Bons liegen dann mittig mit weissen
// Raendern links und rechts, quer aufgenommene Rechnungen oben und unten.
//
// meta (optional): { dateiname, laufnummer, aufgenommen } fuer die Fusszeile.
function ausBild(daten, meta = {}) {
  const masse = pdf.jpegMasse(daten);
  if (!masse) throw new Error("Das Bild ließ sich nicht lesen (kein gültiges JPEG).");

  // Ein sehr hohes Bild (langer Kassenbon) bekommt Hochformat, ein breites
  // Querformat. Sonst schrumpft ein Bon auf Streichholzbreite.
  const quer = masse.breite > masse.hoehe;
  const d = pdf.neu({
    titel: meta.dateiname ? `Beleg ${meta.dateiname}` : "Beleg",
    betreff: meta.laufnummer ? `Beleg ${meta.laufnummer}` : "",
    autor: "Flowstate OS",
    format: quer ? "A4quer" : "A4",
    // Der Seiteninhalt ist ein einziger Zeichenbefehl — Komprimieren spart
    // nichts und macht die Datei nur schwerer nachvollziehbar.
    komprimieren: false,
  });

  const platzB = d.B - 2 * RAND;
  const platzH = d.H - 2 * RAND - pdf.mm(8);   // unten Platz fuer die Fusszeile
  const faktor = Math.min(platzB / masse.breite, platzH / masse.hoehe);
  const b = masse.breite * faktor;
  const h = masse.hoehe * faktor;
  const x = (d.B - b) / 2;
  const y = RAND + (platzH - h) / 2;

  d.bild(x, y, daten, { breite: b, hoehe: h });

  // Fusszeile: woher das PDF kommt und was das Original war. Ohne diese Zeile
  // sieht man dem PDF nicht an, dass es aus einem Foto entstanden ist — und
  // genau das muss die Verfahrensdokumentation belegen koennen.
  const fuss = [
    meta.laufnummer ? `Beleg ${meta.laufnummer}` : null,
    meta.dateiname ? `Original: ${meta.dateiname}` : null,
    `${masse.breite}×${masse.hoehe} Pixel`,
    "unverändert eingebettet (Flowstate OS)",
  ].filter(Boolean).join(" · ");
  d.text(d.B / 2, d.H - RAND / 2, fuss, { groesse: 7, farbe: [0.45, 0.45, 0.45], ausrichtung: "mitte" });

  return d.fertig();
}

// Der Dateiname des PDF: derselbe Stamm, andere Endung.
const pdfName = (name) => String(name || "Beleg").replace(/\.[^.]+$/, "") + ".pdf";

module.exports = { wandelbar, ausBild, pdfName, istJpeg, istPdf, RAND };
