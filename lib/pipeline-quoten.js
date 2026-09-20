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
  // 0 % vor dem Gespräch (20.09.2026, Vorgabe Lukas). Vorher standen hier
  // 10 %, und damit trug ein Lead, der einmal angerufen wurde, schon Geld zur
  // Pipeline bei. Er hat aber nichts zugesagt — nicht einmal ein Gespräch.
  // Eine Pipeline, in der solche Betraege mitzaehlen, ist eine Wunschliste.
  // Die 0 wirkt doppelt: als Anzeige auf der Spalte UND als Ausschluss aus
  // dem Pipeline-Volumen (siehe zaehltInPipeline unten).
  "Neu": 0,
  "Follow-up": 0,
  // Vor dem Gespräch wird nur vorbereitet — das hebt die Abschlusschance noch nicht.
  "Analyse & Strategie": 0,
  // Ein gebuchtes Gespräch ist der grosse Sprung.
  "Erstgespräch": 55,
  // Nach dem Gespräch entscheidet kaum jemand sofort. Wer hier steht, hat Interesse
  // gezeigt, ist aber noch nicht sicher — deutlich besser als vor dem Gespräch.
  "Follow-up nach Erstgespräch": 65,
  // KI-Verkauf: die ganze Leiter hat Lukas am 20.09.2026 selbst gesetzt.
  // Sie liegt durchweg niedriger als im Webdesign, und das ist kein Versehen:
  // Ein KI-Projekt wird ueber mehrere Gespraeche verkauft, da faellt zwischen
  // Setting Call und Abschluss mehr weg als bei einer Webseite.
  //
  // Follow-up nach Setting Call bekommt bewusst DIESELBEN 33 % wie der Setting
  // Call (Migration 0074, ausdrueckliche Vorgabe). Ein gelaufenes Gespraech
  // ohne Zusage ist weder besser noch schlechter als eines, das noch
  // bevorsteht — die Karte wandert nur weiter, damit man am Montag sieht, mit
  // wem man wirklich noch spricht.
  // Setting Call und KI-Workshop sind seit Migration 0076 EINE Phase mit
  // 44 % — es ist dasselbe Gespräch. Die alten Einzelnamen stehen weiter in
  // der Tabelle: Sie kommen in alten Aktivitäten und Auswertungen vor, und
  // eine Phase, die ploetzlich keine Quote mehr hat, faellt still auf die
  // Rechenformel zurueck, statt sich zu beschweren.
  "Setting Call / KI-Workshop": 44,
  "Follow-up nach Setting Call / KI-Workshop": 44,
  "Setting Call": 44,
  "KI-Workshop": 44,
  "Follow-up nach Setting Call": 44,
  "KI-Masterplan versendet": 65,
  "Sales-Call": 66,
  "Follow-up nach Sales-Call": 78,
  "Angebot": 78,
  "Gewonnen": 100,
  "Verloren": 0,
};

// WO EINE PHASE IM BRETT STEHT — die Reihenfolge des Trichters.
//
// Gilt nur fuer die Gesamtsicht, in der Webdesign und KI nebeneinander in
// einer Spaltenreihe stehen. Bis zum 20.09.2026 war das schlicht die
// Abschlusschance. Das ging so lange gut, wie beide Bereiche aehnliche Quoten
// hatten — bis der KI-Verkauf eigene, niedrigere Zahlen bekam: Mit
// KI-Workshop 44 % und Erstgespräch 55 % waere der Workshop plotzlich LINKS
// vom Erstgespräch gestanden. Ein Trichter, der zurueckspringt.
//
// Darum eine eigene Leiter. Sie beschreibt den Ablauf, nicht die Chance, und
// aendert sich nur, wenn eine Phase dazukommt. Wer eine Quote anpasst, muss
// hier nichts anfassen — genau das war der Fehler.
//
// "Verloren" gehoert ans rechte Ende und nicht nach ganz links, obwohl die
// Chance dort 0 ist.
const STUFEN_PLATZ = {
  "Neu": 10,
  "Follow-up": 20,
  "Analyse & Strategie": 25,
  "Erstgespräch": 30,
  "Setting Call": 30,
  "Setting Call / KI-Workshop": 30,
  "Follow-up nach Erstgespräch": 40,
  "Follow-up nach Setting Call": 40,
  "Follow-up nach Setting Call / KI-Workshop": 40,
  "KI-Workshop": 50,
  "KI-Masterplan versendet": 60,
  "Sales-Call": 70,
  "Angebot": 75,
  "Follow-up nach Sales-Call": 80,
  "Gewonnen": 100,
  "Verloren": 101,
};
// Unbekannte Phase: zurueck auf die Abschlusschance, sonst die Mitte — eine
// neue Spalte soll irgendwo Sinnvolles landen und nicht das Brett sprengen.
const stufenPlatz = (name) => STUFEN_PLATZ[name] ?? (name === "Verloren" ? 101 : (STUFEN_QUOTE[name] ?? 50));

// Abschluss-Wahrscheinlichkeit einer Phase: erste 10 %, letzte 100 % — skaliert
// mit der Phasenzahl, falls die Stufe nicht in der Tabelle steht.
const wahrsch = (anzahl, i, name) =>
  STUFEN_QUOTE[name] ?? Math.round(10 + (90 * i) / Math.max(1, anzahl - 1));

// AB WANN EIN DEAL INS PIPELINE-VOLUMEN ZAEHLT (20.09.2026).
//
// Lukas: "Wenn bei einem Follow-up-Kunden 5.000 EUR als Wert dabeisteht, wird
// es nicht in die Pipeline gerechnet, sondern erst ab Gespräch — bei KI
// logischerweise erst ab Setting Call."
//
// Die Regel haengt bewusst an der QUOTE und nicht an einer zweiten Liste mit
// Phasennamen. Zwei Listen waeren zwei Wahrheiten: Wer spaeter eine Phase
// umbenennt oder eine neue vor das Gespraech schiebt, haette die eine
// angefasst und die andere vergessen — und die Pipeline haette still wieder
// Betraege gezaehlt, die niemand zugesagt hat. So gilt: Eine Phase mit 0 %
// Abschlusschance kann kein Volumen beitragen. Punkt.
//
// Der Betrag bleibt trotzdem auf der Karte stehen — er ist ja bekannt, er
// zaehlt nur noch nicht.
const zaehltInPipeline = (anzahl, i, name) => wahrsch(anzahl, i, name) > 0;

module.exports = { STUFEN_QUOTE, STUFEN_PLATZ, stufenPlatz, wahrsch, zaehltInPipeline };
