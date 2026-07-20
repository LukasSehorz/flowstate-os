// Screenshots des CRM — startet Server, meldet sich an, fotografiert alle Seiten.
// Aufruf: node scripts/shot.js [ordnername]
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const ORDNER = path.join(__dirname, "..", "shots", process.argv[2] || "aktuell");
const PORT = 3995;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SEITEN = [
  ["01-anmelden", "/crm/anmelden", false],
  ["02-uebersicht", "/crm", true],
  ["03-leads", "/crm/leads", true],
  ["04-pipeline", "/crm/pipeline", true],
  ["05-kunden", "/crm/kunden", true],
  ["06-team", "/crm/team", true],
];

(async () => {
  fs.mkdirSync(ORDNER, { recursive: true });
  const server = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT, DASHBOARD_PASSWORD: "test123", VAULT_PATH: "C:/dev/flowstate-vault" },
    stdio: "ignore", detached: false,
  });
  await new Promise((r) => setTimeout(r, 2500));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });

  // Anmelden
  await page.goto(`http://localhost:${PORT}/crm/anmelden`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(ORDNER, "01-anmelden.png") });
  await page.type('input[name=email]', "lukas.sehorz@flowstate-ai.net");
  await page.type('input[name=passwort]', "flowstate2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);

  for (const [name, pfad, nachLogin] of SEITEN) {
    if (!nachLogin) continue;
    await page.goto(`http://localhost:${PORT}${pfad}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 900)); // Animationen abwarten
    await page.screenshot({ path: path.join(ORDNER, `${name}.png`), fullPage: true });
    console.log(`📸 ${name}`);
  }

  // Eine Detailseite
  const link = await page.$eval("table.tabelle tbody tr", (tr) => tr.getAttribute("onclick")).catch(() => null);
  if (link) {
    const url = link.match(/'([^']+)'/)?.[1];
    if (url) {
      await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 900));
      await page.screenshot({ path: path.join(ORDNER, "07-firma-detail.png"), fullPage: true });
      console.log("📸 07-firma-detail");
    }
  }

  await browser.close();
  server.kill();
  console.log(`\n✅ Screenshots in shots/${path.basename(ORDNER)}/`);
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
