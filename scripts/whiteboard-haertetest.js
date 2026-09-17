// scripts/whiteboard-haertetest.js — das Whiteboard im echten Browser durchklicken.
//
//   node scripts/whiteboard-haertetest.js          alle drei Runden
//   node scripts/whiteboard-haertetest.js 3        nur Runde 3 (Handy-Blatt)
//
// Warum es das gibt (17.09.2026): Gemeldet war, dass die Zeilenwerkzeuge
// verschwinden, sobald man mit der Maus zu ihnen faehrt, dass "Loeschen" den
// ganzen Block nimmt und dass das leere erste Kaestchen nie wieder weggeht.
// Nichts davon sieht man im Code — es haengt an Pixeln (ein Griff, der 90 px
// IN den Block ragte), an Stapelfolgen und an Tasten. Also wird genau das
// geprueft: echte Mauswege, echte Klicks, echte Tasten, und danach der Stand,
// wie ihn der Server gespeichert hat.
//
//   Runde 1  Tafel am Schreibtisch   (Werkzeuge, Papierkorb, Unterpunkte, Ziehen)
//   Runde 2  Alltag und Rueckfall    (mehrfach loeschen, Zettel, Abgabe an andere)
//   Runde 3  Handy-Blatt             (Touch, 390 x 844)
//
// Laeuft gegen scripts/whiteboard-probe.js (Arbeitsspeicher, keine Datenbank,
// nichts verlaesst das Haus) — der Laeufer startet die Probe selbst auf einem
// eigenen Port und raeumt sie wieder ab.
//
// Bewusst NICHT in scripts/pruefen.js: der pre-push-Hook muss ohne Chrome und
// in Sekunden laufen. Das hier braucht einen Browser und ein paar Minuten —
// es ist fuer den Moment gedacht, in dem jemand am Whiteboard geschraubt hat.
const path = require("path"), http = require("http"), { spawn, spawnSync } = require("child_process");
const { CHROME } = require("./whiteboard-haertetest/gemeinsam.js");

const PORT = Number(process.env.WB_TEST_PORT) || 3971;
const BASIS = "http://localhost:" + PORT;
const RUNDEN = ["runde1-tafel.js", "runde2-alltag.js", "runde3-handy.js"];
const nur = Number(process.argv[2]) || 0;

const antwortet = () => new Promise((fertig) => {
  const anfrage = http.get(BASIS + "/als/0", (antwort) => { antwort.resume(); fertig(antwort.statusCode < 500); });
  anfrage.on("error", () => fertig(false));
  anfrage.setTimeout(1500, () => { anfrage.destroy(); fertig(false); });
});

(async () => {
  if (!CHROME) {
    console.error("Kein Chrome gefunden. Bitte mit CHROME=/pfad/zu/chrome aufrufen.");
    process.exit(2);
  }
  const probe = spawn(process.execPath, [path.join(__dirname, "whiteboard-probe.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, WB_PROBE_PORT: String(PORT) },
    stdio: "ignore",
  });
  const aufraeumen = () => { try { probe.kill(); } catch (_) { /* schon weg */ } };
  process.on("exit", aufraeumen);
  process.on("SIGINT", () => { aufraeumen(); process.exit(130); });

  let bereit = false;
  for (let i = 0; i < 40 && !bereit; i++) {
    await new Promise((r) => setTimeout(r, 250));
    bereit = await antwortet();
  }
  if (!bereit) { console.error("Die Probe antwortet nicht auf " + BASIS + "."); process.exit(2); }

  let offen = 0;
  for (const [i, datei] of RUNDEN.entries()) {
    if (nur && nur !== i + 1) continue;
    console.log("\n================ " + datei.replace(".js", "") + " ================");
    const lauf = spawnSync(process.execPath, [path.join(__dirname, "whiteboard-haertetest", datei)], {
      env: { ...process.env, WB_TEST_BASIS: BASIS },
      stdio: "inherit",
    });
    if (lauf.status !== 0) offen++;
  }
  console.log("\n" + (offen ? "❌ " + offen + " Runde(n) mit offenen Punkten." : "✅ Alle Runden grün."));
  process.exit(offen ? 1 : 0);
})();
