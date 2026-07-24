// Testet das direkte Eintragen von Terminen (Phase 4, 25.07.).
//
// Hintergrund: "Trag mir morgen 10 Uhr spazieren ein" ging an Hermes und
// brauchte 43,8 s. Ueber gws-cli dauert derselbe Eintrag etwa eine Sekunde.
//
// Geprueft wird vor allem die ZEITUMRECHNUNG — daran scheitert so etwas still:
// Modelle lassen die Zeitzone gern weg, und ein Termin, der eine Stunde
// verschoben im Kalender landet, faellt erst auf, wenn jemand zu spaet kommt.
//
// Aufruf: node scripts/test-termin.js

const werkzeuge = require("../lib/werkzeuge.js");
const { zeitNormal, stundeSpaeter } = werkzeuge;

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// --- Zeitangaben normalisieren -------------------------------------------
pruefe("Ohne Zeitzone -> Sommerzeit +02:00 wird ergaenzt",
  zeitNormal("2026-07-26T10:00") === "2026-07-26T10:00:00+02:00");
pruefe("Im Winter -> +01:00",
  zeitNormal("2026-01-15T09:30") === "2026-01-15T09:30:00+01:00");
pruefe("Mit Sekunden funktioniert auch",
  zeitNormal("2026-07-26T10:00:45") === "2026-07-26T10:00:45+02:00");
pruefe("Vorhandene Zeitzone bleibt unangetastet",
  zeitNormal("2026-07-26T10:00:00+02:00") === "2026-07-26T10:00:00+02:00");
pruefe("Zeitzone ohne Doppelpunkt wird korrigiert",
  zeitNormal("2026-07-26T10:00+0200") === "2026-07-26T10:00:00+02:00");
pruefe("Zulu-Zeit bleibt Zulu", zeitNormal("2026-07-26T08:00:00Z") === "2026-07-26T08:00:00Z");
pruefe("Leerzeichen statt T wird akzeptiert",
  zeitNormal("2026-07-26 10:00") === "2026-07-26T10:00:00+02:00");

pruefe("Nur ein Datum bleibt ein Datum (ganztaegig)", zeitNormal("2026-07-26") === "2026-07-26");
pruefe("Ganztags schneidet die Uhrzeit ab",
  zeitNormal("2026-07-26T10:00", { ganztags: true }) === "2026-07-26");

pruefe("Unsinn wird abgelehnt", zeitNormal("morgen um zehn") === null);
pruefe("Leer wird abgelehnt", zeitNormal("") === null);
pruefe("Halbes Datum wird abgelehnt", zeitNormal("2026-07") === null);

// --- Ende automatisch bestimmen ------------------------------------------
pruefe("Eine Stunde drauf", stundeSpaeter("2026-07-26T10:00:00+02:00") === "2026-07-26T11:00:00+02:00");
pruefe("Ueber Mitternacht hinweg", stundeSpaeter("2026-07-26T23:30:00+02:00") === "2026-07-27T00:30:00+02:00");

// --- Termin finden: Lukas nennt eine Beschreibung, keine ID --------------
const { terminFinden } = require("../lib/sprache-routes.js");
const KAL = [
  { id: "e1", titel: "Physio", start: "2026-07-27T10:00:00+02:00" },
  { id: "e2", titel: "Kalhofer-Anruf", start: "2026-07-27T14:00:00+02:00" },
  { id: "e3", titel: "Physio", start: "2026-07-30T10:00:00+02:00" },
  { id: "e4", titel: "Erstgespräch Herr Müller", start: "2026-07-28T09:00:00+02:00" },
];
pruefe("Eindeutiger Titel wird gefunden", terminFinden("Kalhofer-Anruf", KAL)?.id === "e2");
pruefe("Teilwort reicht", terminFinden("Kalhofer", KAL)?.id === "e2");
pruefe("Fuellwoerter stoeren nicht ('den Termin mit Müller')",
  terminFinden("den Termin mit Müller", KAL)?.id === "e4");
pruefe("Zwei gleichnamige -> mehrdeutig statt geraten",
  Array.isArray(terminFinden("Physio", KAL)?.mehrdeutig));
pruefe("Mit Tag eingegrenzt wird es eindeutig",
  terminFinden("Physio", KAL, "2026-07-30")?.id === "e3");
pruefe("Unbekannter Termin -> null", terminFinden("Zahnarzt", KAL) === null);
pruefe("Leere Beschreibung -> null", terminFinden("", KAL) === null);
pruefe("Leerer Kalender -> null", terminFinden("Physio", []) === null);
pruefe("Termine ohne ID kommen nicht in Frage",
  terminFinden("Ohne", [{ titel: "Ohne ID", start: "2026-07-27T10:00:00+02:00" }]) === null);

// --- terminEintragen: Pruefungen VOR dem Aufruf ---------------------------
(async () => {
  let r = await werkzeuge.terminEintragen({ titel: "", start: "2026-07-26T10:00" });
  pruefe("Ohne Titel wird abgelehnt", !r.ok && /Titel/i.test(r.grund));

  r = await werkzeuge.terminEintragen({ titel: "Sport", start: "irgendwann" });
  pruefe("Unlesbare Startzeit wird abgelehnt", !r.ok && /Startzeit/i.test(r.grund));

  // Ohne gws-cli auf dieser Maschine muss es sauber scheitern statt zu werfen.
  r = await werkzeuge.terminEintragen({ titel: "Spazieren", start: "2026-07-26T10:00" });
  pruefe("Ohne gws-cli: sauberer Fehler statt Absturz", typeof r.ok === "boolean");
  console.log(`   (hier ${r.ok ? "eingetragen" : "erwartet fehlgeschlagen: " + String(r.grund).slice(0, 60)})`);

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
