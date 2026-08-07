// Testet, WAS aus dem Postfach in die Buchhaltung darf — und was nicht.
//
// Der teuerste Fehler hier ist nicht eine uebersehene Rechnung. Es ist eine
// falsch eingeordnete: Beim ersten echten Lauf am 07.08. zog der Postfachlauf
// Lukas' EIGENE Rechnung an die Estera GmbH über 3.500 € in den Belegeingang —
// als Ausgabe. Eine gestellte Rechnung ist aber eine Forderung. In der falschen
// Spalte verschiebt sie das Ergebnis um den doppelten Betrag.
//
// Aufruf: node scripts/test-mail-belege.js

// Das Postfach wird ausgetauscht, BEVOR das Modul geladen wird: Es holt sich
// execFile beim Laden ab, ein spaeterer Austausch kaeme zu spaet.
let gestellteFrage = "";
let POSTFACH = [];
require("child_process").execFile = (befehl, args, opt, fertig) => {
  gestellteFrage = args.join(" ");
  fertig(null, JSON.stringify({ messages: { data: JSON.stringify(POSTFACH) } }), "");
};

const m = require("../lib/mail-belege.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// Der Test prueft den FILTER, nicht Google.
POSTFACH = [
  { id: "1", from: "Paddle <help@paddle.com>", subject: "Ihre Rechnung von Web3Forms" },
  { id: "2", from: "Google Payments <payments-noreply@google.com>", subject: "Google Workspace: Your invoice is available" },
  { id: "3", from: "united-domains <service@united-domains.de>", subject: "Ihre Rechnung von united-domains" },
  // Das ist die gefaehrliche: Lukas' eigene, gestellte Rechnung.
  { id: "4", from: "lukas sehorz <lukas.sehorz@flowstate-ai.net>", subject: "Rechnung CRM & Webseite" },
  { id: "5", from: "Jannik <jannikvomhofe@flowstate-ai.net>", subject: "Angebot Rechnung Entwurf" },
  // Kein Rechnungsbezug — darf nicht mit.
  { id: "6", from: "Newsletter <news@irgendwas.de>", subject: "Unsere Neuigkeiten im August" },
  { id: "7", from: "Kunde <info@mueller.de>", subject: "Fotos vom Termin" },
];

(async () => {
  const treffer = await m.suchen(2);
  const ids = treffer.map((t) => t.id);

  // --- Was rein muss ---------------------------------------------------------
  pruefe("Paddle-Rechnung kommt durch", ids.includes("1"));
  pruefe("Google-Rechnung kommt durch", ids.includes("2"));
  pruefe("united-domains-Rechnung kommt durch", ids.includes("3"));

  // --- Was DRAUSSEN bleiben muss --------------------------------------------
  pruefe("Lukas' eigene gestellte Rechnung bleibt draußen", !ids.includes("4"),
    "Sie ist eine Forderung, keine Ausgabe — im Belegeingang verschiebt sie das Ergebnis um den doppelten Betrag.");
  pruefe("Auch Janniks Mail von der Firmenadresse bleibt draußen", !ids.includes("5"));
  pruefe("Newsletter ohne Rechnungsbezug bleibt draußen", !ids.includes("6"));
  pruefe("Mail ohne Rechnungsbezug bleibt draußen", !ids.includes("7"));

  pruefe("Genau drei bleiben übrig", treffer.length === 3, ids.join(","));

  // --- Die Suchanfrage selbst -----------------------------------------------
  //
  // Der Filter oben ist die zweite Schranke. Die erste steht in der Anfrage an
  // Gmail — faellt sie weg, laedt der Lauf jeden Newsletter mit Anhang herunter,
  // bevor er ihn wegwirft.
  pruefe("Nur Mails mit PDF-Anhang werden geholt", /has:attachment filename:pdf/.test(gestellteFrage));
  pruefe("Schon verarbeitete werden ausgeschlossen", /-label:Flowstate-verbucht/.test(gestellteFrage));
  pruefe("Selbst Verschicktes wird schon in der Anfrage ausgeschlossen",
    /-from:me/.test(gestellteFrage) && /-in:sent/.test(gestellteFrage), gestellteFrage);
  pruefe("Der Zeitraum steht drin", /newer_than:2d/.test(gestellteFrage));

  // --- Eigene Domaenen sind einstellbar -------------------------------------
  //
  // Kommt eine zweite Firmenadresse dazu, darf man dafuer nicht in den Code
  // greifen muessen.
  process.env.EIGENE_DOMAENEN = "flowstate-ai.net, sehorz.de";
  delete require.cache[require.resolve("../lib/mail-belege.js")];
  const m2 = require("../lib/mail-belege.js");
  POSTFACH.push({ id: "8", from: "Lukas <post@sehorz.de>", subject: "Rechnung Juli" });
  const t2 = await m2.suchen(2);
  pruefe("Eine zweite eigene Domäne lässt sich nachtragen", !t2.map((x) => x.id).includes("8"),
    t2.map((x) => x.id).join(","));

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
