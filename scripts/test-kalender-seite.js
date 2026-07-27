// Prueft die Kalender-Rechnerei aus lib/kalender.js — die Stellen, an denen
// ein Kalender still falsch wird, statt laut zu scheitern:
//
//   - Monatsraster: faengt es am Montag an, hoert es am Sonntag auf, sind es
//     immer volle Wochen?
//   - Google-Eigenheit: end.date ist bei GANZTAEGIGEN Terminen der Tag DANACH.
//     Wer das nicht abzieht, malt jeden ganztaegigen Termin einen Tag zu lang.
//   - Ein Termin, der exakt um Mitternacht endet, gehoert zum Vortag.
//   - Zeitzone: alsDate/tagPlus duerfen den Tag nicht kippen (der Container
//     laeuft in UTC, der Laptop in Berlin — beides muss dasselbe ergeben).
//
// Laeuft ohne gws-cli und ohne Datenbank.

const kal = require("../lib/kalender.js");

let fehler = 0;
function pruefe(was, bedingung, extra = "") {
  if (bedingung) { console.log("  ok   " + was); return; }
  fehler++;
  console.log("  FEHL " + was + (extra ? "  -> " + extra : ""));
}
const gleich = (was, ist, soll) => pruefe(was, JSON.stringify(ist) === JSON.stringify(soll),
  `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);

console.log("\nDatum");
gleich("tagPlus ueber den Monatswechsel", kal.tagPlus("2026-07-31", 1), "2026-08-01");
gleich("tagPlus rueckwaerts ueber den Jahreswechsel", kal.tagPlus("2027-01-01", -1), "2026-12-31");
gleich("tagPlus ueber den Schalttag", kal.tagPlus("2028-02-28", 1), "2028-02-29");
gleich("montagVon(Montag) ist der Tag selbst", kal.montagVon("2026-07-27"), "2026-07-27");
gleich("montagVon(Sonntag) geht 6 Tage zurueck", kal.montagVon("2026-08-02"), "2026-07-27");
gleich("letzterDesMonats Juli", kal.letzterDesMonats("2026-07-15"), "2026-07-31");
gleich("letzterDesMonats Februar (kein Schaltjahr)", kal.letzterDesMonats("2026-02-05"), "2026-02-28");
gleich("letzterDesMonats Februar (Schaltjahr)", kal.letzterDesMonats("2028-02-05"), "2028-02-29");
// monatPlus rechnet ab dem Ersten — sonst wuerde der 31. Januar plus ein Monat
// im Maerz landen, und der Vor-Zurueck-Knopf wuerde Monate ueberspringen.
gleich("monatPlus vom 31. springt keinen Monat", kal.monatPlus("2026-01-31", 1), "2026-02-01");
gleich("monatPlus rueckwaerts ueber den Jahreswechsel", kal.monatPlus("2026-01-10", -1), "2025-12-01");
gleich("tagOderHeute weist Unsinn ab", kal.tagOderHeute("<script>"), kal.heuteTag());
gleich("tagOderHeute nimmt einen gueltigen Tag", kal.tagOderHeute("2026-03-09"), "2026-03-09");

console.log("\nMonatsraster (volle Wochen)");
for (const monat of ["2026-02-01", "2026-07-01", "2026-08-01", "2027-01-01"]) {
  const von = kal.montagVon(kal.ersterDesMonats(monat));
  const bis = kal.tagPlus(kal.montagVon(kal.letzterDesMonats(monat)), 6);
  let tage = 0;
  for (let d = von; d <= bis; d = kal.tagPlus(d, 1)) tage++;
  pruefe(`${monat.slice(0, 7)}: ${tage} Zellen, ganze Wochen`, tage % 7 === 0 && tage >= 28 && tage <= 42, String(tage));
  pruefe(`${monat.slice(0, 7)}: enthaelt den Ersten und den Letzten`,
    von <= kal.ersterDesMonats(monat) && bis >= kal.letzterDesMonats(monat));
}

console.log("\nGanztaegig: Googles Ende ist der Tag DANACH");
gleich("eintaegig (start 27., ende 28.) liegt nur auf dem 27.",
  kal.tageVon({ start: "2026-07-27", ende: "2026-07-28" }), ["2026-07-27"]);
gleich("dreitaegig (27.–30.) liegt auf 27., 28., 29.",
  kal.tageVon({ start: "2026-07-27", ende: "2026-07-30" }),
  ["2026-07-27", "2026-07-28", "2026-07-29"]);
gleich("ohne Ende: nur der Starttag",
  kal.tageVon({ start: "2026-07-27" }), ["2026-07-27"]);
pruefe("ganztaegig wird an der fehlenden Uhrzeit erkannt",
  kal.istGanztags({ start: "2026-07-27" }) && !kal.istGanztags({ start: "2026-07-27T09:00:00+02:00" }));

console.log("\nMit Uhrzeit");
gleich("normaler Termin liegt auf einem Tag",
  kal.tageVon({ start: "2026-07-27T09:00:00+02:00", ende: "2026-07-27T10:30:00+02:00" }),
  ["2026-07-27"]);
gleich("Termin bis exakt Mitternacht gehoert noch zum Vortag",
  kal.tageVon({ start: "2026-07-27T22:00:00+02:00", ende: "2026-07-28T00:00:00+02:00" }),
  ["2026-07-27"]);
gleich("Termin ueber Mitternacht hinaus liegt auf beiden Tagen",
  kal.tageVon({ start: "2026-07-27T22:00:00+02:00", ende: "2026-07-28T01:00:00+02:00" }),
  ["2026-07-27", "2026-07-28"]);
gleich("minuten() liest die Wandzeit, nicht die Zeitzone",
  kal.minuten("2026-07-27T09:30:00+02:00"), 570);
gleich("uhrzeit() bei ganztaegig ist leer", kal.uhrzeit("2026-07-27"), "");
gleich("dauer() rechnet Ende minus Start",
  kal.dauer({ start: "2026-07-27T09:00:00+02:00", ende: "2026-07-27T10:30:00+02:00" }), 90);
pruefe("dauer() hat eine Untergrenze (sonst unklickbar)",
  kal.dauer({ start: "2026-07-27T09:00:00+02:00", ende: "2026-07-27T09:05:00+02:00" }) >= 30);

console.log("\nEinsortieren");
const karte = kal.nachTagen([
  { titel: "spaet", start: "2026-07-27T16:00:00+02:00", ende: "2026-07-27T17:00:00+02:00" },
  { titel: "frueh", start: "2026-07-27T08:00:00+02:00", ende: "2026-07-27T09:00:00+02:00" },
  { titel: "ganztags", start: "2026-07-27", ende: "2026-07-28" },
  { titel: "anderer Tag", start: "2026-07-29T08:00:00+02:00", ende: "2026-07-29T09:00:00+02:00" },
]);
gleich("Reihenfolge: ganztaegig zuerst, dann nach Uhrzeit",
  (karte["2026-07-27"] || []).map((t) => t.titel), ["ganztags", "frueh", "spaet"]);
gleich("andere Tage bleiben getrennt",
  (karte["2026-07-29"] || []).map((t) => t.titel), ["anderer Tag"]);
pruefe("Tage ohne Termine tauchen nicht auf", karte["2026-07-28"] === undefined);
gleich("leere Eingabe ergibt eine leere Karte", kal.nachTagen([]), {});
gleich("null ergibt eine leere Karte", kal.nachTagen(null), {});

console.log("\nOhne gws-cli sauber scheitern");
kal.spanne("2026-07-27", "2026-07-28").then((r) => {
  if (r.ok) {
    pruefe("gws-cli vorhanden: Antwort ist eine Liste", Array.isArray(r.termine));
  } else {
    pruefe("kein gws-cli: meldet 'fehlt' statt eines Defekts", r.fehlt === true, r.fehler);
  }
  console.log(fehler ? `\n${fehler} Fehler.\n` : "\nAlles gruen.\n");
  process.exit(fehler ? 1 : 0);
});
