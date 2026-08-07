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
  const dash = async (pfad, body) => {
    gerufen.push(pfad);
    if (pfad.endsWith("/hochladen")) return { json: async () => hochladen ?? { ok: true, id: 7, laufnummer: 42 } };
    if (pfad.endsWith("/lesen")) return { json: async () => lesen ?? { ok: true, werte: { betrag: 119.99, datum: "2026-08-01", gegenstelle: "Hetzner", kategorie: "Hosting" } } };
    if (pfad.endsWith("/buchen")) return buchen ?? { status: 302, headers: { get: () => "/buchhaltung?gebucht=7" } };
    return { json: async () => ({}) };
  };
  return {
    gesagt, gerufen, dash,
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

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
