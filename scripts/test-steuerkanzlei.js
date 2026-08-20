// Prueft das Kanzlei-Feld in der Buchhaltung — gegen die ECHTE Datenbank.
//
// WARUM GEGEN DIE ECHTE (20.08.2026): Was hier geprueft wird, ist genau das,
// was eine Attrappe nicht zeigen wuerde — ob die vier Spalten aus Migration
// 0055 da sind, ob das UPDATE durch die Zeilenrechte kommt und ob ein zweites
// Formular (Kontostand) die Kanzlei nicht mit leeren Feldern ueberschreibt.
// Ein Test mit gefaelschter Datenbank haette all das bestanden und trotzdem
// nichts gesagt.
//
// SCHREIBT UND RAEUMT AUF: Der bestehende Inhalt der vier Spalten wird zu
// Beginn gesichert und am Ende Wort fuer Wort zurueckgeschrieben — auch wenn
// unterwegs etwas schiefgeht. Sonst stuende nach dem Test eine erfundene
// Kanzlei in der Buchhaltung, und Alexandra schickte den naechsten Monatsordner
// an "meier@beispiel-kanzlei.de".
//
// DER DATENBANK-TEIL IST ZUGESCHALTET, nicht Standard. Die .env im Arbeitsordner
// zeigt auf die ECHTE Datenbank — ohne diesen Schalter wuerde jedes
// "node scripts/pruefen.js" die Finanz-Einstellungen der Firma beschreiben und
// wieder zuruecksetzen. Das geht gut, bis es einmal nicht gut geht.
//
// Die Pruefung der Mailadressen laeuft immer mit: sie ist reine Rechnerei.
//
//   node scripts/test-steuerkanzlei.js                  nur die Mailpruefung
//   KANZLEI_TEST_DB=1 node scripts/test-steuerkanzlei.js  mit Datenbank
//   docker exec -w /app -e KANZLEI_TEST_DB=1 flowstate-dashboard node scripts/test-steuerkanzlei.js

process.env.ADS_PROBE = "1";            // hier geht ohnehin nichts raus — doppelt haelt

const fs = require("fs");
const path = require("path");

const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

const buch = require("../lib/buchhaltung.js");

// -------------------------------------------------------- Die Mailpruefung
// Reine Rechnerei, laeuft ohne Datenbank.
console.log("— Was als Mailadresse durchgeht —");
for (const [wert, soll] of [
  ["meier@kanzlei-beispiel.de", true],
  ["Vor.Name@kanzlei.co.uk", true],
  ["meier@kanzlei", false],            // kein Punkt danach
  ["meierkanzlei.de", false],          // kein @
  ["meier@.de", false],                // eine Domain faengt nicht mit einem Punkt an
  ["", false],
  ["  ", false],
  ["zwei@adressen.de, drei@vier.de", false],
]) {
  const ist = buch.mailGueltig(wert);
  melde(ist === soll, `"${wert}" -> ${ist ? "gültig" : "abgelehnt"}`);
}

if (process.env.KANZLEI_TEST_DB !== "1" || !process.env.DATABASE_URL) {
  console.log(process.env.KANZLEI_TEST_DB === "1"
    ? "\nKeine DATABASE_URL — der Datenbank-Teil braucht sie. Übersprungen."
    : "\n(Datenbank-Teil übersprungen — KANZLEI_TEST_DB=1 schaltet ihn zu.)");
  console.log(`\n${fehler ? "❌" : "✅"} ${fehler ? fehler + " Fehler" : "alles grün"}`);
  process.exit(fehler ? 1 : 0);
}

const crm = require("../lib/crm.js");

(async () => {
  const { rows: [chef] } = await crm.system(
    `select id, name from profiles where aktiv and rolle = 'admin' order by name limit 1`);
  if (!chef) { melde(false, "kein Admin-Profil in der Datenbank gefunden"); process.exit(1); }
  console.log(`\n— Gegen die Datenbank, als ${chef.name} —`);

  // Sicherung. Ab hier MUSS aufgeraeumt werden.
  const vorher = await buch.einstellungen(chef);
  const sicherung = {
    steuer_anrede: vorher.steuer_anrede, steuer_name: vorher.steuer_name,
    steuer_mail: vorher.steuer_mail, steuer_notiz: vorher.steuer_notiz,
    start_saldo: vorher.start_saldo, steuersatz: vorher.steuersatz,
  };
  console.log("   gesichert: " + JSON.stringify(sicherung));

  try {
    // 1. Eintragen und wiederfinden.
    const r1 = await buch.einstellungenSetzen(chef, {
      steuer_anrede: "Frau", steuer_name: "Meier",
      steuer_mail: "meier@testkanzlei-flowstate.de",
      steuer_notiz: "Kanzlei Meier & Partner, Musterweg 1, Mandant 4711",
    });
    melde(r1.ok, "gespeichert" + (r1.ok ? "" : " — " + r1.grund));

    const k1 = await buch.steuerkanzlei(chef);
    melde(k1.an === "meier@testkanzlei-flowstate.de", "Adresse kommt zurück: " + k1.an);
    melde(k1.name === "Frau Meier", "Anrede und Name ergeben den gesprochenen Namen: " + k1.name);
    melde(k1.reinerName === "Meier", "der reine Name bleibt getrennt verfügbar");
    melde(/Mandant 4711/.test(k1.notiz), "die Notiz steht drin");

    // 2. Eine kaputte Adresse darf die gute NICHT ersetzen. Das ist der Punkt,
    //    an dem es sonst still schiefginge: gespeichert, aber unzustellbar.
    const r2 = await buch.einstellungenSetzen(chef, {
      steuer_anrede: "Frau", steuer_name: "Meier-Schmidt",
      steuer_mail: "meier(at)kanzlei", steuer_notiz: "geändert",
    });
    melde(r2.ok === false && r2.grund === "mail", "kaputte Adresse wird abgelehnt: " + JSON.stringify(r2));
    const k2 = await buch.steuerkanzlei(chef);
    melde(k2.an === "meier@testkanzlei-flowstate.de", "die alte Adresse steht noch: " + k2.an);
    melde(k2.reinerName === "Meier-Schmidt", "Name und Notiz wurden trotzdem übernommen");

    // 3. Das Kontostand-Formular darf die Kanzlei nicht leerräumen. Es schickt
    //    die vier Felder gar nicht mit — genau daran haengt es.
    await buch.einstellungenSetzen(chef, { start_saldo: "1234,56", steuersatz: "30" });
    const k3 = await buch.steuerkanzlei(chef);
    melde(k3.an === "meier@testkanzlei-flowstate.de" && k3.reinerName === "Meier-Schmidt",
      "nach dem Speichern des Kontostands steht die Kanzlei unverändert da");

    // 4. Leeres Feld = keine Adresse. Dann fragt Alexandra nach, statt zu raten.
    await buch.einstellungenSetzen(chef, {
      steuer_anrede: "", steuer_name: "", steuer_mail: "", steuer_notiz: "",
    });
    const k4 = await buch.steuerkanzlei(chef);
    melde(k4.an === "" && k4.name === "", "leer geräumt: kein Empfänger, kein Name");

    const sv = require("../lib/steuer-versand.js");
    // Die anderen Quellen stilllegen, sonst prueft dieser Fall nur, welche
    // Adresse sonst noch irgendwo im Container herumliegt.
    delete process.env.STEUER_MAIL;
    const kontakte = require("../lib/kontakte.js");
    const echt = kontakte.alle; kontakte.alle = () => [];
    const wer = await sv.empfaengerinFinden(chef);
    kontakte.alle = echt;
    melde(wer === null, "ohne gepflegte Kanzlei findet der Versand niemanden — und fragt nach");

    // 5. Anrede ist eine Auswahl, kein Freitext.
    await buch.einstellungenSetzen(chef, {
      steuer_anrede: "Sehr geehrte Damen und Herren", steuer_name: "Meier",
      steuer_mail: "meier@testkanzlei-flowstate.de", steuer_notiz: "",
    });
    const k5 = await buch.steuerkanzlei(chef);
    melde(k5.anrede === "" && k5.name === "Meier",
      "Freitext in der Anrede wird verworfen, der Name bleibt: " + JSON.stringify([k5.anrede, k5.name]));
  } finally {
    // Zurueckschreiben. Auch nach einem Fehler oben — hier hängt dran, an wen
    // der naechste Monatsordner geht.
    await buch.einstellungenSetzen(chef, {
      steuer_anrede: sicherung.steuer_anrede, steuer_name: sicherung.steuer_name,
      steuer_mail: sicherung.steuer_mail, steuer_notiz: sicherung.steuer_notiz,
      start_saldo: String(sicherung.start_saldo).replace(".", ","),
      steuersatz: String(sicherung.steuersatz).replace(".", ","),
    });
    const nach = await buch.einstellungen(chef);
    melde(nach.steuer_mail === sicherung.steuer_mail
      && nach.steuer_name === sicherung.steuer_name
      && nach.steuer_anrede === sicherung.steuer_anrede
      && Number(nach.start_saldo) === Number(sicherung.start_saldo),
      "aufgeräumt — der Ausgangszustand steht wieder da: " + JSON.stringify({
        anrede: nach.steuer_anrede, name: nach.steuer_name, mail: nach.steuer_mail,
        saldo: nach.start_saldo }));
    await crm.pool?.end?.().catch(() => {});
  }

  console.log(`\n${fehler ? "❌" : "✅"} ${fehler ? fehler + " Fehler" : "alles grün"}`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("Testlauf gescheitert:", e); process.exit(1); });
