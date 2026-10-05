// Prueft die Anzeige "Jetzt" auf dem Wochenplan (lib/wochenplan-routes.js).
//
// Die Seite ist nur zum Ansehen, aber genau diese eine Zeile soll stimmen:
// "In welcher Phase sind wir gerade?" (Lukas, 05.10.2026). Faellt eine Pause
// beim Umbau aus dem Plan, laege zwischen zwei Sessions ploetzlich NICHTS —
// die Karte waere leer, und das sieht man der Seite erst zur falschen Uhrzeit an.
//
//   node scripts/test-wochenplan.js

const { wpPhase, wpJetzt, PLAN } = require("../lib/wochenplan-routes.js");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};
const um = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Der Plan hat keine Luecken: Jeder Block endet, wo der naechste beginnt.
const tag = PLAN.tag;
for (let i = 0; i < tag.length - 1; i++) {
  pruefe(`Lueckenlos: ${tag[i].id} endet, wo ${tag[i + 1].id} beginnt`, tag[i].bis === tag[i + 1].von,
    `${tag[i].bis} gegen ${tag[i + 1].von}`);
}
pruefe("Nur der letzte Block hat ein offenes Ende", tag.filter((b) => b.bis === null).length === 1 && tag[tag.length - 1].bis === null);

// Die Zeiten, die Lukas genannt hat.
const faelle = [
  [1, "07:30", "vorher", null],
  [1, "08:00", "block", "plan"],
  [2, "09:15", "block", "dw1"],
  [3, "10:00", "block", "pause1"],
  [3, "10:15", "block", "dw2"],
  [4, "12:30", "block", "daily"],
  [4, "13:05", "block", "pause2"],
  [5, "14:59", "block", "dw3"],
  [5, "15:10", "block", "pause3"],
  [5, "15:30", "block", "dw3b"],
  [1, "17:00", "block", "dw4"],
  [1, "23:59", "block", "dw4"],
  [6, "11:00", "wochenende", null],
  [0, "18:00", "wochenende", null],
];
for (const [t, zeit, modus, block] of faelle) {
  const ph = wpPhase(t, um(zeit), PLAN);
  pruefe(`Tag ${t}, ${zeit}: ${modus}${block ? " / " + block : ""}`, ph.modus === modus && ph.block === block,
    `bekommen: ${ph.modus} / ${ph.block}`);
}

// Rest und Danach.
let ph = wpPhase(3, um("10:42"), PLAN);
pruefe("10:42: noch 1 Std. 18 Min. bis 12:00", ph.rest === "noch 1 Std. 18 Min. · bis 12:00", ph.rest);
pruefe("10:42: danach Daily Call", ph.danach === "12:00 · Daily Call MMS", ph.danach);
ph = wpPhase(5, um("18:00"), PLAN);
pruefe("Freitagabend: danach Wochenende", /Wochenende/.test(ph.danach) && ph.anteil === null, ph.danach);
ph = wpPhase(2, um("18:00"), PLAN);
pruefe("Dienstagabend: danach morgen 08:00", ph.danach === "Morgen, 08:00 · Besprechung / Plan", ph.danach);
ph = wpPhase(6, um("10:00"), PLAN);
pruefe("Wochenende zeigt die sechs Punkte der Tafel", ph.punkte.length === 6 && ph.punkte.includes("Buchhaltung"));

// Deutsche Zeit, egal wo der Server steht (Container laeuft auf UTC).
// 05.10.2026 08:30 UTC = 10:30 in Berlin (Sommerzeit), ein Montag.
const j = wpJetzt(new Date(Date.UTC(2026, 9, 5, 8, 30)));
pruefe("Berliner Zeit: Montag 10:30", j.tag === 1 && j.min === um("10:30"), JSON.stringify(j));
// 02.11.2026 07:30 UTC = 08:30 in Berlin (Winterzeit).
const w = wpJetzt(new Date(Date.UTC(2026, 10, 2, 7, 30)));
pruefe("Berliner Zeit im Winter: 08:30", w.min === um("08:30"), JSON.stringify(w));

// Die Funktionen laufen auch als Text im Browser — dafuer muessen sie ohne
// Bezuege nach aussen auskommen.
const imBrowser = new Function("P", `${wpJetzt.toString()}\n${wpPhase.toString()}\nreturn wpPhase(3, 645, P);`);
pruefe("wpPhase laeuft als Text (wie im Skript der Seite)", imBrowser(PLAN).block === "dw2");

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gut.");
process.exit(fehler ? 1 : 0);
