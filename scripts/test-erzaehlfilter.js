// Testet den Filter gegen leere und doppelte Zwischensaetze (25.07.).
//
// Rueckmeldung Lukas: "Er sagt drei Mal 'ich schau jetzt nach', nur in anderen
// Worten. Aber er beschreibt nie den Prozess." Der Prompt verlangt Konkretes
// bereits — Haiku haelt sich nicht immer daran. Deshalb wird im Code geprueft.
//
// Aufruf: node scripts/test-erzaehlfilter.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname;
const { nenntEtwasKonkretes, zuAehnlich, schritteFiltern } = require("../lib/sprache-routes.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// --- Floskel oder konkret? -----------------------------------------------
// Deutsche Substantive sind grossgeschrieben — daran haengt die Erkennung.
for (const satz of [
  "Ich schau mir das kurz an.",
  "Ich pruefe das.",
  "Ich recherchiere das eben.",
  "Ich hol dir das gleich.",
  "Das schau ich mir mal an.",
]) pruefe(`Floskel erkannt: „${satz}“`, !nenntEtwasKonkretes(satz));

for (const satz of [
  "Ich schau in die aktuellen Bundesliga-Tabellen.",
  "Jetzt bau ich die drei Kernpunkte rein.",
  "Dann gleich ich ab, ob die Top-3 nah beieinander sind.",
  "Zuerst die Gliederung, dann die Folien.",
  "Ich vergleiche die Zahlen von Meta und Google.",
]) pruefe(`Konkret erkannt: „${satz.slice(0, 44)}…“`, nenntEtwasKonkretes(satz));

// --- Sagen zwei Saetze dasselbe? -----------------------------------------
pruefe("Fast gleiche Saetze werden erkannt",
  zuAehnlich("Ich schau in die aktuellen Bundesliga-Tabellen.",
             "Ich schaue mir die aktuellen Bundesliga-Tabellen an."));
pruefe("Verschiedene Saetze bleiben verschieden",
  !zuAehnlich("Ich fang mit der Gliederung an.", "Dann kommen die Beispiele dazu."));
pruefe("Leere Saetze gelten nicht als aehnlich", !zuAehnlich("", "Ich fang an."));

// --- Der Filter im Zusammenspiel -----------------------------------------
const gefiltert = schritteFiltern([
  "Ich schau mir das kurz an.",                                  // Floskel -> raus
  "Ich schau in die aktuellen Bundesliga-Tabellen.",             // bleibt
  "Ich schaue mir die aktuellen Bundesliga-Tabellen an.",        // Doppelung -> raus
  "Dann gleich ich ab, wie viele Spieltage noch laufen.",        // bleibt
  "Ich pruefe das.",                                             // Floskel -> raus
]);
pruefe("Nur die zwei brauchbaren Schritte bleiben", gefiltert.length === 2);
pruefe("Der erste konkrete Satz bleibt erhalten", /Bundesliga-Tabellen/.test(gefiltert[0]));
pruefe("Die Doppelung ist weg", gefiltert.filter((z) => /Bundesliga/.test(z)).length === 1);

pruefe("Nur Floskeln ergeben gar keinen Plan (dann bleibt sie still)",
  schritteFiltern(["Ich schau nach.", "Ich pruefe das.", "Ich hol das."]).length === 0);
pruefe("Leere Eingabe ergibt leeres Ergebnis", schritteFiltern([]).length === 0);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
