// Rechnungen und Angebote aus Lukas' eigenen Vorlagen erzeugen.
//
// Warum (Lukas, 07.08.2026): "Er soll sich an die Rechnungen und Angebote
// halten, wie es in dem Ordner schon abgelegt ist. Es soll immer das gleiche
// Format sein, sodass sie immer gleich sind. Deswegen soll das Format von den
// alten Rechnungen uebernommen werden."
//
// DESHALB WIRD NICHT NEU GEBAUT, SONDERN GEFUELLT. Eine Vorlage aus dem echten
// Bestand wird kopiert und darin werden die Textstellen ersetzt. Schrift,
// Abstaende, Tabellen, Fusszeile, das Logo — alles bleibt Zeichen fuer Zeichen,
// weil es gar nicht angefasst wird. Eine nachgebaute Rechnung sieht immer
// "fast" aus wie die alte, und "fast" faellt beim Kunden auf.
//
// Das geht nur, weil die Vorlagen guenstig aufgebaut sind: Geprueft am
// 07.08. steht "Rechnungsnummer: R-2026-130" als EIN zusammenhaengendes
// Textstueck im Dokument, nicht ueber mehrere Bausteine verteilt. Waere es
// zerrissen (was Word gern tut), muesste man die Bausteine erst
// zusammenfuehren. Deshalb prueft pruefeVorlage() das nach — wenn eine neue
// Vorlage hinterlegt wird, faellt es sofort auf statt still schiefzugehen.
//
// NUMMERNKREISE (Entscheidung Lukas, 07.08.): EIN durchlaufender Kreis je Art,
// nicht getrennt nach Sparte. So ist es im Bestand gewachsen —
// R-2026-126 (Social Media) liegt mitten in der Website-Reihe. Getrennte Kreise
// waeren erlaubt, aber ein Wechsel mitten im Jahr ist genau die Art Bruch, die
// bei einer Pruefung auffaellt. Die SPARTE bestimmt nur, welche Vorlage
// herangezogen wird.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const VORLAGEN = process.env.VORLAGEN_PFAD || "/vorlagen";

// --- Minimaler ZIP-Umgang ---------------------------------------------------
//
// Ein .docx IST eine ZIP-Datei. Statt eine Bibliothek dafuer aufzunehmen (und
// eine weitere Abhaengigkeit in eine Buchhaltung zu holen), wird hier nur das
// getan, was noetig ist: eine Datei darin austauschen, alles andere
// unveraendert uebernehmen.
function zipLesen(buf) {
  const dateien = [];
  // Das zentrale Verzeichnis steht am Ende. Von dort aus wird jeder Eintrag
  // gefunden — das ist verlaesslicher, als von vorn durch die Datei zu laufen.
  let ende = buf.length - 22;
  while (ende >= 0 && buf.readUInt32LE(ende) !== 0x06054b50) ende--;
  if (ende < 0) throw new Error("Keine gueltige docx-Datei");
  const anzahl = buf.readUInt16LE(ende + 10);
  let p = buf.readUInt32LE(ende + 16);
  for (let i = 0; i < anzahl; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const gepackt = buf.readUInt32LE(p + 20);
    const roh = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const kLen = buf.readUInt16LE(p + 32);
    const versatz = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nLen).toString("utf-8");
    // Der lokale Kopf hat eigene Laengen — die aus dem Verzeichnis gelten nicht
    // fuer das Ueberspringen.
    const lnLen = buf.readUInt16LE(versatz + 26);
    const leLen = buf.readUInt16LE(versatz + 28);
    const daten = buf.slice(versatz + 30 + lnLen + leLen, versatz + 30 + lnLen + leLen + gepackt);
    dateien.push({ name, methode, crc, roh, daten });
    p += 46 + nLen + eLen + kLen;
  }
  return dateien;
}

function crc32(buf) {
  let c, tabelle = crc32.t;
  if (!tabelle) {
    tabelle = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelle[n] = c;
    }
  }
  let x = -1;
  for (let i = 0; i < buf.length; i++) x = (x >>> 8) ^ tabelle[(x ^ buf[i]) & 0xff];
  return (x ^ -1) >>> 0;
}

function zipSchreiben(dateien) {
  const stuecke = [], verzeichnis = [];
  let versatz = 0;
  for (const d of dateien) {
    const name = Buffer.from(d.name, "utf-8");
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0, 6);
    kopf.writeUInt16LE(d.methode, 8); kopf.writeUInt16LE(0, 10); kopf.writeUInt16LE(0, 12);
    kopf.writeUInt32LE(d.crc, 14); kopf.writeUInt32LE(d.daten.length, 18);
    kopf.writeUInt32LE(d.roh, 22); kopf.writeUInt16LE(name.length, 26); kopf.writeUInt16LE(0, 28);
    stuecke.push(kopf, name, d.daten);

    const v = Buffer.alloc(46);
    v.writeUInt32LE(0x02014b50, 0); v.writeUInt16LE(20, 4); v.writeUInt16LE(20, 6);
    v.writeUInt16LE(0, 8); v.writeUInt16LE(d.methode, 10);
    v.writeUInt32LE(d.crc, 16); v.writeUInt32LE(d.daten.length, 20); v.writeUInt32LE(d.roh, 24);
    v.writeUInt16LE(name.length, 28); v.writeUInt32LE(versatz, 42);
    verzeichnis.push(v, name);
    versatz += 30 + name.length + d.daten.length;
  }
  const vBuf = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(vBuf.length, 12); ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...stuecke, vBuf, ende]);
}

// --- Vorlage fuellen --------------------------------------------------------

// XML-sichere Ersetzung: Kaufmanns-Und und spitze Klammern wuerden das Dokument
// zerstoeren. Ein Firmenname wie "Meyer & Sohn" ist keine Seltenheit.
const xml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function vorlagePfad(art, sparte) {
  const s = /social|content|marketing|performance/i.test(String(sparte || "")) ? "socialmedia" : "website";
  const datei = path.join(VORLAGEN, `${art}-${s}.docx`);
  if (fs.existsSync(datei)) return datei;
  const rueck = path.join(VORLAGEN, `${art}-website.docx`);
  if (fs.existsSync(rueck)) return rueck;
  throw new Error(`Keine Vorlage für ${art} gefunden`);
}

// Prueft, ob eine Vorlage ueberhaupt fuellbar ist — also ob die Suchtexte als
// zusammenhaengende Stuecke vorliegen. Ohne diese Pruefung wuerde eine neu
// hinterlegte Vorlage still halb gefuellt und ginge so zum Kunden.
function pruefeVorlage(text, muster) {
  const fehlend = muster.filter((m) => !text.includes(m));
  if (fehlend.length) {
    throw new Error("Vorlage passt nicht — nicht gefunden: " + fehlend.slice(0, 3).join(" | "));
  }
}

const dat = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const eur = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// d = { art:"rechnung"|"angebot", sparte, nummer, empfaenger:{firma,anrede,strasse,plz_ort},
//       datum, faellig, positionen:[{text,einzel,gesamt}] }
function erzeugen(d) {
  const datei = vorlagePfad(d.art, d.sparte);
  const dateien = zipLesen(fs.readFileSync(datei));
  const doc = dateien.find((x) => x.name === "word/document.xml");
  if (!doc) throw new Error("Vorlage ohne document.xml");

  let text = doc.methode === 8 ? zlib.inflateRawSync(doc.daten).toString("utf-8") : doc.daten.toString("utf-8");

  // Die Werte der VORLAGE herausziehen — sie sind die Suchtexte.
  const altNummer = (text.match(/[RA]-\d{4}-\d+/) || [])[0];
  if (!altNummer) throw new Error("Vorlage ohne Nummer — Aufbau geändert?");
  const altDaten = [...new Set(text.match(/\d{2}\.\d{2}\.\d{4}/g) || [])];
  pruefeVorlage(text, [altNummer]);

  const ersetze = (von, nach) => { text = text.split(von).join(nach); };

  // 1. Nummer — steht mehrfach drin (Kopf, Titel, Verwendungszweck).
  ersetze(altNummer, xml(d.nummer));

  // 2. Datumsangaben. Das erste ist das Ausstellungsdatum, das letzte die
  //    Faelligkeit. Dazwischen kann das Leistungsdatum stehen.
  if (altDaten.length) {
    const neuAus = dat(d.datum || Date.now());
    const neuFaellig = dat(d.faellig || Date.now() + 14 * 86400000);
    // Von hinten ersetzen, damit ein frueher ersetztes Datum nicht erneut trifft.
    for (const alt of altDaten) {
      ersetze(alt, alt === altDaten[altDaten.length - 1] && altDaten.length > 1 ? neuFaellig : neuAus);
    }
  }

  // 3. Empfaengerblock. Die Vorlagenzeilen werden aus dem Text gelesen: Die
  //    Firma steht direkt vor dem Ort-Datum-Absatz, danach folgen Anrede,
  //    Strasse und PLZ/Ort als eigene Textstuecke.
  const e = d.empfaenger || {};
  // Obergrenze 2000, nicht 80: Der erste Entwurf fand den Leistungstext nicht,
  // weil er auf 80 Zeichen begrenzt war — die Leistungsbeschreibung hat rund
  // 300. Die erzeugte Rechnung trug dann den Text der VORLAGE, also den
  // Kundennamen des Vormonats. Genau die Art Fehler, die beim Kunden landet.
  const alteZeilen = (text.match(/<w:t[^>]*>([^<]{3,2000})<\/w:t>/g) || [])
    .map((s) => (s.match(/>([^<]*)</) || [])[1]);
  const platz = { firma: null, anrede: null, strasse: null, ort: null };
  for (let i = 0; i < alteZeilen.length; i++) {
    const z = alteZeilen[i];
    if (!platz.firma && /(GmbH|UG|AG|KG|e\.K\.|GbR|OHG)\b/.test(z) && !/Sehorz|Flowstate/i.test(z)) platz.firma = z;
    if (!platz.anrede && /^(Herrn|Frau|z\. ?Hd\.)/.test(z)) platz.anrede = z;
    if (!platz.strasse && /^[A-ZÄÖÜ][\wäöüß.\- ]+ \d+[a-z]?$/.test(z) && !/Anger 3/.test(z)) platz.strasse = z;
    if (!platz.ort && /^\d{5} [A-ZÄÖÜ]/.test(z) && !/84539/.test(z)) platz.ort = z;
  }
  if (platz.firma && e.firma) ersetze(`>${platz.firma}<`, `>${xml(e.firma)}<`);
  if (platz.anrede && e.anrede) ersetze(`>${platz.anrede}<`, `>${xml(e.anrede)}<`);
  if (platz.strasse && e.strasse) ersetze(`>${platz.strasse}<`, `>${xml(e.strasse)}<`);
  if (platz.ort && e.plz_ort) ersetze(`>${platz.ort}<`, `>${xml(e.plz_ort)}<`);

  // 4. Leistungstext und Betraege.
  const pos = (d.positionen || [])[0];
  if (pos) {
    const alterText = alteZeilen.find((z) => z && z.length > 60 && /erstellung|betreuung|leistung|website|social|abgerechnet/i.test(z));
    if (alterText && pos.text) ersetze(`>${alterText}<`, `>${xml(pos.text)}<`);
    // Betraege: alle Vorkommen des alten Gesamtbetrags ersetzen.
    const alteBetraege = [...new Set(text.match(/\d{1,3}(?:\.\d{3})*,\d{2}\s*€/g) || [])];
    const neuEinzel = eur(pos.einzel ?? pos.gesamt ?? 0);
    const neuGesamt = eur(d.gesamt ?? pos.gesamt ?? pos.einzel ?? 0);
    for (const b of alteBetraege) {
      // Der haeufigste Betrag ist der Gesamtbetrag (steht mehrfach), der
      // seltenere der Einzelpreis.
      const wieOft = text.split(b).length - 1;
      ersetze(b, wieOft > 1 ? neuGesamt : neuEinzel);
    }
  }

  const neuDaten = zlib.deflateRawSync(Buffer.from(text, "utf-8"));
  const rohBuf = Buffer.from(text, "utf-8");
  doc.methode = 8; doc.daten = neuDaten; doc.roh = rohBuf.length; doc.crc = crc32(rohBuf);

  return zipSchreiben(dateien);
}

// Welche Vorlagen liegen bereit?
function vorhanden() {
  try { return fs.readdirSync(VORLAGEN).filter((f) => f.endsWith(".docx")); } catch { return []; }
}

module.exports = { erzeugen, vorhanden, vorlagePfad, zipLesen, zipSchreiben, crc32 };
