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

// --- Bruecke zur Seite: die Zusatzbegriffe ---------------------------------
//
// DER SCHWERSTE FEHLER VOM 20.08.2026, und er hing an einem Zeichen.
//
// Dieselbe Frage, zwei Wege: lib/suche-web.js direkt aufgerufen 5 von 5 richtig,
// ueber POST /api/chat 0 von 5. Grund war nicht die Suche, sondern der Weg
// dorthin: Das Verstehen-Modell reichte die Frage nicht durch, sondern schrieb
// sie in Suchbegriffe um —
//   Nutzer:      "Wie steht der SV Oberbergkirchen in der Tabelle?"
//   an websuche: "Aktueller Tabellenstand SV Oberbergkirchen Fußball Saison 2026/27"
// — und `\btabelle\b` trifft "Tabellenstand" NICHT. Damit fehlten die
// Brueckenbegriffe, passendeStellen griff das falsche Fenster, und das Modell
// meldete voellig korrekt "NICHT GEFUNDEN".
//
// Beide Enden sind hier festgenagelt: die Werkzeugbeschreibung (damit die Frage
// woertlich ankommt) und die Muster (damit auch eine umgeschriebene Frage noch
// greift).
const begriffe = (frage, thema = "") =>
  suche.suchbegriffe(frage, thema).map((x) => x.wort.toLowerCase());

const originalFrage = "Wie steht der SV Oberbergkirchen in der Tabelle?";
const umgeschrieben = "Aktueller Tabellenstand SV Oberbergkirchen Fußball Saison 2026/27";

pruefe("„Tabelle“ bringt die Bruecke (wie bisher)",
  begriffe(originalFrage, "SV Oberbergkirchen").includes("tabellenplatz"));
pruefe("„Tabellenstand“ bringt sie jetzt AUCH",
  begriffe(umgeschrieben, "SV Oberbergkirchen").includes("tabellenplatz"));
pruefe("... samt Punkte-Bruecke",
  begriffe(umgeschrieben, "SV Oberbergkirchen").includes("punkte"));
pruefe("„Tabellenplatz“ als ein Wort trifft ebenfalls",
  begriffe("Auf welchem Tabellenplatz steht der TSV Dorfen?").includes("pkt"));
// Fall Dieselpreis (20.08.): "Dieselpreis" ist EIN Wort, \bpreis\b verfehlte es.
pruefe("„Dieselpreis“ bringt die Preis-Bruecke",
  begriffe("Wie hoch ist der Dieselpreis in Bayern gerade?").includes("preis"));
pruefe("... und die Spritbegriffe der Preisseiten",
  begriffe("Wie hoch ist der Dieselpreis in Bayern gerade?").includes("liter"));
pruefe("„Spritpreis“ genauso",
  begriffe("Was ist der Spritpreis heute?").includes("preis"));
pruefe("„Was kostet ein Liter Diesel?“ funktioniert weiter",
  begriffe("Was kostet ein Liter Diesel gerade in Bayern?").includes("preis"));
// Nicht zu breit werden: Ein Platzhalter ist kein Tabellenplatz.
pruefe("„Platzhalter“ loest keine Tabellen-Bruecke aus",
  !begriffe("Was ist ein Platzhalter in HTML?").includes("tabellenplatz"));

// Auch das Nachlesen der echten Seite darf an der umgeschriebenen Frage nicht
// scheitern — sonst bliebe es bei den Google-Schnipseln.
const fundAttrappe = { treffer: [{ titel: "x", url: "https://bfv.de", domain: "bfv.de" }], direkt: true };
pruefe("bei „Tabellenstand“ wird die Seite gelesen",
  suche.brauchtSeiten(umgeschrieben, fundAttrappe) === true);
pruefe("bei „Dieselpreis“ ebenfalls",
  suche.brauchtSeiten("Dieselpreis Bayern", fundAttrappe) === true);

// --- Das Netz gegen die Antwort ohne Suche ---------------------------------
//
// GEMESSEN AM 20.08.2026 ueber /api/chat. Zwanzig Mal dieselbe Frage in EINER
// Sitzung, gegen den damals laufenden Stand: 5 von 20 richtig. Der Grund steht
// woertlich im Sprachprotokoll — "aufrufe": [], "quelle": "zustand". Es wurde
// nicht gesucht. Und schlimmer: Der Fehler frisst sich fest. Sobald einmal
// "ich komm an die Tabelle nicht ran" im Verlauf steht, liest das Modell das
// beim naechsten Mal als Tatsache und sucht erst recht nicht mehr:
//
//   [10] "Da kommt nichts mehr. Ich hab's oft genug versucht."
//   [17] "Nein. Die Tabelle bekomme ich nicht — daran aendert sich auch beim
//         fuenfzehnten Mal nichts."
//
// istNachschlagefrage() ist die Pruefung, die das aufhaelt: Kann der STAND das
// ueberhaupt wissen? Sie muss zwei Dinge zugleich koennen — bei der Aussenfrage
// anspringen UND bei allem Internen still bleiben. Beide Haelften stehen unten,
// denn ein Netz, das zu oft greift, waere ein neuer Fehler.
const STAND_PROBE = [
  "HEUTE: 2026-08-20, 18:30 Uhr, Dorfen.",
  "KALENDER heute: 14:00-15:00 Erstgespraech Physio Schwabing.",
  "AUFGABEN offen: Angebot Krotzer rausschicken.",
  "FIRMA: Sehorz & vom Hofe GbR, Performance Marketing. Team: Lukas, Jannik.",
  "PREISE: Betreuung ab 1.500 Euro im Monat.",
  "CRM: Krotzer und Eisele, Physio Schwabing, Zahnarztpraxis Bergmann.",
].join("\n");

for (const [f, soll] of [
  // MUSS greifen: fremder Name + etwas, das sich taeglich aendert.
  ["Wie steht der SV Oberbergkirchen in der Tabelle?", true],
  ["Wie ist der Tabellenstand vom TSV Dorfen?", true],
  ["Wie hoch ist der Dieselpreis in Bayern gerade?", true],
  ["Wie viele Einwohner hat Erding?", true],
  ["Was hat der FC Bayern gestern gespielt?", true],
  // DARF NICHT greifen: alles, was der STAND oder die Datenbank beantwortet.
  ["was steht heute an", false],
  ["was steht morgen an", false],
  ["wann hab ich Freitag Zeit", false],
  ["was kostet bei uns die Betreuung", false],       // "bei uns" = eigener Laden
  ["wie hat mein Reel Fassade performt", false],     // "mein" = eigener Laden
  ["Stand bei Projekt Krotzer", false],              // Name steht im STAND
  ["wie viele Leads hat Ioannis heute bekommen", false],
  // Ein Auftrag ist keine Nachschlagefrage — eine Websuche waere hier die
  // falsche Rettung.
  ["schreib Jannik dass ich mich morgen melde", false],
  ["trag mir morgen 10 Uhr Sport ein", false],
  ["sag den Kalhofer-Anruf ab", false],
  ["bau mir eine Praesentation ueber Performance Marketing", false],
  ["schick den Juli-Ordner an die Steuerberaterin", false],
]) {
  pruefe(`${soll ? "sucht" : "sucht NICHT"}: „${f}“`,
    suche.istNachschlagefrage(f, STAND_PROBE, []) === soll);
}

// Der zweite Teil von Lukas' Pruefsatz nennt den Verein nicht mehr. Auch er
// muss als Aussenfrage durchgehen — sonst faellt das Netz genau bei der
// Anschlussfrage aus, die in der Aufnahme direkt danach kommt.
pruefe("Rueckbezug zaehlt als Aussenfrage, wenn das Thema im Verlauf steht",
  suche.istNachschlagefrage("Wie haben sie am Wochenende gespielt?", STAND_PROBE,
    [{ role: "user", content: "Wie steht der SV Oberbergkirchen in der Tabelle?" }]) === true);
pruefe("... aber nicht ohne Thema (dann waere es geraten)",
  suche.istNachschlagefrage("Wie haben sie am Wochenende gespielt?", STAND_PROBE, []) === false);

// DIE FALLE, DIE DAS NETZ ZUERST WIRKUNGSLOS GEMACHT HAT (20.08.2026).
//
// Gemessen ueber /api/chat: 20 Laeufe, 5 richtig — obwohl das Netz eingebaut
// war und im Sprachprotokoll `aufrufe: []` stand. Es haette greifen MUESSEN und
// tat es nicht. Grund: sprache-routes.js haengt an den STAND die Liste der
// laufenden Auftraege, und dort steht Lukas' Frage WOERTLICH drin
// ("LAEUFT SEIT 3 s: Wie steht der SV Oberbergkirchen in der Tabelle?").
// Ab der zweiten Runde stand der Vereinsname damit im uebergebenen Text — und
// die Pruefung "kennt der STAND den Namen?" sagte ja.
//
// Ein STAND, der die Frage nur zurueckwirft, weiss gar nichts. Der Aufrufer
// uebergibt jetzt den STAND ohne Anhang UND die Pruefung schneidet ihn selbst
// ab — beides, damit es beim naechsten Umbau nicht wieder umfaellt.
const FRAGE_TABELLE = "Wie steht der SV Oberbergkirchen in der Tabelle?";
const STAND_MIT_ANHANG = STAND_PROBE +
  "\n\nDEINE LAUFENDE ARBEIT:\n- LAEUFT SEIT 3 s: " + FRAGE_TABELLE;
pruefe("Der STAND allein: die Frage geht an die Suche",
  suche.istNachschlagefrage(FRAGE_TABELLE, STAND_PROBE, []) === true);
pruefe("Die eigene Frage im Auftrags-Anhang zaehlt NICHT als Wissen des STANDs",
  suche.istNachschlagefrage(FRAGE_TABELLE, STAND_MIT_ANHANG, []) === true);
// Der Anhang darf aber auch nichts ZERSTOEREN: Was davor steht, gilt weiter.
pruefe("Ein echter Name aus dem STAND bleibt trotz Anhang bekannt",
  suche.istNachschlagefrage("Wie ist der Stand bei Krotzer und Eisele?",
    STAND_MIT_ANHANG, []) === false);

// --- Der Auftrag muss woertlich ankommen -----------------------------------
const { WERKZEUGE } = require("../lib/sprache-werkzeuge.js");
const recherche = WERKZEUGE.find((w) => w.name === "recherchieren");
pruefe("das Werkzeug „recherchieren“ gibt es noch", Boolean(recherche));
pruefe("es verlangt die Frage WÖRTLICH",
  /WÖRTLICH/.test(recherche?.input_schema?.properties?.auftrag?.description || ""));
pruefe("und verbietet das Umschreiben in Suchbegriffe ausdruecklich",
  /nicht in Suchbegriffe umschreiben/i.test(recherche?.input_schema?.properties?.auftrag?.description || ""));

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
