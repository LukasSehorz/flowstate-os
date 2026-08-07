// Schneller Selbsttest vor dem Push.
//
//   node scripts/pruefen.js
//
// Warum es das gibt (26.07.2026): Lukas und Jannik arbeiten ab jetzt BEIDE
// direkt auf main — kein eigener Branch mehr, kein Pull Request dazwischen.
// Das ist schnell und beide sehen sofort, was der andere macht. Der Preis: Was
// kaputt gepusht wird, bremst den anderen SOFORT aus.
//
// Diese Pruefung faengt genau das ab: Syntaxfehler in geaenderten Dateien und
// die Testskripte. Sie ersetzt kein Ausprobieren im Browser — sie verhindert,
// dass offensichtlich Kaputtes beim anderen landet.
//
// Bewusst schnell (wenige Sekunden): Eine Pruefung, die lange dauert, wird
// umgangen.

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..");
let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

// --- 1. Syntax der geaenderten JS-Dateien -------------------------------
// Drei getrennte Aufrufe statt einer Kette mit ";" — die Trennzeichen sind
// unter Windows und Linux verschieden, und ein stiller Fehlschlag hier haette
// bedeutet: "keine geaenderten Dateien" und damit gar keine Syntaxpruefung.
let geaendert = [];
for (const befehl of [
  "git diff --name-only HEAD",              // geaendert, noch nicht vorgemerkt
  "git diff --cached --name-only",          // vorgemerkt
  "git ls-files --others --exclude-standard", // ganz neu
]) {
  try {
    const roh = execSync(befehl, { cwd: wurzel, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    geaendert.push(...roh.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch { /* z. B. ganz frisches Repo ohne HEAD — der naechste Befehl greift */ }
}
geaendert = [...new Set(geaendert)];

const jsDateien = geaendert.filter((d) => d.endsWith(".js") && fs.existsSync(path.join(wurzel, d)));
if (!jsDateien.length) {
  console.log("Keine geaenderten JS-Dateien.");
} else {
  for (const d of jsDateien) {
    try {
      execFileSync(process.execPath, ["--check", d], { cwd: wurzel, stdio: "pipe" });
      melde(true, "Syntax ok: " + d);
    } catch (e) {
      melde(false, "SYNTAXFEHLER in " + d + "\n   " + String(e.stderr || e.message).split("\n").slice(0, 3).join("\n   "));
    }
  }
}

// --- 2. JSON-Dateien (manifest.json & Co.) -------------------------------
for (const d of geaendert.filter((x) => x.endsWith(".json") && !x.includes("node_modules"))) {
  const p = path.join(wurzel, d);
  if (!fs.existsSync(p)) continue;
  try { JSON.parse(fs.readFileSync(p, "utf-8")); melde(true, "JSON ok: " + d); }
  catch (e) { melde(false, "KAPUTTES JSON in " + d + " — " + String(e.message).slice(0, 80)); }
}

// --- 3. Die Testskripte --------------------------------------------------
// Ohne Datenbank/Netz lauffaehig — die uebrigen (test-crm.js) bleiben aussen
// vor, damit die Pruefung schnell und ohne Zugaenge durchlaeuft.
// test-erzaehlspur, test-erzaehlfilter und test-plan sind am 26.07. mit der
// Erzaehlspur selbst entfallen (Schritt A1) — sie prueften Verhalten, das es
// nicht mehr gibt.
const TESTS = [
  "test-navigation", "test-prompt", "test-sprache", "test-kontakte", "test-gespraech",
  // test-kalender prueft das LESEN der gws-cli-Antwort, test-kalender-seite die
  // Rechnerei der Kalenderseite (Monatsraster, Googles ganztaegiges Ende).
  "test-kalender", "test-kalender-seite",
  "test-suche", "test-termin", "test-wa-lesen",
  "test-wa-arten", "test-neuigkeiten", "test-nachschlagen", "test-dokument", "test-zustand-frische", "test-crm-sprache", "test-zufluss-telegram", "test-beleg-telegram",
];
for (const t of TESTS) {
  const p = path.join(wurzel, "scripts", t + ".js");
  if (!fs.existsSync(p)) continue;
  try {
    execFileSync(process.execPath, [p], { cwd: wurzel, stdio: "pipe", timeout: 60000 });
    melde(true, t);
  } catch (e) {
    const raus = String(e.stdout || "") + String(e.stderr || "");
    const schlecht = raus.split("\n").filter((z) => z.includes("❌")).slice(0, 3);
    melde(false, t + (schlecht.length ? "\n   " + schlecht.join("\n   ") : " — " + String(e.message).slice(0, 90)));
  }
}

console.log(fehler
  ? `\n${fehler} Problem(e). Bitte beheben, BEVOR du pushst — sonst faellt es dem anderen auf die Fuesse.`
  : "\nAlles sauber. Du kannst pushen.");
process.exit(fehler ? 1 : 0);
