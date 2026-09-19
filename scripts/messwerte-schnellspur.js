// Misst die Schnellspur ueber Hermes (Stufe 3.1): acht typische Kurzaufrufe,
// Zeit je Aufruf, Median und p90. Braucht Netz zum Hermes-Container:
//
//   docker exec -w /app flowstate-dashboard node scripts/messwerte-schnellspur.js
//
// Abnahme laut Plan: p90 unter 5 s. Sonst bleibt SCHNELL_PROVIDER=anthropic.
const hermes = require("../lib/hermes.js");
const PROBEN = [
  ["Formuliere einen freundlichen Satz fuer Lukas.", "3 neue Leads, 2 Termine heute, 1 Rechnung ueberfaellig."],
  ["Entnimm Betrag und Datum als JSON {betrag, datum}.", "Rechnung vom 12.09.2026 ueber 1.250,00 EUR brutto."],
  ["Ordne die Nachricht einer Kategorie zu: Vertrieb, Marketing, Buchhaltung, Sonstiges. Nur das Wort.", "Der Kunde fragt nach dem Angebot fuer die Webseite."],
  ["Schreibe einen Betreff fuer diese Mail, hoechstens acht Woerter.", "Wir bestaetigen den Termin am Dienstag um 10 Uhr und schicken die Unterlagen vorab."],
  ["Fasse in einem Satz zusammen.", "Lukas hat mit Herrn Holzer telefoniert, Follow-up am 21.09. um 10:00, Interesse an einer Webseite mit Shop."],
  ["Antworte nur mit ja oder nein.", "Ist 'Nachfassen am 21.09.' ein Termin in der Zukunft, wenn heute der 19.09.2026 ist?"],
  ["Korrigiere Rechtschreibung, sonst nichts aendern.", "wir habn den auftrag bekomen und starten naechste woche"],
  ["Nenne die Uhrzeit im Format HH:MM.", "Treffen ist um halb elf vormittags."],
];
(async () => {
  const zeiten = [];
  for (const [system, nutzer] of PROBEN) {
    const t0 = Date.now();
    try {
      const antwort = await hermes.kurz(system, nutzer, { timeoutMs: 20000 });
      const ms = Date.now() - t0; zeiten.push(ms);
      console.log(`${String(ms).padStart(5)} ms  ${JSON.stringify(antwort).slice(0, 90)}`);
    } catch (e) { console.log(`FEHLER  ${e.message}`); }
  }
  const s = [...zeiten].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  console.log(`\n${zeiten.length}/${PROBEN.length} beantwortet · Median ${q(0.5)} ms · p90 ${q(0.9)} ms · max ${s[s.length - 1]} ms`);
  process.exit(zeiten.length === PROBEN.length ? 0 : 1);
})();
