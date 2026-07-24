// Testet den Vorgehensplan der Erzaehlspur (Stufe 2, 25.07.).
//
// Wunsch Lukas: Waehrend gearbeitet wird, soll Alexandra beschreiben, WAS sie
// macht — konkret zur Aufgabe, menschlich, und nicht jedes Mal derselbe Satz.
// Geprueft wird deshalb vor allem, was aus einer Modellantwort wird: dass
// Aufzaehlungszeichen und Nummern verschwinden, Muell rausfliegt und im
// Fehlerfall lieber gar nichts gesagt wird als eine Floskel.
//
// Aufruf: node scripts/test-plan.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname;
const schnell = require("../lib/schnell.js");
const { planBauen, AUFTRAEGE } = require("../lib/sprache-routes.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

function auftragAnlegen(id) {
  AUFTRAEGE.set(id, { fertig: false, gestartet: Date.now(), was: "hermes", art: "lang", auftragText: "Test" });
  return AUFTRAEGE.get(id);
}

(async () => {
  const original = schnell.frage;

  // 1. Normalfall lange Arbeit: vier Schritte + Abschluss-Satz.
  schnell.frage = async () => [
    "Ich fang mit der Struktur an — Ueberschrift, Nutzen, Beispiele.",
    "Jetzt schreib ich den Einstieg, der muss sitzen.",
    "Dann kommen die Beispiele, sonst bleibt es abstrakt.",
    "Zum Schluss les ich nochmal in Ruhe drueber.",
    "Ab hier dauert's ein paar Minuten — ich meld mich.",
  ].join("\n");
  auftragAnlegen("t2");
  await planBauen("t2", "Onepager ueber ChatGPT erstellen");
  let e = AUFTRAEGE.get("t2");
  pruefe("Vier Schritte uebernommen", e.plan?.length === 4);
  pruefe("Zaehler startet bei null", e.planIndex === 0);
  pruefe("Erster Schritt ist der erste Satz", e.plan[0].startsWith("Ich fang mit der Struktur"));
  pruefe("Abschluss-Satz getrennt abgelegt", e.abschluss === "Ab hier dauert's ein paar Minuten — ich meld mich.");
  pruefe("Abschluss steht NICHT in den Schritten", !e.plan.includes(e.abschluss));

  // 1b. Recherche bekommt weniger Schritte (sie ist in Sekunden durch).
  schnell.frage = async () => [
    "Ich such erst die aktuellen Zahlen.",
    "Dann vergleich ich die Anbieter.",
    "Danach fass ich es kurz zusammen.",
    "Bin gleich durch, dauert nicht lang.",
  ].join("\n");
  auftragAnlegen("t2b");
  await planBauen("t2b", "Preise fuer Meta-Ads recherchieren", "sonnet");
  const b = AUFTRAEGE.get("t2b");
  pruefe("Recherche: nur drei Schritte", b.plan?.length === 3);
  pruefe("Recherche: vierte Zeile wird zum Abschluss", b.abschluss === "Bin gleich durch, dauert nicht lang.");

  // 2. Aufzaehlungszeichen, Nummern und Anfuehrungszeichen fliegen raus.
  schnell.frage = async () => [
    "1. Ich sammle erst die Zahlen.",
    "- Dann bau ich die Uebersicht.",
    "• Danach schreib ich die Empfehlung.",
    "\"Zum Schluss pruef ich alles nochmal.\"",
  ].join("\n");
  auftragAnlegen("t3");
  await planBauen("t3", "Report bauen");
  e = AUFTRAEGE.get("t3");
  pruefe("Nummerierung entfernt", e.plan[0] === "Ich sammle erst die Zahlen.");
  pruefe("Strich entfernt", e.plan[1] === "Dann bau ich die Uebersicht.");
  pruefe("Aufzaehlungspunkt entfernt", e.plan[2] === "Danach schreib ich die Empfehlung.");
  pruefe("Anfuehrungszeichen entfernt", e.plan[3] === "Zum Schluss pruef ich alles nochmal.");

  // 3. Leerzeilen und zu kurze Fragmente werden aussortiert, max 4 Schritte.
  schnell.frage = async () => "\n\nOk\n\nIch starte mit der Gliederung.\n\nJa\nDann die Folien.\nDanach die Bilder.\nZum Schluss der Feinschliff.\nUnd noch was Fuenftes hier.\n";
  auftragAnlegen("t4");
  await planBauen("t4", "Praesentation");
  e = AUFTRAEGE.get("t4");
  pruefe("Fragmente ('Ok', 'Ja') aussortiert", !e.plan.includes("Ok") && !e.plan.includes("Ja"));
  pruefe("Hoechstens vier Schritte", e.plan.length === 4);
  pruefe("Erster echter Satz gewinnt", e.plan[0] === "Ich starte mit der Gliederung.");

  // 3b. Liefert das Modell NUR die Schritte (keine Abschlusszeile), darf der
  //     letzte Arbeitsschritt nicht als Abschied missbraucht werden.
  schnell.frage = async () => [
    "Ich sortier erst die Unterlagen.", "Dann rechne ich durch.",
    "Danach schreib ich es auf.", "Zum Schluss pruef ich die Zahlen.",
  ].join("\n");
  auftragAnlegen("t4b");
  await planBauen("t4b", "Angebot rechnen");
  const c = AUFTRAEGE.get("t4b");
  pruefe("Ohne fuenfte Zeile: kein erfundener Abschluss", c.abschluss === "");
  pruefe("Ohne fuenfte Zeile: alle vier Schritte bleiben", c.plan.length === 4);

  // 4. Faellt das Modell aus, bleibt sie STILL — lieber nichts als eine Floskel.
  schnell.frage = async () => { throw new Error("Anthropic 529"); };
  auftragAnlegen("t5");
  await planBauen("t5", "Angebot schreiben");
  e = AUFTRAEGE.get("t5");
  pruefe("Bei Modellausfall kein Plan (bleibt still)", !e.plan);

  // 5. Antwortet das Modell nur Muell, ebenfalls kein Plan.
  schnell.frage = async () => "\n\n\n";
  auftragAnlegen("t6");
  await planBauen("t6", "Irgendwas");
  e = AUFTRAEGE.get("t6");
  pruefe("Leere Antwort ergibt keinen Plan", !e.plan);

  // 6. Ein fehlender Auftrag darf nicht crashen (Auftrag schon aufgeraeumt).
  let geworfen = false;
  try { await planBauen("gibtsnicht", "Test"); } catch { geworfen = true; }
  pruefe("Unbekannter Auftrag crasht nicht", !geworfen);

  schnell.frage = original;
  for (const id of ["t2", "t2b", "t3", "t4", "t4b", "t5", "t6"]) AUFTRAEGE.delete(id);
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
