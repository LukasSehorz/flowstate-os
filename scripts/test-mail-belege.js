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
  // Seit 18.09.2026 ist das angeschlossene Postfach lukas.sehorz@svhconsult.de —
  // eine Weiterleitung von Jannik aus derselben Domaene ist ebenfalls keine Ausgabe.
  { id: "9", from: "Jannik vom Hofe <jannikvomhofe@svhconsult.de>", subject: "Fwd: Rechnung an Kunde Müller" },
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
  pruefe("svhconsult.de zählt ohne Einstellung als eigene Domäne", !ids.includes("9"),
    "DIENST_KONTO ist lukas.sehorz@svhconsult.de — eine eigene Rechnung von dort darf keine Ausgabe werden.");
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

  // --- Rueckschau und Dateiname (18.09.2026) --------------------------------
  //
  // "Alle Rechnungen, die wir bis jetzt bekommen haben": Die Anfrage bekommt
  // ein festes Startdatum statt "letzte N Tage", und ein PDF, das selbst
  // "Rechnung" heisst, zaehlt auch dann, wenn der Betreff nur "Ihre Bestellung" sagt.
  const frage = m2.frageBauen({ seit: "2026-07-26" });
  pruefe("Rückschau fragt ab einem festen Tag", /after:2026\/07\/26/.test(frage) && !/newer_than/.test(frage), frage);
  pruefe("Ein kaputtes Datum fällt auf die Tagesregel zurück", /newer_than:2d/.test(m2.frageBauen({ seit: "gestern", tage: 2 })));
  for (const [name, soll] of [
    ["Rechnung_4711.pdf", true], ["invoice-2026-08.PDF", true], ["Receipt 123.pdf", true],
    ["Angebot_Webseite.pdf", false], ["Vertrag.pdf", false], ["Rechnung.docx", false], ["", false],
  ]) pruefe(`Dateiname ${JSON.stringify(name)} -> ${soll ? "Rechnung" : "keine"}`, m2.passtDateiname(name) === soll);

  const k = await m.kandidaten({ suchen: async () => [
    { id: "a", from: "Shop <shop@laden.de>", subject: "Ihre Bestellung 4711" },
    { id: "b", from: "Paddle <help@paddle.com>", subject: "Ihre Rechnung" },
    { id: "c", from: "Lukas <lukas.sehorz@svhconsult.de>", subject: "Ihre Bestellung" },
  ] }, { seit: "2026-07-26" });
  pruefe("Sichere Treffer und unklare (nur PDF dabei) werden getrennt",
    k.sicher.map((x) => x.id).join() === "b" && k.unklar.map((x) => x.id).join() === "a", JSON.stringify(k));
  pruefe("Eigene Absender landen auch nicht bei den unklaren", !k.unklar.some((x) => x.id === "c"));
  pruefe("Rückschau holt mehr Mails als der Tageslauf", m2.MAX_RUECKSCHAU > m2.MAX_TAEGLICH);

  // --- Nur bestimmte Absender (Hotmail, 18.09.2026) -------------------------
  //
  // Ein privates Postfach liefert nur, was von gelisteten Absendern kommt —
  // und die brauchen kein "Rechnung" im Betreff, ein PDF genuegt.
  const h = await m.kandidaten({ erlaubt: ["amazon.de", "billing@hetzner.com"], suchen: async () => [
    { id: "x", from: "Amazon.de <bestellung@amazon.de>", subject: "Ihre Bestellung" },
    { id: "y", from: "Hetzner <billing@hetzner.com>", subject: "Invoice 2026-08" },
    { id: "z", from: "Zalando <news@zalando.de>", subject: "Rechnung zu Ihrer Bestellung" },
  ] }, { tage: 30 });
  pruefe("Absenderliste: nur Gelistete, und die gelten als sicher",
    h.sicher.map((x) => x.id).join() === "x,y" && h.unklar.length === 0, JSON.stringify(h));
  pruefe("Ohne Liste bleibt alles beim Alten", m.absenderErlaubt({ from: "irgendwer@x.de" }, []) === true);

  // Die Rueckschau laeuft nur einmal gleichzeitig — und braucht ein Datum.
  pruefe("Rückschau ohne Datum wird abgewiesen", m2.rueckschauStarten({ dash: async () => ({}), seit: "" }).grund === "seit");

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
