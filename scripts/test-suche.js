// Testet das schnelle Nachschlagen (Phase 4, 25.07.).
//
// Hintergrund: "Wer wurde letzte Saison Bundesliga-Meister?" lief ueber die
// Modell-Websuche und brach nach 40 s im Timeout ab — ohne Antwort. Der direkte
// Abruf liefert in unter einer Sekunde.
//
// Die Netzteile laufen nur mit --netz (sonst haengt der Test am Internet).
// Aufruf:  node scripts/test-suche.js  [--netz]

const suche = require("../lib/suche.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// --- Begriffe: aus der Frage das Tragende ziehen --------------------------
const b1 = suche.begriffe("kannst du mir mal sagen wer der Bundeskanzler ist");
pruefe("Fuellwoerter fliegen raus", !b1.includes("kannst") && !b1.includes("sagen") && !b1.includes("wer"));
pruefe("Der tragende Begriff bleibt", b1.includes("Bundeskanzler"));

const b2 = suche.begriffe("wie hoch ist der Eiffelturm?");
pruefe("Satzzeichen stoeren nicht", b2.includes("Eiffelturm"));

pruefe("Leere Frage ergibt keine Begriffe", suche.begriffe("").length === 0);
pruefe("Nur Fuellwoerter ergeben nichts", suche.begriffe("kannst du mir mal sagen").length === 0);

// --- Passende Stellen: das Relevante aus einem langen Artikel -------------
const artikel = [
  "Die Bundesliga 2025/26 war die 63. Spielzeit der hoechsten deutschen Spielklasse.",
  "Insgesamt fanden 306 Ligaspiele statt und die Zuschauerzahlen blieben stabil.",
  "Der FC Bayern Muenchen wurde am 31. Spieltag vorzeitig deutscher Meister.",
  "Die Winterpause lag zwischen Dezember und Januar wie in den Vorjahren.",
].join(" ");
const stellen = suche.passendeStellen(artikel, ["Bundesliga", "Meister"]);
pruefe("Der Satz mit der Antwort ist dabei", /vorzeitig deutscher Meister/.test(stellen));
pruefe("Ergebnis bleibt kurz genug fuers Modell", stellen.length <= 1400);

const ohneTreffer = suche.passendeStellen(artikel, ["Kartoffelsalat"]);
pruefe("Ohne Treffer kommt wenigstens der Anfang", ohneTreffer.length > 0);

// --- Netzteil (optional) --------------------------------------------------
(async () => {
  if (process.argv.includes("--netz")) {
    console.log("\n--- mit Netz ---");
    const r = await suche.schnellNachschlagen("wie hoch ist der Eiffelturm");
    pruefe("Eiffelturm gefunden", r.ok && /Eiffelturm/i.test(r.titel));
    pruefe("Antwort steht im Text", r.ok && /330/.test(r.text));
    pruefe("Unter zwei Sekunden", r.dauerMs < 2000);
    console.log(`   (${r.dauerMs} ms, Artikel "${r.titel}")`);

    const leer = await suche.schnellNachschlagen("xqzzy nichtexistierender begriff blafasel");
    pruefe("Unsinn liefert kein falsches Ergebnis", !leer.ok || leer.text.length > 0);
  } else {
    console.log("\n(Netzteil uebersprungen — mit --netz mitlaufen lassen)");
  }

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
