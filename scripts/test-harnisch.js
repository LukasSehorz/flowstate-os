// Prueft den PRUEFER: Schlaegt scripts/ads-proben.js an, wenn etwas kaputt ist?
//
// WARUM (20.08.2026): Bis heute pruefte fast jedes Szenario nur, was NICHT
// vorkommen darf. Durch diese Luecke ging "Die Flugsuche ist mir gerade
// weggebrochen" DREIMAL als bestanden durch — kein Panne-Wort, kein Zeitlimit
// gerissen, also gruen. Geliefert wurde nichts.
//
// Ein Testwerkzeug, das Schweigen fuer eine Antwort haelt, ist schlimmer als
// keines: Es erzeugt Vertrauen, das nicht gedeckt ist. Also wird hier der
// Pruefer selbst geprueft — mit absichtlich kaputten Antworten, gegen die
// echten Erwartungen aus der Szenarienliste.
//
// Braucht weder Netz noch Modell noch Datenbank.
//
// Aufruf:  node scripts/test-harnisch.js

const fs = require("fs");
const path = require("path");

let fehler = 0;
const pruefe = (name, wahr, dazu = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !dazu ? "" : "\n   " + dazu));
  if (!wahr) fehler++;
};

// Die Szenarien aus dem Harnisch holen, ohne ihn laufen zu lassen. Er startet
// beim Laden einen Server — deshalb wird die Datei gelesen und nur der
// Szenarien-Block ausgewertet. Umstaendlich, aber die Alternative waere, die
// Erwartungen hier ein zweites Mal hinzuschreiben; dann prueft der Test seine
// eigene Abschrift und nicht das, was wirklich laeuft.
const quelle = fs.readFileSync(path.join(__dirname, "ads-proben.js"), "utf-8");
const von = quelle.indexOf("const SZENARIEN = [");
const bis = quelle.indexOf("\n];", von);
pruefe("Szenarienliste gefunden", von > 0 && bis > von, "");
if (von < 0) { process.exit(1); }

// Die Hilfsmuster stehen ueber der Liste und werden gebraucht.
const kopfVon = quelle.indexOf("const PANNE =");
const kopf = quelle.slice(kopfVon, von);
const PRAEFIX = "ADSTEST";
// eslint-disable-next-line no-new-func
const SZENARIEN = new Function("PRAEFIX", kopf + quelle.slice(von, bis + 3) + "\nreturn SZENARIEN;")(PRAEFIX);
pruefe(`Szenarien lesbar (${SZENARIEN.length})`, SZENARIEN.length > 50, "");

// Dieselbe Bewertung wie im Harnisch — bewusst nachgebaut, aber nur die drei
// Regeln, um die es hier geht.
function bewerte(zug, antwort) {
  const maengel = [];
  if (!antwort) maengel.push("Keine Antwort");
  if (zug.enthaelt && !zug.enthaelt.test(antwort)) maengel.push("fehlt: " + zug.enthaelt);
  if (zug.verboten && zug.verboten.test(antwort)) maengel.push("verboten: " + zug.verboten);
  return maengel;
}

const zugVon = (id, i = 0) => SZENARIEN.find((s) => s.id === id)?.zuege[i];

// --- 1. Kaputtes computer.js: "weggebrochen" muss ROT geben -----------------
//
// Wortlaut aus lib/computer.js, Fehlerzweig. Genau dieser Satz galt dreimal
// als bestanden.
{
  const kaputt = "Bei der Flugsuche nach Barcelona bin ich nicht durchgekommen. " +
    "Sag nochmal, dann probier ich's neu.";
  for (const id of ["cu-1", "cu-2", "cu-3", "r-1"]) {
    const zug = zugVon(id);
    if (!zug) { pruefe(`Szenario ${id} vorhanden`, false, ""); continue; }
    const m = bewerte(zug, kaputt);
    pruefe(`${id}: kaputte Flugsuche gibt ROT`, m.length > 0, "kam durch: " + kaputt);
  }
  // Und die heile Antwort muss WEITERHIN durchkommen — ein Test, der alles
  // ablehnt, ist genauso wertlos wie einer, der alles durchlaesst.
  const heil = "Der günstigste ist 185 Euro, mit Iberia, ein Stopp in Madrid, gut acht Stunden. " +
    "Hin am Samstag nach Barcelona, zurück am Dienstag. Gebucht hab ich nichts, das machst du selbst.";
  for (const id of ["cu-1", "cu-2", "cu-3", "r-1"]) {
    const zug = zugVon(id);
    if (zug) pruefe(`${id}: heile Flugantwort bleibt GRÜN`, bewerte(zug, heil).length === 0,
      bewerte(zug, heil).join(" | "));
  }
}

// --- 2. Kaputtes terminFinden: "finde keinen Termin" muss ROT geben ---------
//
// Der Fehler vom 20.08.: Der Termin stand im Kalender, der STAND kannte ihn
// noch nicht, und Alexandra sagte "Ich finde keinen Termin". Live 2 von 2.
{
  const kaputt = "Ich finde keinen Termin, der auf „ADSTEST Kamera-Check“ passt — " +
    "sag mir kurz, welchen du meinst.";
  for (const [id, i] of [["c2-3", 2], ["k-3", 1], ["k-3", 2]]) {
    const zug = zugVon(id, i);
    if (!zug) { pruefe(`Zug ${id}#${i} vorhanden`, false, ""); continue; }
    pruefe(`${id} Zug ${i + 1}: „finde keinen Termin“ gibt ROT`,
      bewerte(zug, kaputt).length > 0, "kam durch");
  }
  // Umgekehrt: Beim Szenario mit dem erfundenen Termin MUSS genau dieser Satz
  // kommen — dort ist er die richtige Antwort.
  const k5 = zugVon("k-5");
  pruefe("k-5: „finde keinen Termin“ ist dort die RICHTIGE Antwort",
    k5 && bewerte(k5, "Ich finde keinen Termin, der auf „Termin mit dem Bundeskanzler“ passt — sag mir kurz, welchen du meinst.").length === 0,
    k5 ? bewerte(k5, "Ich finde keinen Termin, der auf „x“ passt.").join(" | ") : "");
  pruefe("k-5: eine erfundene Bestätigung gibt ROT",
    k5 && bewerte(k5, "Mach ich, der Termin fliegt raus. Abgesagt.").length > 0, "");
}

// --- 3. Schweigen darf nirgends bestehen ------------------------------------
//
// Der eigentliche Punkt: Eine leere oder nichtssagende Antwort muss auffallen.
{
  const stumm = ["", "Mach ich — ich setz mich dran.", "Alles klar."];
  let ohneErwartung = [];
  for (const sz of SZENARIEN) {
    for (const zug of sz.zuege) {
      // Nur Zuege mit positiver Erwartung koennen Schweigen erkennen.
      if (!zug.enthaelt) { ohneErwartung.push(sz.id); continue; }
      for (const s of stumm) {
        if (!bewerte(zug, s).length) {
          pruefe(`${sz.id}: Schweigen („${s.slice(0, 25)}“) faellt auf`, false, zug.frage);
        }
      }
    }
  }
  ohneErwartung = [...new Set(ohneErwartung)];
  console.log(`\n   ${SZENARIEN.length - ohneErwartung.length} von ${SZENARIEN.length} Szenarien haben eine positive Erwartung.`);
  // Kein Muss fuer jedes Szenario — manche prueten bewusst nur, dass etwas
  // NICHT passiert ("Trag ein — nein, warte, lass es"). Aber die Szenen aus dem
  // Anzeigen-Konzept muessen eine haben.
  const KERN = SZENARIEN.filter((s) => s.gruppe === "kern" || s.gruppe === "rueckfall");
  const kernOhne = KERN.filter((s) => !s.zuege.some((z) => z.enthaelt)).map((s) => s.id);
  pruefe("Jedes Drehbuch-Szenario hat eine positive Erwartung" +
    (kernOhne.length ? ` — fehlt bei: ${kernOhne.join(", ")}` : ""), !kernOhne.length, "");
}

console.log(fehler ? `\n${fehler} Fall/Faelle durchgefallen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
