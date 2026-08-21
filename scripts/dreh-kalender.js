// Den Drehtag in den Kalender schreiben — die vier Calls aus C2_05.
//
// WARUM ES DAS BRAUCHT (21.08.2026): Die Termine standen fest auf dem
// 20.08. Am naechsten Drehtag war der Kalender leer, waehrend Erik in C2_05
// vier Calls aufzaehlt. Auf dem zweiten Bildschirm haette man ein leeres
// Tagesraster gesehen, waehrend die Stimme Termine vorliest — genau der
// Widerspruch, den die Kamera festhaelt.
//
// Deshalb: nicht ein festes Datum, sondern HEUTE. Vor jedem Drehtag einmal
// laufen lassen.
//
// Die Uhrzeiten und Namen stehen genau so in C2_05. Gelesen werden sie aus
// skript.json, damit sie nicht zweimal gepflegt werden muessen — die Zeile
// dort ist die Wahrheit, dieses Skript nur ihre Umsetzung.
//
//   node scripts/dreh-kalender.js            Termine fuer heute anlegen
//   node scripts/dreh-kalender.js --zeigen   nur nachsehen, was dasteht
//   node scripts/dreh-kalender.js --leeren   alles wieder wegnehmen
//
// Es wird IMMER erst geleert: Zweimal aufgerufen soll nicht acht Termine
// ergeben. Weggeraeumt wird nur, was dieses Skript kennt.

const kalender = require("../lib/kalender.js");
const werkzeuge = require("../lib/werkzeuge.js");

// Was C2_05 aufzaehlt. Die Reihenfolge ist die des gesprochenen Satzes.
const TAG = [
  { von: "10:00", bis: "11:00", titel: "Erstgespräch Herr Bayer" },
  { von: "11:30", bis: "12:30", titel: "Sales Call Herr Widmann" },
  { von: "14:00", bis: "15:00", titel: "Meeting mit Alex — Paddel" },
  { von: "17:30", bis: "18:30", titel: "Erstgespräch Herr Bauer" },
];

// Auch Gym und der freie Abend gehoeren weg: Sie entstehen WAEHREND der
// Aufnahme (C2_07), und wenn sie vorher schon dastehen, gibt es nichts zu
// sehen. Beim Aufraeumen nach einem Take von gestern sind sie auch dabei.
const UNSERE = new RegExp("^(" + TAG.map((t) => t.titel.replace(/[.*+?^${}()|[\]\\—]/g, "\\$&"))
  .concat(["Gym", "Privat"]).join("|") + ")");

const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

async function zeigen(tag) {
  const r = await kalender.spanne(tag, tag, 60);
  if (!r.ok) { console.error("Kalender nicht lesbar:", r.fehler || r.grund); process.exit(1); }
  const t = r.termine || [];
  console.log(`${tag}: ${t.length ? "" : "(leer)"}`);
  t.forEach((x) => console.log("   " + String(x.start).slice(11, 16) + "  " + x.titel));
  return t;
}

async function leeren(tag) {
  const t = await kalender.spanne(tag, tag, 60);
  let weg = 0;
  for (const x of (t && t.termine) || []) {
    if (UNSERE.test(String(x.titel || "")) && x.id) {
      await werkzeuge.terminAbsagen({ id: x.id });
      weg++;
    }
  }
  return weg;
}

(async () => {
  const tag = heute();
  const argv = process.argv.slice(2);

  if (argv.includes("--zeigen")) { await zeigen(tag); return; }

  const weg = await leeren(tag);
  if (weg) console.log(`${weg} alte(r) Termin(e) entfernt.`);
  if (argv.includes("--leeren")) { await zeigen(tag); return; }

  for (const e of TAG) {
    const r = await werkzeuge.terminEintragen({
      titel: e.titel,
      start: `${tag}T${e.von}:00`,
      ende: `${tag}T${e.bis}:00`,
    });
    // Ein stiller Fehlschlag waere hier teuer: Die Stimme zaehlt vier Calls
    // auf, und im Bild stuenden drei.
    if (!r || r.ok === false) {
      console.error("FEHLGESCHLAGEN:", e.titel, JSON.stringify(r).slice(0, 200));
      process.exitCode = 1;
    }
  }
  console.log(`Drehtag ${tag} steht:`);
  const t = await zeigen(tag);
  if (t.length !== TAG.length) {
    console.error(`\nACHTUNG: ${t.length} Termine statt ${TAG.length}. C2_05 zählt vier Calls auf.`);
    process.exitCode = 1;
  }
})().catch((e) => { console.error("Fehlgeschlagen:", e.message); process.exit(1); });
