// Bilder der beiden Jarvis-Seiten aufnehmen — Sprachbuehne und Zentrale.
//
// Wofuer (18.08.2026): Beide Seiten werden abgefilmt und als Anzeige
// geschaltet. Ob sie das tragen, sieht man nicht im Code, sondern nur im Bild —
// und zwar in DER Groesse, in der sie spaeter laufen. Deshalb 1920x1080 als
// Leitmass, dazu ein Laptop-Mass und ein Handy.
//
// Der Server wird hier eigens gestartet, mit zwei Sicherungen:
//   1. DATA_PATH zeigt in einen Wegwerf-Ordner. Die Routinen ("Zweites
//      Gehirn": Chronik, Zufluss, Selbsttest) schreiben Dateien — die sollen
//      nicht die echten ueberschreiben.
//   2. Gesendet werden kann ohnehin nichts: In der lokalen .env stehen keine
//      Telegram- und WhatsApp-Zugaenge, die Routinen schalten sich also selbst
//      ab. Wer das hier auf einem Rechner MIT diesen Zugaengen laufen laesst,
//      muss sie vorher leeren.
//
// Die Datenbank ist die echte. Gelesen wird nur — die Seiten zeigen an, sie
// schreiben nicht. Genau deshalb stehen in den Bildern auch echte Zahlen, und
// nur die sind zur Beurteilung zu gebrauchen.
//
// Aufruf:  node scripts/shot-jarvis.js  [--nur sprache|zentrale]

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const WURZEL = path.join(__dirname, "..");
const ZIEL = path.join(WURZEL, "shots", "jarvis");
const PORT = 3998;
const PASSWORT = "jarvis-schuss";

// Chrome finden — auf diesem Rechner liegt er an einer der beiden Stellen.
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));

const MASSE = [
  { name: "gross", breite: 1920, hoehe: 1080, faktor: 1 },   // Monitor, das Leitmass
  { name: "laptop", breite: 1440, hoehe: 900, faktor: 2 },
  { name: "handy", breite: 390, hoehe: 844, faktor: 2 },
];

const SEITEN = [
  { name: "sprache", pfad: "/sprache" },
  { name: "zentrale", pfad: "/" },
  // Die Buehne fuer die Aufnahme (20.08.). Zwei Bilder statt einem: Der
  // Zustand VOR dem Klatschen ist die halbe Miete — ein Bildschirm, der
  // wartet. Ausgeloest wird per Leertaste, weil ein kopfloser Browser kein
  // Mikrofon hat; im Code ist es derselbe Weg wie beim Klatschen.
  { name: "buehne", pfad: "/buehne", wecken: true },
];

const nur = process.argv.includes("--nur") ? process.argv[process.argv.indexOf("--nur") + 1] : "";

(async () => {
  if (!CHROME) { console.log("Kein Chrome gefunden."); process.exit(1); }
  fs.mkdirSync(ZIEL, { recursive: true });

  // .env einlesen, aber DATA_PATH und Passwort selbst setzen.
  const env = { ...process.env };
  const envDatei = path.join(WURZEL, ".env");
  if (fs.existsSync(envDatei)) {
    for (const z of fs.readFileSync(envDatei, "utf-8").split("\n")) {
      const t = z.trim(); if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
    }
  }
  env.PORT = String(PORT);
  env.DASHBOARD_PASSWORD = PASSWORT;
  env.DATA_PATH = path.join(require("os").tmpdir(), "jarvis-schuss-daten");
  fs.mkdirSync(env.DATA_PATH, { recursive: true });

  console.log("Server startet auf Port " + PORT + " …");
  const srv = spawn("node", ["server.js"], { cwd: WURZEL, env, stdio: "ignore" });
  const aus = () => { try { srv.kill(); } catch {} };
  process.on("exit", aus); process.on("SIGINT", () => { aus(); process.exit(1); });

  // Warten, bis er antwortet — statt blind zu schlafen.
  const http = require("http");
  const lebt = () => new Promise((r) => {
    const anfrage = http.get({ host: "127.0.0.1", port: PORT, path: "/login", timeout: 1500 },
      (res) => { res.resume(); r(res.statusCode > 0); });
    anfrage.on("error", () => r(false));
    anfrage.on("timeout", () => { anfrage.destroy(); r(false); });
  });
  let da = false;
  for (let i = 0; i < 40 && !da; i++) { da = await lebt(); if (!da) await new Promise((r) => setTimeout(r, 500)); }
  if (!da) { console.log("Server antwortet nicht."); aus(); process.exit(1); }
  console.log("Server ist da.");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  });

  try {
    for (const mass of MASSE) {
      const seite = await browser.newPage();
      await seite.setViewport({ width: mass.breite, height: mass.hoehe, deviceScaleFactor: mass.faktor });

      // Anmelden. PERSOENLICH, wenn Zugangsdaten da sind — sonst mit dem
      // gemeinsamen Passwort.
      //
      // Der Unterschied ist hier nicht kosmetisch: Ohne persoenliches Konto
      // zeigt die Zentrale voellig zu Recht nur den Hinweis "Melde dich
      // persoenlich an" und KEINE Zahlen — die Zeilenrechte haengen am Konto.
      // Ein Bild davon zeigt eine leere Seite und taugt zur Beurteilung nicht.
      // Zugangsdaten kommen aus der Umgebung (SCHUSS_MAIL / SCHUSS_PASSWORT),
      // damit hier keine im Klartext stehen.
      await seite.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: "domcontentloaded" });
      const mail = process.env.SCHUSS_MAIL || "";
      const wort = process.env.SCHUSS_PASSWORT || "";
      await seite.evaluate((pw, mail, wort) => {
        const f = document.querySelector("form");
        const feldPw = f.querySelector('input[type="password"], input[name="password"]');
        const feldMail = f.querySelector('input[type="email"], input[name="email"]');
        if (mail && wort && feldMail) { feldMail.value = mail; feldPw.value = wort; }
        else { feldPw.value = pw; }
        f.submit();
      }, PASSWORT, mail, wort);
      await seite.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
      if (!mail) console.log("  (Hinweis: ohne SCHUSS_MAIL nur gemeinsames Passwort — die Zentrale bleibt dann leer)");

      for (const s of SEITEN) {
        if (nur && s.name !== nur) continue;
        await seite.goto(`http://127.0.0.1:${PORT}${s.pfad}`, { waitUntil: "networkidle2" });
        // Der Seite Zeit geben, ihre Bewegung anzuwerfen: Zaehler laufen hoch,
        // das Gehirn baut sich auf. Ein Bild in Millisekunde 0 zeigt nichts.
        await new Promise((r) => setTimeout(r, 3800));
        const datei = path.join(ZIEL, `${s.name}-${mass.name}.png`);
        await seite.screenshot({ path: datei, fullPage: mass.name !== "gross" });
        console.log("  " + path.relative(WURZEL, datei));

        // Buehne: einmal schlafend (oben), einmal aufgefahren.
        if (s.wecken) {
          await seite.keyboard.press("Space");
          await new Promise((r) => setTimeout(r, 4200));
          const wach = path.join(ZIEL, `${s.name}-wach-${mass.name}.png`);
          await seite.screenshot({ path: wach, fullPage: false });
          console.log("  " + path.relative(WURZEL, wach));
        }
      }
      await seite.close();
    }
  } finally {
    await browser.close();
    aus();
  }
  console.log("\nFertig. Bilder in shots/jarvis/");
  process.exit(0);
})().catch((e) => { console.log("FEHLER: " + (e.stack || e.message)); process.exit(1); });
