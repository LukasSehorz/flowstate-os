// Generalprobe fuer die Werbeaufnahmen (20.08.2026).
//
// WOZU: Morgen wird gedreht. Lukas spricht mit Alexandra, und was in der
// Aufnahme schiefgeht, gibt es nicht als zweite Anzeige. Dieses Skript spielt
// die Szenarien aus dem Anzeigen-Konzept durch, BEVOR die Kamera laeuft — und
// zwar auf demselben Weg, den die Stimme nimmt.
//
// WARUM UEBER /api/chat: Der getippte Chat und die Sprache laufen seit dem
// 08.08. durch dieselbe Funktion (frageBeantworten in lib/sprache-routes.js).
// Der Unterschied ist nur, ob das Ergebnis gestroemt oder am Stueck kommt.
// Was hier geht, geht per Stimme — und was hier scheitert, scheitert dort auch.
//
// WARUM EIN EIGENER SERVER: Zwei Gruende, beide schon einmal teuer geworden.
//   1. DATA_PATH zeigt in einen Wegwerf-Ordner. Sprachprotokoll, Zustand und
//      Sitzungen des Probelaufs sollen die echten nicht ueberschreiben.
//   2. Die .env wird HIER eingelesen und weitergereicht. Ein per spawn
//      gestarteter Server erbt sie nicht von selbst — ohne das steht er ohne
//      Datenbank da und jede Antwort ist ein Fehlschlag, der nach einem
//      inhaltlichen Problem aussieht und keins ist.
//
// SICHERHEIT: Der Lauf setzt ADS_PROBE=1 (lib/probemodus.js). Mail, WhatsApp,
// Telegram und Anruf werden an der letzten Stelle abgefangen und protokolliert,
// alles davor laeuft echt. Was in die Datenbank geschrieben wird, traegt das
// Praefix ADSTEST und wird am Ende wieder entfernt (--kein-aufraeumen laesst es
// stehen, wenn man nachsehen will).
//
// DIE DATENBANK IST DIE ECHTE. Das ist Absicht: Zahlen aus einer leeren
// Testdatenbank sagen ueber die Aufnahme nichts. Deshalb der Praefix-Zwang oben.
//
// AUFRUF
//   node scripts/ads-proben.js                       alles
//   node scripts/ads-proben.js --nur kern             nur eine Gruppe
//   node scripts/ads-proben.js --nur c1-1,c2-3        einzelne Szenarien
//   node scripts/ads-proben.js --liste                nur auflisten, nichts tun
//   node scripts/ads-proben.js --env <pfad>           zusaetzliche .env
//   node scripts/ads-proben.js --port 3997 --gleichzeitig 4
//
// ERGEBNIS: shots/ads-proben/<zeitstempel>.json und eine Zusammenfassung auf
// der Konsole.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const WURZEL = path.join(__dirname, "..");
const ZIEL = path.join(WURZEL, "shots", "ads-proben");

// ---------------------------------------------------------------- Argumente
const argv = process.argv.slice(2);
const wert = (name, standard) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : standard;
};
const PORT = Number(wert("--port", 3997));
const NUR = String(wert("--nur", "")).split(",").map((s) => s.trim()).filter(Boolean);
const GLEICHZEITIG = Math.max(1, Number(wert("--gleichzeitig", 4)));
const EXTRA_ENV = wert("--env", process.env.ADS_ENV || "");
const NUR_LISTE = argv.includes("--liste");
const KEIN_AUFRAEUMEN = argv.includes("--kein-aufraeumen");
const AUSFUEHRLICH = argv.includes("--ausfuehrlich");
// Laeuft der Lauf trotz fehlender Voraussetzungen? Siehe die Pruefung im
// Hauptlauf — ohne diesen Schalter bricht er dort ab.
const TROTZDEM = argv.includes("--trotzdem");
// WIE OFT (20.08.2026). Agent 2 formuliert seine Abnahmen als Wiederholung —
// "10 von 10", "5 von 5", "20x hintereinander". Genau dafuer: Jedes gewaehlte
// Szenario laeuft N mal, jedes Mal mit frischer Sitzung. Ein Fehler, der nur
// bei jedem dritten Lauf auftritt, ist in einer Aufnahme derselbe Totalausfall
// wie einer, der immer auftritt — er faellt beim einmaligen Pruefen nur nicht auf.
const WIEDERHOLEN = Math.max(1, Number(wert("--wiederholen", 1)));

// FERNMODUS: gegen einen schon laufenden Server messen statt einen eigenen zu
// starten (20.08.2026).
//
// Anlass: Kalender und Postfach haengen an gws-cli, das nur IM CONTAINER liegt.
// Ein Lauf auf dem Entwicklungsrechner kann Creative 2 deshalb grundsaetzlich
// nicht pruefen — er misst dort immer nur seine eigene fehlende Umgebung.
//
//   node scripts/ads-proben.js --ziel https://flowstate…  --nur c2-3
//
// ACHTUNG, DER UNTERSCHIED IST WICHTIG: Im Fernmodus laeuft der Probemodus
// NICHT (er haengt an ADS_PROBE im Serverprozess, und den startet hier keiner).
// Eine Mail oder WhatsApp, die dort freigegeben wird, geht WIRKLICH raus.
// Deshalb: nur ausdruecklich benannte Szenarien, kein Rundumschlag.
const ZIEL_URL = wert("--ziel", "");
const FERN = Boolean(ZIEL_URL);

const MAIL = process.env.ADS_MAIL || "lukas.sehorz@flowstate-ai.net";
const PASSWORT = process.env.ADS_PASSWORT || "flowstate2026";

// Das Praefix, an dem alles Erzeugte erkennbar ist. Steht als Konstante hier,
// weil es an drei Stellen gebraucht wird: in den Szenarien, beim Aufraeumen und
// im Bericht.
const PRAEFIX = "ADSTEST";

// ---------------------------------------------------------------- Szenarien
//
// AUFBAU: Ein Szenario ist ein GESPRAECH, kein Einzelsatz — genau wie in der
// Aufnahme. "zuege" laufen nacheinander in derselben Sitzung; erst zwischen
// zwei Szenarien wird der Verlauf zurueckgesetzt. Ohne das wuerde "das ist zu
// wenig, such nochmal hundert weitere raus" ins Leere greifen.
//
// PRUEFUNGEN je Zug, alle freiwillig:
//   werkzeug   Name(n) — mindestens einer muss aufgerufen worden sein
//   kein_werkzeug  Name(n) — keiner davon darf aufgerufen worden sein
//   enthaelt   Regex, die in der Antwort vorkommen MUSS
//   verboten   Regex, die NICHT vorkommen darf
//   maxMs      Zeitbudget. Ueberschreitung ist ein Mangel, kein Absturz.
//
// schreibt: true  -> laeuft nie parallel zu anderen (sonst faelschen sich zwei
//                    Laeufe gegenseitig die Zahlen) und wird beim Aufraeumen
//                    beruecksichtigt.

// Nichts darf klingen wie eine Fehlermeldung. Diese Wendungen sind aus echten
// Sprachprotokollen gesammelt — sie sind der haeufigste Grund, warum eine
// Aufnahme unbrauchbar wird.
const PANNE = /(hat nicht geklappt|ist etwas schiefgegangen|steckengeblieben|nicht erreichbar|keine Antwort erhalten|Fehler|fehlgeschlagen|hakt|komme? gerade nicht an|kann ich (dir )?(gerade )?nicht)/i;
// Interne Begriffe, die Lukas nie hoeren soll (dieselbe Liste wie in
// lib/sprache-routes.js — sie steht dort als Messgroesse, hier als Pruefung).
const INTERN = /\b(hermes|sonnet|haiku|token|prompt|json|werkzeug\w*|lange_arbeit|auftrag-id|sql|datenbank)\b/i;

// Ein Geldbetrag — als Ziffern ("5.000 €", "7000 Euro") oder ausgeschrieben
// ("Siebentausend Euro"). Beides ist eine Antwort auf "wie viel Umsatz";
// eine Liste von Kundennamen ist keine.
const BETRAG = /(\d[\d.]*\s*(€|Euro)|(tausend|hundert|million)\w*\s*Euro)/i;

// POSITIVE ERWARTUNGEN (20.08.2026).
//
// Bis hierher pruefte fast jedes Szenario nur, was NICHT vorkommen darf. Durch
// diese Luecke ging "Die Flugsuche ist mir gerade weggebrochen" dreimal als
// BESTANDEN durch: kein Panne-Wort, keine Zeitueberschreitung, also gruen —
// obwohl kein einziger Preis geliefert wurde.
//
// Ein Test, der nur Verbote kennt, ist mit Schweigen zufrieden. Jedes Szenario
// braucht deshalb einen Satz darueber, was in der Antwort STEHEN muss.
const UHRZEIT = /(\d{1,2}:\d{2}|\d{1,2} Uhr|[a-zäöü]+ Uhr)/i;
const ZAHL = /(\d|null|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|kein)/i;
// Die Flugsuche hat geliefert, wenn ein Preis dasteht — nicht, wenn sie nur
// nicht gejammert hat.
const FLUG_DA = /(\d[\d.]*\s*(€|Euro)|(hundert|tausend)\w*\s*Euro)/i;
const FLUG_WEG = /(weggebrochen|nicht durchgelaufen|keinen Preis|kein Chrome|nicht verstanden)/i;

const SZENARIEN = [
  // ============================================================ Creative 1
  {
    id: "c1-1", gruppe: "kern", titel: "Cold Calls, Erstgespraeche, Sales von gestern",
    zuege: [
      // MUSS Zahlen nennen. "Dazu hab ich nichts" waere frueher durchgegangen.
      { frage: "Wie viele Cold Calls hat das Team gestern gemacht, wie viele davon wurden zu Erstgesprächen, und wie viele zu Sales?",
        werkzeug: ["daten_fragen"], enthaelt: ZAHL, verboten: PANNE, maxMs: 30000 },
    ],
  },
  {
    id: "c1-2", gruppe: "kern", titel: "Umsatz Juli",
    zuege: [
      { frage: "Wie viel Umsatz wurde im Juli generiert?",
        enthaelt: BETRAG, verboten: PANNE, maxMs: 30000 },
    ],
  },
  {
    id: "c1-3", gruppe: "kern", titel: "Leads fuer morgen + Nachschub",
    zuege: [
      // KEIN Werkzeug erzwungen (20.08.2026): Seit die Zahl als Kennzahl im
      // STAND steht (lib/crm.js, anrufbare_leads), antwortet Alexandra ohne
      // Abfrage — in 3,6 s statt 7,5 s und jedes Mal mit derselben Zahl. Ein
      // Test, der hier daten_fragen verlangt, wuerde den besseren Weg
      // durchfallen lassen. Geprueft wird die ANTWORT: eine Menge Leads, und
      // keine Aufteilung nach Personen.
      { frage: "Wie viele Leads haben wir für morgen zur Verfügung?",
        enthaelt: /(1[.\s]?7\d\d|siebzehnhundert|tausendsiebenhundert)/i,
        verboten: /(Ioannis|Jannik|pro Mitarbeiter)/i,
        maxMs: 30000 },
      // MUSS sagen, wie viele es geworden sind — "mach ich" allein ist nichts.
      { frage: "Das ist zu wenig. Such nochmal hundert weitere raus.",
        werkzeug: ["leads_nachschub"], enthaelt: /(\d{2,}|hundert)/i, verboten: PANNE, maxMs: 45000 },
    ],
  },

  // ============================================================ Creative 2
  {
    id: "c2-1", gruppe: "kern", titel: "Neue Mails heute",
    zuege: [
      { frage: "Wie viele neue Mails kamen heute rein?",
        werkzeug: ["mail_lesen"], enthaelt: ZAHL, verboten: PANNE, maxMs: 35000 },
    ],
  },
  {
    id: "c2-2", gruppe: "kern", titel: "To-Dos fuer heute",
    zuege: [
      { frage: "Was sind die To-Dos für heute?", enthaelt: ZAHL, verboten: PANNE, maxMs: 25000 },
    ],
  },
  {
    id: "c2-3", gruppe: "kern", titel: "Termine heute, einen loeschen, einen neuen", schreibt: true,
    zuege: [
      // MUSS eine Uhrzeit nennen — "heute steht nichts an" waere sonst gleich gut.
      { frage: "Was sind meine Termine heute?", enthaelt: UHRZEIT, verboten: PANNE, maxMs: 25000 },
      { frage: `Trag mir heute um 16 Uhr ${PRAEFIX} Probeaufnahme ein.`,
        werkzeug: ["termin_eintragen"], enthaelt: /Steht|eingetragen/i,
        verboten: /gehakt|nicht drin/i, maxMs: 30000 },
      // enthaelt/verboten statt nur werkzeug: Im Fernmodus gibt es kein
      // Sprachprotokoll, und genau dort ist der Fehler aufgetreten — der
      // Termin stand im Kalender, der STAND kannte ihn noch nicht, und die
      // Antwort war "Ich finde keinen Termin". Der Wortlaut faengt das ueberall.
      { frage: `Sag den Termin ${PRAEFIX} Probeaufnahme wieder ab.`,
        werkzeug: ["termin_absagen"], enthaelt: /(Abgesagt|ist raus)/i,
        verboten: /finde keinen Termin/i, maxMs: 30000 },
    ],
  },
  {
    id: "c2-4", gruppe: "kern", titel: "WhatsApp an Jannik formulieren",
    zuege: [
      // MUSS den Entwurf enthalten, nicht nur "mach ich".
      { frage: "Formulier eine WhatsApp an Jannik, dass wir morgen um zehn mit den Aufnahmen starten.",
        werkzeug: ["whatsapp_senden"], enthaelt: /(Jannik|morgen|zehn|10)/i,
        verboten: PANNE, maxMs: 35000 },
      // Bewusst NICHT bestaetigen: In der Aufnahme soll man die Rueckfrage
      // hoeren. Dass sie kommt, ist der Pruefpunkt.
      { frage: "Nein, noch nicht schicken.",
        enthaelt: /(ok|gut|verworfen|liegt|warte|Bescheid|nicht)/i, verboten: PANNE, maxMs: 25000 },
    ],
  },

  // ============================================================ Creative 3
  {
    id: "c3-1", gruppe: "kern", titel: "Erstgespraech auswerten und Angebot erstellen", schreibt: true,
    zuege: [
      // MUSS die Firma aufgreifen. "Bei welcher Firma denn?" ist die Antwort,
      // die live kam — der Name stand im Satz.
      { frage: "Werte das Erstgespräch mit der Zahnarztpraxis Bergmann aus und erstell mir auf dieser Basis ein Angebot.",
        werkzeug: ["beleg_erstellen", "lange_arbeit", "nachschlagen", "gehirn_suchen"],
        enthaelt: /Bergmann/i, verboten: /(welche[rn]? Firma|welchen Zusammenhang|fehlt mir der Zusammenhang)/i,
        maxMs: 60000 },
    ],
  },
  {
    id: "c3-2", gruppe: "kern", titel: "Follow-up-Termin eintragen", schreibt: true,
    zuege: [
      { frage: `Trag einen Termin für das Follow-up ein, nächsten Dienstag um elf, nenn ihn ${PRAEFIX} Follow-up Bergmann.`,
        werkzeug: ["termin_eintragen"], enthaelt: /Steht|eingetragen/i,
        verboten: /gehakt|nicht drin/i, maxMs: 30000 },
    ],
  },
  {
    id: "c3-3", gruppe: "kern", titel: "Beleg einscannen + Ordner an die Steuerberaterin",
    zuege: [
      // MUSS einen Weg nennen. Ein blosses "kann ich nicht" ist die Antwort,
      // die live kam.
      { frage: "Ich hab einen Beleg zum Einscannen für die Buchhaltung — was muss ich tun?",
        enthaelt: /(foto|hochlad|Telegram|schick|Buchhaltung|Beleg)/i, maxMs: 30000 },
      { frage: "Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin.",
        enthaelt: /(Monat|welche|Rechnung|Entwurf|Ordner|schick)/i, maxMs: 45000 },
    ],
  },

  // ============================================================ TikTok
  {
    id: "tt-1", gruppe: "kern", titel: "Morning Briefing",
    zuege: [
      // Ein Briefing ohne eine einzige Zahl ist kein Briefing.
      { frage: "Guten Morgen — gib mir mein Morning Briefing.",
        enthaelt: ZAHL, verboten: PANNE, maxMs: 40000 },
    ],
  },

  // ============================================================ Computer Use
  {
    id: "cu-1", gruppe: "kern", titel: "Guenstigster Flug, abgestimmt mit dem Kalender",
    zuege: [
      // MUSS einen Preis liefern. Genau hier ging "weggebrochen" dreimal als
      // bestanden durch, weil nur Verbote geprueft wurden.
      { frage: "Buch mir den günstigsten Flieger nach Barcelona, abgestimmt mit meinem Terminkalender.",
        werkzeug: ["computer_auftrag"], enthaelt: FLUG_DA, verboten: FLUG_WEG, maxMs: 90000 },
    ],
  },
  {
    id: "cu-2", gruppe: "computer", titel: "Flug ohne Kalenderbezug",
    zuege: [
      { frage: "Such mir den günstigsten Flug von München nach Lissabon im September.",
        werkzeug: ["computer_auftrag"], enthaelt: FLUG_DA, verboten: FLUG_WEG, maxMs: 90000 },
    ],
  },
  {
    id: "cu-3", gruppe: "computer", titel: "Nachfassen auf einen Flugvorschlag",
    zuege: [
      { frage: "Such mir den günstigsten Flug nach Barcelona nächste Woche.",
        werkzeug: ["computer_auftrag"], enthaelt: FLUG_DA, verboten: FLUG_WEG, maxMs: 90000 },
      { frage: "Und buch den gleich.", enthaelt: /(freigab|buch|selbst|nicht|Warenkorb|du)/i, maxMs: 40000 },
    ],
  },

  // ==================================================== Varianten Zahlen/CRM
  { id: "z-1", gruppe: "zahlen", titel: "Anrufe heute", zuege: [
    { frage: "Wie viele Anrufe hat das Team heute schon gemacht?", werkzeug: ["daten_fragen"], maxMs: 30000 }] },
  { id: "z-2", gruppe: "zahlen", titel: "Erstgespraeche diese Woche", zuege: [
    { frage: "Wurden diese Woche Erstgespräche gebucht?", werkzeug: ["daten_fragen"], maxMs: 30000 }] },
  { id: "z-3", gruppe: "zahlen", titel: "Umsatz letzter Monat, umformuliert", zuege: [
    { frage: "Was haben wir letzten Monat eingenommen?", werkzeug: ["daten_fragen", "nachschlagen"], maxMs: 30000 }] },
  { id: "z-4", gruppe: "zahlen", titel: "Bester im Team", zuege: [
    { frage: "Wer hat im Team gerade die meisten Leads?", werkzeug: ["daten_fragen"], maxMs: 30000 }] },
  { id: "z-5", gruppe: "zahlen", titel: "Umsatz Jahr", zuege: [
    { frage: "Wie viel Umsatz haben wir dieses Jahr insgesamt gemacht?", werkzeug: ["daten_fragen", "nachschlagen"], maxMs: 30000 }] },
  { id: "z-6", gruppe: "zahlen", titel: "Quote", zuege: [
    { frage: "Wie ist unsere Abschlussquote von Erstgespräch zu Kunde?", werkzeug: ["daten_fragen"], maxMs: 35000 }] },
  { id: "z-7", gruppe: "zahlen", titel: "Nachfassen auf eine Zahl", zuege: [
    { frage: "Wie viele Leads haben wir insgesamt im System?", werkzeug: ["daten_fragen"], maxMs: 30000 },
    { frage: "Und wie viele davon sind noch nie angerufen worden?", werkzeug: ["daten_fragen"], maxMs: 35000 }] },
  { id: "z-8", gruppe: "zahlen", titel: "Zwei Fragen in einem Satz", zuege: [
    { frage: "Sag mir den Umsatz vom Juli und wie viele Kunden wir gerade haben.", werkzeug: ["daten_fragen"], maxMs: 40000 }] },
  { id: "z-9", gruppe: "zahlen", titel: "Unklarer Zeitraum", zuege: [
    { frage: "Wie lief's letzte Zeit?", maxMs: 35000 }] },
  { id: "z-10", gruppe: "zahlen", titel: "Stand bei einer Firma", zuege: [
    { frage: "Wie ist der Stand bei Krotzer?", werkzeug: ["nachschlagen", "daten_fragen"], maxMs: 35000 }] },
  { id: "z-11", gruppe: "zahlen", titel: "Korrektur mitten drin", zuege: [
    { frage: "Wie viele Cold Calls waren es gestern? Nein, doch lieber die ganze Woche.", werkzeug: ["daten_fragen"], maxMs: 40000 }] },
  { id: "z-12", gruppe: "zahlen", titel: "Offene Rechnungen", zuege: [
    { frage: "Sind noch Rechnungen offen?", werkzeug: ["daten_fragen", "nachschlagen"], maxMs: 35000 }] },

  // ==================================================== Varianten Kalender
  { id: "k-1", gruppe: "kalender", titel: "Termine morgen", zuege: [
    { frage: "Was steht morgen an?", enthaelt: UHRZEIT, verboten: PANNE, maxMs: 25000 }] },
  { id: "k-2", gruppe: "kalender", titel: "Naechster Termin", zuege: [
    { frage: "Wann ist mein nächster Termin?", enthaelt: UHRZEIT, verboten: PANNE, maxMs: 25000 }] },
  { id: "k-3", gruppe: "kalender", titel: "Termin anlegen und verschieben", schreibt: true, zuege: [
    { frage: `Trag mir morgen um neun ${PRAEFIX} Kamera-Check ein.`, werkzeug: ["termin_eintragen"],
      enthaelt: /Steht|eingetragen/i, verboten: /gehakt|nicht drin/i, maxMs: 30000 },
    { frage: `Schieb ${PRAEFIX} Kamera-Check auf halb elf.`, werkzeug: ["termin_verschieben"],
      enthaelt: /(Verschoben|Geändert)/i, verboten: /finde keinen Termin/i, maxMs: 30000 },
    { frage: `Und sag ihn doch wieder ab.`, werkzeug: ["termin_absagen"],
      enthaelt: /(Abgesagt|ist raus)/i, verboten: /finde keinen Termin/i, maxMs: 30000 }] },
  { id: "k-4", gruppe: "kalender", titel: "Termin ohne Uhrzeit", schreibt: true, zuege: [
    { frage: `Trag mir am Freitag ${PRAEFIX} Drehtag ganztägig ein.`, werkzeug: ["termin_eintragen"], maxMs: 30000 }] },
  // Kein "Mach ich" vor einem Werkzeug, das scheitern kann. Live gemessen:
  // "Mach ich, der Kamera-Check morgen fliegt raus. Ich finde keinen Termin …"
  { id: "k-5", gruppe: "kalender", titel: "Nicht existierender Termin", zuege: [
    { frage: "Sag den Termin mit dem Bundeskanzler ab.",
      verboten: /(abgesagt|ist raus|fliegt raus|mach ich|sag ich ab|schieb ich)/i,
      enthaelt: /finde keinen Termin/i, maxMs: 30000 }] },
  { id: "k-6", gruppe: "kalender", titel: "Freie Zeit finden", zuege: [
    { frage: "Wann hab ich diese Woche zwei Stunden am Stück frei?", maxMs: 35000 }] },
  { id: "k-7", gruppe: "kalender", titel: "Termin plus Aufgabe in einem Satz", schreibt: true, zuege: [
    { frage: `Trag mir morgen um 14 Uhr ${PRAEFIX} Schnitt ein und setz ${PRAEFIX} Musik aussuchen auf die Liste.`,
      werkzeug: ["termin_eintragen"], maxMs: 40000 }] },

  // ==================================================== Varianten Aufgaben
  { id: "a-1", gruppe: "aufgaben", titel: "Aufgabe anlegen und abhaken", schreibt: true, zuege: [
    { frage: `Setz ${PRAEFIX} Akkus laden auf die Liste.`, werkzeug: ["aufgabe_anlegen"],
      enthaelt: /(steht|liste|notiert|drauf|eingetragen)/i, maxMs: 30000 },
    { frage: `${PRAEFIX} Akkus laden hab ich erledigt.`, werkzeug: ["aufgabe_erledigt"], maxMs: 30000 }] },
  { id: "a-2", gruppe: "aufgaben", titel: "Aufgabe mit Frist", schreibt: true, zuege: [
    { frage: `Erinner mich bis Freitag an ${PRAEFIX} Rechnung Bergmann.`, werkzeug: ["aufgabe_anlegen"], maxMs: 30000 }] },
  { id: "a-3", gruppe: "aufgaben", titel: "Was ist offen", zuege: [
    { frage: "Was ist bei mir noch offen?", verboten: PANNE, maxMs: 30000 }] },
  { id: "a-4", gruppe: "aufgaben", titel: "Aufgabe vs. Termin unterscheiden", schreibt: true, zuege: [
    { frage: `Ich muss ${PRAEFIX} das Objektiv putzen, irgendwann.`, werkzeug: ["aufgabe_anlegen"], kein_werkzeug: ["termin_eintragen"], maxMs: 30000 }] },

  // ==================================================== Varianten Nachrichten
  { id: "n-1", gruppe: "nachricht", titel: "WhatsApp kurz", zuege: [
    { frage: "Schreib Jannik, dass ich zehn Minuten später komme.", werkzeug: ["whatsapp_senden"], maxMs: 35000 }] },
  { id: "n-2", gruppe: "nachricht", titel: "WhatsApp mit Freigabe", zuege: [
    { frage: "Sag Jannik Bescheid, dass die Kamera da ist.", werkzeug: ["whatsapp_senden"], maxMs: 35000 },
    { frage: "Ja, schick sie ab.", verboten: PANNE, maxMs: 30000 }] },
  { id: "n-3", gruppe: "nachricht", titel: "WhatsApp umformulieren lassen", zuege: [
    { frage: "Formulier eine WhatsApp an Jannik wegen morgen.", werkzeug: ["whatsapp_senden"], maxMs: 35000 },
    { frage: "Nein, schreib das kürzer und lockerer.", werkzeug: ["whatsapp_senden"], maxMs: 35000 }] },
  { id: "n-4", gruppe: "nachricht", titel: "Mail an mich selbst", zuege: [
    { frage: "Schick mir eine Mail mit den Zahlen von heute.", maxMs: 45000 }] },
  { id: "n-5", gruppe: "nachricht", titel: "Externe Mail = Entwurf", zuege: [
    { frage: "Schreib eine Mail an die Zahnarztpraxis Bergmann, dass sich das Angebot verzögert.",
      kein_werkzeug: [], maxMs: 45000 }] },
  { id: "n-6", gruppe: "nachricht", titel: "Erfundener Gruppenname", zuege: [
    { frage: "Schreib in die Gruppe Vertriebsleitung Nord, dass wir morgen drehen.",
      verboten: /ist raus|abgeschickt|gesendet/i, maxMs: 35000 }] },
  { id: "n-7", gruppe: "nachricht", titel: "Neue Mails, umformuliert", zuege: [
    { frage: "Ist heute was Wichtiges reingekommen?", werkzeug: ["mail_lesen"], maxMs: 40000 }] },
  { id: "n-8", gruppe: "nachricht", titel: "WhatsApp lesen", zuege: [
    { frage: "Was hat Jannik zuletzt geschrieben?", werkzeug: ["whatsapp_lesen"], maxMs: 35000 }] },

  // ==================================================== Varianten CRM
  { id: "c-1", gruppe: "crm", titel: "Lead anlegen", schreibt: true, zuege: [
    { frage: `Leg einen Lead an: ${PRAEFIX} Zahnarztpraxis Bergmann, München, kam über Empfehlung.`,
      werkzeug: ["crm_lead"], enthaelt: /(angelegt|steht|drin|Bergmann)/i, maxMs: 35000 }] },
  { id: "c-2", gruppe: "crm", titel: "Notiz an einer Firma", schreibt: true, zuege: [
    { frage: `Leg einen Lead an: ${PRAEFIX} Praxis Nordlicht, Hamburg.`, werkzeug: ["crm_lead"], maxMs: 35000 },
    { frage: `Notier bei ${PRAEFIX} Praxis Nordlicht, dass sie erst im Oktober Budget haben.`,
      werkzeug: ["crm_notiz"], maxMs: 35000 }] },
  { id: "c-3", gruppe: "crm", titel: "Anrufergebnis festhalten", schreibt: true, zuege: [
    { frage: `Leg einen Lead an: ${PRAEFIX} Praxis Sonnenhof, Rosenheim.`, werkzeug: ["crm_lead"], maxMs: 35000 },
    { frage: `Ich hab bei ${PRAEFIX} Praxis Sonnenhof angerufen, wir haben ein Erstgespräch ausgemacht.`,
      werkzeug: ["crm_anruf"], maxMs: 35000 }] },
  { id: "c-4", gruppe: "crm", titel: "Wiedervorlage", schreibt: true, zuege: [
    { frage: `Leg einen Lead an: ${PRAEFIX} Praxis Waldblick, Augsburg.`, werkzeug: ["crm_lead"], maxMs: 35000 },
    { frage: `Erinner mich in einer Woche an ${PRAEFIX} Praxis Waldblick.`, werkzeug: ["crm_wiedervorlage"], maxMs: 35000 }] },
  { id: "c-5", gruppe: "crm", titel: "Firma ohne Namen", zuege: [
    { frage: "Leg mir mal einen Lead an.", verboten: /angelegt|steht|ist drin/i, maxMs: 30000 }] },

  // ==================================================== Varianten Buchhaltung
  { id: "b-1", gruppe: "buchhaltung", titel: "Naechste Rechnungsnummer", zuege: [
    { frage: "Welche Rechnungsnummer kommt als nächstes dran?", werkzeug: ["beleg_nummer"],
      enthaelt: ZAHL, verboten: PANNE, maxMs: 30000 }] },
  { id: "b-2", gruppe: "buchhaltung", titel: "Angebot mit allen Angaben", schreibt: true, zuege: [
    { frage: `Schreib ein Angebot für ${PRAEFIX} Zahnarztpraxis Bergmann über 4.500 Euro für eine neue Website mit Terminbuchung.`,
      werkzeug: ["beleg_erstellen"], maxMs: 60000 }] },
  { id: "b-3", gruppe: "buchhaltung", titel: "Rechnung ohne Betrag", zuege: [
    { frage: "Schreib eine Rechnung für Bergmann.", verboten: /ist erstellt|liegt bereit|Nummer \d/i, maxMs: 35000 }] },
  { id: "b-4", gruppe: "buchhaltung", titel: "Belege des Monats", zuege: [
    { frage: "Welche Belege habe ich diesen Monat schon abgelegt?", maxMs: 35000 }] },

  // ==================================================== Sprache/Ton
  { id: "s-1", gruppe: "sprache", titel: "Kein Fachjargon", zuege: [
    { frage: "Was kannst du eigentlich alles?", verboten: INTERN, maxMs: 30000 }] },
  { id: "s-2", gruppe: "sprache", titel: "Gedaechtnis ueber Zuege", zuege: [
    { frage: "Wie ist das Wetter morgen?", werkzeug: ["wetter"], maxMs: 30000 },
    { frage: "Wie viele Leads haben wir?", maxMs: 30000 },
    { frage: "Was hab ich dich als Erstes gefragt?", enthaelt: /wetter/i, maxMs: 30000 }] },
  { id: "s-3", gruppe: "sprache", titel: "Euro und Datum sprechbar", zuege: [
    { frage: "Wie viel Umsatz war es im Juli, sag es mir in einem Satz.",
      verboten: /€|EUR\b|\d{4}-\d{2}-\d{2}/, maxMs: 35000 }] },
  { id: "s-4", gruppe: "sprache", titel: "Unverstaendliche Eingabe", zuege: [
    { frage: "das kann aus okay ja ich klappte doch keine Zeit", verboten: PANNE, maxMs: 30000 }] },
  { id: "s-5", gruppe: "sprache", titel: "Abbruch mitten drin", zuege: [
    { frage: "Trag mir morgen um zehn einen Termin ein — nein, warte, lass es.",
      kein_werkzeug: ["termin_eintragen"], maxMs: 30000 }] },
  { id: "s-6", gruppe: "sprache", titel: "Zwei Auftraege in einem Satz", zuege: [
    { frage: "Sag mir das Wetter für morgen und wie viele Mails heute reinkamen.",
      werkzeug: ["wetter"], maxMs: 45000 }] },
  { id: "s-7", gruppe: "sprache", titel: "Frage nach den eigenen Grenzen", zuege: [
    { frage: "Darfst du eigentlich selbst was bestellen?",
      enthaelt: /(nicht|nie|freigab|frag)/i, maxMs: 30000 }] },
  { id: "s-8", gruppe: "sprache", titel: "Hoeflichkeit ohne Auftrag", zuege: [
    { frage: "Danke dir.", verboten: PANNE, maxMs: 25000 }] },
  { id: "s-9", gruppe: "sprache", titel: "Begruessung", zuege: [
    { frage: "Guten Morgen Alexandra.", verboten: PANNE, maxMs: 25000 }] },
  { id: "s-10", gruppe: "sprache", titel: "Widerspruch des Nutzers", zuege: [
    { frage: "Wie viel Umsatz war im Juli?", maxMs: 35000 },
    { frage: "Das stimmt nicht, schau nochmal genau nach.", verboten: PANNE, maxMs: 40000 }] },
  { id: "s-11", gruppe: "sprache", titel: "Wetter", zuege: [
    { frage: "Wie wird das Wetter morgen in München?", werkzeug: ["wetter"],
      // Grad ODER ein Wetterwort MIT Zahl. Ohne diese Kopplung ging "Alles
      // klar." als Wetterauskunft durch — das Wort "klar" steht darin.
      enthaelt: /(\d+\s*(grad|°)|(sonn|regen|wolk|bewölkt|schauer|gewitter|schnee|nebel)\w*)/i,
      verboten: PANNE, maxMs: 30000 }] },
  { id: "s-12", gruppe: "sprache", titel: "Recherche", zuege: [
    { frage: "Was kostet aktuell eine Meta-Ads-Agentur im Monat, so als Richtwert?",
      werkzeug: ["recherchieren", "lange_arbeit"], maxMs: 60000 }] },
  { id: "s-13", gruppe: "sprache", titel: "Firmengedaechtnis", zuege: [
    { frage: "Was haben wir damals zum Thema Preisgestaltung entschieden?",
      werkzeug: ["gehirn_suchen", "nachschlagen"], maxMs: 45000 }] },
  { id: "s-14", gruppe: "sprache", titel: "Dashboard zeigen", zuege: [
    { frage: "Zeig mir mal den Kalender.", maxMs: 25000 }] },
  { id: "s-15", gruppe: "sprache", titel: "Anruf anfordern", zuege: [
    { frage: "Ruf mich in zehn Sekunden an.", werkzeug: ["anrufen"], maxMs: 30000 }] },

  // ============================================== Nachgereicht am 20.08.
  //
  // Jeder Fall hier stammt aus einer Messung am laufenden Server, nicht aus
  // einer Vermutung. Die Gruppe heisst "rueckfall", weil genau das ihr Zweck
  // ist: dass diese fünf nicht ein zweites Mal auftreten.
  //
  // Rohdaten duerfen NIE in der gesprochenen Antwort landen. Diese Wendungen
  // standen am 20.08. woertlich in einer Flugantwort.
  { id: "r-1", gruppe: "rueckfall", titel: "Flugantwort ohne Google-Rohtext", zuege: [
    { frage: "Buch mir den günstigsten Flieger nach Barcelona, abgestimmt mit meinem Terminkalender.",
      werkzeug: ["computer_auftrag"], enthaelt: FLUG_DA,
      verboten: /(CO2|gesch(ä|ae)tzt|Durchgef(ü|ue)hrt von|kg CO2e|weggebrochen|nicht durchgekommen)/i,
      maxMs: 60000 }] },

  // "Umsatz" muss IMMER zu einer Summe fuehren, nicht nur mit Monatsnennung.
  // Gemessen: "9 Deals diesen Monat: Ralph Richter Malereibetrieb, Frau
  // Ladenhauf …" — gefragt war nach Geld.
  // GEPRUEFT WIRD DIE ANTWORT, NICHT DER WEG. Auf "diesen Monat" antwortete sie
  // in 4,5 s aus dem STAND — ohne Abfrage, mit "Siebentausend Euro". Richtig
  // und schneller als jede Datenbankrunde. Ein Test, der hier ein Werkzeug
  // erzwingt, wuerde die bessere Loesung durchfallen lassen.
  //
  // BETRAG heisst: Ziffern mit Euro ODER ausgeschrieben. Beides ist eine Zahl,
  // nur die Aufzaehlung von Kundennamen ist keine.
  { id: "r-2", gruppe: "rueckfall", titel: "Umsatz diesen Monat ist ein Betrag", zuege: [
    { frage: "Wie viel Umsatz haben wir diesen Monat gemacht?", enthaelt: BETRAG, maxMs: 40000 }] },
  { id: "r-3", gruppe: "rueckfall", titel: "Umsatz dieses Jahr ist ein Betrag", zuege: [
    { frage: "Wie viel haben wir dieses Jahr eingenommen?", enthaelt: BETRAG, maxMs: 40000 }] },
  { id: "r-4", gruppe: "rueckfall", titel: "Umsatz letzte Woche ist ein Betrag", zuege: [
    { frage: "Was haben wir letzte Woche umgesetzt?", enthaelt: BETRAG, maxMs: 40000 }] },

  // Duenner Nachrichtenauftrag: formulieren und vorlegen, nicht zurueckfragen.
  // Drehbuch Creative 2d. Gemessen: "Was soll's morgen sein — Termin, Calls,
  // oder was Bestimmtes? Ohne das schreib ich ihm nur Luft."
  { id: "r-5", gruppe: "rueckfall", titel: "WhatsApp mit duennem Auftrag", zuege: [
    { frage: "Formulier eine WhatsApp an Jannik wegen morgen.",
      werkzeug: ["whatsapp_senden"], enthaelt: /(Jannik|morgen)/i,
      verboten: /(Was soll|Worum geht|Ohne das)/i, maxMs: 40000 }] },

  // Ein Teilfehler darf nie roh im Text stehen ("spawn gws-cli ENOENT").
  { id: "r-6", gruppe: "rueckfall", titel: "Briefing ohne technische Fehlermeldung", zuege: [
    { frage: "Guten Morgen — gib mir mein Morning Briefing.",
      // "null" steht hier bewusst NICHT: Auf Deutsch ist das eine ganz normale
      // Zahl ("für morgen null Wiedervorlagen"), und der Test hat genau darauf
      // angeschlagen. Gesucht sind technische Reste, keine deutschen Wörter.
      enthaelt: ZAHL,
      verboten: /(ENOENT|spawn |gws-cli|ECONNREFUSED|undefined|\[object |Error:|: null)/i, maxMs: 45000 }] },

  // ==================================================== Leads-Nachschub
  { id: "l-1", gruppe: "leads", titel: "Nachschub mit Ort und Branche", zuege: [
    { frage: "Such mir fünfzig neue Zahnarztpraxen in München als Leads raus.",
      werkzeug: ["leads_nachschub", "lange_arbeit"], maxMs: 60000 }] },
  { id: "l-2", gruppe: "leads", titel: "Nachschub ohne Angaben", zuege: [
    { frage: "Wir brauchen mehr Leads.", maxMs: 35000 }] },
  { id: "l-3", gruppe: "leads", titel: "Nachschub nach Zahlenfrage", zuege: [
    { frage: "Wie viele unbearbeitete Leads liegen noch da?", werkzeug: ["daten_fragen"], maxMs: 35000 },
    { frage: "Zu wenig — leg nochmal hundert nach, gleiche Zielgruppe.",
      werkzeug: ["leads_nachschub", "lange_arbeit"], maxMs: 60000 }] },

  // ==================================================== Beleg/Steuerberaterin
  { id: "st-1", gruppe: "steuer", titel: "Belege sammeln und schicken", zuege: [
    { frage: "Schick alle Rechnungen vom Juli an die Steuerberaterin.", maxMs: 60000 }] },
  { id: "st-2", gruppe: "steuer", titel: "Beleg ablegen", zuege: [
    { frage: "Ich hab hier eine Tankquittung über 68 Euro — leg die für die Buchhaltung ab.", maxMs: 45000 }] },
];

// ---------------------------------------------------------------- Umgebung
function envLesen(datei, ziel) {
  if (!datei || !fs.existsSync(datei)) return;
  for (const z of fs.readFileSync(datei, "utf-8").split("\n")) {
    const t = z.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) ziel[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}

function umgebungBauen(datenPfad) {
  const env = { ...process.env };
  // Die zusaetzliche Datei ZUERST — envLesen setzt nur, was noch leer ist,
  // damit gewinnt die erste gelesene Quelle. So kann ein Probelauf einen
  // Schluessel mitbringen, den die lokale .env nicht hat.
  envLesen(EXTRA_ENV, env);
  envLesen(path.join(WURZEL, ".env"), env);

  env.PORT = String(PORT);
  env.DATA_PATH = datenPfad;
  env.DASHBOARD_PASSWORD ||= "ads-probe";
  env.ADS_PROBE = "1";                 // der Riegel, siehe lib/probemodus.js

  // GUERTEL UND HOSENTRAEGER: Selbst wenn der Riegel in probemodus.js einmal
  // nicht greifen sollte, kann ohne diese Zugaenge nichts hinausgehen. Sie
  // werden hier bewusst GELEERT und nicht bloss weggelassen — sonst kaeme der
  // Wert doch noch aus der .env.
  for (const k of ["TELEGRAM_BOT_TOKEN", "MELDE_SECRET", "WA_BRIDGE_URL", "WA_BRIDGE_SECRET",
                   "ELEVENLABS_AGENT_ID", "TELEFON_SECRET", "TELEFON_ZIEL"]) env[k] = "";

  return env;
}

// ---------------------------------------------------------------- HTTP
// Wohin die Anfragen gehen: eigener Server auf 127.0.0.1 oder der ferne.
const FERNZIEL = FERN ? new URL(ZIEL_URL) : null;
const NETZ = FERN && FERNZIEL.protocol === "https:" ? require("https") : http;

function anfrage(pfad, { methode = "GET", body = null, typ = "application/json", cookie = "", timeoutMs = 180000 } = {}) {
  return new Promise((ok, fehler) => {
    const daten = body == null ? null : (typ === "application/json" ? JSON.stringify(body) : body);
    const kopf = {};
    if (daten) { kopf["content-type"] = typ; kopf["content-length"] = Buffer.byteLength(daten); }
    if (cookie) kopf.cookie = cookie;
    const r = NETZ.request({
      host: FERN ? FERNZIEL.hostname : "127.0.0.1",
      port: FERN ? (FERNZIEL.port || undefined) : PORT,
      path: pfad, method: methode, headers: kopf, timeout: timeoutMs },
      (res) => {
        let roh = "";
        res.setEncoding("utf-8");
        res.on("data", (d) => { roh += d; });
        res.on("end", () => ok({ code: res.statusCode, kopf: res.headers, text: roh }));
      });
    r.on("error", fehler);
    r.on("timeout", () => { r.destroy(new Error("Zeitüberschreitung nach " + timeoutMs + " ms")); });
    if (daten) r.write(daten);
    r.end();
  });
}

// Eine eigene angemeldete Sitzung. Jeder gleichzeitige Strang braucht eine —
// sonst teilen sich zwei Gespraeche denselben Verlauf und beeinflussen sich.
// DREI ANLAEUFE (20.08.2026). Beim ersten Lauf fielen zwei Szenarien mit
// "socket hang up" aus — nicht inhaltlich, sondern weil mehrere Anmeldungen
// gleichzeitig an derselben Supabase-Anmeldung hingen. Ein Testlauf, der aus
// so einem Grund rot wird, verdeckt genau die Befunde, wegen derer er laeuft.
async function sitzungAnmelden() {
  const koerper = `email=${encodeURIComponent(MAIL)}&password=${encodeURIComponent(PASSWORT)}`;
  let letzter = null;
  for (let versuch = 0; versuch < 3; versuch++) {
    if (versuch) await new Promise((r) => setTimeout(r, 700 * versuch));
    try {
      const a = await anfrage("/login", { methode: "POST", body: koerper, typ: "application/x-www-form-urlencoded", timeoutMs: 30000 });
      if (String(a.kopf.location || "").includes("err=1")) {
        throw new Error("Anmeldung abgelehnt — Zugangsdaten oder DATABASE_URL prüfen.");
      }
      const cookie = (a.kopf["set-cookie"] || []).map((c) => String(c).split(";")[0]).join("; ");
      if (cookie) return cookie;
      letzter = new Error("Keine Sitzung erhalten (HTTP " + a.code + ")");
    } catch (e) {
      letzter = e;
      if (/abgelehnt/.test(e.message)) break;   // ein falsches Passwort wird nicht besser
    }
  }
  throw letzter || new Error("Anmeldung fehlgeschlagen");
}

// ---------------------------------------------------------------- Protokoll
//
// Welche Werkzeuge tatsaechlich gerufen wurden, steht nicht in der Antwort,
// sondern im Sprachprotokoll (lib/sprachlog.js) — dieselbe Quelle, mit der
// Lukas hinterher eine schiefe Antwort auseinandernimmt. Weil DATA_PATH in den
// Wegwerf-Ordner zeigt, enthaelt sie ausschliesslich diesen Lauf.
function protokollLesen(datenPfad) {
  const dir = path.join(datenPfad, "sprachlog");
  const zeilen = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      for (const z of fs.readFileSync(path.join(dir, name), "utf-8").split("\n")) {
        if (!z.trim()) continue;
        try { zeilen.push(JSON.parse(z)); } catch { /* halbe Zeile am Ende */ }
      }
    }
  } catch { /* noch nichts geschrieben */ }
  return zeilen;
}

// Alles, was zu genau dieser Frage gehoert. Verglichen wird auf den Wortlaut —
// der steht in beiden Eintragsarten ("runde" und "frage") vollstaendig drin.
function werkzeugeZu(protokoll, frage) {
  const kurz = frage.slice(0, 200);
  const treffer = protokoll.filter((e) => e.art === "frage" && (e.frage === frage || e.frage === kurz));
  const namen = [];
  for (const t of treffer) {
    for (const n of t.verstehen?.aufrufe || []) if (!namen.includes(n)) namen.push(n);
  }
  const diag = treffer[treffer.length - 1]?.verstehen || null;
  return { namen, diag, aktionen: treffer.flatMap((t) => t.aktionen || []) };
}

// Die Abfragen, die daten_fragen in diesem Lauf geschrieben hat. Sie stehen im
// Protokoll unter art:"auftrag" — und sie sind der einzige Weg, "die Zahl
// stimmt nicht" von "die Frage wurde falsch verstanden" zu unterscheiden.
// Genau diese Unterscheidung war am 20.08. der Unterschied zwischen "Umsatz
// Juli: null" und den tatsaechlichen 25.250 Euro.
function abfragenAus(protokoll) {
  return protokoll.filter((e) => e.art === "auftrag" && e.sql)
    .map((e) => ({ was: e.was, sql: e.sql, antwort: e.antwort, ok: e.ok, dauerMs: e.dauerMs }));
}

// ---------------------------------------------------------------- Ein Zug
async function zugFahren(zug, cookie, datenPfad) {
  const start = Date.now();
  let antwort = "", fehler = null, code = 0;
  try {
    const r = await anfrage("/api/chat", { methode: "POST", body: { message: zug.frage }, cookie });
    code = r.code;
    let j = null;
    try { j = JSON.parse(r.text); } catch { fehler = "Keine JSON-Antwort (HTTP " + r.code + "): " + r.text.slice(0, 200); }
    if (j) {
      antwort = String(j.reply || j.hint || "").trim();
      if (j.ok === false) fehler = "ok:false — " + (j.hint || "ohne Begründung");
    }
  } catch (e) {
    fehler = String(e.message).slice(0, 300);
  }
  const dauerMs = Date.now() - start;

  // Das Protokoll wird mit appendFile geschrieben (nicht blockierend) — ein
  // kurzer Moment, sonst fehlt der Eintrag zur gerade gestellten Frage.
  await new Promise((r) => setTimeout(r, 250));
  const { namen, diag, aktionen } = werkzeugeZu(protokollLesen(datenPfad), zug.frage);

  // --- Bewertung
  const maengel = [];
  if (fehler) maengel.push("Fehler: " + fehler);
  if (!antwort) maengel.push("Keine Antwort");
  // Im Fernmodus liegt das Sprachprotokoll auf dem anderen Rechner. Eine
  // Werkzeugpruefung waere dann keine Pruefung, sondern ein garantiertes Nein.
  if (!FERN && zug.werkzeug?.length && !zug.werkzeug.some((w) => namen.includes(w))) {
    maengel.push(`Kein Werkzeug aus [${zug.werkzeug.join(", ")}] — aufgerufen: [${namen.join(", ") || "keins"}]`);
  }
  if (!FERN && zug.kein_werkzeug?.length) {
    const verboten = zug.kein_werkzeug.filter((w) => namen.includes(w));
    if (verboten.length) maengel.push("Verbotenes Werkzeug: " + verboten.join(", "));
  }
  if (zug.enthaelt && !zug.enthaelt.test(antwort)) maengel.push("Antwort passt nicht zu " + zug.enthaelt);
  if (zug.verboten && zug.verboten.test(antwort)) {
    maengel.push("Unerwünschte Wendung: „" + (antwort.match(zug.verboten) || [""])[0] + "“");
  }
  if (zug.maxMs && dauerMs > zug.maxMs) maengel.push(`Zu langsam: ${(dauerMs / 1000).toFixed(1)} s (Budget ${(zug.maxMs / 1000).toFixed(0)} s)`);

  return {
    frage: zug.frage, antwort, werkzeuge: namen, aktionen, dauerMs, httpCode: code,
    modell: diag?.modell || null, verstehenMs: diag?.dauerMs || null,
    reserve: Boolean(diag?.reserve), modellFehler: diag?.fehler || null,
    fehler, maengel, bestanden: maengel.length === 0,
  };
}

// ---------------------------------------------------------------- Ein Szenario
async function szenarioFahren(sz, datenPfad) {
  const start = Date.now();
  let cookie;
  try { cookie = await sitzungAnmelden(); }
  catch (e) { return { ...kopfDaten(sz), bestanden: false, zuege: [], fehler: String(e.message) }; }
  // Frischer Verlauf — sonst traegt das Szenario mit, was das vorige gesagt hat.
  await anfrage("/api/sprache/neu", { methode: "POST", body: {}, cookie }).catch(() => {});

  const zuege = [];
  for (const zug of sz.zuege) {
    const e = await zugFahren(zug, cookie, datenPfad);
    zuege.push(e);
    console.log(`  ${e.bestanden ? "✅" : "❌"} [${sz.id}] ${(e.dauerMs / 1000).toFixed(1)}s  „${zug.frage.slice(0, 62)}${zug.frage.length > 62 ? "…" : ""}“`);
    if (!e.bestanden) for (const m of e.maengel) console.log(`       ↳ ${m}`);
    if (AUSFUEHRLICH || !e.bestanden) console.log(`       » ${(e.antwort || "(nichts)").replace(/\n/g, " ").slice(0, 220)}`);
  }
  return { ...kopfDaten(sz), zuege, dauerMs: Date.now() - start, bestanden: zuege.every((z) => z.bestanden) };
}
const kopfDaten = (sz) => ({ id: sz.id, gruppe: sz.gruppe, titel: sz.titel, schreibt: Boolean(sz.schreibt) });

// ---------------------------------------------------------------- Aufraeumen
//
// Was in die Datenbank geschrieben wurde, traegt ADSTEST im Namen. Hier geht es
// wieder raus. Reihenfolge beachten: projekte.deal_id haengt an keinem Cascade
// (dieselbe Falle wie in scripts/test-crm.js).
//
// Der KALENDER wird nicht von hier geraeumt — Termine liegen bei Google und
// gehen nur ueber gws-cli. Die Szenarien, die einen anlegen, sagen ihn im
// naechsten Zug selbst wieder ab; was danach noch uebrig ist, steht unten im
// Bericht unter "haendisch zu pruefen".
async function aufraeumen(env) {
  const alt = { ...process.env };
  Object.assign(process.env, env);         // crm.js liest DATABASE_URL beim Laden
  const weg = {};
  try {
    const crm = require("../lib/crm.js");
    const wie = `%${PRAEFIX}%`;
    weg.projekte = (await crm.system(
      `delete from projekte where firma_id in (select id from firmen where name ilike $1)`, [wie])).rowCount;
    weg.firmen = (await crm.system(`delete from firmen where name ilike $1`, [wie])).rowCount;
    weg.aufgaben = (await crm.system(`delete from aufgaben where titel ilike $1`, [wie])).rowCount;
    // Anruflisten aus dem Lead-Nachschub. Sie heissen immer "Nachschub …"
    // (lib/leads-nachschub.js) und wuerden sonst als echte Tagesarbeit im CRM
    // stehenbleiben — die Leads darin sind unveraendert, nur die Buendelung
    // war ein Test.
    weg.listenEintraege = (await crm.system(
      `delete from call_listen_eintraege where liste_id in
         (select id from call_listen where name like 'Nachschub%' and erstellt >= now() - interval '2 hours')`)).rowCount;
    weg.listen = (await crm.system(
      `delete from call_listen where name like 'Nachschub%' and erstellt >= now() - interval '2 hours'`)).rowCount;
    await crm.pool.end().catch(() => {});
  } catch (e) {
    weg.fehler = String(e.message).slice(0, 200);
  }
  // Der Kalender liegt bei Google und geht nur ueber gws-cli.
  Object.assign(weg, await kalenderRaeumen(env));
  process.env = alt;
  return weg;
}

// DEN KALENDER RAEUMEN — und melden, wenn etwas uebrigbleibt (20.08.2026).
//
// WAS PASSIERT IST: Nach einem Lauf lag "ADSTEST Probeaufnahme" acht Stunden im
// Produktivkalender. Beim naechsten Morgen fiel die Drehbuch-Eroeffnung darauf
// herein — auf "Was sind meine Termine heute?" las Alexandra den Testtermin
// woertlich vor. Jemand musste ihn von Hand loeschen.
//
// Die Szenarien sagen ihre Termine zwar selbst wieder ab; genau das kann aber
// scheitern (und ist gescheitert, siehe den STAND-Fehler vom selben Tag). Ein
// Aufraeumen, das vom Erfolg des Getesteten abhaengt, ist kein Aufraeumen.
//
// Bleibt danach etwas stehen, endet der Lauf mit Fehlercode. Ein stiller Rest
// im Produktivkalender ist schlimmer als ein roter Testlauf.
async function kalenderRaeumen(env) {
  const { execFile } = require("child_process");
  const gws = (args) => new Promise((ok) => {
    execFile("gws-cli", args, { env: { ...env, GWS_ENCRYPTION: "none" }, timeout: 30000 },
      (fehler, aus) => ok(fehler ? "" : String(aus || "")));
  });

  const roh = await gws(["calendar", "list", "--max", "50"]);
  // Kein gws-cli heisst: In diesem Lauf konnte auch kein Termin ANGELEGT
  // werden (werkzeuge.js scheitert an derselben Stelle). Dann gibt es nichts
  // zu raeumen und erst recht keinen Grund, rot zu werden.
  if (!roh) return { kalenderUngeprueft: "gws-cli nicht da — es konnte auch nichts eingetragen werden" };

  // gws-cli verpackt die Termine als JSON-Zeichenkette im Feld "data".
  let termine = [];
  try {
    const huelle = JSON.parse(roh);
    termine = JSON.parse(huelle?.events?.data || "[]");
  } catch { return { kalender: "Antwort von gws-cli nicht lesbar — von Hand prüfen" }; }


  const meine = termine.filter((t) => new RegExp(PRAEFIX, "i").test(String(t.summary || "")));
  if (!meine.length) return { kalenderTermine: 0 };

  let weg = 0;
  for (const t of meine) if (await gws(["calendar", "delete", String(t.id)])) weg++;
  const uebrig = meine.length - weg;
  return { kalenderTermine: meine.length, kalenderGeloescht: weg,
           kalenderUebrig: uebrig || 0,
           kalenderRest: uebrig ? meine.slice(weg).map((t) => `${t.summary} (${t.start})`) : undefined };
}

// ---------------------------------------------------------------- Hauptlauf
(async () => {
  let liste = SZENARIEN;
  if (NUR.length) liste = liste.filter((s) => NUR.includes(s.id) || NUR.includes(s.gruppe));
  if (WIEDERHOLEN > 1) {
    liste = liste.flatMap((s) => Array.from({ length: WIEDERHOLEN },
      (_, i) => ({ ...s, id: `${s.id}#${i + 1}` })));
  }
  if (!liste.length) { console.log("Kein Szenario passt zu --nur " + NUR.join(",")); process.exit(1); }

  if (NUR_LISTE) {
    for (const s of liste) console.log(`${s.id.padEnd(7)} ${String(s.gruppe).padEnd(12)} ${s.zuege.length} Zug/Züge  ${s.titel}`);
    console.log(`\n${liste.length} Szenarien, ${liste.reduce((n, s) => n + s.zuege.length, 0)} Züge.`);
    return process.exit(0);
  }

  const datenPfad = path.join(os.tmpdir(), "ads-proben-daten-" + Date.now().toString(36));
  fs.mkdirSync(datenPfad, { recursive: true });
  const env = umgebungBauen(datenPfad);

  // --- Fernmodus: kein eigener Server, keine Umgebungspruefung -------------
  //
  // Gemessen wird, was dort laeuft. Werkzeugaufrufe kommen im Fernmodus NICHT
  // mit — das Sprachprotokoll liegt auf dem anderen Rechner. Der Bericht sagt
  // das, statt "kein Werkzeug" zu behaupten.
  if (FERN) {
    if (!NUR.length) {
      console.log("Fernmodus braucht --nur. Ein Rundumschlag gegen den laufenden Server "
        + "wäre keine Probe, sondern echter Betrieb — der Probemodus greift dort nicht.");
      process.exit(2);
    }
    console.log(`FERNMODUS gegen ${ZIEL_URL}`);
    console.log("ACHTUNG: Der Probemodus läuft dort NICHT. Freigegebene Nachrichten gehen wirklich raus.");
    console.log("Geschrieben wird nur mit " + PRAEFIX + "-Präfix; Kalendereinträge räumst du mit gws-cli nach.");
    const start = Date.now();
    const ergebnisse = [];
    for (const sz of liste) ergebnisse.push(await szenarioFahren(sz, datenPfad));
    const zuegeAlle = ergebnisse.flatMap((e) => e.zuege);
    const bericht = {
      zeit: new Date().toISOString(),
      lauf: { fern: ZIEL_URL, nur: NUR, praefix: PRAEFIX,
              hinweis: "Fernmodus: Werkzeugnamen fehlen (Protokoll liegt auf dem Server), Probemodus inaktiv." },
      zusammenfassung: {
        szenarien: ergebnisse.length,
        bestanden: ergebnisse.filter((e) => e.bestanden).length,
        zuege: zuegeAlle.length,
        zuegeBestanden: zuegeAlle.filter((z) => z.bestanden).length,
        medianMs: median(zuegeAlle.map((z) => z.dauerMs)),
        gesamtMs: Date.now() - start,
      },
      ergebnisse,
    };
    // AUCH UND GERADE HIER AUFRAEUMEN (20.08.2026). Der Fernmodus schreibt in
    // den ECHTEN Kalender — genau daher stammt der Testtermin, der am naechsten
    // Morgen bei "Was sind meine Termine heute?" vorgelesen wurde. Im
    // Fernmodus laeuft gws-cli nicht hier, sondern im Container; deshalb wird
    // der Rest hier nur GEMELDET, mit dem fertigen Befehl zum Nachraeumen.
    bericht.geraeumt = await aufraeumen(env);
    const rest = bericht.geraeumt.kalenderUebrig || bericht.geraeumt.kalenderUngeprueft;
    fs.mkdirSync(ZIEL, { recursive: true });
    const datei = path.join(ZIEL, "fern-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
    fs.writeFileSync(datei, JSON.stringify(bericht, null, 2));
    console.log(`
Szenarien: ${bericht.zusammenfassung.bestanden}/${bericht.zusammenfassung.szenarien} · Züge: ${bericht.zusammenfassung.zuegeBestanden}/${bericht.zusammenfassung.zuege}`);
    console.log("Aufgeräumt: " + JSON.stringify(bericht.geraeumt));
    if (rest) {
      console.log(`
⚠  ${PRAEFIX}-Termine im ECHTEN Kalender prüfen — von hier aus geht das nicht:`);
      console.log("  docker exec flowstate-dashboard sh -c 'GWS_ENCRYPTION=none gws-cli calendar list --max 50'");
    }
    console.log("Bericht: " + path.relative(WURZEL, datei));
    return process.exit(
      bericht.zusammenfassung.bestanden === bericht.zusammenfassung.szenarien && !rest ? 0 : 1);
  }

  // ABBRECHEN STATT FALSCH MESSEN (20.08.2026).
  //
  // Der erste grosse Lauf lief ausserhalb des Containers. Dort fehlt gws-cli,
  // und HERMES_CHAT_URL war leer. Ergebnis: 74 Szenarien, ein ordentlich
  // aussehender Bericht — und JEDER Kalender- und Mail-Fehlschlag darin war
  // ein Artefakt der Testumgebung, nicht des Produkts. Live lief der Kalender
  // die ganze Zeit einwandfrei. Ein Messwerkzeug, das so etwas als Befund
  // ausgibt, ist schlimmer als keines: Es lenkt die Arbeit auf Probleme, die
  // es nicht gibt, und verdeckt die, die es gibt.
  //
  // Deshalb faellt der Lauf hier hart aus, wenn eine Voraussetzung fehlt.
  // --trotzdem laesst ihn laufen (fuer den Fall, dass jemand bewusst nur die
  // Sprachschicht messen will) und schreibt den Vorbehalt in den Bericht.
  const fehlt = [];
  if (!env.DATABASE_URL) fehlt.push("DATABASE_URL — CRM, Aufgaben und Zahlen können nicht antworten");
  if (!env.SCHNELL_API_KEY) fehlt.push("SCHNELL_API_KEY — ohne ihn versteht Alexandra gar nichts");
  if (!env.HERMES_CHAT_URL) fehlt.push("HERMES_CHAT_URL — lange_arbeit scheitert dann immer");
  try {
    require("child_process").execFileSync("gws-cli", ["--help"], { stdio: "ignore", env });
  } catch {
    fehlt.push("gws-cli nicht im PATH — Kalender und Mail scheitern dann IMMER, und zwar ohne dass es am Produkt liegt");
  }
  if (fehlt.length) {
    console.log("\nDieser Lauf würde falsch messen. Es fehlt:");
    for (const f of fehlt) console.log("  · " + f);
    if (!TROTZDEM) {
      console.log("\nRichtiger Ort für den Lauf ist der Container:");
      console.log("  docker exec -w /app flowstate-dashboard node scripts/ads-proben.js --nur kern");
      console.log("\n(Mit --trotzdem laufen lassen — der Bericht trägt den Vorbehalt dann mit.)");
      process.exit(2);
    }
    console.log("\n--trotzdem gesetzt: Lauf startet, Vorbehalt steht im Bericht.\n");
  }

  console.log(`Server startet auf Port ${PORT} · Daten: ${datenPfad}`);
  const srv = spawn(process.execPath, ["server.js"], { cwd: WURZEL, env, stdio: AUSFUEHRLICH ? "inherit" : "ignore" });
  const aus = () => { try { srv.kill(); } catch {} };
  process.on("exit", aus);
  process.on("SIGINT", () => { aus(); process.exit(1); });

  const lebt = () => new Promise((r) => {
    const a = http.get({ host: "127.0.0.1", port: PORT, path: "/login", timeout: 1500 }, (res) => { res.resume(); r(res.statusCode > 0); });
    a.on("error", () => r(false));
    a.on("timeout", () => { a.destroy(); r(false); });
  });
  let da = false;
  for (let i = 0; i < 60 && !da; i++) { da = await lebt(); if (!da) await new Promise((r) => setTimeout(r, 500)); }
  if (!da) { console.log("Server antwortet nicht — mit --ausfuehrlich starten, dann sieht man warum."); aus(); process.exit(1); }
  console.log("Server ist da.\n");

  const start = Date.now();
  const ergebnisse = [];

  // Schreibende Szenarien laufen NACHEINANDER: Zwei gleichzeitige Laeufe, die
  // beide Leads anlegen und Zahlen abfragen, faelschen sich gegenseitig die
  // Antwort — und die Antwort ist hier der Pruefgegenstand.
  const seriell = liste.filter((s) => s.schreibt);
  const parallel = liste.filter((s) => !s.schreibt);

  console.log(`— ${seriell.length} schreibende Szenarien (nacheinander) —`);
  for (const sz of seriell) ergebnisse.push(await szenarioFahren(sz, datenPfad));

  console.log(`\n— ${parallel.length} lesende Szenarien (${GLEICHZEITIG} gleichzeitig) —`);
  let n = 0;
  const arbeiter = Array.from({ length: Math.min(GLEICHZEITIG, parallel.length) }, async () => {
    while (n < parallel.length) ergebnisse.push(await szenarioFahren(parallel[n++], datenPfad));
  });
  await Promise.all(arbeiter);

  ergebnisse.sort((a, b) => liste.findIndex((s) => s.id === a.id) - liste.findIndex((s) => s.id === b.id));

  // --- Abgefangene Sendungen: was WAERE rausgegangen?
  let abgefangen = [];
  try {
    abgefangen = fs.readFileSync(path.join(datenPfad, "probe-abgefangen.jsonl"), "utf-8")
      .split("\n").filter(Boolean).map((z) => JSON.parse(z));
  } catch { /* nichts abgefangen */ }

  const geraeumt = KEIN_AUFRAEUMEN ? { uebersprungen: true } : await aufraeumen(env);
  aus();

  // --- Bericht
  const zuegeAlle = ergebnisse.flatMap((e) => e.zuege);
  const bericht = {
    zeit: new Date().toISOString(),
    lauf: { port: PORT, datenPfad, gleichzeitig: GLEICHZEITIG, nur: NUR, praefix: PRAEFIX,
            modellVerstehen: env.SPRACHE_VERSTEHEN_MODEL || env.SCHNELL_MODEL || "(unbekannt)",
            // Steht hier etwas, ist der Bericht NUR unter diesem Vorbehalt zu
            // lesen — die betroffenen Wege scheitern dann aus Umgebungsgruenden.
            vorbehalt: fehlt },
    zusammenfassung: {
      szenarien: ergebnisse.length,
      bestanden: ergebnisse.filter((e) => e.bestanden).length,
      gescheitert: ergebnisse.filter((e) => !e.bestanden).length,
      zuege: zuegeAlle.length,
      zuegeBestanden: zuegeAlle.filter((z) => z.bestanden).length,
      medianMs: median(zuegeAlle.map((z) => z.dauerMs)),
      maxMs: Math.max(0, ...zuegeAlle.map((z) => z.dauerMs)),
      gesamtMs: Date.now() - start,
    },
    abgefangen, geraeumt, abfragen: abfragenAus(protokollLesen(datenPfad)), ergebnisse,
  };

  fs.mkdirSync(ZIEL, { recursive: true });
  const datei = path.join(ZIEL, new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  fs.writeFileSync(datei, JSON.stringify(bericht, null, 2));

  const z = bericht.zusammenfassung;
  console.log("\n" + "=".repeat(72));
  console.log(`Szenarien: ${z.bestanden}/${z.szenarien} bestanden · Züge: ${z.zuegeBestanden}/${z.zuege}`);
  console.log(`Dauer je Zug: Median ${(z.medianMs / 1000).toFixed(1)} s, längster ${(z.maxMs / 1000).toFixed(1)} s · gesamt ${(z.gesamtMs / 1000 / 60).toFixed(1)} min`);
  if (abgefangen.length) {
    const je = {};
    for (const a of abgefangen) je[a.kanal] = (je[a.kanal] || 0) + 1;
    console.log("Abgefangen (nichts davon ging raus): " + Object.entries(je).map(([k, v]) => `${k} ${v}`).join(", "));
  }
  console.log("Aufgeräumt: " + JSON.stringify(geraeumt));
  const durchgefallen = ergebnisse.filter((e) => !e.bestanden);
  if (durchgefallen.length) {
    console.log("\nDurchgefallen:");
    for (const e of durchgefallen) {
      const m = e.zuege.flatMap((x) => x.maengel);
      console.log(`  ${e.id.padEnd(7)} ${e.titel} — ${m[0] || e.fehler || "?"}`);
    }
  }
  // EIN REST IM PRODUKTIVKALENDER MACHT DEN LAUF ROT (20.08.2026).
  //
  // Nach einem Lauf blieb "ADSTEST Probeaufnahme" acht Stunden stehen und wurde
  // am naechsten Morgen bei "Was sind meine Termine heute?" vorgelesen. Der
  // Lauf selbst hatte gruen gemeldet. Ein Testlauf, der Spuren im Betrieb
  // hinterlaesst und trotzdem gruen ist, luegt zweimal.
  const restig = [];
  if (geraeumt.kalenderUebrig) restig.push(`${geraeumt.kalenderUebrig} Termin(e) im Kalender: ${(geraeumt.kalenderRest || []).join(", ")}`);
  if (typeof geraeumt.kalender === "string") restig.push(geraeumt.kalender);
  if (geraeumt.fehler) restig.push("Datenbank: " + geraeumt.fehler);
  if (restig.length) {
    console.log("\n⚠  NICHT VOLLSTÄNDIG AUFGERÄUMT — bitte von Hand nachsehen:");
    for (const r of restig) console.log("  · " + r);
  }

  console.log("\nBericht: " + path.relative(WURZEL, datei));
  process.exit(durchgefallen.length || restig.length ? 1 : 0);
})().catch((e) => { console.log("FEHLER: " + (e.stack || e.message)); process.exit(1); });

function median(werte) {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
