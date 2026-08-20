// Prueft den Weg "Schick den Ordner an die Steuerberaterin" (Szene 3c).
//
// WARUM DIESER TEST (20.08.2026): Das Modul verschickt die komplette
// Buchhaltung nach aussen. Zwei Dinge muessen darum belegbar sein und nicht
// nur plausibel:
//
//   1. Ohne gesprochenes Ja geht NICHTS raus (REGELN.md: Mailversand nach
//      aussen ist ROT).
//   2. Der Sprechtext enthaelt keine Dateinamen, keine Adresse, keine Ziffern —
//      er wird vorgelesen, und im Auto ist "Buchhaltung_2026-07.zip" nur Laerm.
//
// GUERTEL UND HOSENTRAEGER: Der Lauf setzt ADS_PROBE=1 (lib/probemodus.js) UND
// verbiegt zusaetzlich gmail.senden auf einen Fehler. Selbst wenn der Riegel
// einmal nicht greift, kann hier nichts hinausgehen.
//
// Standardmaessig laeuft alles gegen ERFUNDENE Monatsdaten — der echte
// buch.monatsExport() schreibt eine Zeile nach monats_exporte, und der Monat
// stuende danach im Dashboard als "schon geholt". Einen Tag vor dem Dreh will
// das niemand. Der echte Durchlauf ist mit STEUER_TEST_ECHT=1 zuschaltbar.
//
//   ssh flowstate 'docker exec -i flowstate-dashboard node' < scripts/test-steuer-versand.js

process.env.ADS_PROBE = "1";            // VOR allen require: probemodus liest beim Laden

const fs = require("fs");
const path = require("path");

// .env nachziehen wie in den anderen Testskripten — schadet im Container nicht.
const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}
process.env.ADS_PROBE = "1";            // auch wenn die .env etwas anderes sagt

const buch = require("../lib/buchhaltung.js");
const gmail = require("../lib/gmail-direkt.js");
const probemodus = require("../lib/probemodus.js");
const sv = require("../lib/steuer-versand.js");

// Zweiter Riegel: ein echter Versand waere ab hier ein lauter Fehler.
gmail.senden = async () => { throw new Error("ECHTER VERSAND VERSUCHT — das darf der Test nie"); };

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

const NUTZER = { id: "00000000-0000-0000-0000-000000000001", name: "Testlauf" };
const PROBE_DATEI = path.join(process.env.DATA_PATH || path.join(__dirname, "..", "data"),
  "probe-abgefangen.jsonl");

// --------------------------------------------------------- erfundene Monate
// 18 Belege, 2.400 € — genau der Satz aus dem Drehbuch.
//
// Die echten Funktionen werden beiseitegelegt und nicht neu geladen:
// steuer-versand.js haelt eine Referenz auf DIESES Modulobjekt. Ein zweites
// require gaebe ein anderes, und das Modul benutzte weiter die Attrappe.
const ECHT = {
  monatsDaten: buch.monatsDaten,
  monatsExport: buch.monatsExport,
  monateMitDaten: buch.monateMitDaten,
};
const monateEchtWieder = () => Object.assign(buch, ECHT);

function monateFaelschen({ leer = false } = {}) {
  buch.monatsDaten = async (u, jahr, monat) => (leer ? { jahr, monat, zeilen: [] } : {
    jahr: Number(jahr), monat: Number(monat),
    zeilen: Array.from({ length: 18 }, (_, i) => ({ id: i })),
    summe_ein: 2400, summe_aus: 0, mitBeleg: 18, ohneBeleg: 0,
  });
  buch.monatsExport = async (u, jahr, monat) => (leer ? { ok: false, grund: "leer" } : {
    ok: true, zip: Buffer.alloc(4096, 7),
    titel: `${buch.MONATSNAME[Number(monat) - 1]} ${jahr}`,
    dateiname: `Buchhaltung ${jahr}-${String(monat).padStart(2, "0")} Sehorz-vom-Hofe.zip`,
    anzahl: 18, dateien: 18, ohneBeleg: 0,
  });
  buch.monateMitDaten = async () => [{ jahr: 2026, monat: 6, anzahl: 12, ein: 900, aus: 300 }];
}

function probeZeilen() {
  try {
    return fs.readFileSync(PROBE_DATEI, "utf-8").trim().split("\n").filter(Boolean).map((z) => JSON.parse(z));
  } catch { return []; }
}

(async () => {
  // ================================================== 1. Zeitraum verstehen
  console.log("\n— Zeitraum aus dem Auftrag —");
  const jetzt = new Date("2026-08-20T10:00:00");
  const FAELLE = [
    ["Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin.", "Juli 2026", true],
    ["Schick alle Rechnungen vom Juli an die Steuerberaterin.", "Juli 2026", false],
    ["die Rechnungen vom Juli", "Juli 2026", false],
    ["Schick den Ordner von letztem Monat raus.", "Juli 2026", false],
    ["Nimm diesen Monat.", "August 2026", false],
    ["Schick das Quartal.", "April bis Juni 2026", false],
    ["das zweite Quartal", "April bis Juni 2026", false],
    ["Q1 2026", "Januar bis März 2026", false],
    ["den September", "September 2025", false],       // September 2026 ist Zukunft
    ["Juni 2025", "Juni 2025", false],
    ["die letzten drei Monate", "Mai bis Juli 2026", false],
    ["letztes Jahr", "Jahr 2025", false],
  ];
  for (const [satz, erwartet, geraten] of FAELLE) {
    const z = sv.zeitraumVerstehen(satz, jetzt);
    melde(z && z.titel === erwartet && Boolean(z.geraten) === geraten,
      `"${satz}" -> ${z ? z.titel : "nichts"}${z && z.geraten ? " (geraten)" : ""}` +
      (z && z.titel === erwartet ? "" : `   ERWARTET: ${erwartet}`));
  }

  // ================================================== 2. Der ganze Weg
  console.log("\n— Vorlegen und Freigabe —");
  monateFaelschen();
  process.env.STEUER_MAIL = "Frau Meier <meier@beispiel-kanzlei.de>";
  process.env.STEUER_NAME = "Frau Meier";
  sv.vergessen();

  const vorher = probeZeilen().length;
  const a = await sv.vorbereiten(NUTZER, { text: "Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin." });
  console.log("   gesprochen: " + a.gesprochen);
  console.log("   reply:\n" + String(a.reply).split("\n").map((z) => "     " + z).join("\n"));

  melde(a.ok && a.wartetAuf === "freigabe", "legt zur Freigabe vor, sendet nicht von selbst");
  melde(/Juli-Rechnungen/.test(a.gesprochen), "nennt den Zeitraum im Sprechtext");
  melde(/achtzehn Belege/.test(a.gesprochen), "Anzahl als Wort: „achtzehn Belege“");
  melde(/zweitausendvierhundert Euro/.test(a.gesprochen), "Betrag als Wort: „zweitausendvierhundert Euro“");
  melde(/Frau Meier/.test(a.gesprochen), "nennt die Empfängerin beim Namen");
  melde(/\?$/.test(a.gesprochen.trim()), "endet mit der Frage");
  melde(!/[0-9]/.test(a.gesprochen), "keine Ziffern im Sprechtext");
  melde(!/@|\.zip|\/|Betreff/i.test(a.gesprochen), "keine Adresse, kein Dateiname, kein Pfad im Sprechtext");
  melde(/@/.test(a.reply) && /\.zip/.test(a.reply), "die Langfassung im Chat zeigt Adresse und Anhang");
  melde(probeZeilen().length === vorher, "beim Vorlegen geht noch nichts raus");

  // Ein beliebiger Satz ist KEINE Antwort auf die Rueckfrage.
  const egal = await sv.antwortAuf("Wie wird das Wetter morgen?");
  melde(egal === null, "fremder Satz läuft normal weiter (antwortAuf gibt null)");
  melde(sv.wasOffen() !== null, "der Vorgang bleibt dabei offen");

  // ================================================== 3. Das Ja
  console.log("\n— Das gesprochene Ja —");
  const b = await sv.antwortAuf("Ja, schick sie raus.");
  console.log("   gesprochen: " + (b && b.gesprochen));
  melde(b && b.ok && b.probe === true, "Ja -> Versand läuft, wird aber vom Probemodus abgefangen");
  const zeilen = probeZeilen();
  const letzte = zeilen[zeilen.length - 1];
  melde(zeilen.length === vorher + 1 && letzte.kanal === "mail", "genau eine abgefangene Mail protokolliert");
  melde(letzte && letzte.an === "meier@beispiel-kanzlei.de", "an die hinterlegte Adresse: " + (letzte && letzte.an));
  melde(letzte && /Buchhaltung Juli 2026/.test(letzte.betreff || ""), "Betreff: " + (letzte && letzte.betreff));
  melde(letzte && Array.isArray(letzte.anhaenge) && letzte.anhaenge.length === 1 && /\.zip/.test(letzte.anhaenge[0]),
    "genau ein ZIP im Anhang: " + (letzte && letzte.anhaenge && letzte.anhaenge[0]));
  melde(sv.wasOffen() === null, "der Vorgang ist danach zu");

  const nochmal = await sv.antwortAuf("Ja.");
  melde(nochmal === null, "ein zweites Ja verschickt nichts ein zweites Mal");
  melde(probeZeilen().length === vorher + 1, "und hinterlässt keine zweite Sendung");

  // ================================================== 4. Das Nein
  console.log("\n— Das Nein —");
  sv.vergessen();
  await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  const n = await sv.antwortAuf("Nein, lass mal.");
  console.log("   gesprochen: " + (n && n.gesprochen));
  melde(n && n.ok && !n.probe, "Nein -> verworfen");
  melde(probeZeilen().length === vorher + 1, "beim Nein geht nichts raus");
  melde(sv.wasOffen() === null, "der Vorgang ist zu");

  // ================================================== 5. Monat umbiegen
  console.log("\n— „Nein, den Juni“ —");
  sv.vergessen();
  const v1 = await sv.vorbereiten(NUTZER, { text: "Schick den Ordner an die Steuerberaterin." });
  melde(/Juli/.test(v1.gesprochen), "geraten wird der letzte abgeschlossene Monat — und er wird ausgesprochen");
  const v2 = await sv.antwortAuf("Nein, den Juni.");
  console.log("   gesprochen: " + (v2 && v2.gesprochen));
  melde(v2 && v2.ok && /Juni-Rechnungen/.test(v2.gesprochen), "der Monat wird umgebogen statt verworfen");
  melde(v2 && v2.wartetAuf === "freigabe", "und wieder zur Freigabe vorgelegt");
  melde(probeZeilen().length === vorher + 1, "dabei geht nichts raus");
  sv.vergessen();

  // ================================================== 6. Ohne Adresse
  console.log("\n— Keine Adresse hinterlegt —");
  delete process.env.STEUER_MAIL;
  delete process.env.STEUER_NAME;
  // Die dritte Quelle (Notiz in den Finanz-Einstellungen) hier stilllegen —
  // im Container koennte dort eine echte Adresse stehen, und dann pruefte
  // dieser Fall nichts.
  const echteEinstellungen = buch.einstellungen;
  buch.einstellungen = async () => ({ notiz: "" });
  sv.vergessen();
  const f = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  console.log("   gesprochen: " + f.gesprochen);
  melde(f.wartetAuf === "adresse", "fragt nach der Adresse, statt zu raten");
  melde(!/@/.test(f.gesprochen), "und liest keine erfundene Adresse vor");
  const jaOhne = await sv.antwortAuf("Ja, mach.");
  melde(jaOhne && jaOhne.wartetAuf === "adresse", "ein Ja ohne Adresse sendet nichts");
  melde(probeZeilen().length === vorher + 1, "und schickt erst recht nichts los");

  const nachgereicht = await sv.antwortAuf("Die geht an meier@beispiel-kanzlei.de.");
  melde(nachgereicht && nachgereicht.wartetAuf === "freigabe", "nachgereichte Adresse -> Freigabe steht an");
  const raus = await sv.antwortAuf("Ja.");
  melde(raus && raus.probe === true, "danach geht sie (im Probemodus) raus");
  buch.einstellungen = echteEinstellungen;
  sv.vergessen();

  // ================================================== 7. Leerer Monat
  console.log("\n— Monat ohne Buchungen —");
  monateFaelschen({ leer: true });
  process.env.STEUER_MAIL = "meier@beispiel-kanzlei.de";
  sv.vergessen();
  const l = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  console.log("   gesprochen: " + l.gesprochen);
  melde(!l.ok && /nichts gebucht/.test(l.gesprochen), "sagt ehrlich, dass da nichts liegt");
  melde(/Juni/.test(l.gesprochen), "und nennt den letzten Monat mit Belegen");
  const jaLeer = await sv.antwortAuf("Ja, nimm den.");
  melde(jaLeer !== null, "das Ja greift den Vorschlag auf");
  sv.vergessen();

  // ================================================== 8. Echter Durchlauf
  //
  // ACHTUNG: buch.monatsExport() schreibt eine Zeile nach monats_exporte —
  // der Monat steht danach im Dashboard als "schon geholt". Deshalb ist dieser
  // Teil zugeschaltet und nicht Standard.
  if (process.env.STEUER_TEST_ECHT === "1") {
    console.log("\n— Echter Ordner aus der Datenbank —");
    monateEchtWieder();
    const crm = require("../lib/crm.js");
    const { rows: [chef] } = await crm.system(
      `select id, name from profiles where aktiv and rolle='admin' and name ilike 'Lukas%' limit 1`);
    melde(Boolean(chef), "Nutzer aus der Datenbank: " + (chef && chef.name));

    const monate = await buch.monateMitDaten(chef);
    console.log("   Monate mit Daten: " + monate.slice(0, 4).map((m) => `${m.monat}/${m.jahr} (${m.anzahl})`).join(", "));
    melde(monate.length > 0, "die Buchhaltung liefert Monate");

    process.env.STEUER_MAIL = "Frau Meier <meier@beispiel-kanzlei.de>";
    process.env.STEUER_NAME = "Frau Meier";
    sv.vergessen();
    const vorEcht = probeZeilen().length;
    let e1 = await sv.vorbereiten(chef, { text: "Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin." });

    // BEFUND VOM 20.08.2026: Der Juli-Ordner wiegt 19,3 MB (elf Belege als
    // Handyfotos) und passt damit in keine Mail. Das ist kein Testfehler,
    // sondern die Lage — hier wird sie nur laut gemacht und danach an einem
    // Monat weitergeprueft, der passt.
    if (e1.zuGross) {
      console.log("   ⚠ " + e1.reply);
      melde(true, "zu großes Paket wird erkannt und NICHT gesendet");
      const passt = monate.find((m) => m.monat !== new Date().getMonth() + 1 && m.anzahl > 1
        && !(m.jahr === 2026 && m.monat === 7));
      sv.vergessen();
      e1 = await sv.vorbereiten(chef, { text: `Schick die ${buch.MONATSNAME[passt.monat - 1]}-Rechnungen an die Steuerberaterin.` });
    }
    console.log("   gesprochen: " + e1.gesprochen);
    console.log("   reply:\n" + String(e1.reply).split("\n").map((z) => "     " + z).join("\n"));
    melde(e1.ok && e1.wartetAuf === "freigabe", "echter Monatsordner wird zur Freigabe vorgelegt");
    melde(!/[0-9]/.test(e1.gesprochen || ""), "auch hier keine Ziffern im Sprechtext");

    const e2 = await sv.antwortAuf("Ja, schick sie raus.");
    const letzteEcht = probeZeilen().pop();
    melde(e2 && e2.probe === true, "Ja -> abgefangen, nichts ist rausgegangen");
    melde(probeZeilen().length === vorEcht + 1 && /\.zip \(\d{4,}/.test((letzteEcht.anhaenge || [])[0] || ""),
      "ein echtes ZIP hing dran: " + ((letzteEcht.anhaenge || [])[0] || "keins"));
    sv.vergessen();
    await crm.pool?.end?.().catch(() => {});
  } else {
    console.log("\n(Echter Datenbank-Durchlauf übersprungen — STEUER_TEST_ECHT=1 schaltet ihn zu.)");
  }

  console.log(`\n${fehler ? "❌" : "✅"} ${fehler ? fehler + " Fehler" : "alles grün"} · Probemodus: ${probemodus.aktiv() ? "an" : "AUS (!)"}`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("Testlauf gescheitert:", e); process.exit(1); });
