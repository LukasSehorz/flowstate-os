// Testet, was von einer WhatsApp im Verlauf ankommt — je Nachrichtenart.
//
// Warum es diesen Test gibt (Lukas, 27.07.): Er zeigte auf eine Nachricht von
// 19:17 — ein PDF, "Fragenkatalog Testimonial (KI Beratung).pdf" — und fragte,
// warum sie nicht auftaucht. Im Verlauf standen dazu NULL Eintraege.
//
// textAus() kannte nur vier Faelle: reinen Text, den Text einer zitierten
// Nachricht und die Bildunterschrift von Bild und Video. Bei allem anderen kam
// ein leerer String zurueck — und verlaufSpeichern() verwirft leere
// Nachrichten. Ein PDF ohne Bildunterschrift, eine Sprachnachricht, ein Foto
// ohne Text: alles unsichtbar. Nicht falsch vorgelesen, sondern gar nicht da.
//
// Das traf auch den Ungelesen-Zaehler: WhatsApp meldet eine ungelesene
// Nachricht, im Verlauf steht dazu nichts, und die Antwort bleibt leer.
//
// Aufruf: node scripts/test-wa-arten.js

const fs = require("fs");
const path = require("path");

// textAus() aus der Bruecke holen, ohne die ganze Bruecke zu starten (die
// wuerde sich mit WhatsApp verbinden wollen).
const quelle = fs.readFileSync(path.join(__dirname, "..", "whatsapp-bridge", "index.js"), "utf-8");
const anfang = quelle.indexOf("function textAus(m) {");
if (anfang < 0) { console.log("❌ textAus() nicht gefunden — Aufbau der Bruecke geaendert?"); process.exit(1); }
// Bis zur schliessenden Klammer am Zeilenanfang.
const ende = quelle.indexOf("\n}", anfang);
const textAus = new Function("m", quelle.slice(anfang, ende + 2).replace("function textAus(m) {", "") .replace(/\}\s*$/, "") );

let fehler = 0;
function pruefe(name, wahr, bekommen) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr ? "" : `   bekommen: "${bekommen}"`));
  if (!wahr) fehler++;
}
const wrap = (message) => ({ key: { remoteJid: "x@s.whatsapp.net" }, message });

// --- Die Faelle, die schon immer gingen -----------------------------------
pruefe("Reiner Text", textAus(wrap({ conversation: "Hallo" })) === "Hallo");
pruefe("Antwort auf eine Nachricht",
  textAus(wrap({ extendedTextMessage: { text: "Ja passt" } })) === "Ja passt");
pruefe("Bild mit Bildunterschrift",
  textAus(wrap({ imageMessage: { caption: "Schau mal" } })) === "[Bild] Schau mal");

// --- Genau der Fall von Lukas (PDF ohne Bildunterschrift) -----------------
const pdf = textAus(wrap({ documentMessage: { fileName: "Fragenkatalog Testimonial (KI Beratung) 04:26.pdf" } }));
pruefe("PDF ist ueberhaupt sichtbar", pdf.length > 0, pdf);
pruefe("PDF nennt den Dateinamen", /Fragenkatalog Testimonial/.test(pdf), pdf);

// --- Alles Weitere, das vorher unsichtbar war ------------------------------
pruefe("Sprachnachricht mit Dauer",
  textAus(wrap({ audioMessage: { ptt: true, seconds: 34 } })) === "[Sprachnachricht 0:34]",
  textAus(wrap({ audioMessage: { ptt: true, seconds: 34 } })));
pruefe("Bild OHNE Bildunterschrift", textAus(wrap({ imageMessage: {} })) === "[Bild]");
pruefe("Video OHNE Bildunterschrift", textAus(wrap({ videoMessage: {} })) === "[Video]");
pruefe("Sticker", textAus(wrap({ stickerMessage: {} })) === "[Sticker]");
pruefe("Geteilter Kontakt nennt den Namen",
  /Mary/.test(textAus(wrap({ contactMessage: { displayName: "Mary" } }))));
pruefe("Standort", textAus(wrap({ locationMessage: {} })) === "[Standort]");
pruefe("Umfrage nennt die Frage",
  /Wann treffen wir uns/.test(textAus(wrap({ pollCreationMessage: { name: "Wann treffen wir uns" } }))));

// --- Huellen: verschwindende und einmalig sichtbare Nachrichten ------------
//
// Ohne Auspacken ist ALLES darin unsichtbar — auch reiner Text.
pruefe("Verschwindende Nachricht wird ausgepackt",
  textAus(wrap({ ephemeralMessage: { message: { conversation: "Geheim" } } })) === "Geheim");
pruefe("Einmalig sichtbare Nachricht wird ausgepackt",
  textAus(wrap({ viewOnceMessageV2: { message: { imageMessage: { caption: "Nur einmal" } } } })) === "[Bild] Nur einmal");
pruefe("Dokument in der Huelle wird ausgepackt",
  /Angebot\.pdf/.test(textAus(wrap({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "Angebot.pdf" } } } }))));

// --- Was NICHT in den Verlauf gehoert --------------------------------------
pruefe("Reaktion (Daumen hoch) erzeugt keinen Eintrag",
  textAus(wrap({ reactionMessage: { text: "👍" } })) === "");
pruefe("Unbekannte Art erzeugt keinen Eintrag",
  textAus(wrap({ irgendwasNeues: {} })) === "");

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
