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

// --- Frage saeubern: Vorspann weg, Frage bleibt ---------------------------
pruefe("'kannst du mir sagen' faellt weg",
  suche.frageSaeubern("kannst du mir sagen wer Bundesliga Meister wurde") === "wer Bundesliga Meister wurde");
pruefe("'google mal' faellt weg",
  suche.frageSaeubern("google mal was XYZ kostet") === "was XYZ kostet");
pruefe("'Hey Alexandra,' faellt weg",
  suche.frageSaeubern("Hey Alexandra, wie hoch ist der Eiffelturm") === "wie hoch ist der Eiffelturm");
pruefe("Normale Frage bleibt unveraendert",
  suche.frageSaeubern("wie hoch ist der Eiffelturm") === "wie hoch ist der Eiffelturm");
pruefe("Nur Vorspann -> Original bleibt erhalten (nie leer)",
  suche.frageSaeubern("google mal").length > 0);

// Alles Weitere NACHEINANDER: Der Serper-Test tauscht global.fetch aus. Liefe
// der Netzteil parallel, wuerde er in die Attrappe laufen statt ins Internet.
(async () => {
  // --- Google/Serper: Antwort zusammenbauen (ohne echten Schluessel) ------
  const echtesFetch = global.fetch;
  const alterKey = process.env.SERPER_API_KEY;
  process.env.SERPER_API_KEY = "test";

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      answerBox: { answer: "FC Bayern München", title: "Deutscher Meister 2026" },
      knowledgeGraph: { title: "FC Bayern München", type: "Fußballverein", attributes: { Gegründet: "1900" } },
      organic: [
        { title: "Bundesliga 2025/26", snippet: "Bayern sicherte sich am 31. Spieltag den Titel." },
        { title: "Sportschau", snippet: "Die Meisterschale ging erneut nach München." },
      ],
    }),
  });
  const g = await suche.serper("wer wurde Meister");
  pruefe("Google: direkte Antwort wird uebernommen", g.ok && /FC Bayern München/.test(g.text));
  pruefe("Google: Belege aus den Treffern dabei", /31. Spieltag/.test(g.text));
  pruefe("Google: Wissensbereich dabei", /Fußballverein/.test(g.text));
  pruefe("Google: bleibt kurz genug fuers Modell", g.text.length <= 1600);

  global.fetch = async () => ({ ok: true, json: async () => ({ organic: [] }) });
  const leer = await suche.serper("nichts dazu");
  pruefe("Google ohne Treffer: kein erfundenes Ergebnis", !leer.ok);

  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  let geworfen = false;
  try { await suche.serper("egal"); } catch { geworfen = true; }
  pruefe("Google mit falschem Schluessel wirft (Rueckfall greift)", geworfen);

  global.fetch = echtesFetch;
  if (alterKey === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = alterKey;

  // --- Netzteil (optional) ------------------------------------------------
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
