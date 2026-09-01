// Prueft den Weg "Schick den Ordner an die Steuerberaterin" (Szene 3c).
//
// WARUM DIESER TEST (20.08.2026): Das Modul fasst die komplette Buchhaltung an.
// Drei Dinge muessen darum belegbar sein und nicht nur plausibel:
//
//   1. Der Normalfall ist der ENTWURF. Es geht nichts nach draussen — die Mail
//      liegt in Lukas' Postfach, und abgeschickt wird sie dort von ihm.
//   2. Der alte Freigabe-Weg gibt es weiter, aber nur auf ausdrueckliches
//      "schick sie raus" — und auch dann erst nach der Rueckfrage (REGELN.md:
//      Mailversand nach aussen ist ROT).
//   3. Der Sprechtext enthaelt keine Dateinamen, keine Adresse, keine Ziffern —
//      er wird vorgelesen, und im Auto ist "Buchhaltung_2026-07.zip" nur Laerm.
//
// GUERTEL UND HOSENTRAEGER: Der Lauf setzt ADS_PROBE=1 (lib/probemodus.js) UND
// verbiegt gmail.senden auf einen Fehler. Selbst wenn der Riegel einmal nicht
// greift, kann hier nichts hinausgehen.
//
// FUER DEN ENTWURFS-ABSCHNITT wird der Probemodus BEWUSST kurz abgeschaltet und
// gmail.entwurf durch eine Attrappe ersetzt, die nur mitschreibt. Sonst pruefte
// der Abschnitt nur, dass der Riegel haelt — nicht, was Alexandra sagt und was
// im Entwurf steht. gmail.senden bleibt dabei die Bombe.
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
const kontakte = require("../lib/kontakte.js");
const probemodus = require("../lib/probemodus.js");
const sv = require("../lib/steuer-versand.js");

// Zweiter Riegel: ein echter Versand waere ab hier ein lauter Fehler.
gmail.senden = async () => { throw new Error("ECHTER VERSAND VERSUCHT — das darf der Test nie"); };

// Attrappe fuer den Entwurf. Sie legt nichts an, sie schreibt mit — damit
// pruefbar ist, WAS im Entwurf gestanden haette (Adresse, Betreff, Anhang).
const entwuerfe = [];
let entwurfFehler = null;
gmail.entwurf = async (m) => {
  if (entwurfFehler) throw new Error(entwurfFehler);
  entwuerfe.push({ ...m, anhaenge: (m.anhaenge || []).map((a) => `${a.name} (${a.daten.length} B)`) });
  return { ok: true, id: "entwurf-" + entwuerfe.length };
};
const geloescht = [];
gmail.entwurfLoeschen = async (id) => { geloescht.push(id); return true; };
gmail.bereit = () => true;

// Das Kontaktbuch nicht anfassen. Eine diktierte Adresse wird sich sonst
// gemerkt (merken()) — der Test hinterliesse eine erfundene Steuerberaterin in
// data/kontakte.json, und die waere beim naechsten echten Lauf eine Quelle.
const gemerkt = [];
kontakte.speichern = (liste) => { gemerkt.push(liste); return true; };

// Den Probemodus fuer einen Abschnitt zuschalten oder wegnehmen. Er wird an
// steuer-versand.js ueber DIESES Modulobjekt gereicht, ein Umbiegen hier wirkt
// also auch dort.
const echtAktiv = probemodus.aktiv;
const probeAn = (an) => { probemodus.aktiv = an ? echtAktiv : () => false; };

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
  steuerkanzlei: buch.steuerkanzlei,
  einstellungen: buch.einstellungen,
};
const monateEchtWieder = () => Object.assign(buch, ECHT);

// Das Kanzlei-Feld (Migration 0055) ist seit dem 20.08. die ERSTE Quelle fuer
// die Empfaengerin. Im Container steht dort womoeglich schon eine echte
// Adresse — dann pruefte der Rest des Tests nicht mehr, was er soll. Darum
// wird die Quelle hier gesetzt statt gelesen.
function kanzleiSetzen(k) {
  buch.steuerkanzlei = async () => (k || { anrede: "", name: "", reinerName: "", an: "", notiz: "" });
}

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

// Der GERATENE Monat haengt an der Uhr: Sagt niemand einen Zeitraum, nimmt
// der Versand den letzten abgeschlossenen Monat. Genau das darf hier nicht
// fest verdrahtet stehen — am 01.09.2026 fiel diese Pruefung um, weil sie am
// 20.08. geschrieben wurde und "Juli" erwartete, waehrend der Code voellig
// richtig August raet. Ein Test, der beim Monatswechsel rot wird, blockiert
// jeden Push im ganzen Haus und sagt dabei nichts ueber die Sache aus.
//
// Wo ein Auftrag den Monat NENNT ("Schick die Juli-Rechnungen"), bleibt Juli
// fest stehen — dort haengt nichts am Kalender.
const geratenRef = (() => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth() - 1, 1); })();
const GERATEN_NAME = buch.MONATSNAME[geratenRef.getMonth()];
const GERATEN_TITEL = `${GERATEN_NAME} ${geratenRef.getFullYear()}`;

(async () => {
  // ================================================== 1. Zeitraum verstehen
  console.log("\n— Zeitraum aus dem Auftrag —");
  // Hier ist die Uhr bewusst festgenagelt: Diese Faelle pruefen das VERSTEHEN
  // von Zeitangaben, und dafuer muss "jetzt" bekannt sein.
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

  // ================================================== 2. Die Kanzlei als Quelle
  //
  // Sie steht VOR der Umgebung: Was Lukas im Dashboard eintraegt, gilt. Sonst
  // koennte eine alte STEUER_MAIL auf dem Server ein gepflegtes Feld
  // stillschweigend ueberstimmen — und niemand saehe, warum die Mail woanders
  // hinging, als im Dashboard steht.
  console.log("\n— Woher die Empfängerin kommt —");
  monateFaelschen();
  buch.einstellungen = async () => ({ notiz: "" });        // dritte Quelle still
  process.env.STEUER_MAIL = "alt@umgebung.de";
  process.env.STEUER_NAME = "Alt";
  kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
    an: "meier@beispiel-kanzlei.de", notiz: "" });
  const q = await sv.empfaengerinFinden(NUTZER);
  melde(q && q.an === "meier@beispiel-kanzlei.de", "das Kanzlei-Feld schlägt die Umgebung: " + (q && q.an));
  melde(q && q.name === "Frau Meier", "Anrede und Name kommen zusammen: " + (q && q.name));

  // Halb eingetippte Adresse: buch.steuerkanzlei() gibt "an" dann gar nicht
  // heraus, und die naechste Quelle greift — hier die Umgebung.
  kanzleiSetzen({ anrede: "", name: "", reinerName: "", an: "", notiz: "" });
  const q2 = await sv.empfaengerinFinden(NUTZER);
  melde(q2 && q2.an === "alt@umgebung.de", "ohne gepflegte Kanzlei greift die nächste Quelle");
  delete process.env.STEUER_MAIL;
  delete process.env.STEUER_NAME;

  // ================================================== 3. Der Entwurf
  console.log("\n— Der Entwurf (Normalfall) —");
  kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
    an: "meier@beispiel-kanzlei.de", notiz: "" });
  probeAn(false);                 // damit der echte Text und der Anhang prüfbar sind
  entwuerfe.length = 0; geloescht.length = 0;
  const vorher = probeZeilen().length;
  sv.vergessen();

  const a = await sv.vorbereiten(NUTZER, { text: "Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin." });
  console.log("   gesprochen: " + a.gesprochen);
  console.log("   reply:\n" + String(a.reply).split("\n").map((z) => "     " + z).join("\n"));

  melde(a.ok && a.entwurf === true, "legt einen Entwurf an, statt zu fragen und zu senden");
  melde(entwuerfe.length === 1, "genau ein Entwurf: " + entwuerfe.length);
  melde(entwuerfe[0]?.an === "meier@beispiel-kanzlei.de", "an die hinterlegte Adresse: " + entwuerfe[0]?.an);
  melde(entwuerfe[0]?.betreff?.includes(`Buchhaltung ${GERATEN_TITEL}`), "Betreff: " + entwuerfe[0]?.betreff);
  melde(entwuerfe[0]?.anhaenge.length === 1 && /\.zip \(\d{4,}/.test(entwuerfe[0].anhaenge[0]),
    "ein echtes ZIP hängt dran: " + entwuerfe[0]?.anhaenge[0]);
  melde(/Guten Tag Frau Meier,/.test(entwuerfe[0]?.text || ""), "die Anrede steht in der Mail");
  melde(/Entwurf/.test(a.gesprochen) && /Postfach/.test(a.gesprochen), "sagt, dass es ein Entwurf im Postfach ist");
  melde(a.gesprochen.includes(`${GERATEN_NAME}-Rechnungen`), "nennt den Zeitraum im Sprechtext");
  melde(/achtzehn Belege/.test(a.gesprochen), "Anzahl als Wort: „achtzehn Belege“");
  melde(/zweitausendvierhundert Euro/.test(a.gesprochen), "Betrag als Wort: „zweitausendvierhundert Euro“");
  melde(/Frau Meier/.test(a.gesprochen), "nennt die Empfängerin beim Namen");
  melde(!/[0-9]/.test(a.gesprochen), "keine Ziffern im Sprechtext");
  melde(!/@|\.zip|\/|Betreff/i.test(a.gesprochen), "keine Adresse, kein Dateiname, kein Pfad im Sprechtext");
  melde(/Liegt als Entwurf in deinem Postfach/.test(a.reply), "die Langfassung sagt es wörtlich");
  melde(/@/.test(a.reply) && /\.zip/.test(a.reply), "die Langfassung im Chat zeigt Adresse und Anhang");
  melde(sv.wasOffen()?.schritt === "entwurf-liegt", "der Vorgang steht auf „Entwurf liegt“");

  // Ein beliebiger Satz ist KEINE Antwort auf die Rueckfrage.
  const egal = await sv.antwortAuf("Wie wird das Wetter morgen?");
  melde(egal === null, "fremder Satz läuft normal weiter (antwortAuf gibt null)");

  // Ein blosses "ja" darf jetzt NICHTS senden — es war keine Frage offen.
  const jaDanach = await sv.antwortAuf("Ja.");
  console.log("   gesprochen: " + (jaDanach && jaDanach.gesprochen));
  melde(jaDanach && jaDanach.ok && !jaDanach.gesendet, "ein bloßes Ja schickt nichts ab");
  melde(/abschicken musst du ihn selbst/.test(jaDanach?.gesprochen || ""), "und sagt, dass Lukas selbst abschickt");
  melde(entwuerfe.length === 1, "und legt keinen zweiten Entwurf an");
  melde(probeZeilen().length === vorher, "es ist nichts hinausgegangen");

  // ============================ 3b. Wiederholen ist keine Eskalation
  //
  // FEHLER GEFUNDEN AM 20.08.2026. SENDEWUNSCH matchte `\braus\b` und `schick`,
  // und damit hat der HAEUFIGSTE Satz ueberhaupt eskaliert — der wiederholte
  // Auftrag:
  //
  //   LUKAS> Schick den Juli-Ordner an die Steuerberaterin   -> Entwurf liegt
  //   LUKAS> Schick den Juli-Ordner an die Steuerberaterin   -> Entwurf GELÖSCHT,
  //                                                             "Soll sie so rausgehen?"
  //   LUKAS> ja                                              -> RAUS an die Kanzlei
  //
  // Zwei harmlose Sätze und ein Ja, und die komplette Buchhaltung war beim
  // Empfänger. Der ganze Umbau ("Ein Entwurf verlässt das Haus nicht") war
  // damit ausgehebelt.
  console.log("\n— Denselben Auftrag nochmal sagen —");
  const vorWdh = probeZeilen().length;
  const entwuerfeVorWdh = entwuerfe.length;
  const geloeschtVorWdh = geloescht.length;

  // Die beiden ersten Saetze muessen DENSELBEN Monat nennen, den der Entwurf
  // oben traegt — sonst ist es kein wiederholter Auftrag mehr, sondern ein
  // neuer fuer einen anderen Zeitraum, und der Versand legt voellig zu Recht
  // einen zweiten Entwurf an. Oben wurde der Monat GERATEN, also steht hier
  // derselbe geratene Monat. (Am 20.08. geschrieben, als das zufaellig beides
  // "Juli" war — am 01.09. fiel der Abschnitt deshalb um.)
  for (const satz of [
    `Schick den ${GERATEN_NAME}-Ordner an die Steuerberaterin`,
    `Schick den ${GERATEN_NAME}-Ordner an die Steuerberaterin.`,
    "Ja, ist die schon raus?",
    "Ist die schon raus?",
    "Schick die Rechnungen an die Steuerberaterin",
  ]) {
    const w = await sv.antwortAuf(satz);
    melde(w && w.ok && !w.gesendet && w.wartetAuf !== "freigabe"
      && /liegt schon als Entwurf/.test(w.reply || ""),
      `"${satz}" -> ${w ? String(w.gesprochen).slice(0, 60) : "null"}`);
  }
  melde(sv.wasOffen()?.schritt === "entwurf-liegt", "der Vorgang steht weiter auf „Entwurf liegt“");
  melde(entwuerfe.length === entwuerfeVorWdh, "es wurde kein neuer Entwurf geschrieben");
  melde(geloescht.length === geloeschtVorWdh, "und der bestehende wurde NICHT weggeräumt");
  melde(probeZeilen().length === vorWdh, "es ist nichts hinausgegangen");

  // Die Unterscheidung einzeln, ohne offenen Vorgang — damit sie beim naechsten
  // Umbau nicht still zurueckkippt.
  console.log("\n— Was gilt als ausdrücklicher Sendewunsch? —");
  for (const [satz, erwartet] of [
    ["schick den juli-ordner an die steuerberaterin", false],
    ["ja, ist die schon raus?", false],
    ["ist die schon raus?", false],
    ["ist die eigentlich rausgegangen?", false],
    ["schick den ordner an die kanzlei", false],
    ["ja", false],
    ["passt", false],
    ["schick sie doch bitte wirklich raus.", true],
    ["ja, schick sie ruhig gleich raus", true],
    ["schick sie jetzt raus", true],
    ["rausschicken bitte", true],
    ["raus damit", true],
    ["abschicken", true],
    ["verschick sie", true],
    ["schick den ordner jetzt wirklich raus", true],
  ]) {
    melde(sv.sendewunsch(satz) === erwartet,
      `"${satz}" -> ${sv.sendewunsch(satz) ? "Eskalation" : "keine"}` +
      (sv.sendewunsch(satz) === erwartet ? "" : `   ERWARTET: ${erwartet ? "Eskalation" : "keine"}`));
  }

  // ================================================== 4. Doch direkt senden
  //
  // Der alte Weg bleibt — aber nur auf ausdruecklichen Wunsch, und auch dann
  // erst nach der Rueckfrage. Ein Ja, das auf keine Frage antwortet, ist keins.
  console.log("\n— „Schick sie doch wirklich raus“ —");
  const w1 = await sv.antwortAuf("Schick sie doch bitte wirklich raus.");
  console.log("   gesprochen: " + (w1 && w1.gesprochen));
  melde(w1 && w1.wartetAuf === "freigabe", "ausdrücklicher Wunsch -> Freigabe wird eingeholt");
  melde(/\?$/.test((w1?.gesprochen || "").trim()), "und die Frage wird gestellt");
  melde(geloescht.length === 1, "der Entwurf wird dabei weggeräumt: " + geloescht.join(","));
  melde(probeZeilen().length === vorher, "bis hierher ist nichts raus");

  probeAn(true);                  // ab jetzt wieder der harte Riegel
  const w2 = await sv.antwortAuf("Ja.");
  console.log("   gesprochen: " + (w2 && w2.gesprochen));
  melde(w2 && w2.ok && w2.probe === true, "erst das Ja darauf sendet — und wird abgefangen");
  const letzte = probeZeilen().pop();
  melde(probeZeilen().length === vorher + 1 && letzte.kanal === "mail" && letzte.an === "meier@beispiel-kanzlei.de",
    "genau eine abgefangene Mail an die richtige Adresse");
  melde(sv.wasOffen() === null, "der Vorgang ist danach zu");
  const nochmal = await sv.antwortAuf("Ja.");
  melde(nochmal === null, "ein zweites Ja verschickt nichts ein zweites Mal");

  // ================================================== 5. Das Nein
  console.log("\n— Das Nein räumt den Entwurf weg —");
  probeAn(false);
  entwuerfe.length = 0; geloescht.length = 0;
  const vorNein = probeZeilen().length;
  sv.vergessen();
  await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  melde(entwuerfe.length === 1, "erst liegt der Entwurf");
  const n = await sv.antwortAuf("Nein, lass mal.");
  console.log("   gesprochen: " + (n && n.gesprochen));
  melde(n && n.ok, "Nein -> verworfen");
  melde(geloescht.length === 1 && /rausgenommen/.test(n.gesprochen), "der Entwurf wird wieder rausgenommen");
  melde(probeZeilen().length === vorNein, "beim Nein geht nichts raus");
  melde(sv.wasOffen() === null, "der Vorgang ist zu");

  // ================================================== 6. Monat umbiegen
  console.log("\n— „Nein, den Juni“ —");
  entwuerfe.length = 0; geloescht.length = 0;
  sv.vergessen();
  const v1 = await sv.vorbereiten(NUTZER, { text: "Schick den Ordner an die Steuerberaterin." });
  melde(v1.gesprochen.includes(GERATEN_NAME),
    `geraten wird der letzte abgeschlossene Monat (${GERATEN_NAME}) — und er wird ausgesprochen`);
  const v2 = await sv.antwortAuf("Nein, den Juni.");
  console.log("   gesprochen: " + (v2 && v2.gesprochen));
  melde(v2 && v2.ok && /Juni-Rechnungen/.test(v2.gesprochen), "der Monat wird umgebogen statt verworfen");
  melde(v2 && v2.entwurf === true, "und wieder als Entwurf abgelegt");
  melde(geloescht.length === 1, "der Juli-Entwurf ist weg — es liegt nur einer im Postfach: " + geloescht.length);
  melde(entwuerfe.length === 2, "und es wurde genau EIN neuer geschrieben, nicht zwei: " + entwuerfe.length);
  melde(/Juni/.test(entwuerfe[entwuerfe.length - 1]?.betreff || ""),
    "der neue Entwurf trägt den Juni: " + entwuerfe[entwuerfe.length - 1]?.betreff);
  // Die Empfaengerin darf beim Umbiegen nicht verlorengehen — sonst begaenne
  // die Mail mit "Guten Tag," statt mit dem Namen.
  melde(/Guten Tag Frau Meier,/.test(entwuerfe[entwuerfe.length - 1]?.text || ""),
    "und die Anrede ist mitgewandert");
  melde(probeZeilen().length === vorNein, "dabei geht nichts raus");
  // Eine intern weitergereichte Adresse ist keine diktierte: Sie darf keinen
  // Kontakt anlegen, den nie jemand eingetragen hat.
  melde(gemerkt.length === 0, "und es wurde kein Kontakt „Steuerberaterin“ erfunden");
  sv.vergessen();

  // ================================================== 7. Ohne Adresse
  console.log("\n— Keine Adresse hinterlegt —");
  kanzleiSetzen(null);
  // Auch die zweite Quelle stilllegen: Im Container kann im Kontaktbuch eine
  // echte Kanzlei stehen, und dann pruefte dieser Fall nichts.
  const echteKontakte = kontakte.alle;
  kontakte.alle = () => [];
  entwuerfe.length = 0; geloescht.length = 0;
  sv.vergessen();
  const f = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  console.log("   gesprochen: " + f.gesprochen);
  melde(f.wartetAuf === "adresse", "fragt nach der Adresse, statt zu raten");
  melde(!/@/.test(f.gesprochen), "und liest keine erfundene Adresse vor");
  melde(entwuerfe.length === 0, "ohne Adresse gibt es auch keinen Entwurf");
  const jaOhne = await sv.antwortAuf("Ja, mach.");
  melde(jaOhne && jaOhne.wartetAuf === "adresse", "ein Ja ohne Adresse legt nichts an");

  const nachgereicht = await sv.antwortAuf("Die geht an meier@beispiel-kanzlei.de.");
  console.log("   gesprochen: " + (nachgereicht && nachgereicht.gesprochen));
  melde(nachgereicht && nachgereicht.entwurf === true, "nachgereichte Adresse -> Entwurf liegt");
  melde(entwuerfe[0]?.an === "meier@beispiel-kanzlei.de", "mit der diktierten Adresse: " + entwuerfe[0]?.an);
  melde(probeZeilen().length === vorNein, "und raus ist immer noch nichts");
  kontakte.alle = echteKontakte;
  probeAn(true);
  sv.vergessen();

  // ================================================== 7b. Gmail hakt
  console.log("\n— Wenn das Ablegen scheitert —");
  probeAn(false);
  // Die Empfaengerin wieder setzen: Der Abschnitt davor hat sie absichtlich
  // weggenommen, und ohne sie prüfte dieser hier nur die Adressfrage.
  kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
    an: "meier@beispiel-kanzlei.de", notiz: "" });
  entwurfFehler = "Gmail 500";
  sv.vergessen();
  const h = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  console.log("   gesprochen: " + h.gesprochen);
  melde(h && h.ok === false && /nochmal/.test(h.gesprochen), "sagt ehrlich, dass es hakt, und bietet einen zweiten Versuch an");
  melde(sv.wasOffen()?.schritt === "entwurf-nochmal", "der Vorgang steht auf „nochmal“, NICHT auf Freigabe");
  entwurfFehler = null;
  const h2 = await sv.antwortAuf("Ja, versuch's nochmal.");
  melde(h2 && h2.entwurf === true, "das Ja legt den Entwurf an — und sendet nicht");
  melde(probeZeilen().length === vorNein, "auch hier geht nichts raus");
  probeAn(true);
  sv.vergessen();

  // ============================ 7c. STEUER_MODUS=senden bleibt unberührt
  //
  // Der feste Direktversand laeuft gar nicht ueber sendewunsch() — er wird beim
  // Vorbereiten gesetzt. Beim Verengen von SENDEWUNSCH am 20.08. war die
  // naheliegende Sorge, genau diesen Weg mitzuerwischen; hier steht, dass es
  // nicht passiert ist. Gesendet wird auch dann erst nach der Rückfrage.
  console.log("\n— STEUER_MODUS=senden —");
  probeAn(true);                  // harter Riegel: hier geht nichts hinaus
  monateFaelschen();
  kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
    an: "meier@beispiel-kanzlei.de", notiz: "" });
  entwuerfe.length = 0;
  sv.vergessen();
  const vorModus = probeZeilen().length;
  const m1 = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin.", modus: "senden" });
  console.log("   gesprochen: " + m1.gesprochen);
  melde(m1 && m1.wartetAuf === "freigabe", "im Sendemodus wird die Freigabe eingeholt");
  melde(entwuerfe.length === 0, "und kein Entwurf abgelegt");
  melde(probeZeilen().length === vorModus, "vor dem Ja ist nichts raus");
  const m2 = await sv.antwortAuf("Ja.");
  melde(m2 && m2.ok && m2.probe === true, "das Ja sendet — und wird abgefangen");
  melde(probeZeilen().length === vorModus + 1, "genau eine abgefangene Mail");
  sv.vergessen();

  // ================================================== 8. Leerer Monat
  console.log("\n— Monat ohne Buchungen —");
  monateFaelschen({ leer: true });
  kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
    an: "meier@beispiel-kanzlei.de", notiz: "" });
  sv.vergessen();
  const l = await sv.vorbereiten(NUTZER, { text: "Schick die Juli-Rechnungen an die Steuerberaterin." });
  console.log("   gesprochen: " + l.gesprochen);
  melde(!l.ok && /nichts gebucht/.test(l.gesprochen), "sagt ehrlich, dass da nichts liegt");
  melde(/Juni/.test(l.gesprochen), "und nennt den letzten Monat mit Belegen");
  const jaLeer = await sv.antwortAuf("Ja, nimm den.");
  melde(jaLeer !== null, "das Ja greift den Vorschlag auf");
  sv.vergessen();

  // ================================================== 9. Echter Durchlauf
  //
  // ACHTUNG: buch.monatsExport() schreibt eine Zeile nach monats_exporte —
  // der Monat steht danach im Dashboard als "schon geholt". Deshalb ist dieser
  // Teil zugeschaltet und nicht Standard.
  if (process.env.STEUER_TEST_ECHT === "1") {
    console.log("\n— Echter Ordner aus der Datenbank —");
    monateEchtWieder();
    // Hier laeuft ALLES echt bis auf die letzte Stelle: echte Monatsdaten,
    // echtes ZIP — und der Probemodus faengt den Entwurf ab, bevor er in
    // Lukas' Postfach liegt.
    kanzleiSetzen({ anrede: "Frau", name: "Frau Meier", reinerName: "Meier",
      an: "meier@beispiel-kanzlei.de", notiz: "" });
    const crm = require("../lib/crm.js");
    const { rows: [chef] } = await crm.system(
      `select id, name from profiles where aktiv and rolle='admin' and name ilike 'Lukas%' limit 1`);
    melde(Boolean(chef), "Nutzer aus der Datenbank: " + (chef && chef.name));

    const monate = await buch.monateMitDaten(chef);
    console.log("   Monate mit Daten: " + monate.slice(0, 4).map((m) => `${m.monat}/${m.jahr} (${m.anzahl})`).join(", "));
    melde(monate.length > 0, "die Buchhaltung liefert Monate");

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
    melde(e1.ok && e1.probe === true && e1.entwurf === true,
      "echter Monatsordner -> Entwurf, vom Probemodus abgefangen");
    melde(!/[0-9]/.test(e1.gesprochen || ""), "auch hier keine Ziffern im Sprechtext");

    const letzteEcht = probeZeilen().pop();
    melde(probeZeilen().length === vorEcht + 1 && letzteEcht.entwurf === true
      && /\.zip \(\d{4,}/.test((letzteEcht.anhaenge || [])[0] || ""),
      "ein echtes ZIP hing dran: " + ((letzteEcht.anhaenge || [])[0] || "keins"));
    sv.vergessen();
    await crm.pool?.end?.().catch(() => {});
  } else {
    console.log("\n(Echter Datenbank-Durchlauf übersprungen — STEUER_TEST_ECHT=1 schaltet ihn zu.)");
  }

  console.log(`\n${fehler ? "❌" : "✅"} ${fehler ? fehler + " Fehler" : "alles grün"} · Probemodus: ${probemodus.aktiv() ? "an" : "AUS (!)"}`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("Testlauf gescheitert:", e); process.exit(1); });
