// Prueft, dass eine abgelehnte Eingabe auf /buchhaltung SICHTBAR wird.
//
// WARUM (Fehler gefunden am 20.08.2026): Vier Endpunkte leiten bei einem
// Fehlschlag auf "/buchhaltung?fehler=…" um — und die Seite hat
// req.query.fehler NIRGENDS gelesen. Live gemessen waren /buchhaltung und
// /buchhaltung?fehler=mail byteidentisch.
//
// Der Fall: Lukas tippt "meier@kanzlei" ins Kanzlei-Feld. Die Adresse wird
// richtig abgelehnt und NICHT gespeichert, der Name schon. Der Dialog schliesst,
// die Seite sieht aus wie immer, kein Wort dazu.
//
// Geprueft wird beides:
//   1. die Zuordnung Code -> Satz (fehlerText), und
//   2. die echte Route mit einem echten express — mit Attrappen fuer alles,
//      was sonst an die Datenbank ginge. Nur so ist belegt, dass die SEITE die
//      Angabe liest und nicht bloss eine Tabelle danebenliegt.
//
//   node scripts/test-buchhaltung-fehler.js

const express = require("express");
const http = require("http");

const buch = require("../lib/buchhaltung.js");
const crm = require("../lib/crm.js");
const routen = require("../lib/buchhaltung-routes.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// ---------------------------------------------------- 1. Code -> Satz
console.log("— Welcher Satz zu welchem Fehler —");
pruefe("fehler=mail sagt, dass die Adresse nicht gespeichert wurde",
  /Die Adresse wurde nicht gespeichert/.test(routen.fehlerText("mail")));
pruefe("fehler=migration-fehlt nennt die Migration",
  /0055/.test(routen.fehlerText("migration-fehlt")));
pruefe("fehler=betrag nennt den Betrag",
  /Betrag/.test(routen.fehlerText("betrag")));
pruefe("fehler=kanzlei sagt, dass die Kanzlei nicht gespeichert wurde",
  /Steuerkanzlei wurde nicht gespeichert/.test(routen.fehlerText("kanzlei")));
// Ein unbekannter Code darf nicht stumm verschluckt werden — genau das war der
// ganze Fehler.
pruefe("ein unbekannter Code wird trotzdem gezeigt",
  /nicht geklappt/.test(routen.fehlerText("voellig-neuer-fall")));
pruefe("ohne Angabe kein Streifen", routen.fehlerText("") === "");

// ------------------------------------------------ 2. Die Seite selbst
// Alles, was an die Datenbank ginge, wird beiseitegelegt. Das Modul haelt eine
// Referenz auf DIESE Modulobjekte — ein Umbiegen hier wirkt also auch dort.
buch.uebersicht = async () => ({
  summe: { einnahmen: 0, ausgaben: 0, ergebnis: 0, anzahl_einnahmen: 0, anzahl_ausgaben: 0 },
  offen: [], offenSumme: 0, verlauf: [], kategorien: [], letzte: [], belege: [],
});
buch.belegeOffen = async () => [];
buch.kontoUndSteuer = async () => ({
  start: 0, saldo_stand: null, satz: 30, stand: 0, bewegung_ein: 0, bewegung_aus: 0,
  jahr_ein: 0, jahr_aus: 0, gewinn: 0, ruecklage: 0, frei: 0,
});
buch.monateMitDaten = async () => [];
buch.exportVerlauf = async () => [];
buch.saldoErinnerung = async () => ({ faellig: false, tageAlt: 1, angelegt: false });
buch.einstellungen = async () => ({ steuer_mail: "", steuer_name: "", notiz: "" });
crm.firmenListe = async () => [];

const app = express();
// Statt einer echten Anmeldung: die Sitzung, die nurAdmin erwartet.
app.use((req, res, next) => {
  req.session = { crm: { id: "test", name: "Testlauf", rolle: "admin" } };
  next();
});
routen(app);

function holen(pfad) {
  return new Promise((fertig, schief) => {
    http.get({ host: "127.0.0.1", port: server.address().port, path: pfad }, (r) => {
      let text = "";
      r.on("data", (s) => { text += s; });
      r.on("end", () => fertig({ status: r.statusCode, text }));
    }).on("error", schief);
  });
}

const server = app.listen(0, "127.0.0.1", async () => {
  try {
    console.log("\n— Die Seite selbst —");
    const ohne = await holen("/buchhaltung");
    const mit = await holen("/buchhaltung?fehler=mail");
    pruefe("die Seite laedt ueberhaupt", ohne.status === 200, "Status " + ohne.status);

    // DER BEFUND VOM 20.08.: vorher waren diese beiden Antworten byteidentisch.
    pruefe("mit und ohne Fehlerangabe sind NICHT mehr dieselbe Seite",
      ohne.text !== mit.text);
    pruefe("/buchhaltung?fehler=mail zeigt „Die Adresse wurde nicht gespeichert“",
      /Die Adresse wurde nicht gespeichert/.test(mit.text));
    pruefe("ohne Fehlerangabe steht der Streifen nicht da",
      !/Die Adresse wurde nicht gespeichert/.test(ohne.text));

    const migration = await holen("/buchhaltung?fehler=migration-fehlt");
    pruefe("fehler=migration-fehlt erscheint auf der Seite", /0055/.test(migration.text));
    const betrag = await holen("/buchhaltung?fehler=betrag");
    pruefe("fehler=betrag erscheint auf der Seite",
      /Buchung wurde nicht gespeichert/.test(betrag.text));
    const kanzlei = await holen("/buchhaltung?fehler=kanzlei");
    pruefe("fehler=kanzlei erscheint auf der Seite",
      /Steuerkanzlei wurde nicht gespeichert/.test(kanzlei.text));

    // Die Angabe kommt aus der Adresszeile und darf nichts einschleusen.
    const boes = await holen("/buchhaltung?fehler=" + encodeURIComponent("<script>alert(1)</script>"));
    pruefe("eine erfundene Angabe wird maskiert, nicht ausgefuehrt",
      !/<script>alert/.test(boes.text) && /&lt;script&gt;/.test(boes.text));
  } catch (e) {
    pruefe("Testlauf ohne Ausnahme", false, String(e && e.message));
  }
  server.close();
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
});
