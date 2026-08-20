// Liest die Belegerkennung wirklich einen Beleg? (20.08.2026)
//
// WARUM DIESER TEST: Der Telegram-Weg steht und faellt damit. Erkennt der Leser
// den Betrag, kommt eine Rueckfrage mit fertigen Werten; erkennt er ihn nicht,
// fragt Alexandra nach. Beides ist in Ordnung — was NICHT in Ordnung waere,
// ist ein geratener Betrag. Genau das laesst sich nur mit einem echten Aufruf
// zeigen, nicht mit einer Attrappe.
//
// Der Beleg wird hier ERZEUGT statt mitgeliefert: LibreOffice steckt ohnehin im
// Container (siehe lib/beleg-pdf.js) und macht aus einer HTML-Datei eine PDF.
// So haengt der Test an keiner Datei, die irgendwann verschwindet.
//
// ES WIRD NICHTS GEBUCHT UND NICHTS ABGELEGT. Der Leser bekommt die Datei
// direkt; die Tabelle "belege" wird nicht angefasst. Das ist Absicht: Ein
// hochgeladener Beleg bekommt eine Laufnummer und laesst sich per Trigger
// (Migration 0024) nicht mehr loeschen — ein Testbeleg bliebe fuer immer in
// der Buchhaltung stehen.
//
//   docker exec -w /app flowstate-dashboard node scripts/test-belegleser-echt.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}

const leser = require("../lib/belegleser.js");
const buch = require("../lib/buchhaltung.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

if (!leser.bereit()) {
  console.log("Kein Schlüssel für den Lesedienst — dieser Test braucht ihn. Übersprungen.");
  process.exit(0);
}

const SOFFICE = ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"]
  .find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!SOFFICE) {
  console.log("Kein LibreOffice da — der Beleg lässt sich nicht erzeugen. Übersprungen.");
  process.exit(0);
}

// Eine HTML-Seite zu PDF. Bewusst schlicht gesetzt wie ein Kassenbon.
function belegBauen(name, html) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "belegtest-"));
  const quelle = path.join(ordner, name + ".html");
  fs.writeFileSync(quelle, `<meta charset="utf-8"><body style="font-family:monospace;font-size:13pt">${html}</body>`, "utf-8");
  execFileSync(SOFFICE, ["--headless", "-env:UserInstallation=file://" + path.join(os.tmpdir(), "lo-profil-test"),
    "--convert-to", "pdf", "--outdir", ordner, quelle], { stdio: "pipe", timeout: 90000 });
  return fs.readFileSync(path.join(ordner, name + ".pdf"));
}

(async () => {
  // ------------------------------------------------ 1. Ein lesbarer Kassenbon
  console.log("— Ein Tankbeleg, wie er per Telegram käme —");
  // Die erste Zeile ist Fuellmaterial. LibreOffice haengt beim HTML-Import den
  // ersten Absatz an eine leere erste Seite — stuende der Firmenname dort, waere
  // er im PDF nicht zu sehen, und der Test pruefte den Leser gar nicht, sondern
  // den Wandler. (Nachgemessen am 20.08.: mit dem Namen im ersten Absatz kam
  // "Kein Firmenname erkennbar, erste Seite ist leer" zurueck.)
  const bon = belegBauen("tankbeleg", `<p>*** KASSENBELEG ***</p>
    <p><b>ARAL Station Ingolstadt GmbH</b><br>Hauptstraße 12<br>85049 Ingolstadt</p>
    <p>Rechnung Nr. 2026-1187<br>Datum: 03.07.2026&nbsp;&nbsp;14:22 Uhr</p>
    <hr>
    <p>Super E10&nbsp;&nbsp;&nbsp;42,15 L à 1,749 &euro;&nbsp;&nbsp;&nbsp;73,72 &euro;<br>
       Scheibenreiniger&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5,99 &euro;</p>
    <hr>
    <p><b>SUMME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;79,71 &euro;</b><br>
       darin 19% MwSt&nbsp;&nbsp;&nbsp;12,72 &euro;<br>Netto&nbsp;&nbsp;&nbsp;66,99 &euro;</p>
    <p>Zahlung: EC-Karte<br>Vielen Dank für Ihren Einkauf!</p>`);
  melde(bon.length > 1000, "Beleg erzeugt (" + bon.length + " Byte PDF)");

  const r = await leser.lesen(
    { dateiname: "tankbeleg.pdf", dateityp: "application/pdf", daten: bon, art: "ausgabe" },
    buch.AUSGABE_KATEGORIEN);
  console.log("   gelesen: " + JSON.stringify(r.werte || r, null, 2).split("\n").map((z) => "   " + z).join("\n").trim());

  melde(r.ok, "der Leser antwortet" + (r.ok ? "" : " — " + r.hinweis));
  if (r.ok) {
    const w = r.werte;
    // DER BRUTTO-GESAMTBETRAG, nicht der Sprit-Posten und nicht netto. Genau
    // hier geht es bei Kassenbons am haeufigsten schief.
    melde(w.betrag === 79.71, "Betrag ist die SUMME, nicht ein Posten: " + w.betrag);
    // 03.07.2026 ist der 3. Juli. Ein Leser, der TT.MM als MM/TT liest, macht
    // daraus den 7. März — und der Beleg landet im falschen Monatsordner.
    melde(w.datum === "2026-07-03", "Datum deutsch gelesen (3. Juli, nicht 7. März): " + w.datum);
    melde(/aral/i.test(w.gegenstelle || ""), "Lieferant: " + w.gegenstelle);
    melde(w.kategorie === "Fahrzeug & Tanken", "Kategorie einsortiert: " + w.kategorie);
    melde(w.steuersatz === 19, "Steuersatz: " + w.steuersatz);
    melde(w.belegnummer === "2026-1187", "Belegnummer: " + w.belegnummer);
    melde(w.richtung === "ausgabe", "als Ausgabe erkannt");
  }

  // ------------------------------- 2. Ein Blatt ohne Betrag: NICHT raten
  //
  // Der wichtigste Fall. Lieber ein leeres Feld und eine Rückfrage als eine
  // plausible falsche Zahl — die fällt erst beim Steuerberater auf.
  console.log("\n— Ein Beleg, auf dem kein Betrag steht —");
  const ohne = belegBauen("ohne-betrag", `<p>*** LIEFERSCHEIN ***</p>
    <p><b>Musterfirma GmbH</b><br>Lieferschein zur Bestellung 8842</p>
    <p>Datum: 11.06.2026</p>
    <hr>
    <p>2 x Bürostuhl "Ergo"<br>1 x Rollcontainer</p>
    <hr>
    <p>Die Rechnung erhalten Sie separat per Post.</p>`);
  const r2 = await leser.lesen(
    { dateiname: "ohne-betrag.pdf", dateityp: "application/pdf", daten: ohne, art: "ausgabe" },
    buch.AUSGABE_KATEGORIEN);
  console.log("   gelesen: " + JSON.stringify(r2.werte || r2));
  melde(r2.ok, "der Leser antwortet auch hier");
  if (r2.ok) {
    melde(r2.werte.betrag === null, "KEIN Betrag erfunden: " + r2.werte.betrag);
    melde(Boolean(r2.werte.hinweis), "und gesagt, warum: " + r2.werte.hinweis);
    // Ohne Betrag fragt lib/beleg-telegram.js nach, statt die Buchungsfrage zu
    // stellen — die Buchhaltung wuerde sie ohnehin mit "fehler=betrag"
    // abweisen. Dass genau dieser Fall hier ankommt, ist der Anschluss.
    melde(/musterfirma/i.test(r2.werte.gegenstelle || ""), "Lieferant trotzdem gelesen: " + r2.werte.gegenstelle);
  }

  // ------------------------------- 3. Was gar nicht gelesen werden kann
  console.log("\n— Formate, die der Leser abweist —");
  melde(/HEIC/i.test(leser.warumNicht("image/heic", 1000) || ""), "HEIC bekommt einen verständlichen Hinweis");
  melde(leser.warumNicht("application/pdf", 1000) === null, "PDF ist in Ordnung");
  melde(/JPG/.test(leser.warumNicht("application/zip", 1000) || ""), "ZIP wird mit Hinweis abgelehnt");
  const gross = await leser.lesen(
    { dateiname: "riesig.jpg", dateityp: "image/jpeg", daten: Buffer.alloc(5 * 1024 * 1024), art: "ausgabe" },
    buch.AUSGABE_KATEGORIEN);
  melde(gross.ok === false && /größer/.test(gross.hinweis || ""), "zu großes Bild: " + gross.hinweis);

  console.log(`\n${fehler ? "❌" : "✅"} ${fehler ? fehler + " Fehler" : "alles grün"} · Modell: ${leser.modell()}`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("Testlauf gescheitert:", e); process.exit(1); });
