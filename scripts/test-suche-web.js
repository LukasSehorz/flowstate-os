// Testet die Websuche OHNE Netz (20.08.2026).
//
// Zwei Tests, zwei Aufgaben:
//   · scripts/websuche-proben.js faehrt 27 echte Fragen gegen das Internet.
//     Das ist die Wahrheit, dauert eine Minute und braucht Schluessel.
//   · DIESER Test prueft die Rechnerei drumherum — Rueckbezug, Textaufbereitung,
//     Sprechtext. Er laeuft in Millisekunden, ohne Netz, und darum auch in
//     scripts/pruefen.js mit.
//
// Alles, was hier geprueft wird, ist mindestens einmal live schiefgegangen. Die
// Faelle stehen mit ihrem Datum daneben.
//
//   node scripts/test-suche-web.js

const suche = require("../lib/suche-web.js");
const seiten = require("../lib/suche-seiten.js");
const schnell = require("../lib/schnell.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// --- Frage saeubern --------------------------------------------------------
pruefe("Gespraechs-Vorspann faellt weg",
  suche.frageSaeubern("Hey Alexandra, kannst du mal nachschauen wie hoch der Eiffelturm ist")
    === "wie hoch der Eiffelturm ist");
pruefe("Normale Frage bleibt unveraendert",
  suche.frageSaeubern("Wie steht der SV Oberbergkirchen in der Tabelle?")
    === "Wie steht der SV Oberbergkirchen in der Tabelle?");
pruefe("Nur Vorspann ergibt trotzdem etwas (nie leer)",
  suche.frageSaeubern("google mal").length > 0);

// --- Rueckbezug ------------------------------------------------------------
//
// Der Pruefsatz von Lukas: "Wie haben sie am Wochenende gespielt?" nach
// "Wie steht der SV Oberbergkirchen in der Tabelle?".
suche.GEDAECHTNIS.clear();
suche.themaMerken("t1", "SV Oberbergkirchen", []);
const r1 = suche.aufloesen("Wie haben sie am Wochenende gespielt?", { sitzung: "t1" });
pruefe("„sie“ wird zum Verein aufgeloest", r1.ersetzt && /SV Oberbergkirchen/.test(r1.frage));

// 20.08.2026 live: Nach "Wie viele Einwohner hat Erding?" antwortete Alexandra
// auf "Und wer ist dort Bürgermeister?" ueber Lollar in Hessen. Grund: Die
// Pruefung "hat die Frage ein eigenes Thema?" hielt das grossgeschriebene
// "Bürgermeister" fuer einen Eigennamen — im Deutschen ist jedes Substantiv
// gross. Starke Zeiger wie "dort" setzen sich seitdem darueber hinweg.
suche.themaMerken("t2", "Erding", []);
const r2 = suche.aufloesen("Und wer ist dort Bürgermeister?", { sitzung: "t2" });
pruefe("„dort“ schlaegt das grossgeschriebene Substantiv", r2.ersetzt && /Erding/.test(r2.frage));
pruefe("„dort“ bekommt seine Praeposition („in Erding“)", /in Erding/.test(r2.frage));

// Der starke Zeiger gewinnt gegen den schwachen, auch wenn er spaeter steht:
// "Und wie ist das Wetter dort?" wurde sonst zu "wie ist Erding Wetter dort".
const r3 = suche.aufloesen("Und wie ist das Wetter dort?", { sitzung: "t2" });
pruefe("Der starke Zeiger wird ersetzt, nicht der Artikel",
  /in Erding/.test(r3.frage) && !/\bdort\b/.test(r3.frage));

// Fragen mit eigenem Thema duerfen NICHT umgeschrieben werden.
for (const f of [
  "Wie hoch ist der Eiffelturm?",
  "Wer ist der bayerische Ministerpräsident?",
  "Wie weit ist es von München nach Salzburg?",
  "Was macht die Firma Krotzer und Eisele?",
]) {
  pruefe(`Eigenes Thema bleibt unangetastet: „${f}“`,
    suche.aufloesen(f, { sitzung: "t2" }).ersetzt === false);
}
// Steht das Thema schon in der Frage, ist nichts aufzuloesen.
pruefe("Genanntes Thema loest keinen Rueckbezug aus",
  suche.aufloesen("Und wie viele Einwohner hat Erding?", { sitzung: "t2" }).ersetzt === false);

// Ohne Gedaechtnis bleibt die Frage, wie sie ist — lieber unvollstaendig
// suchen als das Thema von vorgestern hineinraten.
suche.GEDAECHTNIS.clear();
pruefe("Ohne Gedaechtnis kein erfundener Bezug",
  suche.aufloesen("Wie haben sie am Wochenende gespielt?", { sitzung: "leer" }).ersetzt === false);

// Der Verlauf des Aufrufers schlaegt das eigene Gedaechtnis.
const ausVerlauf = suche.aufloesen("Wie haben sie gespielt?", {
  sitzung: "leer",
  verlauf: [{ role: "user", content: "Wie steht der TSV Dorfen in der Tabelle?" }],
});
pruefe("Thema aus dem uebergebenen Verlauf", /TSV Dorfen/.test(ausVerlauf.frage));

// --- Namen erkennen --------------------------------------------------------
pruefe("Vereinskuerzel wird als Name erkannt",
  suche.namensKandidaten("Wie steht der SV Oberbergkirchen in der Tabelle?").includes("SV Oberbergkirchen"));
pruefe("„Tabelle“ ist kein Name",
  !suche.namensKandidaten("Wie steht der SV Oberbergkirchen in der Tabelle?").includes("Tabelle"));

// --- Nachrichtenfrage ------------------------------------------------------
//
// 20.08.2026: Mit der ganzen Frage als Suchbegriff lieferte der Nachrichten-
// Endpunkt auf "Was ist heute in Deutschland passiert?" Beitraege ueber eine
// Sonnenfinsternis vom Vormonat. Mit "Nachrichten Deutschland" kamen die
// Schlagzeilen des Tages.
pruefe("Bekanntes Thema wird zur Nachrichtenfrage",
  suche.nachrichtenFrage("Wie haben sie gespielt?", "SV Oberbergkirchen") === "SV Oberbergkirchen");
pruefe("Ohne Namen bleibt der Kern, nicht der Satzbau",
  suche.nachrichtenFrage("Was ist heute in Deutschland passiert?", "") === "Nachrichten Deutschland");
pruefe("Nachrichtenfrage erkennt Ereignisfragen",
  suche.NACHRICHTLICH.test("Wie haben sie am Wochenende gespielt?"));
pruefe("Eine Faktenfrage braucht keine Nachrichten",
  !suche.NACHRICHTLICH.test("Wie hoch ist der Eiffelturm?"));

// --- Seitentext: Tabellen, Symbolschrift, Wert-vor-Wort --------------------
//
// Die drei Fallen, an denen die Antwort live falsch wurde. Alle drei stammen
// aus dem HTML echter Seiten (fussball.de, bfv.de), hier nachgebaut.
const html = "<table><tr><td>4</td><td>Tabellenplatz</td><td>3</td><td>Punkte</td>" +
  "<td>1:0</td><td>Torverhältnis</td></tr></table>" +
  "<div>Letztes Spiel: Fr, 14.08.2026</div><div>FC Grünthal - SV 66 Oberbergkirchen</div>" +
  "<div>&#xE69A;:&#xE6B1;</div><div>{{streamitem.content.date}}</div>";
const text = seiten.textAus(html);
pruefe("Zellen werden getrennt, nicht verklebt", text.includes(" | "));
pruefe("Wert und Bezeichnung finden zusammen (Tabellenplatz: 4)", /Tabellenplatz: 4/.test(text));
pruefe("... auch fuer Punkte und Torverhaeltnis",
  /Punkte: 3/.test(text) && /Torverhältnis: 1:0/.test(text));
// Die Ziffern eines Spielstands stehen bei fussball.de als Symbolschrift im
// privaten Unicode-Bereich. Ohne Schriftdatei bedeuten sie nichts — sie fliegen
// raus, damit sich das Modell daraus keine Zahl reimt.
pruefe("Symbolschrift-Ziffern fliegen raus", !/[\u{E000}-\u{F8FF}]/u.test(text));
pruefe("Vorlagen-Platzhalter fliegen raus", !text.includes("{{"));
pruefe("Der lesbare Inhalt bleibt",
  text.includes("FC Grünthal") && text.includes("14.08.2026"));

// --- Passende Stellen: Gewicht und Frische ---------------------------------
//
// Nachbau des Falls vom 20.08.: Oben der aktuelle Stand, unten die
// abgeschlossene Vorsaison. Ohne Gewichte gewann die lange alte Tabelle, weil
// in jeder ihrer Zeilen "Pkt." und Zahlen stehen.
const seite = [
  "Menü", "Start", "Vereine", "Ligen",
  "SV 66 Oberbergkirchen", "Kreisliga 1", "Tabellenplatz: 4", "Punkte: 3",
  "Letztes Spiel: Fr, 14.08.2026",
  "Archiv Saison 25/26", "Pl.", "Verein", "Sp.", "Pkt.",
  "1.", "SV Oberbergkirchen", "26", "56", "2.", "TSV Eiselfing", "26", "55",
  "3.", "SV Ramerberg", "26", "50", "4.", "DJK Oberndorf", "26", "41",
].join(" | ");
// max = ein Fenster: So misst der Test, WELCHE Stelle gewinnt, statt ob beide
// hineinpassen. Geprueft wird die Reihenfolge — das beste Fenster muss beim
// aktuellen Stand ANFANGEN, nicht im Archiv.
const stelle = seiten.passendeStellen(seite,
  [{ wort: "Oberbergkirchen", gewicht: 9 }, { wort: "Tabelle", gewicht: 3 }, { wort: "Punkte", gewicht: 1.5 }],
  { max: 120, fensterZeichen: 120, jahr: 2026 });
pruefe("Der aktuelle Stand gewinnt gegen das Saison-Archiv",
  /Tabellenplatz: 4/.test(stelle) && !/\b56\b/.test(stelle));

// --- Sprechtext ------------------------------------------------------------
pruefe("Zahlen werden zu Worten",
  /vier/.test(suche.sprechtext("Platz 4 mit 3 Punkten")));
pruefe("Ein Spielstand wird zu „zu“",
  /eins zu null/.test(suche.sprechtext("Sie haben 1:0 gewonnen.", { sport: true })));
// 20.08.2026 gehoert: "Saison 2025/sechsundzwanzig". Die Zahlregel laesst
// vierstellige Jahre stehen, machte aus der zweistelligen Haelfte aber ein Wort.
pruefe("Saison-Schreibweise wird ausgeschrieben, nicht zerlegt",
  suche.sprechtext("in der Saison 2025/26").includes("2025/2026"));
pruefe("Eine Uhrzeit bleibt eine Uhrzeit (kein Ergebnis daraus)",
  /Uhr/.test(suche.sprechtext("Der Termin ist um 18:30 Uhr")));

// --- Das Zeitbudget --------------------------------------------------------
//
// Die Summe der Einzelfristen ist die Zusage "unter sechs Sekunden". Faellt sie
// jemand hoch, soll dieser Test es sagen, nicht Lukas im Gespraech.
const budget = suche.FRISTEN;
pruefe("Suche, Seiten und Satz zusammen unter 14 s (harte Obergrenze)",
  budget.suche + budget.seiten + budget.satz <= 14000);

// --- schnell.js: welches Modell kennt "effort"? ----------------------------
//
// 20.08.2026 im Container gemessen: Haiku 4.5 antwortet auf output_config.effort
// mit HTTP 400 "This model does not support the effort parameter". Vorher setzte
// mitWerkzeugen() das Feld immer — damit war Haiku fuer Werkzeugaufrufe gesperrt.
pruefe("Haiku bekommt kein effort-Feld", schnell.kenntAufwand("claude-haiku-4-5") === false);
pruefe("Sonnet bekommt eines", schnell.kenntAufwand("claude-sonnet-5") === true);
pruefe("Opus bekommt eines", schnell.kenntAufwand("claude-opus-5") === true);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
console.log("(Die echten Fragen laufen in scripts/websuche-proben.js — braucht Netz und Schluessel.)");
process.exit(fehler ? 1 : 0);
