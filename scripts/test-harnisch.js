// Prueft den PRUEFER: Schlaegt scripts/ads-proben.js an, wenn etwas kaputt ist —
// und laesst er in Ruhe, was in Ordnung ist?
//
// WARUM (20.08.2026): Der Harnisch hat zweimal in beide Richtungen gelogen.
//
//   Er liess ECHTE FEHLER durch. "Die Flugsuche ist mir gerade weggebrochen"
//   galt DREIMAL als bestanden — kein Panne-Wort, kein Zeitlimit gerissen, also
//   gruen. Geliefert wurde nichts. Ein Testwerkzeug, das Schweigen fuer eine
//   Antwort haelt, erzeugt Vertrauen, das nicht gedeckt ist.
//
//   Er meldete FALSCHE FEHLER. Elf Szenarien fielen durch, obwohl die Antwort
//   richtig war — nur hatte Alexandra sie aus dem STAND geliefert statt aus
//   einer Abfrage, und der Pruefer verlangte das Werkzeug. Das ist schlimmer
//   als es klingt: Es faerbt den schnelleren Weg rot und treibt die Entwicklung
//   in die falsche Richtung. Dazu kam "Unerwuenschte Wendung: €" bei einer
//   Antwort, die gesprochen sauber "fuenftausend Euro" lautet.
//
// Beide Richtungen stehen hier als Faelle. Der Harnisch prueft nicht mehr eine
// Abschrift der Bewertung, sondern ruft mit require() genau die Funktion auf,
// die morgen im Lauf entscheidet (bewerteZug aus ads-proben.js).
//
// Braucht weder Netz noch Modell noch Datenbank.
//
// Aufruf:  node scripts/test-harnisch.js

const {
  SZENARIEN, bewerteZug, gesprochen, PRAEFIX,
} = require("./ads-proben.js");

let fehler = 0;
const pruefe = (name, wahr, dazu = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !dazu ? "" : "\n   " + dazu));
  if (!wahr) fehler++;
};

pruefe(`Szenarien lesbar (${SZENARIEN.length})`, SZENARIEN.length > 50, "");

const zugVon = (id, i = 0) => SZENARIEN.find((s) => s.id === id)?.zuege[i];
// Kurzform: Was sagt der Pruefer zu dieser Antwort?
const maengel = (zug, antwort, opt = {}) => bewerteZug(zug, antwort, opt).maengel;
const hinweise = (zug, antwort, opt = {}) => bewerteZug(zug, antwort, opt).hinweise;
const rot = (zug, antwort, opt) => maengel(zug, antwort, opt).length > 0;
const gruen = (zug, antwort, opt) => maengel(zug, antwort, opt).length === 0;

// --- 1. Kaputtes computer.js: "weggebrochen" muss ROT geben -----------------
//
// Wortlaut aus lib/computer.js, Fehlerzweig. Genau dieser Satz galt dreimal
// als bestanden.
{
  const kaputt = "Bei der Flugsuche nach Barcelona bin ich nicht durchgekommen. " +
    "Sag nochmal, dann probier ich's neu.";
  // Auch der hoefliche Ausweichsatz ist kein Ergebnis: Wer vertroestet, hat
  // keinen Preis genannt. Live gemessen am 19.08.
  const vertroestet = "Kalender kriege ich gerade nicht auf. Ich lass dir die günstigsten " +
    "Verbindungen nach Barcelona raussuchen und meld mich per Telegram.";
  for (const id of ["cu-1", "cu-2", "cu-3", "r-1"]) {
    const zug = zugVon(id);
    if (!zug) { pruefe(`Szenario ${id} vorhanden`, false, ""); continue; }
    pruefe(`${id}: kaputte Flugsuche gibt ROT`, rot(zug, kaputt), "kam durch: " + kaputt);
    pruefe(`${id}: Vertrösten ohne Preis gibt ROT`, rot(zug, vertroestet), "kam durch: " + vertroestet);
  }
  // Und die heile Antwort muss WEITERHIN durchkommen — ein Test, der alles
  // ablehnt, ist genauso wertlos wie einer, der alles durchlaesst.
  const heil = "Der günstigste ist 185 Euro, mit Iberia, ein Stopp in Madrid, gut acht Stunden. " +
    "Hin am Samstag nach Barcelona, zurück am Dienstag. Gebucht hab ich nichts, das machst du selbst.";
  for (const id of ["cu-1", "cu-2", "cu-3", "r-1"]) {
    const zug = zugVon(id);
    if (zug) pruefe(`${id}: heile Flugantwort bleibt GRÜN`, gruen(zug, heil), maengel(zug, heil).join(" | "));
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
      rot(zug, kaputt, { praefixErlaubt: true, werkzeuge: ["termin_absagen", "termin_verschieben"] }), "kam durch");
  }
  // Umgekehrt: Beim Szenario mit dem erfundenen Termin MUSS sie genau das
  // sagen — dort ist es die richtige Antwort. Und zwar in JEDER Formulierung:
  // Am 20.08. verlangte der Pruefer den Wortlaut "finde keinen Termin" und
  // liess die bessere, natuerlichere Antwort durchfallen.
  const k5 = zugVon("k-5");
  const k5Gut = [
    "Ich finde keinen Termin, der auf „Termin mit dem Bundeskanzler“ passt — sag mir kurz, welchen du meinst.",
    "So einen Termin hast du nicht im Kalender — kein Bundeskanzler, weder heute noch später. Meinst du einen anderen?",
    "Im Kalender steht kein Termin mit dem Bundeskanzler. Soll ich woanders nachsehen?",
    "Einen Bundeskanzler-Termin gibt es nicht bei dir. Welchen meinst du?",
  ];
  for (const gut of k5Gut) {
    pruefe(`k-5: „${gut.slice(0, 38)}…“ ist die RICHTIGE Antwort`,
      Boolean(k5) && gruen(k5, gut), k5 ? maengel(k5, gut).join(" | ") : "");
  }
  pruefe("k-5: eine erfundene Bestätigung gibt ROT",
    Boolean(k5) && rot(k5, "Mach ich, der Termin fliegt raus. Abgesagt."), "");
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
        if (gruen(zug, s, { praefixErlaubt: true })) {
          pruefe(`${sz.id}: Schweigen („${s.slice(0, 25)}“) faellt auf`, false, zug.frage);
        }
      }
    }
  }
  ohneErwartung = [...new Set(ohneErwartung)];
  console.log(`\n   ${SZENARIEN.length - ohneErwartung.length} von ${SZENARIEN.length} Szenarien haben eine positive Erwartung.`);
  // Kein Muss fuer jedes Szenario — manche pruefen bewusst nur, dass etwas
  // NICHT passiert ("Trag ein — nein, warte, lass es"). Aber die Szenen aus dem
  // Anzeigen-Konzept muessen eine haben.
  const KERN = SZENARIEN.filter((s) => s.gruppe === "kern" || s.gruppe === "rueckfall");
  const kernOhne = KERN.filter((s) => !s.zuege.some((z) => z.enthaelt)).map((s) => s.id);
  pruefe("Jedes Drehbuch-Szenario hat eine positive Erwartung" +
    (kernOhne.length ? ` — fehlt bei: ${kernOhne.join(", ")}` : ""), !kernOhne.length, "");
}

// --- 4. Kein Zug ohne Urteil ------------------------------------------------
//
// NEU AM 20.08.: Seit die Werkzeug-Erwartung weich ist (Hinweis statt
// Durchfall), kann ein Zug, der NUR ein Werkzeug nennt, ueberhaupt nicht mehr
// scheitern — er ist Deko. Damit die Aufweichung keine Loecher reisst, muss
// jeder Zug mindestens eine echte Pruefung tragen.
{
  const ohne = [];
  for (const sz of SZENARIEN) {
    sz.zuege.forEach((z, i) => {
      if (!z.enthaelt && !z.verboten && !z.kein_werkzeug?.length) ohne.push(`${sz.id}#${i + 1}`);
    });
  }
  pruefe("Jeder Zug trägt eine echte Prüfung (enthaelt/verboten/kein_werkzeug)" +
    (ohne.length ? ` — fehlt bei: ${ohne.join(", ")}` : ""), !ohne.length, "");
}

// --- 5. Werkzeug ist Mittel, nicht Zweck ------------------------------------
//
// Die elf falschen Alarme aus dem Lauf 69/80. Jede dieser Antworten ist
// WOERTLICH so gemessen worden und jede ist RICHTIG. Wenn eine davon wieder
// rot wird, ist der Pruefer erneut auf den Weg statt auf das Ergebnis fixiert.
{
  const RICHTIG = [
    ["z-1", 0, "Null. Keiner hat heute bisher telefoniert."],
    ["z-4", 0, "Jannik mit rund neunhundertsechzig Leads, danach Ioannis mit knapp achthundert."],
    ["z-7", 0, "Zweitausendeinhundertsiebenundachtzig Leads, verteilt auf vierunddreißig Kunden."],
    ["z-7", 1, "Davon sind eintausendsiebenhundertsiebenunddreißig noch nie angerufen worden."],
    ["z-12", 0, "Nein, aktuell keine offenen Rechnungen — nichts überfällig."],
    ["l-3", 0, "Zum Anrufen liegen 1737 unbearbeitete Leads bereit."],
    ["n-3", 0, "Hey Jannik, wir starten morgen um zehn mit den Aufnahmen. Passt das so?"],
    ["n-3", 1, "Kürzer: Moin Jannik, morgen zehn Uhr geht's los. Bis dann!"],
    ["c1-3", 0, "Zum Anrufen liegen rund siebzehnhundertvierzig Leads bereit, die noch nie angerufen wurden."],
  ];
  for (const [id, i, antwort] of RICHTIG) {
    const zug = zugVon(id, i);
    if (!zug) { pruefe(`Zug ${id}#${i + 1} vorhanden`, false, ""); continue; }
    // Ausdruecklich OHNE Werkzeuge: aus dem STAND beantwortet, keine Abfrage.
    pruefe(`${id}#${i + 1}: richtige Antwort ohne Werkzeug bleibt GRÜN`,
      gruen(zug, antwort, { werkzeuge: [] }), maengel(zug, antwort, { werkzeuge: [] }).join(" | "));
  }
  // …und sie taucht als HINWEIS auf, damit der Weg nicht unter den Tisch faellt.
  const z1 = zugVon("z-1");
  pruefe("z-1: der fehlende Werkzeugaufruf steht als Hinweis im Bericht",
    hinweise(z1, "Null. Keiner hat heute bisher telefoniert.", { werkzeuge: [] }).length === 1, "");

  // Hart bleibt, wo der Aufruf die Leistung IST: Ein Termin, den niemand
  // eintraegt, steht nicht im Kalender — da hilft die schoenste Antwort nichts.
  const eintragen = zugVon("c2-3", 1);
  pruefe("c2-3#2: „Steht“ OHNE termin_eintragen gibt ROT (Pflicht-Werkzeug)",
    rot(eintragen, `Steht, ${PRAEFIX} Probeaufnahme heute um 16 Uhr.`,
      { werkzeuge: [], praefixErlaubt: true }), "");
  pruefe("c2-3#2: mit termin_eintragen bleibt es GRÜN",
    gruen(eintragen, `Steht, ${PRAEFIX} Probeaufnahme heute um 16 Uhr.`,
      { werkzeuge: ["termin_eintragen"], praefixErlaubt: true }), "");
  // Im Fernmodus gibt es kein Sprachprotokoll — dort darf die Werkzeugpflicht
  // nicht als garantiertes Nein durchschlagen, sondern nur als Hinweis.
  pruefe("c2-3#2: im Fernmodus ist die Werkzeugpflicht nur ein Hinweis",
    gruen(eintragen, `Steht, ${PRAEFIX} Probeaufnahme heute um 16 Uhr.`,
      { werkzeuge: [], fern: true, praefixErlaubt: true })
    && hinweise(eintragen, "Steht.", { werkzeuge: [], fern: true, praefixErlaubt: true }).length === 1, "");
}

// --- 6. Geprüft wird der GESPROCHENE Text -----------------------------------
//
// "Umsatz im Juli 2026 waren 5.000 €" wurde als "Unerwuenschte Wendung: €"
// gemeldet — obwohl lib/aussprache.js daraus sauber "fuenftausend Euro" macht.
// Der Pruefer schaute auf den falschen Text.
{
  const s3 = zugVon("s-3");
  pruefe("s-3: „5.000 €“ ist GRÜN — gesprochen wird daraus „fünftausend Euro“",
    gruen(s3, "Umsatz im Juli 2026 waren 5.000 €."), maengel(s3, "Umsatz im Juli 2026 waren 5.000 €.").join(" | "));
  pruefe("s-3: der Aussprache-Filter räumt € und ISO-Datum wirklich weg",
    !/€|\d{4}-\d{2}-\d{2}/.test(gesprochen("Am 2026-07-31 waren es 5.000 €.")),
    gesprochen("Am 2026-07-31 waren es 5.000 €."));
  // Die Gegenprobe, damit s-3 nicht zur Attrappe wird: Ein Waehrungszeichen,
  // das aussprache.js NICHT aufloest (keine Zahl davor), bleibt im gesprochenen
  // Text stehen und muss auffallen. Bricht dort die Waehrungsregel, wird s-3
  // wieder rot — genau dafuer ist das Szenario da.
  pruefe("s-3: ein € im gesprochenen Text gibt weiterhin ROT",
    rot(s3, "Im Juli waren es fünftausend Euro, gerundet auf volle €."), "");
  // Und die Inhaltspruefung muss BEIDE Schreibweisen gelten lassen — sonst
  // faellt "um vier" durch, obwohl genau so gesprochen werden soll.
  const termine = zugVon("c2-3", 0);
  for (const gut of [
    "Zwei heute: um zehn der Anruf bei Fuchsius, um vier die Probeaufnahme.",
    "Heute nur einer: um 16:00 Uhr die Probeaufnahme.",
    "Einer: halb elf das Gespräch mit Bergmann.",
  ]) {
    pruefe(`c2-3#1: „${gut.slice(0, 34)}…“ zählt als Uhrzeit`, gruen(termine, gut), maengel(termine, gut).join(" | "));
  }
  pruefe("c2-3#1: „Heute steht nichts an.“ gibt ROT", rot(termine, "Heute steht nichts an."), "");
}

// --- 7. Technischer Rohtext — in JEDER Antwort ------------------------------
//
// Bis zum 20.08. stand diese Pruefung nur bei r-6. Ein "spawn gws-cli ENOENT"
// mitten in der Aufnahme ist aber immer ein Totalausfall, egal welche Frage
// davor stand.
{
  const roh = "Heute fällig: Wallner Bau und Ladenhauf. Das hat nicht geklappt: Mail: spawn gws-cli ENOENT";
  const durchgerutscht = [];
  for (const sz of SZENARIEN) {
    sz.zuege.forEach((z, i) => {
      if (gruen(z, roh, { praefixErlaubt: true, werkzeuge: [...(z.werkzeug || [])] })) durchgerutscht.push(`${sz.id}#${i + 1}`);
    });
  }
  pruefe("Technischer Rohtext fällt in jedem Zug auf" +
    (durchgerutscht.length ? ` — durchgerutscht bei: ${durchgerutscht.slice(0, 8).join(", ")}` : ""),
    !durchgerutscht.length, "");
  // Gegenprobe: Die deutsche Null ist KEIN technischer Rest. Genau daran hat
  // sich r-6 einmal verschluckt ("für morgen null Wiedervorlagen").
  const r6 = zugVon("r-6");
  const echt = "Heute fällig: Wallner Bau und Ladenhauf, überfällig zwei Follow-ups bei Häckl. " +
    "Anrufe heute bisher null.";
  pruefe("r-6: die deutsche „null“ ist kein Fehler", gruen(r6, echt), maengel(r6, echt).join(" | "));
}

// --- 8. Testmüll aus einem früheren Lauf ------------------------------------
//
// "ADSTEST Probeaufnahme" lag acht Stunden im Produktivkalender und wurde am
// naechsten Morgen bei "Was sind meine Termine heute?" vorgelesen. Der Lauf
// davor hatte gruen gemeldet.
{
  const vorgelesen = `Zwei: um zehn der Anruf bei Fuchsius, um vier die ${PRAEFIX}-Probeaufnahme.`;
  for (const [id, i] of [["c2-3", 0], ["k-1", 0], ["k-2", 0]]) {
    const zug = zugVon(id, i);
    if (!zug) { pruefe(`Zug ${id}#${i + 1} vorhanden`, false, ""); continue; }
    pruefe(`${id}#${i + 1}: vorgelesener Testtermin gibt ROT`,
      rot(zug, vorgelesen, { praefixErlaubt: false }), "kam durch: " + vorgelesen);
  }
  // Gegenprobe: Hat die FRAGE den Präfix genannt, gehört er in die Antwort.
  const absagen = zugVon("c2-3", 2);
  pruefe("c2-3#3: „Abgesagt, ADSTEST … ist raus“ bleibt GRÜN",
    gruen(absagen, `Abgesagt, ${PRAEFIX} Probeaufnahme ist raus.`,
      { praefixErlaubt: true, werkzeuge: ["termin_absagen"] }),
    maengel(absagen, `Abgesagt, ${PRAEFIX} Probeaufnahme ist raus.`,
      { praefixErlaubt: true, werkzeuge: ["termin_absagen"] }).join(" | "));
}

// --- 9. Eine Ausrede ist keine Auskunft -------------------------------------
//
// Die Kehrseite der weichen Werkzeugpruefung: Wer vertroestet, hat nicht
// geantwortet — auch mit Werkzeugaufruf. Frueher waere genau das gruen gewesen
// (Werkzeug lief, kein Panne-Wort), waehrend die richtige Antwort ohne
// Werkzeug rot war. Genau verkehrt herum.
{
  const AUSREDEN = [
    "Schau ich gleich nach und meld mich.",
    "Dazu hab ich keine Zahlen.",
    "Weiß ich gerade nicht, müsste ich erst nachsehen.",
  ];
  // z-9 ("Wie lief's letzte Zeit?") ist ausgenommen: Dort ist der Zeitraum
  // unklar, und Zurueckfragen IST die richtige Antwort. Ein Test, der auch das
  // rot faerbt, verlangt Raten statt Nachfragen.
  const ZAHLENFRAGEN = SZENARIEN.filter((s) => s.gruppe === "zahlen" && s.id !== "z-9");
  const durchgerutscht = [];
  for (const sz of ZAHLENFRAGEN) {
    sz.zuege.forEach((z, i) => {
      for (const a of AUSREDEN) {
        // Mit Werkzeug! Der Punkt ist: Das Werkzeug rettet die Ausrede nicht.
        if (gruen(z, a, { werkzeuge: ["daten_fragen", "nachschlagen"] })) durchgerutscht.push(`${sz.id}#${i + 1} „${a.slice(0, 20)}“`);
      }
    });
  }
  pruefe("Eine Ausrede besteht keine Zahlenfrage — auch nicht mit Werkzeug" +
    (durchgerutscht.length ? ` — durchgerutscht: ${durchgerutscht.slice(0, 6).join(", ")}` : ""),
    !durchgerutscht.length, "");
}

console.log(fehler ? `\n${fehler} Fall/Faelle durchgefallen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
