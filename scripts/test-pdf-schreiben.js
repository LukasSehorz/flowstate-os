// Prueft den eigenen PDF-Schreiber (lib/pdf-schreiben.js) — ohne Datenbank,
// ohne Betrachter, ohne Fremdpaket.
//
// Warum das wichtig ist: Ein PDF mit falschen xref-Versaetzen zeigt in
// manchen Betrachtern eine leere Seite, in anderen wird es still "repariert".
// Beides faellt lokal nicht auf und beim Kunden schon. Darum wird hier die
// Struktur nachgerechnet: Kopf, Ende, jede xref-Adresse zeigt auf "N 0 obj",
// die Seitenzahl stimmt, der Umbruch haelt die Breite ein, Umlaute und Euro
// landen als WinAnsi-Bytes im Strom.
//
//   node scripts/test-pdf-schreiben.js

const zlib = require("zlib");
const pdf = require("../lib/pdf-schreiben.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// Alle Inhaltsstroeme eines PDFs entpackt als Text.
function stroeme(buf) {
  const s = buf.toString("latin1");
  const raus = [];
  const re = /<<([^>]*)>>\s*stream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const laenge = Number((m[1].match(/\/Length (\d+)/) || [])[1]);
    const ab = m.index + m[0].length;
    const roh = buf.subarray(ab, ab + laenge);
    raus.push(/FlateDecode/.test(m[1]) ? zlib.inflateSync(roh).toString("latin1") : roh.toString("latin1"));
  }
  return raus;
}

// ---------------------------------------------------- 1. Breiten & Kodierung
console.log("— Breiten und Kodierung —");
pruefe("Helvetica: 'Hallo' bei 10 pt ist 22,78 pt breit (AFM)", Math.abs(pdf.textBreite("Hallo", 10) - 22.78) < 0.01);
pruefe("Helvetica-Bold ist breiter als Helvetica", pdf.textBreite("Hallo", 10, true) > pdf.textBreite("Hallo", 10));
pruefe("'i' ist schmaler als 'm'", pdf.textBreite("i", 10) < pdf.textBreite("m", 10));
pruefe("Breite waechst linear mit der Groesse", Math.abs(pdf.textBreite("Abc", 20) - 2 * pdf.textBreite("Abc", 10)) < 0.001);
pruefe("Tabellen haben 224 Eintraege (Codes 32..255)", pdf.BREITE_NORMAL.length === 224 && pdf.BREITE_FETT.length === 224);
const k = pdf.kodieren("ä€„“→ x");
pruefe("ä wird 0xE4, € wird 0x80, „ wird 0x84, “ wird 0x93", k[0] === 0xE4 && k[1] === 0x80 && k[2] === 0x84 && k[3] === 0x93);
pruefe("Pfeil ausserhalb WinAnsi wird '->' statt verschluckt", k.toString("latin1").includes("->"));
pruefe("Unbekanntes Zeichen wird '?', nicht leer", pdf.kodieren("a中b").toString("latin1") === "a?b");
pruefe("Zeilenumbruch im Text wird zum Leerzeichen", pdf.kodieren("a\nb").toString("latin1") === "a b");

// ---------------------------------------------------- 2. Umbruch
console.log("\n— Umbruch —");
const lang = "Konzeption und Erstellung eines modernen Webauftritts inkl. individuellem Webdesign im Corporate Design, technischer On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / AI-SEO, Schema.org), responsivem Layout sowie vollständiger Online-Stellung.";
const zeilen = pdf.umbrechen(lang, 250, 10);
pruefe("langer Text wird in mehrere Zeilen gebrochen", zeilen.length >= 4, `${zeilen.length} Zeilen`);
pruefe("keine Zeile ist breiter als erlaubt", zeilen.every((z) => pdf.textBreite(z, 10) <= 250));
// Seit dem 06.09.2026 darf an Bindestrichen getrennt werden ("On-Page-SEO-" /
// "Optimierung,"). Woerter zaehlen taugt deshalb nicht mehr als Mass — die
// Zeichenkette ohne Leerraum muss stimmen. Das ist die schaerfere Probe: sie
// faende auch ein verlorenes einzelnes Zeichen.
const ohneLeer = (x) => x.replace(/\s+/g, "");
pruefe("kein Zeichen geht verloren und keines kommt dazu", ohneLeer(zeilen.join("")) === ohneLeer(lang),
  `${ohneLeer(zeilen.join("")).length} statt ${ohneLeer(lang).length} Zeichen`);
pruefe("an Bindestrichen wird getrennt, der Strich bleibt am Zeilenende",
  zeilen.some((z) => /-$/.test(z)) && zeilen.every((z) => !/^-/.test(z)), zeilen.join(" | "));
const einWort = pdf.umbrechen("Donaudampfschifffahrtsgesellschaftskapitaensmuetze", 60, 10);
pruefe("ein ueberlanges Wort wird zeichenweise getrennt", einWort.length > 1 && einWort.every((z) => pdf.textBreite(z, 10) <= 60));
pruefe("Absaetze (\\n) bleiben erhalten", pdf.umbrechen("a\nb", 100, 10).length === 2);
pruefe("leerer Text ergibt eine leere Zeile", pdf.umbrechen("", 100, 10).length === 1);

// ---------------------------------------------------- 3. Struktur
console.log("\n— Struktur —");
const d = pdf.neu({ titel: "Prüfung – Größe & € (Umlaute im Titel)", autor: "Flowstate", betreff: "Test" });
d.text(71, 80, "Überschrift mit Umlauten: Größe, Straße, 1.234,56 €", { groesse: 14, fett: true });
const y = d.absatz(71, 110, lang, { breite: 300 });
d.linie(71, y, 524, y);
d.rechteck(71, y + 10, 200, 20, { fuellung: [0.9, 0.9, 0.9], rand: [0, 0, 0] });
d.text(524, y + 24, "rechtsbündig", { ausrichtung: "rechts" });
d.seite();
d.text(71, 80, "Zweite Seite", { groesse: 12 });
d.seite();
d.text(71, 80, "Dritte Seite", { groesse: 12 });
for (let i = 0; i < d.seiten(); i++) { d.seiteWaehlen(i); d.text(524, 800, `Seite ${i + 1} von ${d.seiten()}`, { groesse: 7, ausrichtung: "rechts" }); }
const buf = d.fertig();
const text = buf.toString("latin1");

pruefe("beginnt mit %PDF-1.4", text.startsWith("%PDF-1.4\n"));
pruefe("Binaerkennung in Zeile 2", buf[9] === 0x25 && buf[10] >= 0x80);
pruefe("endet mit %%EOF", /%%EOF\s*$/.test(text));
pruefe("drei Seiten im Seitenbaum", /\/Type \/Pages [^>]*\/Count 3/.test(text));
pruefe("Helvetica und Helvetica-Bold mit WinAnsiEncoding", /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(text) && /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/.test(text));
pruefe("Titel als UTF-16 (BOM FEFF) im Info-Woerterbuch", /\/Title <FEFF[0-9A-F]+>/.test(text));

// xref nachrechnen: startxref zeigt auf "xref", jede Adresse auf "N 0 obj".
const start = Number((text.match(/startxref\n(\d+)\n%%EOF/) || [])[1]);
pruefe("startxref ist eine Zahl", Number.isFinite(start), String(start));
pruefe("startxref zeigt auf die xref-Tabelle", text.slice(start, start + 4) === "xref");
const xrefKopf = text.slice(start).match(/^xref\n0 (\d+)\n/);
const anzahl = xrefKopf ? Number(xrefKopf[1]) : 0;
pruefe("xref zaehlt Objekte + 1", anzahl > 3, String(anzahl));
const eintraege = text.slice(start + (xrefKopf ? xrefKopf[0].length : 0)).match(/^\d{10} \d{5} [nf] $/gm) || [];
pruefe("xref hat genau so viele Eintraege wie angekuendigt", eintraege.length === anzahl, `${eintraege.length} von ${anzahl}`);
let alleTreffen = eintraege.length > 1;
eintraege.forEach((z, i) => {
  if (i === 0) return; // 0000000000 65535 f
  const adr = Number(z.slice(0, 10));
  const kopf = text.slice(adr, adr + 20);
  if (!kopf.startsWith(`${i} 0 obj\n`)) { alleTreffen = false; console.log(`   Objekt ${i}: bei ${adr} steht "${kopf.split("\n")[0]}"`); }
});
pruefe("jede xref-Adresse zeigt auf 'N 0 obj'", alleTreffen);
pruefe("/Size im Trailer = Anzahl", new RegExp(`/Size ${anzahl} `).test(text));

// Inhalt: entpackt, mit den Texten drin
const inhalte = stroeme(buf);
pruefe("drei Inhaltsstroeme (einer je Seite)", inhalte.length === 3, String(inhalte.length));
pruefe("Umlaut-Text steht als WinAnsi-Oktalfolge im Strom", /\\334berschrift/.test(inhalte[0]) && /Gr\\366\\337e/.test(inhalte[0]));
pruefe("Euro-Zeichen ist \\200 (0x80)", /\\200/.test(inhalte[0]));
pruefe("Fettschrift nutzt /F2, Normalschrift /F1", /\/F2 14 Tf/.test(inhalte[0]) && /\/F1 10 Tf/.test(inhalte[0]));
pruefe("Klammern im Text sind maskiert", /\\\(GEO/.test(inhalte[0]));
pruefe("Linie und Rechteck sind im Strom", / l S/.test(inhalte[0]) && / re B/.test(inhalte[0]));
pruefe("Seitenzahl steht auf Seite 3", /Seite 3 von 3/.test(inhalte[2]));

// Unkomprimiert: derselbe Inhalt lesbar
const roh = pdf.neu({ komprimieren: false });
roh.text(50, 50, "Klartext");
const rohText = roh.fertig().toString("latin1");
pruefe("ohne Kompression steht der Text im Klartext", /\(Klartext\) Tj/.test(rohText) && !/FlateDecode/.test(rohText));

// Leeres Dokument: trotzdem eine gueltige Seite
const leer = pdf.neu().fertig().toString("latin1");
pruefe("leeres Dokument hat eine Seite", /\/Count 1/.test(leer));

// Rechtsbuendig: Text endet am angegebenen Rand
const rb = pdf.neu({ komprimieren: false });
rb.text(500, 50, "Ende", { ausrichtung: "rechts" });
const rbX = Number((rb.fertig().toString("latin1").match(/1 0 0 1 ([\d.]+) [\d.]+ Tm \(Ende\)/) || [])[1]);
pruefe("rechtsbuendiger Text beginnt bei Rand minus Breite", Math.abs(rbX + pdf.textBreite("Ende", 10) - 500) < 0.02, String(rbX));

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
process.exit(fehler ? 1 : 0);
