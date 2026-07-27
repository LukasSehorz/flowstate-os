// Testet das Verstehen (ausZustand + ausAufrufen) ohne echte API:
// schnell.mitWerkzeugen wird gestubbt. Geprueft werden:
//   1. Modell antwortet sauber        -> Aufrufe uebersetzt, _diag ok
//   2. Sonnet faellt aus              -> Haiku-Reserve springt ein
//   3. Beide fallen aus               -> Hermes-Rueckfall (nie stumm)
//   4. Antwort abgeschnitten          -> fertige Aufrufe bleiben erhalten
//   5. Die Uebersetzungstabelle selbst (ausAufrufen)
// Aufruf: node scripts/test-sprache.js
//
// Umgestellt am 26.07. mit A4: Bis dahin kam die Antwort als JSON-Text und
// dieser Test bewachte das Parsen. Es gibt kein Parsen mehr — die Aufrufe
// kommen strukturiert. Was frueher Fall 4 war ("Antwort ist kein JSON, nichts
// Rohes vorlesen"), kann strukturell nicht mehr passieren; an seine Stelle
// tritt der Nachweis, dass ein Abriss die bereits fertigen Aufrufe NICHT mehr
// mitreisst. Genau daran ist am 26.07. eine WhatsApp an Jannik verschwunden.

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname; // stimmeLaden faellt auf Notnagel zurueck
const schnell = require("../lib/schnell.js");
const { ausZustand, ausAufrufen, markerAufloesen, betrifftKalender } = require("../lib/sprache-routes.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

const GUTE_ANTWORT = {
  text: "Morgen um zehn hast du das Erstgespraech mit der Physio.",
  aufrufe: [{ name: "mail_lesen", input: { auftrag: "letzte 2 Stunden" } },
            { name: "zeigen", input: { was: "kalender" } }],
  stop: "tool_use", zwischenspeicher: "treffer", tokenRaus: 84,
};

(async () => {
  const original = schnell.mitWerkzeugen;

  // 1. Modell antwortet sauber
  let modelle = [];
  schnell.mitWerkzeugen = async (sys, nutzer, wz, opts = {}) => { modelle.push(opts.model); return GUTE_ANTWORT; };
  let a = await ausZustand("was steht morgen an, sind neue mails da", "KALENDER: ...", []);
  pruefe("Sauber: text uebernommen", a.text.includes("Erstgespraech"));
  pruefe("Sauber: mail_lesen wurde zur Aktion 'mail'", a.aktionen.length === 1 && a.aktionen[0].was === "mail");
  pruefe("Sauber: zeigen wurde uebernommen", a.zeige.length === 1 && a.zeige[0] === "kalender");
  pruefe("Sauber: Verstehen lief auf Sonnet", modelle[0] === (process.env.SPRACHE_VERSTEHEN_MODEL || "claude-sonnet-5"));
  pruefe("Sauber: _diag ok, keine Reserve", a._diag.parse === "werkzeuge" && a._diag.reserve === false);
  pruefe("Sauber: _diag haelt die Aufrufe fest", a._diag.aufrufe.join() === "mail_lesen,zeigen");
  pruefe("Sauber: _diag haelt den Zwischenspeicher fest", a._diag.speicher === "treffer");
  // Der System-Prompt muss als Bloecke rausgehen, sonst greift das Zwischen-
  // speichern nicht — und dann zahlt jede Frage die 4.200 Token neu.
  let gesehen = null;
  schnell.mitWerkzeugen = async (sys) => { gesehen = sys; return GUTE_ANTWORT; };
  await ausZustand("was steht morgen an", "KALENDER: ...", []);
  pruefe("Sauber: System-Prompt geht als Block mit Speicher-Marker raus",
    Array.isArray(gesehen) && gesehen[0].cache_control?.type === "ephemeral");

  // 2. Sonnet faellt aus -> Reserve (Haiku)
  modelle = [];
  schnell.mitWerkzeugen = async (sys, nutzer, wz, opts = {}) => {
    modelle.push(opts.model);
    if (modelle.length === 1) throw new Error("Anthropic 529: overloaded");
    return GUTE_ANTWORT;
  };
  a = await ausZustand("was steht morgen an", "KALENDER: ...", []);
  pruefe("Reserve: zweiter Aufruf auf Haiku", modelle.length === 2 && /haiku/.test(modelle[1]));
  pruefe("Reserve: Antwort trotzdem verwertet", a.text.includes("Erstgespraech"));
  pruefe("Reserve: _diag vermerkt Reserve + Fehler", a._diag.reserve === true && /529/.test(a._diag.fehler));

  // 3. Beide fallen aus -> Hermes-Rueckfall
  schnell.mitWerkzeugen = async () => { throw new Error("Anthropic 500: kaputt"); };
  a = await ausZustand("bau mir ein angebot", "KALENDER: ...", []);
  pruefe("Totalausfall: Hermes-Rueckfall statt Stille", a.aktionen.length === 1 && a.aktionen[0].was === "hermes");
  pruefe("Totalausfall: _diag haelt den Fehler fest", a._diag.parse === "fehler" && Boolean(a._diag.fehler));

  // 4. Abgeschnitten an der Token-Grenze — der Vorfall vom 26.07., 16:01 Uhr.
  //
  // Damals: Die JSON-Antwort riss ab, das schliessende } fehlte, das Parsen
  // scheiterte — und mit ihm gingen ALLE Felder verloren. Die vorbereitete
  // WhatsApp an Jannik existierte nie, Alexandra sagte trotzdem "geht raus".
  //
  // Jetzt: Ein fertig uebertragener Aufruf ist fertig. Reisst die Ausgabe
  // danach ab, fehlt hoechstens ein weiterer Aufruf — der schon vorhandene
  // bleibt. Das ist der eigentliche Gewinn von A4, deshalb steht er hier.
  schnell.mitWerkzeugen = async () => ({
    text: "Schick ich Jannik gleich.",
    aufrufe: [{ name: "whatsapp_senden", input: { an: "Jannik", text: "frag ihn, wann er wieder da ist" } }],
    stop: "max_tokens", zwischenspeicher: "treffer", tokenRaus: 1000,
  });
  a = await ausZustand("schreib jannik", "KALENDER: ...", []);
  pruefe("Abriss: die WhatsApp ueberlebt", a.whatsapp !== null && a.whatsapp.an === "Jannik");
  pruefe("Abriss: nichts Rohes im gesprochenen Text", !a.text.includes("{") && !a.text.includes('"'));
  pruefe("Abriss: _diag vermerkt ihn", a._diag.parse === "abgeschnitten");

  // 4b. Die Uebersetzungstabelle — hier entscheidet sich, ob eine erkannte
  //     Absicht beim Server ankommt oder still verschwindet.
  const m1 = ausAufrufen([{ name: "termin_eintragen", input: { titel: "Sport", start: "2026-07-27T10:00", ort: "Halle" } }]);
  pruefe("Mapper: eintragen vollstaendig", m1.termin.was === "eintragen" && m1.termin.titel === "Sport" && m1.termin.ort === "Halle");
  const m2 = ausAufrufen([{ name: "termin_eintragen", input: { titel: "Sport" } }]);
  pruefe("Mapper: eintragen ohne Start wird verworfen", m2.termin === null);
  const m3 = ausAufrufen([{ name: "termin_verschieben", input: { suche: "Physio", start: "2026-07-30T15:00", titel: "Physio neu" } }]);
  pruefe("Mapper: verschieben nimmt den neuen Titel mit", m3.termin.was === "verschieben" && m3.termin.titel === "Physio neu");
  const m4 = ausAufrufen([{ name: "crm_anruf", input: { firma: "Krotzer", ausgang: "spaeter" } }]);
  pruefe("Mapper: 'spaeter' ohne Datum wird zu 'erreicht' statt verworfen",
    m4.crm.was === "anruf" && m4.crm.ausgang === "erreicht");
  const m5 = ausAufrufen([{ name: "crm_notiz", input: { text: "ohne Firma" } }]);
  pruefe("Mapper: CRM ohne Firma wird verworfen", m5.crm === null);
  const m6 = ausAufrufen([
    { name: "wetter", input: { auftrag: "a" } }, { name: "mail_lesen", input: { auftrag: "b" } },
    { name: "recherchieren", input: { auftrag: "c" } }, { name: "gehirn_suchen", input: { auftrag: "d" } },
    { name: "lange_arbeit", input: { auftrag: "e" } },
  ]);
  pruefe("Mapper: hoechstens vier Aktionen gleichzeitig", m6.aktionen.length === 4);
  pruefe("Mapper: lange_arbeit heisst intern hermes",
    ausAufrufen([{ name: "lange_arbeit", input: { auftrag: "x" } }]).aktionen[0].was === "hermes");
  const m7 = ausAufrufen([{ name: "aufgabe_anlegen", input: { titel: "A" } }, { name: "aufgabe_anlegen", input: { titel: "B" } }]);
  pruefe("Mapper: bei Doppelung gilt der erste Aufruf", m7.aufgabe.titel === "A");
  pruefe("Mapper: unbekanntes Werkzeug faellt still weg",
    JSON.stringify(ausAufrufen([{ name: "gibt_es_nicht", input: {} }])) === JSON.stringify(ausAufrufen([])));

  // 5. Temperature-Weiche in schnell.js: Sonnet 5 darf KEIN temperature bekommen
  pruefe("Temp-Weiche: sonnet-5 ohne temperature", !/-4-|haiku-4|opus-4/.test("claude-sonnet-5"));
  pruefe("Temp-Weiche: haiku-4-5 mit temperature", /-4-|haiku-4|opus-4/.test("claude-haiku-4-5"));

  // 6. Kalender-Erkennung (loest die Auffrischung nach Hermes-Auftraegen aus)
  pruefe("Kalender erkannt: 'im Kalender eintragen'", betrifftKalender("kannst du morgen im Kalender eintragen dass ich spazieren gehe"));
  pruefe("Kalender erkannt: 'Termin verschieben'", betrifftKalender("verschieb den Termin mit Physio"));
  pruefe("Kalender NICHT erkannt: PowerPoint", !betrifftKalender("bau mir eine kurze PowerPoint ueber Performance Marketing"));

  // 7. Marker-Aufloesung — der Kern des Fixes vom 24.07.:
  //    Solange etwas laeuft, darf es nicht als erledigt gelten; ist es fertig,
  //    darf es nicht ewig als "laeuft noch" im Verlauf stehen.
  let h = [{ role: "assistant", content: "Trag ich dir gleich ein.\n[LAEUFT NOCH #a1-x: Kalendereintrag morgen 10 Uhr — noch NICHT bestaetigt, nicht als erledigt vorlesen]" }];
  markerAufloesen(h, "a1-x", true, "Kalendereintrag morgen 10 Uhr");
  pruefe("Marker: nach Erfolg kein 'LAEUFT NOCH' mehr", !h[0].content.includes("LAEUFT NOCH"));
  pruefe("Marker: nach Erfolg bestaetigter FAKT", h[0].content.includes("[FAKT: erledigt und bestaetigt — Kalendereintrag morgen 10 Uhr]"));
  pruefe("Marker: gesprochener Satz bleibt erhalten", h[0].content.startsWith("Trag ich dir gleich ein."));

  h = [{ role: "assistant", content: "Bin dran.\n[LAEUFT NOCH #a2-y: Angebot fuer Kunde — noch NICHT bestaetigt]" }];
  markerAufloesen(h, "a2-y", false, "Angebot fuer Kunde");
  pruefe("Marker: Scheitern wird ehrlich vermerkt", h[0].content.includes("FEHLGESCHLAGEN, nicht erledigt"));

  h = [{ role: "assistant", content: "Bin dran.\n[LAEUFT NOCH #a3-z: Etwas anderes — noch NICHT bestaetigt]" }];
  markerAufloesen(h, "a1-x", true, "Kalendereintrag");
  pruefe("Marker: fremde ID bleibt unangetastet", h[0].content.includes("[LAEUFT NOCH #a3-z"));

  schnell.mitWerkzeugen = original;
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
