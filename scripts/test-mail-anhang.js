// Beweist, dass der Mailzugang wirklich mit Anhang senden kann.
//
// Warum als eigener Test: Beim Rechnungsversand steht die Annahme "gmail.modify
// deckt das Senden mit ab" zwischen Lukas und einem Kunden. Angenommen ist sie
// schnell — nachgewiesen wird sie hier.
//
// Es wird NICHTS verschickt. Der Test legt einen ENTWURF mit Anhang an und
// loescht ihn sofort wieder. Das laeuft ueber denselben Zugang, dieselbe
// MIME-Zusammensetzung und dieselbe Berechtigung wie das echte Senden — nur
// ohne Empfaenger, der etwas davon merkt.
//
// Aufruf (nur auf dem Server sinnvoll, wo das Token liegt):
//   docker exec flowstate-dashboard node scripts/test-mail-anhang.js

const gmail = require("../lib/gmail-direkt.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// --- Was auch ohne Zugang prueffbar ist: die MIME-Zusammensetzung -----------
//
// Ein falsch zusammengesetzter Umschlag ist der wahrscheinlichste Fehler und
// braucht kein Netz, um ihn zu finden.
const roh = gmail.mimeBauen({
  an: "test@example.com",
  betreff: "Rechnung R-2026-131 – Müller & Sohn GmbH",
  text: "Guten Tag,\n\nanbei die Rechnung über 1.500,00 €.",
  absender: "Lukas Sehorz <lukas.sehorz@flowstate-ai.net>",
  anhaenge: [{ name: "131_Mueller_Sohn_Website.pdf", typ: "application/pdf", daten: Buffer.from("%PDF-1.4 test") }],
});
const klar = Buffer.from(roh.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

pruefe("Ergebnis ist base64url (kein +, / oder =)", !/[+/=]/.test(roh));
pruefe("Empfaenger steht drin", /^To: test@example\.com$/m.test(klar));
pruefe("Absender steht drin", /^From: .*flowstate-ai\.net/m.test(klar));
// Umlaute im Betreff MUESSEN kodiert sein — roh gesendet kommen sie als
// Buchstabensalat an, und das steht dann in der Mail an den Kunden.
pruefe("Betreff mit Umlaut ist kodiert", /^Subject: =\?UTF-8\?B\?/m.test(klar),
  (klar.match(/^Subject:.*/m) || [])[0]);
pruefe("Betreff dekodiert sich richtig zurück", (() => {
  const m = klar.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m);
  return m && Buffer.from(m[1], "base64").toString("utf-8") === "Rechnung R-2026-131 – Müller & Sohn GmbH";
})());
pruefe("Es ist ein mehrteiliger Umschlag", /Content-Type: multipart\/mixed; boundary="/.test(klar));
pruefe("Der Anhang haengt als Anhang dran", /Content-Disposition: attachment; filename="131_Mueller_Sohn_Website\.pdf"/.test(klar));
pruefe("Der Anhang ist als PDF ausgewiesen", /Content-Type: application\/pdf/.test(klar));
pruefe("Der Umschlag ist sauber geschlossen", /--flowstate-[0-9a-f]+-teil--\s*$/.test(klar.trim()));
// Zeilen ueber 998 Zeichen sind in Mails unzulaessig — manche Server
// zerschneiden sie, und dann ist der Anhang kaputt.
pruefe("Keine Zeile laenger als 998 Zeichen", klar.split("\r\n").every((z) => z.length <= 998),
  `laengste: ${Math.max(...klar.split("\r\n").map((z) => z.length))}`);

// Der Anhang muss sich unversehrt zurueckholen lassen.
pruefe("Der Anhang kommt unversehrt wieder heraus", (() => {
  const teile = klar.split(/--flowstate-[0-9a-f]+-teil/);
  const anh = teile.find((t) => /application\/pdf/.test(t));
  const b64 = (anh || "").split("\r\n\r\n")[1] || "";
  return Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf-8") === "%PDF-1.4 test";
})());

// --- Und jetzt der echte Zugang -------------------------------------------
(async () => {
  if (!gmail.bereit()) {
    console.log("\n⏭  Kein Google-Zugang hinterlegt — der Teil mit dem echten Postfach entfällt.");
    console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle prüfbaren Fälle bestanden.");
    process.exit(fehler ? 1 : 0);
  }

  let id = null;
  try {
    const e = await gmail.entwurf({
      an: "lukas.sehorz@flowstate-ai.net",
      betreff: "Selbsttest Flowstate – bitte ignorieren",
      text: "Dieser Entwurf prüft, ob der Mailzugang Anhänge verschicken darf. Er wird sofort wieder gelöscht.",
      anhaenge: [{ name: "test.pdf", typ: "application/pdf", daten: Buffer.from("%PDF-1.4 test") }],
    });
    id = e.id;
    pruefe("Der Zugang darf mit Anhang senden (Entwurf angelegt)", Boolean(id));
  } catch (e) {
    // Genau hier wuerde sich zeigen, dass gmail.modify NICHT reicht.
    pruefe("Der Zugang darf mit Anhang senden", false, String(e.message).slice(0, 200));
  }

  if (id) {
    const weg = await gmail.entwurfLoeschen(id).catch(() => false);
    pruefe("Der Testentwurf ist wieder weg", weg, "Bitte im Postfach unter Entwürfe nachsehen.");
  }

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
