// Prüft lib/hermes.js ohne Netz und ohne Datenbank: das Lesen des
// Ereignisstroms und des Ergebnis-Blocks, und den Klartext daraus.
//
//   node scripts/test-auftraege.js
//
// Warum (19.09.2026): Hermes antwortet laut SOUL.md mit genau einem
// JSON-Block. Alles, was Lukas per Telegram oder im Chat liest, entsteht aus
// diesem Block. Geht das Lesen kaputt, bekommt er rohes JSON vorgelesen oder
// gar nichts — und das fällt erst im Betrieb auf.
const { sseZeile, ergebnisLesen, antwortText } = require("../lib/hermes.js");

let fehler = 0;
const pruefe = (ok, was) => { console.log((ok ? "✅" : "❌") + " " + was); if (!ok) fehler++; };

// 1. SSE-Zeilen
pruefe(sseZeile(": keepalive") === null, "Lebenszeichen ergibt kein Ereignis");
pruefe(sseZeile("") === null, "Leerzeile ergibt kein Ereignis");
const d = sseZeile('data: {"event": "message.delta", "run_id": "run_1", "delta": "OK"}');
pruefe(d && d.event === "message.delta" && d.delta === "OK", "message.delta wird gelesen");
const c = sseZeile('data: {"event": "run.completed", "run_id": "run_1", "output": "{\\"zusammenfassung\\":\\"OK\\"}"}');
pruefe(c && c.event === "run.completed" && typeof c.output === "string", "run.completed trägt die Ausgabe");
pruefe(sseZeile("data: {kaputt") === null, "kaputtes JSON wirft nicht");

// 2. Ergebnis-Block
const block = { zusammenfassung: "Brutto: 1.487,50 EUR.", ergebnis: "Steuerbetrag: 237,50 EUR.",
  freigabe_noetig: [], vault_aenderungen: [], offene_fragen: [] };
pruefe(ergebnisLesen(JSON.stringify(block))?.zusammenfassung === block.zusammenfassung, "reiner JSON-Block");
pruefe(ergebnisLesen("Kurz vorweg ein Satz.\n```json\n" + JSON.stringify(block, null, 2) + "\n```")?.ergebnis === block.ergebnis, "JSON im Zaun");
pruefe(ergebnisLesen("Zwei Sätze Klartext davor. Noch einer.\n" + JSON.stringify(block))?.zusammenfassung === block.zusammenfassung, "JSON hinter Klartext");
pruefe(ergebnisLesen('Text mit {Klammer} drin und danach {"zusammenfassung":"X","ergebnis":"Y \\"mit\\" Anführung"}')?.ergebnis === 'Y "mit" Anführung', "letzter gültiger Block gewinnt, Anführungszeichen überleben");
pruefe(ergebnisLesen("nur Text") === null, "kein Block ergibt null");
pruefe(ergebnisLesen("") === null, "leer ergibt null");

// 3. Klartext
const t1 = antwortText(block, "");
pruefe(t1.startsWith("Brutto: 1.487,50 EUR.") && t1.includes("Steuerbetrag: 237,50 EUR."), "Zusammenfassung und Ergebnis");
pruefe(!t1.includes("Freigabe") && !t1.includes("Offene Fragen"), "keine leeren Abschnitte");
const t2 = antwortText({ zusammenfassung: "Rechnung vorbereitet.", ergebnis: "Entwurf 2026-041 liegt im OS.",
  freigabe_noetig: [{ was: "Rechnung 2026-041 an Firma X senden", warum: "ROT: verlässt das Haus" }],
  offene_fragen: ["Netto oder brutto?"] }, "");
pruefe(t2.includes("Freigabe nötig:\n- Rechnung 2026-041 an Firma X senden · ROT: verlässt das Haus"), "Freigaben als Liste");
pruefe(t2.includes("Offene Fragen:\n- Netto oder brutto?"), "offene Fragen als Liste");
pruefe(antwortText({ zusammenfassung: "OK", ergebnis: "OK" }, "") === "OK", "gleiches Ergebnis wird nicht doppelt genannt");
pruefe(antwortText({ zusammenfassung: "Daten", ergebnis: { leads: 3 } }, "").includes('"leads": 3'), "Objekt-Ergebnis wird lesbar ausgegeben");
pruefe(antwortText(null, "  roher Text  ") === "roher Text", "ohne Block bleibt der rohe Text");


// 4. Klartext aus einem Kurzaufruf (Stufe 3.1): JSON-Block -> ergebnis, sonst roh
{
  const { klartext } = require("../lib/hermes.js");
  const p = pruefe;
  p(klartext("Heute stehen zwei Termine an.") === "Heute stehen zwei Termine an.", "Klartext bleibt Klartext");
  p(klartext('{"zusammenfassung":"Satz formuliert.","ergebnis":"Drei neue Leads, zwei Termine.","freigabe_noetig":[]}') === "Drei neue Leads, zwei Termine.", "JSON-Block liefert das Ergebnis");
  p(klartext('{"zusammenfassung":"OK","ergebnis":"","freigabe_noetig":[]}') === "OK", "leeres Ergebnis faellt auf die Zusammenfassung zurueck");
  p(klartext("  ") === "", "leer bleibt leer");
}

if (fehler) { console.log(`\n${fehler} Prüfung(en) fehlgeschlagen.`); process.exit(1); }
console.log("\nAlle Prüfungen bestanden.");
