// Flowstate Belegarchiv — Pruefsummen und Monatsordner.
//
// Zwei Aufgaben:
//
//   pruefsumme()   SHA-256 ueber eine Datei. Wird beim Eingang gebildet und nie
//                  wieder angefasst. Tauscht spaeter jemand die Datei aus,
//                  passt die Pruefsumme nicht mehr — der Tausch faellt auf.
//
//   zip()          Baut das ZIP fuer die Steuerberaterin. Bewusst von Hand und
//                  ohne Fremdpaket: das ZIP-Format ist an dieser Stelle simpel
//                  (eine Liste von Dateien, keine Ordnerrechte, keine
//                  Verschluesselung), und ein Paket weniger heisst eine
//                  Abhaengigkeit weniger in einem Pfad, der Steuerunterlagen
//                  ausliefert.
//
// Kein ZIP64 — dafuer muesste ein Monatsordner ueber 4 GB haben oder mehr als
// 65.535 Belege enthalten. Beides faengt zip() ab und meldet es klar, statt ein
// stilles halbes Archiv zu schreiben.

const crypto = require("crypto");
const zlib = require("zlib");

const SIG_LOKAL = 0x04034b50;
const SIG_ZENTRAL = 0x02014b50;
const SIG_ENDE = 0x06054b50;
const UTF8_FLAGGE = 0x0800; // Bit 11: Dateiname ist UTF-8 (Umlaute in Kundennamen)
const MAX_EINTRAEGE = 65535;
const MAX_GROESSE = 0xffffffff;

module.exports.pruefsumme = function (daten) {
  return crypto.createHash("sha256").update(daten).digest("hex");
};

// Pruefsumme ueber einen ganzen Export. Nicht ueber das ZIP selbst — darin
// stecken Zeitstempel, dasselbe ZIP zweimal gezogen waere also nie identisch.
// Stattdessen ueber die sortierte Liste "Laufnummer:Pruefsumme". Die ist stabil:
// derselbe Monat ergibt immer denselben Wert, egal wann man ihn zieht.
module.exports.exportPruefsumme = function (belege) {
  const zeilen = belege
    .map((b) => `${b.laufnummer}:${b.pruefsumme || ""}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(zeilen, "utf8").digest("hex");
};

// Dateinamen fuer die Ablage entschaerfen: keine Pfadtrenner, keine
// Steuerzeichen, nichts, was auf einem anderen Rechner einen Ordner aufmacht.
module.exports.dateinameSicher = function (name, ersatz = "beleg") {
  const rein = String(name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .replace(/^\.+/, "")
    .replace(/[<>:"|?*]/g, "-")
    .trim();
  return rein.slice(0, 150) || ersatz;
};

// Fuer einen Pfad IM Archiv, z. B. "Belege/0008 Shell.pdf".
// Jeder Teil wird einzeln entschaerft, die Schraegstriche bleiben — sonst waere
// der Unterordner Teil des Dateinamens statt ein Ordner. Weil dateinameSicher
// fuehrende Punkte entfernt, ueberlebt ".." keinen Teil: es wird vorher
// herausgefiltert. Ein Ausbrechen aus dem Archiv ist so nicht moeglich.
module.exports.pfadSicher = function (pfad, ersatz = "beleg") {
  const teile = String(pfad || "")
    .split("/")
    .filter((t) => t !== "" && t !== "." && t !== "..")
    .map((t) => module.exports.dateinameSicher(t, ersatz));
  return teile.length ? teile.join("/") : ersatz;
};

// --- ZIP ---------------------------------------------------------------------

// DOS-Zeitformat. Sekunden haben nur 5 Bit, darum die Halbierung — das ZIP-
// Format kennt keine ungeraden Sekunden.
function dosZeit(d) {
  const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const jahr = Math.max(1980, d.getFullYear());
  const datum = ((jahr - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { zeit, datum };
}

// eintraege: [{ name, daten }]  ->  Buffer mit dem fertigen ZIP
module.exports.zip = function (eintraege, stand = new Date()) {
  if (eintraege.length > MAX_EINTRAEGE) {
    throw new Error(`Ein ZIP fasst maximal ${MAX_EINTRAEGE} Dateien, hier sind es ${eintraege.length}.`);
  }
  const { zeit, datum } = dosZeit(stand);
  const teile = [];
  const zentral = [];
  let versatz = 0;
  const vergeben = new Set();

  for (const e of eintraege) {
    // Gleiche Namen wuerden sich im Archiv gegenseitig ueberschreiben, ohne dass
    // es jemand merkt. Darum durchzaehlen: "Bon.pdf", "Bon (2).pdf", ...
    let name = module.exports.pfadSicher(e.name);
    if (vergeben.has(name)) {
      const punkt = name.lastIndexOf(".");
      // Nur im letzten Namensteil zaehlen, damit aus "Belege/x.pdf" nicht
      // "Belege (2)/x.pdf" wird — das waere ein zweiter Ordner.
      const nachSchraeg = name.lastIndexOf("/");
      const hatEndung = punkt > nachSchraeg;
      const stamm = hatEndung ? name.slice(0, punkt) : name;
      const endung = hatEndung ? name.slice(punkt) : "";
      let n = 2;
      while (vergeben.has(`${stamm} (${n})${endung}`)) n++;
      name = `${stamm} (${n})${endung}`;
    }
    vergeben.add(name);

    const roh = Buffer.isBuffer(e.daten) ? e.daten : Buffer.from(String(e.daten), "utf8");
    const gepackt = zlib.deflateRawSync(roh, { level: 6 });
    const crc = zlib.crc32(roh);
    const nameB = Buffer.from(name, "utf8");

    if (roh.length > MAX_GROESSE || gepackt.length > MAX_GROESSE) {
      throw new Error(`"${name}" ist zu groß für ein einfaches ZIP (über 4 GB).`);
    }

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(SIG_LOKAL, 0);
    kopf.writeUInt16LE(20, 4);            // benoetigte Version
    kopf.writeUInt16LE(UTF8_FLAGGE, 6);
    kopf.writeUInt16LE(8, 8);             // Verfahren: deflate
    kopf.writeUInt16LE(zeit, 10);
    kopf.writeUInt16LE(datum, 12);
    kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(gepackt.length, 18);
    kopf.writeUInt32LE(roh.length, 22);
    kopf.writeUInt16LE(nameB.length, 26);
    kopf.writeUInt16LE(0, 28);            // kein Extra-Feld
    teile.push(kopf, nameB, gepackt);

    const zk = Buffer.alloc(46);
    zk.writeUInt32LE(SIG_ZENTRAL, 0);
    zk.writeUInt16LE(20, 4);              // erzeugt von
    zk.writeUInt16LE(20, 6);              // benoetigte Version
    zk.writeUInt16LE(UTF8_FLAGGE, 8);
    zk.writeUInt16LE(8, 10);
    zk.writeUInt16LE(zeit, 12);
    zk.writeUInt16LE(datum, 14);
    zk.writeUInt32LE(crc, 16);
    zk.writeUInt32LE(gepackt.length, 20);
    zk.writeUInt32LE(roh.length, 24);
    zk.writeUInt16LE(nameB.length, 28);
    zk.writeUInt16LE(0, 30);              // Extra
    zk.writeUInt16LE(0, 32);              // Kommentar
    zk.writeUInt16LE(0, 34);              // Datentraeger
    zk.writeUInt16LE(0, 36);              // interne Attribute
    zk.writeUInt32LE(0, 38);              // externe Attribute
    zk.writeUInt32LE(versatz, 42);        // wo der lokale Kopf liegt
    zentral.push(zk, nameB);

    versatz += kopf.length + nameB.length + gepackt.length;
  }

  const zentralBuf = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(SIG_ENDE, 0);
  ende.writeUInt16LE(0, 4);
  ende.writeUInt16LE(0, 6);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(zentralBuf.length, 12);
  ende.writeUInt32LE(versatz, 16);
  ende.writeUInt16LE(0, 20);

  return Buffer.concat([...teile, zentralBuf, ende]);
};

// --- Uebersichtsliste --------------------------------------------------------

// CSV mit Semikolon und BOM — so oeffnet Excel die Datei auf einem deutschen
// System direkt richtig, ohne Importdialog. Ohne BOM landen Umlaute als Kraut.
module.exports.csv = function (zeilen, spalten) {
  const feld = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const kopf = spalten.map((s) => feld(s.titel)).join(";");
  const rest = zeilen.map((z) => spalten.map((s) => feld(s.wert(z))).join(";"));
  return "\uFEFF" + [kopf, ...rest].join("\r\n") + "\r\n";
};

// Betrag deutsch: 1234.5 -> "1.234,50". Fuer die CSV, damit Excel rechnen kann.
module.exports.betragDe = function (n) {
  const z = Number(n);
  if (!Number.isFinite(z)) return "";
  const [ganz, dez] = z.toFixed(2).split(".");
  return ganz.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dez;
};
