// Testet die Satz-Erkennung der Gespraechssteuerung aus public/sprache.js:
// WELCHE Saetze beenden das Gespraech — und welche auf keinen Fall.
//
// Hintergrund (Lukas 24.07.): Alexandra schaltete sich nach jeder Aufgabe ab,
// er musste staendig neu "Hey Alexandra" sagen. Jetzt bleibt das Gespraech
// offen, bis er es ausdruecklich beendet. Dabei darf "ok, ich mach mich an die
// Arbeit" NICHT beenden, "bist du fertig?" auch nicht (das ist eine Frage).
//
// Die Regexe werden aus der echten Datei gelesen — so kann der Test nicht
// stillschweigend von der Auslieferung abweichen.
//
// Aufruf: node scripts/test-gespraech.js

const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(path.join(__dirname, "..", "public", "sprache.js"), "utf-8");

// Die drei Ausdruecke aus der Datei ziehen und hier nachbauen.
const block = quelle.slice(quelle.indexOf("const ENDE_RE"), quelle.indexOf("const willBeenden"));
const frageZeile = quelle.match(/const FRAGE_RE = (\/.*\/[a-z]*);/);
const stoppZeile = quelle.match(/const STOPP_RE = (\/.*\/[a-z]*);/);
if (!block || !frageZeile || !stoppZeile) {
  console.log("❌ Konnte die Ausdruecke nicht aus public/sprache.js lesen — Aufbau geaendert?");
  process.exit(1);
}
// eslint-disable-next-line no-eval
const ENDE_RE = eval(block.replace(/^const ENDE_RE =/, "").replace(/;\s*$/, "").trim());
const FRAGE_RE = eval(frageZeile[1]);
const STOPP_RE = eval(stoppZeile[1]);
const willBeenden = (t) => ENDE_RE.test(t) && !FRAGE_RE.test(t);

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// --- Das MUSS beenden ------------------------------------------------------
for (const satz of [
  "ok passt, fertig",
  "passt so",
  "danke, das war's",
  "das war's erstmal",
  "ok, schalte ich wieder ab",
  "schalt dich wieder ab",
  "bis später",
  "tschüss",
  "feierabend",
]) pruefe(`beendet: „${satz}“`, willBeenden(satz));

// --- Das darf NIEMALS beenden ---------------------------------------------
for (const satz of [
  "ok ich mache mich an die Arbeit",                 // Lukas' ausdrueckliches Beispiel
  "ok, ich mach mich mal an die Arbeit",
  "bist du fertig?",                                 // Zwischenfrage
  "bist du fertig",
  "wie schaut's aus",
  "was machst du gerade",
  "ist die Präsentation fertig",
  "schreib Jannik dass wir morgen fertig werden",
  "wann bist du fertig damit",
  "trag mir morgen einen Termin ein",
]) pruefe(`bleibt offen: „${satz}“`, !willBeenden(satz));

// --- Stopp bleibt Stopp (harter Aus-Knopf) --------------------------------
pruefe("Stopp erkannt: „stopp“", STOPP_RE.test("stopp"));
pruefe("Stopp erkannt: „hör auf“", STOPP_RE.test("hör auf"));
pruefe("Kein Fehlalarm: „das ist halt so“", !STOPP_RE.test("das ist halt so"));

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
