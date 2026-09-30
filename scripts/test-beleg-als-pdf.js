// Prueft die Umwandlung fotografierter Belege in PDF (0078, 30.09.2026).
//
// WARUM DIESER TEST: Die Steuerkanzlei bekommt nur noch PDFs. Wenn hier etwas
// stillschweigend schiefgeht — verzerrtes Bild, kaputtes PDF, verlorenes
// Original — merkt es niemand, bis der Monatsordner bei der Kanzlei liegt.
//
//   node scripts/test-beleg-als-pdf.js

const alsPdf = require("../lib/beleg-als-pdf.js");
const pdf = require("../lib/pdf-schreiben.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// Ein winziges, gueltiges JPEG bauen (1x1 grau) — echte Kopfsegmente, damit
// jpegMasse denselben Weg geht wie bei einem Kamerabild.
function jpegBauen(breite, hoehe) {
  const teile = [
    Buffer.from([0xFF, 0xD8]),                                  // SOI
    Buffer.from([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
                 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), // APP0
  ];
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xFFC0, 0);
  sof.writeUInt16BE(17, 2);        // Laenge
  sof[4] = 8;                       // Bittiefe
  sof.writeUInt16BE(hoehe, 5);
  sof.writeUInt16BE(breite, 7);
  sof[9] = 3;                       // drei Kanaele (Farbe)
  teile.push(sof);
  teile.push(Buffer.from([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]));
  teile.push(Buffer.from([0x00, 0x11, 0x22, 0x33]));            // "Bilddaten"
  teile.push(Buffer.from([0xFF, 0xD9]));                        // EOI
  return Buffer.concat(teile);
}

console.log("— Was gewandelt wird —");
pruefe("JPEG wird gewandelt", alsPdf.wandelbar("image/jpeg", "bon.jpg") === true);
pruefe("JPEG am Dateinamen erkannt", alsPdf.wandelbar("", "bon.JPEG") === true);
pruefe("PDF bleibt PDF", alsPdf.wandelbar("application/pdf", "rechnung.pdf") === false);
pruefe("HEIC bleibt unangetastet", alsPdf.wandelbar("image/heic", "IMG_1.heic") === false);
pruefe("PNG bleibt unangetastet (kein DCTDecode)", alsPdf.wandelbar("image/png", "bild.png") === false);

console.log("\n— Masse aus dem JPEG-Kopf —");
const m = pdf.jpegMasse(jpegBauen(2048, 1536));
pruefe("Breite und Hoehe werden gelesen", m && m.breite === 2048 && m.hoehe === 1536, JSON.stringify(m));
pruefe("Kein JPEG gibt null", pdf.jpegMasse(Buffer.from("kein bild")) === null);
pruefe("Leerer Puffer gibt null", pdf.jpegMasse(Buffer.alloc(0)) === null);

console.log("\n— Das erzeugte PDF —");
const hoch = alsPdf.ausBild(jpegBauen(1200, 1800), { dateiname: "bon.jpg", laufnummer: "42" });
pruefe("Beginnt mit %PDF", hoch.slice(0, 5).toString("latin1") === "%PDF-");
pruefe("Endet mit %%EOF", hoch.slice(-7).toString("latin1").trim() === "%%EOF");
pruefe("Enthaelt das Bild als DCTDecode", hoch.includes(Buffer.from("/DCTDecode")));
pruefe("Meldet das Original in der Fusszeile", hoch.includes(Buffer.from("bon.jpg")));
pruefe("Nennt die Belegnummer", hoch.includes(Buffer.from("Beleg 42")));

// Die JPEG-Bytes muessen UNVERAENDERT im PDF stehen — das ist der Kern der
// Sache: keine zweite Kodierung, kein anderes Bild.
const quelle = jpegBauen(800, 600);
const raus = alsPdf.ausBild(quelle, { dateiname: "x.jpg" });
pruefe("Die Bilddaten stehen unveraendert im PDF", raus.includes(quelle),
  "Wird das Bild neu kodiert, stimmt die bildliche Wiedergabe nicht mehr mit dem Original ueberein.");

console.log("\n— Seitenformat folgt dem Bild —");
// Ein Kassenbon ist hoch: Hochformat. Eine quer fotografierte Rechnung: quer.
const bon = alsPdf.ausBild(jpegBauen(900, 2400), {});
const quer = alsPdf.ausBild(jpegBauen(2400, 900), {});
pruefe("Hohes Bild -> Hochformat (A4)", bon.includes(Buffer.from("841.89")) && bon.includes(Buffer.from("/MediaBox [0 0 595.28 841.89]")));
pruefe("Breites Bild -> Querformat", quer.includes(Buffer.from("/MediaBox [0 0 841.89 595.28]")));

console.log("\n— Kaputte Eingaben —");
let geworfen = false;
try { alsPdf.ausBild(Buffer.from("kein jpeg"), {}); } catch { geworfen = true; }
pruefe("Kaputtes Bild wirft statt ein leeres PDF zu liefern", geworfen,
  "Ein leeres PDF im Archiv waere schlimmer als ein Fehler beim Hochladen.");

console.log("\n— Der Dateiname —");
pruefe("bon.jpg -> bon.pdf", alsPdf.pdfName("bon.jpg") === "bon.pdf");
pruefe("WhatsApp Image 2026.jpeg -> .pdf", alsPdf.pdfName("WhatsApp Image 2026.jpeg") === "WhatsApp Image 2026.pdf");
pruefe("Ohne Endung bekommt .pdf", alsPdf.pdfName("Beleg") === "Beleg.pdf");

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
process.exit(fehler ? 1 : 0);
