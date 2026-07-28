// lib/pipeline-quoten.js — mit welcher Wahrscheinlichkeit wird aus einem Deal Umsatz?
//
// Warum es diese Datei gibt (27.07.2026): Diese Tabelle stand in
// crm-routes.js, und der Forecast des CRM-Dashboards wurde daraus gerechnet.
// Die Zentrale zeigt jetzt denselben Forecast. Haette sie eine eigene Kopie
// bekommen, waere die erste Aenderung an einer Stufe die letzte gewesen, bei
// der beide Seiten dieselbe Zahl zeigen — und niemand haette es gemerkt, weil
// zwei plausible Zahlen an zwei Stellen nicht auffallen.
//
// Also: EINE Tabelle, zwei Leser. Wer eine Quote aendert, aendert sie hier.

// Feste Wahrscheinlichkeit je Stufe. "Follow-up" bleibt bei 10 %, weil ein
// erreichter Kontakt allein noch nichts ueber einen Abschluss sagt — erst das
// Erstgespraech zaehlt. Unbekannte Stufen fallen auf eine gleichmaessige
// Verteilung ueber die Phasenzahl zurueck (siehe wahrsch unten).
const STUFEN_QUOTE = {
  "Neu": 10,
  "Follow-up": 10,
  // Vor dem Gespräch wird nur vorbereitet — das hebt die Abschlusschance noch nicht.
  "Analyse & Strategie": 10,
  // Ein gebuchtes Gespräch ist der grosse Sprung. Bei KI heisst es Readiness-Check.
  "Erstgespräch": 55,
  "Readiness-Check gebucht": 55,
  // Nach dem Gespräch entscheidet kaum jemand sofort. Wer hier steht, hat Interesse
  // gezeigt, ist aber noch nicht sicher — deutlich besser als vor dem Gespräch.
  "Follow-up nach Erstgespräch": 65,
  // Bei KI ist das Ergebnis des Readiness-Checks der Masterplan.
  "KI-Masterplan erstellen": 65,
  "KI-Masterplan versendet": 65,
  "Zweites Erstgespräch": 75,
  "Angebot": 78,
  "Gewonnen": 100,
  "Verloren": 0,
};

// Wo eine Phase im Brett steht. Fast immer die Abschlusschance — nur "Verloren"
// gehoert ans rechte Ende und nicht nach ganz links, obwohl die Chance dort 0 ist.
const stufenPlatz = (name) => (name === "Verloren" ? 101 : (STUFEN_QUOTE[name] ?? 50));

// Abschluss-Wahrscheinlichkeit einer Phase: erste 10 %, letzte 100 % — skaliert
// mit der Phasenzahl, falls die Stufe nicht in der Tabelle steht.
const wahrsch = (anzahl, i, name) =>
  STUFEN_QUOTE[name] ?? Math.round(10 + (90 * i) / Math.max(1, anzahl - 1));

module.exports = { STUFEN_QUOTE, stufenPlatz, wahrsch };
