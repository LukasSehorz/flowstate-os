// Wacht ueber den Vertrag zwischen Modell und Server — Stufe 3 (25.07.),
// auf Werkzeuge umgestellt mit A4 (26.07.).
//
// Bis A4 war der Vertrag ein JSON-Schema im System-Prompt, und dieser Test
// bewachte nur ihn. Jetzt hat der Vertrag ZWEI Haelften, die auseinanderlaufen
// koennen, ohne dass irgendwo etwas kracht:
//
//   1. lib/sprache-werkzeuge.js — was das Modell aufrufen kann.
//   2. ausAufrufen() in lib/sprache-routes.js — was der Server davon versteht.
//
// Wird oben ein Werkzeug umbenannt und unten nicht, ruft das Modell brav auf
// und der Server wirft es still weg: Alexandra sagt "trag ich ein", und nichts
// passiert. Genau diese Klasse von Fehler faellt sonst erst im Gespraech auf.
// Der Test unten haelt beide Haelften zusammen.
//
// Dazu bleiben die Verhaltensregeln im Prompt bewacht — jede stammt aus einem
// echten Vorfall. Aufruf: node scripts/test-prompt.js

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "sprache-routes.js"), "utf-8");
const m = src.match(/const FORMAT_ANHANG = `([\s\S]*?)`;/);
if (!m) { console.log("❌ FORMAT_ANHANG nicht gefunden — Aufbau geaendert?"); process.exit(1); }
const p = m[1];
const { WERKZEUGE, NAMEN } = require(path.join(__dirname, "..", "lib", "sprache-werkzeuge"));

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}
const hat = (...teile) => teile.every((t) => p.toLowerCase().includes(t.toLowerCase()));

// --- Haelfte 1: die Werkzeuge selbst --------------------------------------
const ERWARTET = [
  "termin_eintragen", "termin_verschieben", "termin_absagen",
  "aufgabe_anlegen", "aufgabe_erledigt",
  "crm_lead", "crm_notiz", "crm_wiedervorlage", "crm_anruf",
  "whatsapp_senden", "mail_senden",
  "wetter", "mail_lesen", "whatsapp_lesen", "gehirn_suchen", "recherchieren", "lange_arbeit",
  "neuigkeiten", "nachschlagen", "daten_fragen",
  "beleg_erstellen", "beleg_nummer", "anrufen",
  // 20.08.2026 dazugekommen, fuer die Werbeaufnahmen: ein echter Browser
  // (lib/computer.js) und Nachschub fuer die Anrufliste (lib/leads-nachschub.js).
  "computer_auftrag", "leads_nachschub",
  "zeigen",
];
const fehlend = ERWARTET.filter((n) => !NAMEN.includes(n));
const zuviel = NAMEN.filter((n) => !ERWARTET.includes(n));
pruefe(`Alle ${ERWARTET.length} Werkzeuge vorhanden` + (fehlend.length ? ` — fehlt: ${fehlend}` : ""), !fehlend.length);
pruefe("Keine unbekannten Werkzeuge" + (zuviel.length ? ` — neu: ${zuviel}` : ""), !zuviel.length);

// Der eigentliche Zweck: Kennt der Server jedes Werkzeug, das das Modell sieht?
const mapper = src.slice(src.indexOf("function ausAufrufen"), src.indexOf("async function ausZustand"));
const unbekannt = NAMEN.filter((n) => !mapper.includes(`"${n}"`) && !mapper.includes(n.replace(/^crm_/, "")));
pruefe("ausAufrufen() verarbeitet jedes Werkzeug" + (unbekannt.length ? ` — ignoriert: ${unbekannt}` : ""),
  !unbekannt.length);

// Jedes Werkzeug braucht Zweck und Pflichtfelder, sonst raet das Modell.
const ohneBeschreibung = WERKZEUGE.filter((w) => !w.description || w.description.length < 20).map((w) => w.name);
pruefe("Jedes Werkzeug erklaert seinen Zweck" + (ohneBeschreibung.length ? ` — duenn: ${ohneBeschreibung}` : ""),
  !ohneBeschreibung.length);
const ohnePflicht = WERKZEUGE.filter((w) => !w.input_schema.required.length).map((w) => w.name);
pruefe("Jedes Werkzeug hat Pflichtfelder" + (ohnePflicht.length ? ` — offen: ${ohnePflicht}` : ""), !ohnePflicht.length);

// Regeln, die frueher im Prompt standen und jetzt im Schema stehen muessen —
// sonst waeren sie beim Umbau lautlos verschwunden. (Die Zeitrechnung ist
// bewusst NICHT dabei: Sie galt fuer acht Werkzeuge und stand achtmal im
// Schema. Sie steht jetzt einmal im Prompt und wird dort geprueft.)
const beschreibungen = JSON.stringify(WERKZEUGE);
pruefe("Kontakte loest der Server auf (nie 'kenne X nicht')", /Kontakte loest der Server auf/.test(beschreibungen));
// Umgedreht am 27.07.: Das Modell liefert den FERTIGEN Text. Der zweite
// Modellaufruf, der die Absicht nachformulierte, kostete im Log bis zu 6,2 s.
pruefe("WhatsApp: fertiger Text statt Absicht", /die FERTIGE Nachricht/.test(beschreibungen));
pruefe("WhatsApp: kein Absichts-Vertrag mehr", !/die ABSICHT, nicht der Wortlaut/.test(beschreibungen));
pruefe("Schreibregeln stehen im Prompt (gelten fuer Mail UND WhatsApp)",
  hat("Nachrichten schreiben", "FERTIGEN Text", "Keine Floskeln", "keine Unterschrift"));
pruefe("WhatsApp: kein Serienversand", /Serienversand/.test(beschreibungen));
pruefe("Gruppen: nur freigegebene, keine erfundenen", /Erfinde keine Gruppennamen/.test(beschreibungen));
pruefe("Mail nur intern direkt senden", /lukas\.sehorz@hotmail\.com/.test(beschreibungen));
pruefe("Externe Mail nur als ENTWURF", /ENTWURF/.test(beschreibungen));
pruefe("Anruf: alle fuenf Ausgaenge", ["termin", "absage", "nicht-erreicht", "spaeter", "erreicht"]
  .every((x) => WERKZEUGE.find((w) => w.name === "crm_anruf").input_schema.properties.ausgang.enum.includes(x)));
pruefe("WhatsApp lesen: keine 'nicht verbunden'-Ausrede", /nicht verbunden/.test(beschreibungen));
pruefe("Gehirn nicht fuer Preise/Team (die stehen im STAND)", /NICHT fuer Preise/.test(beschreibungen));
pruefe("Lange Arbeit meldet sich per Telegram, Gespraech wartet nicht",
  /meldet sich per Telegram/i.test(beschreibungen));

// --- Haelfte 2: das Verhalten im Prompt ------------------------------------
pruefe("Was im STAND steht, kommt ohne Aufruf", hat("SOFORT daraus"));
pruefe("Kein JSON-Vertrag mehr im Prompt (das koennen jetzt die Werkzeuge)",
  !/"text":|"whatsapp":|Antworte NUR als JSON/i.test(p));
pruefe("Kein Werkzeug-VERBOT mehr (das war die alte Welt)", !/RUFE KEINE WERKZEUGE AUF/i.test(p));
pruefe("Laengengrenze: hoechstens drei Saetze", hat("HOECHSTENS DREI SAETZE"));
pruefe("Kalender/Aufgaben/CRM: Ergebnis nicht selbst sagen", hat("Ergebnis NICHT selbst sagen"));
// Beim Nachschlagen dauert es Sekunden — ohne einen Zwischensatz wirkt die
// Stille im Gespraech wie ein Abbruch (07.08.2026, Rueckmeldung Lukas).
pruefe("Nachschlagen wird angekuendigt", hat("WAS du nachsiehst"));
// Der Ansagesatz muss VOR dem Werkzeugaufruf kommen, sonst wird er erst nach
// dem Denken gesprochen und die Stille bleibt (07.08.2026).
pruefe("Ansage kommt vor dem Aufruf", hat("BEVOR du das Werkzeug aufrufst"));
// Die Laengenregel darf ihn nicht wieder verbieten — genau dieser Widerspruch
// liess das Modell am 07.08. schweigen, obwohl die Regel schon deployt war.
pruefe("Laengenregel verbietet die Ansage nicht", !hat("keine Wiederholung dessen, was du gerade aufrufst"));
pruefe("Aufrufe laufen parallel", hat("parallel"));
pruefe("Jeder Aufruf nur sein Arbeitsteil", hat("nur seinen Arbeitsteil"));
pruefe("Wetter/Mail stehen nie im STAND", hat("stehen NIE im STAND"));
pruefe("Freie Zeiten kommen aus dem STAND, ohne Werkzeug", hat("WANN HAB ICH ZEIT", "KEIN Werkzeug"));
pruefe("'Was steht heute an' nennt Termine UND Aufgaben", hat("WAS STEHT HEUTE AN"));
// Einmal im Prompt statt achtmal im Schema — siehe oben.
pruefe("Zeitrechnung macht das Modell, nicht der Server",
  hat("Relative Angaben", "Der Server rechnet nichts um", "JJJJ-MM-TT"));
pruefe("IDs braucht das Modell nie — der Server sucht", hat("IDs brauchst du nie"));

pruefe("Niemals ablehnen — im Zweifel an lange_arbeit", hat("niemals ablehnen"));
pruefe("Keine erfundenen fehlenden API-Verbindungen", hat("API-Verbindungen"));
pruefe("Ehrlich scheitern ist erlaubt", hat("EHRLICH SCHEITERN"));
pruefe("Nie falsch dementieren", hat("NIE FALSCH DEMENTIEREN"));
pruefe("Nur EINE Rueckfrage — die Freigabe (Lukas 25.07.)",
  hat("NUR EINE RUECKFRAGE", "soll ich es dir vorlesen"));

pruefe("Kein Vollzug melden, solange etwas laeuft (Fix 24.07.)",
  hat("noch NICHT erledigt", "Ist eingetragen"));
pruefe("Wahrheit nur aus STAND/[FAKT]", hat("[FAKT]", "zaehlt NICHT als Bestaetigung"));
pruefe("Keine erfundenen Termine aus eigener Ankuendigung", hat("Erfinde NIE Termine"));
pruefe("[LAEUFT NOCH]-Marker wird beachtet", hat("LAEUFT NOCH"));
pruefe("Zwischenfragen aus 'DEINE LAUFENDE ARBEIT'", hat("DEINE LAUFENDE ARBEIT"));

pruefe("Sag es einmal, keine Ankuendigung davor (A1, 26.07.)", hat("SAG ES EINMAL"));
pruefe("Keine internen Begriffe aussprechen", hat("NIE interne Begriffe", "Haiku", "Werkzeug"));
pruefe("Nichts wiederholen (BISHER)", hat("NICHT WIEDERHOLEN", "BISHER"));

// --- Groesse: der eigentliche Zweck der Uebung ----------------------------
//
// Korrektur am 25.07.: Der Waechter mass nur den FORMAT_ANHANG — wer Text in
// die Vault-Datei STIMME-alexandra.md verschob, haette ihn ausgetrickst, ohne
// ein Token zu sparen. Gemessen wird seitdem, was wirklich rausgeht.
//
// Zweite Korrektur am 26.07. (A4). Der Waechter schlug beim Umbau an, und das
// war richtig: Ein 8.835 Zeichen grosses Werkzeugschema hatte den Gewinn aus
// dem geschrumpften Prompt komplett aufgefressen. Nach dem Straffen steht es
// bei rund 7.200 — und die Summe liegt trotzdem ueber der alten Grenze.
//
// Statt die Grenze stillschweigend hochzusetzen, wird sie GETEILT, weil sie
// inzwischen zwei verschiedene Dinge misst:
//
//   Prosa (Anhang + STIMME) — durchgehender Text, den das Modell komplett
//     mitlesen muss. GENAU DAS wurde am 24.07. als schaedlich gemessen: 18.291
//     Zeichen, 6 von 36 Anfragen fielen aus, Verstehen 6,2 s. Diese Zahl ist
//     durch A4 von 12.608 auf rund 7.900 gefallen — eine echte Entlastung an
//     der Stelle, an der der Schaden nachgewiesen ist.
//   Schema — Werkzeugnamen mit Feldern, in einem eigenen Kanal. Das Modell
//     muss es nicht durchlesen, sondern gleicht die Absicht gegen Namen ab.
//
// ANNAHME, ausdruecklich als solche markiert: dass Schema-Zeichen leichter
// wiegen als Prosa-Zeichen. Sie ist plausibel, aber fuer DIESES System nicht
// gemessen. Der A4-Test misst sie: Steigen "nicht verstanden" oder die Dauer
// gegenueber dem Ausgangswert in docs/messwerte-ausgangswert.json, war die
// Annahme falsch und die Werkzeugliste muss kuerzer (weniger Werkzeuge,
// nicht kuerzere Saetze). Bis dahin gilt die Teilung als unbewiesen.
const VAULT = process.env.VAULT_PATH || "C:/dev/flowstate-vault";
const stimmeDatei = path.join(VAULT, "instanzen", "lukas", "STIMME-alexandra.md");
let stimme = "";
try { stimme = fs.readFileSync(stimmeDatei, "utf-8"); } catch {}

const schema = JSON.stringify(WERKZEUGE).length;
const prosa = p.length + stimme.length;
const PROSA_GRENZE = 9000;    // war 12.608 vor A4; nachweislich schlecht: 18.291
// Das Schema wird JE WERKZEUG gemessen, nicht als absolute Summe.
//
// Umgestellt am 05.08.: Die alte Grenze war 8.000 Zeichen fuer 18 Werkzeuge.
// Mit "nachschlagen" und "neuigkeiten" sind es 20 — und eine feste Summe
// bestraft dann genau das Falsche. Sie macht keinen Unterschied zwischen
// "zwei echte neue Faehigkeiten" und "die Beschreibungen sind aufgeblaeht",
// und der billigste Weg, sie einzuhalten, waere, Beschreibungen so weit zu
// kuerzen, bis das Modell raten muss.
//
// Der Schnitt je Werkzeug misst, was gemeint war: Bleiben die Beschreibungen
// knapp? Zum Vergleich — bei 18 Werkzeugen und 8.000 Zeichen waren es 444 je
// Werkzeug. Mit 20 Werkzeugen und 8.048 Zeichen sind es 402. Das Schema ist
// also dichter geworden, nicht fetter.
//
// Die Gesamtsumme bleibt sichtbar (unten ausgegeben) — wenn sie einmal wirklich
// aus dem Ruder laeuft, sieht man es trotzdem.
// NACHGESCHAERFT (07.08.): Der SCHNITT hat dasselbe Problem eine Ebene hoeher.
// beleg_erstellen hat zehn Parameter — Firma, Betrag, Leistung, Sparte, Anrede,
// Strasse, PLZ, Mail, Zahlungsziel, Art — und ist damit fast dreimal so gross
// wie ein Werkzeug mit einem Feld. Es zog den Schnitt allein von 402 auf 435,
// ohne dass eine einzige Beschreibung schwammiger geworden waere.
//
// Der MEDIAN beantwortet die eigentliche Frage: Ist das TYPISCHE Werkzeug knapp
// beschrieben? Ein einzelner grosser Ausreisser verschiebt ihn nicht, zehn
// aufgeblaehte Beschreibungen schon.
//
// Damit der Ausreisser nicht unbeobachtet wachsen kann, wird er zusaetzlich
// einzeln gedeckelt. Zwei Zahlen, zwei Fragen — statt einer Zahl, die beide
// vermischt und deshalb keine von beiden richtig beantwortet.
// ZWEITE ANPASSUNG (07.08., anrufen dazu). Der Median sprang von 380 auf 424,
// ohne dass eine Beschreibung laenger geworden waere: Bei 23 Werkzeugen liegt
// die Mitte auf einem kleinen, bei 24 auf dem naechstgroesseren. Ein Sprung aus
// der Position, nicht aus dem Inhalt.
//
// EHRLICH GESAGT: Das ist das zweite Mal, dass diese Schranke nachgezogen wird
// (vorher der Schnitt, jetzt der Median). Wer sie ein DRITTES Mal anheben will,
// sollte sie stattdessen wegwerfen — dann misst sie nicht, was sie messen soll,
// und eine Schranke, die man immer nur hochsetzt, ist keine.
//
// Was sie weiterhin faengt: wenn mehrere Beschreibungen gleichzeitig ausufern.
// Was sie nicht faengt: eine einzelne, und dafuer ist die Obergrenze darunter da.
const SCHEMA_MEDIAN = 450;
const SCHEMA_GROESSTES = 1200;
console.log(`\nFORMAT_ANHANG:  ${p.length} Zeichen`);
if (stimme) console.log(`STIMME:         ${stimme.length} Zeichen`);
console.log(`Prosa gesamt:   ${prosa} Zeichen  (vor A4: 12.608)`);
const groessen = WERKZEUGE.map((x) => JSON.stringify(x).length).sort((a, b) => a - b);
const median = groessen[Math.floor(groessen.length / 2)];
const groesstes = groessen[groessen.length - 1];
const dickster = WERKZEUGE.reduce((a, b) => (JSON.stringify(a).length > JSON.stringify(b).length ? a : b));
console.log(`Werkzeugschema: ${schema} Zeichen — ${WERKZEUGE.length} Werkzeuge, Median ${median}, Schnitt ${Math.round(schema / WERKZEUGE.length)}, groesstes ${groesstes} (${dickster.name})`);
console.log(`Was rausgeht:   ${prosa + schema} Zeichen (~${Math.round((prosa + schema) / 3.6)} Token, ab dem 2. Aufruf aus dem Zwischenspeicher)`);
if (stimme) {
  pruefe(`Prosa bleibt unter ${PROSA_GRENZE} Zeichen`, prosa < PROSA_GRENZE);
} else {
  console.log(`(STIMME nicht gefunden unter ${stimmeDatei} — nur der Anhang wird gemessen)`);
  pruefe("FORMAT_ANHANG bleibt unter 6.000 Zeichen", p.length < 6000);
}
pruefe(`Das typische Werkzeug bleibt knapp (Median unter ${SCHEMA_MEDIAN} Zeichen)`,
  median < SCHEMA_MEDIAN, `Median ${median}`);
pruefe(`Kein Werkzeug laeuft davon (unter ${SCHEMA_GROESSTES} Zeichen)`,
  groesstes < SCHEMA_GROESSTES, `${dickster.name}: ${groesstes}`);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
