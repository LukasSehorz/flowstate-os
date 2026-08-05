// Die Werkzeuge, die Alexandra im Gespraech aufrufen kann (A4, 26.07.2026).
//
// Bis heute stand hier nichts — der Vertrag war ein JSON-Schema IM System-Prompt
// (9.391 Zeichen), und das Modell musste die Antwort als JSON-Text
// zurueckschreiben. Zwei gemessene Folgen, beide teuer:
//
//   1. Jede Antwort trug den ganzen Umschlag mit. Auf "was steht heute an"
//      schrieb das Modell erst {"text": "...", dann "mail": null, "whatsapp":
//      null, "termin": null, "aufgabe": null, "crm": null, "aktionen": [],
//      "zeige": []} — rund 70 Token reine Verpackung, bevor ein Ton kam.
//   2. Riss die Ausgabe an der Token-Grenze ab, fehlte das schliessende },
//      das Parsen scheiterte, und mit ihm gingen ALLE Felder verloren. Am
//      26.07. verschwand so eine vorbereitete WhatsApp an Jannik, waehrend
//      Alexandra "geht jetzt raus" sagte.
//
// Als native Werkzeuge stehen Namen und Felder NEBEN dem Prompt statt darin.
// Das Modell schreibt nur noch den Sprechsatz; die Aufrufe kommen strukturiert
// zurueck. Ein abgeschnittener Aufruf kann es nicht mehr geben.
//
// KNAPP HALTEN. Das Schema geht bei JEDEM Aufruf mit und kostet Token wie
// Prompt-Text — der erste Entwurf dieser Datei war 8.835 Zeichen gross und
// hat den Gewinn aus dem geschrumpften Prompt exakt wieder aufgefressen.
// Regeln, die fuer MEHRERE Werkzeuge gelten (Zeitrechnung, Kontakte, Haltung),
// gehoeren EINMAL in FORMAT_ANHANG, nicht in jede Feldbeschreibung.
//
// WICHTIG fuer den, der hier etwas aendert: Die Namen und Felder unten sind ein
// Vertrag mit zwei Seiten. ausAufrufen() in lib/sprache-routes.js uebersetzt sie
// in die Felder, die der Rest der Route seit Wochen erwartet. Wer hier etwas
// umbenennt, muss dort mitziehen — scripts/test-prompt.js haelt beide Seiten
// zusammen und schlaegt an, wenn sie auseinanderlaufen.

// Kurzschreibweise: w(name, zweck, felder, pflicht)
function w(name, description, properties, required = []) {
  return { name, description, input_schema: { type: "object", properties, required } };
}
const txt = (description) => ({ type: "string", description });
const zeit = txt("JJJJ-MM-TTTHH:MM");
const datum = txt("JJJJ-MM-TT");

const WERKZEUGE = [
  // --- Kalender. Laeuft direkt (~1 s), NIE ueber lange_arbeit. Die Termin-ID
  //     brauchst du nie: Der Server sucht und fragt bei mehreren Treffern nach.
  w("termin_eintragen", "Neuen Termin eintragen. 'trag mir morgen 10 Uhr Sport ein'",
    {
      titel: txt("kurz, wie Lukas ihn nennt"),
      start: zeit,
      ende: txt("nur bei genannter Dauer, sonst weglassen (= eine Stunde)"),
      ganztags: { type: "boolean", description: "dann start nur JJJJ-MM-TT" },
      ort: txt("nur wenn genannt"),
    }, ["titel", "start"]),

  w("termin_verschieben", "Termin auf neue Zeit. 'schieb Physio auf Donnerstag 15 Uhr'",
    {
      suche: txt("wie Lukas den Termin nennt"),
      start: txt("die NEUE Zeit, JJJJ-MM-TTTHH:MM"),
      ende: txt("nur wenn genannt"),
      titel: txt("nur wenn er ihn zusaetzlich umbenennt"),
      ort: txt("nur wenn genannt"),
      tag: txt("an welchem Tag der gesuchte liegt, JJJJ-MM-TT"),
    }, ["suche", "start"]),

  w("termin_absagen", "Termin loeschen. 'sag den Kalhofer-Anruf ab'",
    { suche: txt("wie Lukas ihn nennt"), tag: datum }, ["suche"]),

  // --- Aufgaben. Eine Aufgabe ist etwas ZU TUN, ein Termin hat eine Uhrzeit.
  w("aufgabe_anlegen", "Aufgabe auf die Liste. 'setz X auf die Liste', 'erinner mich an Y'",
    {
      titel: txt("kurz und konkret"),
      faellig: txt("nur bei genannter Frist ('bis Freitag'), JJJJ-MM-TT"),
      geplant: txt("nur wenn er sagt, wann er es machen will, JJJJ-MM-TT"),
    }, ["titel"]),

  w("aufgabe_erledigt", "Aufgabe abhaken. 'hab ich erledigt'",
    { suche: txt("wie Lukas sie nennt") }, ["suche"]),

  // --- CRM. Der Server findet die Firma und fragt bei mehreren Treffern nach.
  w("crm_lead", "Lead anlegen. 'leg einen Lead an: Physio Schwabing, kam ueber Empfehlung'",
    {
      firma: txt("Name, wie Lukas ihn sagt"), quelle: txt("woher"),
      ort: txt(""), telefon: txt(""), email: txt(""), notiz: txt("alles Weitere"),
    }, ["firma"]),

  w("crm_notiz", "Notiz an einer Firma. 'notier bei Krotzer, dass sie erst im September Budget haben'",
    { firma: txt(""), text: txt("der Inhalt, in Lukas' Worten") }, ["firma", "text"]),

  w("crm_wiedervorlage", "Wiedervorlage. 'erinner mich in einer Woche an Mueller'",
    { firma: txt(""), datum, notiz: txt("Grund") }, ["firma", "datum"]),

  w("crm_anruf", "Ergebnis eines Telefonats festhalten.",
    {
      firma: txt(""),
      ausgang: {
        type: "string",
        enum: ["termin", "absage", "nicht-erreicht", "spaeter", "erreicht"],
        description: "termin = Erstgespraech gebucht · absage = verloren, dann 'grund' · nicht-erreicht = niemand da · spaeter = nochmal, BRAUCHT 'datum' · erreicht = gesprochen, sonst nichts davon",
      },
      datum: txt("Pflicht bei 'spaeter', JJJJ-MM-TT"),
      grund: txt("bei 'absage': warum"),
      notiz: txt("alles Weitere"),
    }, ["firma", "ausgang"]),

  // --- Nachrichten.
  w("whatsapp_senden",
    "WhatsApp vorbereiten. Der Server liest sie vor und holt die Freigabe — abgeschickt wird erst danach. Kein Serienversand an viele.",
    {
      an: txt("Name oder Gruppenname — Kontakte loest der Server auf, du brauchst nie eine Nummer"),
      text: txt("die FERTIGE Nachricht, wortwoertlich so abzuschicken — nicht der Auftrag an dich. 'schreib Jannik, wann er wieder da ist' -> 'Hey, wann bist du wieder im Buero?' (siehe Nachrichten schreiben)"),
      gruppe: { type: "boolean", description: "dann ist 'an' der Gruppenname. Nur wenige sind freigegeben; kennt der Server eine nicht, sagt er es. Erfinde keine Gruppennamen." },
    }, ["an", "text"]),

  w("mail_senden",
    "Mail SENDEN — nur wenn sie ganz aus dem STAND formulierbar ist UND an Lukas selbst oder intern geht ('an mich' = lukas.sehorz@hotmail.com). Extern, als Antwort auf einen Verlauf oder mit Recherche: stattdessen lange_arbeit mit dem Auftrag, einen ENTWURF vorzubereiten.",
    { an: txt(""), betreff: txt(""), body: txt("voller Text, in Lukas' Ton") },
    ["an", "betreff", "body"]),

  // --- Nachschauen. Laufen parallel, waehrend du schon sprichst.
  w("wetter", "Wetter nachschlagen — steht NIE im STAND, nie raten.",
    { auftrag: txt("mit Tag und Ort: 'Wetter uebermorgen in Dorfen'") }, ["auftrag"]),

  w("mail_lesen", "Posteingang pruefen — neue Mails stehen NIE im STAND. Nur lesen, nie senden.",
    { auftrag: txt("Zeitfenster, z. B. 'seit gestern'") }, ["auftrag"]),

  w("whatsapp_lesen", "WhatsApp lesen. Erst ab dem Koppeln moeglich — erfinde keine 'nicht verbunden'-Ausrede.",
    { auftrag: txt("bestimmter Chat -> NUR der Kontakt-/Gruppenname; allgemein -> 'neue Nachrichten', dann fasst der Server alle zusammen") },
    ["auftrag"]),

  w("gehirn_suchen",
    "Firmengedaechtnis: frueher Entschiedenes, Projektnotizen, Wiki. NICHT fuer Preise, Leistungen oder Team — die stehen im STAND. Nicht fuer Server-Status. Nie zusammen mit lange_arbeit fuers selbe Anliegen.",
    { auftrag: txt("wonach gesucht wird") }, ["auftrag"]),

  w("neuigkeiten",
    "Was hat sich im OS geaendert — neue Firmen, Deals, Anrufe, Belege, Posts, Projekte. Fuer 'was ist neu im CRM', 'was hat sich seit gestern getan', 'gab es Veraenderungen'. NICHT fuer den Stand EINER Firma.",
    { auftrag: txt("Bereich und Zeitraum, wie Lukas sie nennt: 'im CRM seit gestern', 'diese Woche', 'ueberall heute'") },
    ["auftrag"]),

  w("recherchieren", "Kurze Websuche: Fakten, Preise, News, Zahlen. Dauert Sekunden.",
    { auftrag: txt("die Frage, nur dieser Teil") }, ["auftrag"]),

  w("lange_arbeit",
    "Lange Arbeit UND jedes Kommando ans System: Praesentation, Angebot, Website, externe Mails; Einstellungen und Modelle aendern, Cron-Jobs und Routinen anlegen, Automatisierungen bauen, Status abfragen. Meldet sich per Telegram, das Gespraech wartet nicht.",
    { auftrag: txt("das Kommando im Klartext, in Lukas' Worten") }, ["auftrag"]),

  // --- Anzeige auf dem Dashboard.
  w("zeigen", "Ansicht oeffnen, waehrend du sprichst.",
    { was: { type: "string", enum: ["kalender", "zahlen"] } }, ["was"]),
];

const NAMEN = WERKZEUGE.map((x) => x.name);

module.exports = { WERKZEUGE, NAMEN };
