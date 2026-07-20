// Screenshots aller Seiten in hell und dunkel — eine Huelle, ein Designsystem.
// Aufruf: node scripts/shot-alles.js [ordnername]
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const ORDNER = path.join(__dirname, "..", "shots", process.argv[2] || "alles");
const PORT = 3998;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SEITEN = [
  ["01-zentrale", "/"],
  ["02-crm-dashboard", "/crm"],
  ["03-crm-pipeline-tab", "/crm?tab=pipeline"],
  ["04-crm-board", "/crm/pipeline?sparte=webdesign"],
  ["05-crm-leads", "/crm/leads"],
  ["06-leads-os", "/leads"],
  ["07-wissen", "/wissen"],
  ["08-agenten", "/agenten"],
  ["09-chat", "/chat"],
];

(async () => {
  fs.mkdirSync(ORDNER, { recursive: true });
  const server = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT, DASHBOARD_PASSWORD: "test123", VAULT_PATH: "C:/dev/flowstate-vault" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 2500));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });

  await page.goto(`http://localhost:${PORT}/login`, { waitUntil: "networkidle0" });
  await page.type("input[name=email]", "lukas.sehorz@flowstate-ai.net");
  await page.type("input[name=password]", "flowstate2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);

  for (const thema of ["light", "dark"]) {
    await page.evaluate((t) => localStorage.setItem("flowstate-thema", t), thema);
    for (const [name, pfad] of SEITEN) {
      await page.goto(`http://localhost:${PORT}${pfad}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 1100)); // Nachladen per fetch + Animationen
      await page.screenshot({ path: path.join(ORDNER, `${thema}-${name}.png`), fullPage: true });
    }
    console.log(`📸 ${thema} fertig`);
  }

  await browser.close();
  server.kill();
  console.log(`\n✅ Screenshots in shots/${path.basename(ORDNER)}/`);
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
