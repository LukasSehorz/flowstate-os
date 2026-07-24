// Wacht ueber den System-Prompt (FORMAT_ANHANG) — Stufe 3, 25.07.
//
// Der Anhang ist von 11.814 auf 5.632 Zeichen geschrumpft, weil er langsam und
// unzuverlaessig gemacht hat (6 von 36 Anfragen fielen aus, Verstehen 6,2 s).
// Jede einzelne Regel darin stammt aber aus einem ECHTEN Fehler — sie zu
// verlieren, faellt erst im Gespraech auf, und dann sucht man lange.
//
// Dieser Test haelt fest, was drinstehen MUSS, und was drin NICHT mehr
// vorkommen darf (veraltete Begriffe, Doppelungen). Aufruf:
//   node scripts/test-prompt.js

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "sprache-routes.js"), "utf-8");
const m = src.match(/const FORMAT_ANHANG = `([\s\S]*?)`;/);
if (!m) { console.log("❌ FORMAT_ANHANG nicht gefunden — Aufbau geaendert?"); process.exit(1); }
const p = m[1];

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}
const hat = (...teile) => teile.every((t) => p.toLowerCase().includes(t.toLowerCase()));

// --- Diese Regeln MUESSEN drinbleiben (jede aus einem echten Vorfall) ------
pruefe("Werkzeug-Verbot (sonst 50 s statt 3)", hat("RUFE KEINE WERKZEUGE AUF"));
pruefe("JSON-Vertrag mit allen sechs Feldern",
  hat("zusage", "text", "mail", "whatsapp", "aktionen", "zeige"));
pruefe("Alle sechs Aktionsarten erklaert",
  hat("wetter", "mail", "wa_lesen", "gehirn", "sonnet", "hermes"));
pruefe("Aktionen laufen parallel", hat("parallel"));
pruefe("Jede Aktion nur ihr Arbeitsteil", hat("nur ihren Arbeitsteil"));
pruefe("Wetter/Mail stehen nie im STAND", hat("stehen NIE im STAND"));

pruefe("Kontakte loest der Server auf (nie 'kenne X nicht')",
  hat("Kontakte loest der SERVER auf", "ich kenne"));
pruefe("Niemals ablehnen — im Zweifel an hermes", hat("niemals ablehnen"));
pruefe("Keine erfundenen fehlenden API-Verbindungen", hat("API-Verbindungen"));
pruefe("Nie falsch dementieren", hat("NIE FALSCH DEMENTIEREN"));

pruefe("Nur EINE Rueckfrage — die Freigabe (Lukas 25.07.)",
  hat("NUR EINE RUECKFRAGE", "soll ich es dir vorlesen"));

pruefe("Kein Vollzug melden, solange etwas laeuft (Fix 24.07.)",
  hat("noch NICHT erledigt", "Ist eingetragen"));
pruefe("Wahrheit nur aus STAND/[FAKT]", hat("[FAKT]", "zaehlt NICHT als Bestaetigung"));
pruefe("Keine erfundenen Termine aus eigener Ankuendigung", hat("Erfinde NIE Termine"));
pruefe("[LAEUFT NOCH]-Marker wird beachtet", hat("LAEUFT NOCH"));
pruefe("Zwischenfragen aus 'DEINE LAUFENDE ARBEIT'", hat("DEINE LAUFENDE ARBEIT"));

pruefe("Zusage zuerst, dann Inhalt (Entscheidung 21.07.)", hat("ZUSAGE ZUERST"));
pruefe("Keine internen Begriffe aussprechen", hat("NIE interne Begriffe", "Haiku"));
pruefe("Nichts wiederholen (BISHER)", hat("NICHT WIEDERHOLEN", "BISHER"));

pruefe("Mail nur intern direkt senden", hat("an mich", "lukas.sehorz@hotmail.com"));
pruefe("Externe Mail nur als Entwurf ueber hermes", hat("ENTWURF", "NICHT senden"));
pruefe("WhatsApp: Absicht statt Wortlaut", hat("der ABSICHT", "nicht dem"));
pruefe("WhatsApp: kein Serienversand", hat("Serienversand"));
pruefe("Gruppen: Flag + nur freigegebene", hat('"gruppe": true', "freigegeben"));

// --- Das darf NICHT (mehr) drin sein --------------------------------------
pruefe("Kein veralteter Begriff 'spur \"keine\"'", !/spur\s+"keine"/i.test(p));
pruefe("Aktionsliste nicht faelschlich 'fuenf' genannt (es sind sechs)",
  !/die fuenf aktionsarten/i.test(p));

// --- Groesse: der eigentliche Zweck der Uebung ----------------------------
console.log(`\nGroesse: ${p.length} Zeichen (~${Math.round(p.length / 3.6)} Token)`);
pruefe("Bleibt unter 7.000 Zeichen (war 11.814)", p.length < 7000);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
