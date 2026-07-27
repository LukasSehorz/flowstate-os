// Warum tut der Kalender nichts? — Dieses Skript beantwortet die Frage an der
// Stelle, an der sie entschieden wird, statt im Browser zu raten.
//
//   node scripts/kalender-pruefen.js                           (nur lesen)
//   node scripts/kalender-pruefen.js --testtermin              (auch schreiben)
//
// Auf dem Server, wo der Zugang liegt:
//   docker exec flowstate-dashboard node scripts/kalender-pruefen.js
//   docker exec flowstate-dashboard node scripts/kalender-pruefen.js --testtermin
//
// Es geht denselben Weg wie die Kalenderseite (lib/kalender.js -> gws-cli) und
// zeigt bei jedem Schritt, was WIRKLICH zurueckkommt. Mit --testtermin legt es
// zusaetzlich einen Termin in einer Stunde an und raeumt ihn sofort wieder weg —
// damit ist beide Richtungen belegt, ohne dass etwas im Kalender liegen bleibt.
//
// Ausgegeben werden Titel und Zeiten der naechsten Termine. Das ist Absicht:
// ohne sie kann man nicht sagen, ob der RICHTIGE Kalender dranhaengt. Also
// nicht blind in ein Ticket kopieren.

const { execFile } = require("child_process");

const kal = require("../lib/kalender.js");
const werkzeuge = require("../lib/werkzeuge.js");

const zeile = (s = "") => console.log(s);
const ok = (s) => zeile("  ok    " + s);
const fehl = (s) => zeile("  FEHLT " + s);

// Liegt gws-cli ueberhaupt auf dieser Maschine, und welche Fassung?
function version() {
  return new Promise((fertig) => {
    execFile("gws-cli", ["--version"], { timeout: 8000 }, (err, out, errAus) => {
      if (err) return fertig({ da: false, grund: String(errAus || err.message).slice(0, 200) });
      fertig({ da: true, text: String(out || errAus).trim().slice(0, 80) });
    });
  });
}

(async () => {
  zeile();
  zeile("KALENDER-PRUEFUNG — derselbe Weg, den auch die Seite /kalender geht");
  zeile("=".repeat(66));

  // ---------------------------------------------------------- 1. Werkzeug
  zeile();
  zeile("1. Ist gws-cli da?");
  const v = await version();
  if (!v.da) {
    fehl("gws-cli laesst sich nicht aufrufen.");
    zeile("        " + v.grund);
    zeile();
    zeile("  Das ist auf einem Laptop der NORMALFALL — gws-cli und das Google-Token");
    zeile("  liegen im Container auf dem Server. Dort pruefen:");
    zeile("      docker exec flowstate-dashboard node scripts/kalender-pruefen.js");
    zeile();
    process.exit(1);
  }
  ok("gws-cli antwortet: " + v.text);

  // ------------------------------------------------------------ 2. Lesen
  const von = kal.tagPlus(kal.heuteTag(), -1);
  const bis = kal.tagPlus(kal.heuteTag(), 13);
  zeile();
  zeile(`2. Termine lesen (${von} bis ${bis})`);
  const antwort = await kal.spanne(von, bis);

  if (!antwort.ok) {
    fehl("Google hat nicht geliefert.");
    zeile("        " + antwort.fehler);
    zeile();
    zeile("  Steht dort etwas von 'invalid_grant', 'token' oder 'credentials', ist die");
    zeile("  Anmeldung abgelaufen und muss einmal neu geholt werden. Der Token liegt");
    zeile("  unter ~/.config/gws-cli und wird mit Hermes geteilt.");
    zeile();
    process.exit(1);
  }
  ok(`Antwort gelesen, ${antwort.termine.length} Termine in 15 Tagen.`);

  if (!antwort.termine.length) {
    zeile();
    zeile("  ACHTUNG: Die Verbindung steht, aber es kam KEIN Termin zurueck.");
    zeile("  Dann haengt das Token vermutlich an einem anderen Google-Konto als dem,");
    zeile("  in das du schaust — oder die Termine liegen in einem Kalender, der");
    zeile("  diesem Konto nur freigegeben ist. gws-cli liest den HAUPTKALENDER.");
  } else {
    zeile();
    zeile("  Die naechsten Termine — steht hier, was du im Google Kalender siehst?");
    for (const t of antwort.termine.slice(0, 8)) {
      const wann = kal.istGanztags(t)
        ? String(t.start).slice(0, 10) + " ganztägig"
        : String(t.start).slice(0, 10) + " " + kal.uhrzeit(t.start) + "–" + kal.uhrzeit(t.ende);
      zeile(`     ${wann}  ${String(t.titel).slice(0, 46)}`);
    }
    if (antwort.termine.length > 8) zeile(`     … und ${antwort.termine.length - 8} weitere`);
  }

  // --------------------------------------------------------- 3. Schreiben
  if (!process.argv.includes("--testtermin")) {
    zeile();
    zeile("3. Schreiben — uebersprungen.");
    zeile("   Mit --testtermin wird zusaetzlich ein Termin angelegt und sofort");
    zeile("   wieder abgesagt. Erst das belegt, dass Eintragen wirklich geht.");
    zeile();
    process.exit(0);
  }

  zeile();
  zeile("3. Termin anlegen und sofort wieder absagen");
  const jetzt = new Date(Date.now() + 3600000);
  const p = (n) => String(n).padStart(2, "0");
  const start = `${kal.berlinDatum(jetzt)}T${p(jetzt.getHours())}:${p(jetzt.getMinutes())}`;
  const titel = "Flowstate Testtermin (wird sofort geloescht)";

  const angelegt = await werkzeuge.terminEintragen({ titel, start, beschreibung: "Selbsttest" });
  if (!angelegt.ok) {
    fehl("Anlegen abgelehnt: " + angelegt.grund);
    zeile();
    process.exit(1);
  }
  ok(`Angelegt fuer ${angelegt.start}.`);

  // Die ID steht nicht in der Antwort von create — also einmal nachlesen.
  const nachher = await kal.spanne(kal.heuteTag(), kal.tagPlus(kal.heuteTag(), 1));
  const gefunden = (nachher.termine || []).find((t) => t.titel === titel);
  if (!gefunden) {
    fehl("Der Termin wurde angelegt, taucht beim Nachlesen aber nicht auf.");
    zeile("        Bitte im Google Kalender nachsehen und von Hand entfernen:");
    zeile("        " + titel);
    zeile();
    process.exit(1);
  }
  ok("Beim Nachlesen wiedergefunden — Schreiben und Lesen treffen denselben Kalender.");

  const weg = await werkzeuge.terminAbsagen({ id: gefunden.id });
  if (!weg.ok) {
    fehl("Absagen fehlgeschlagen: " + weg.grund);
    zeile("        Bitte von Hand entfernen: " + titel);
    zeile();
    process.exit(1);
  }
  ok("Wieder abgeraeumt. Es bleibt nichts im Kalender liegen.");

  zeile();
  zeile("Alles gruen — Lesen und Schreiben gehen in denselben Google Kalender.");
  zeile();
})().catch((e) => {
  zeile();
  zeile("Abgebrochen: " + String(e && e.message).slice(0, 300));
  zeile();
  process.exit(1);
});
