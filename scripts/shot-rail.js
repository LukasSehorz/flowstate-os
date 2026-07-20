// Nahaufnahme der Seitenleiste: zusammengeklappt und ausgefahren, hell und dunkel.
// Kein fullPage — sonst malt der Browser die feste Rail nur bis Fensterhoehe.
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const ORDNER = path.join(__dirname, "..", "shots", process.argv[2] || "rail");
const PORT = 3994;

(async () => {
  fs.mkdirSync(ORDNER, { recursive: true });
  const srv = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT, DASHBOARD_PASSWORD: "test123", VAULT_PATH: "C:/dev/flowstate-vault" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new", args: ["--no-sandbox", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1050, deviceScaleFactor: 2 });

  await page.goto(`http://localhost:${PORT}/login`, { waitUntil: "networkidle0" });
  await page.type("input[name=email]", "lukas.sehorz@flowstate-ai.net");
  await page.type("input[name=password]", "flowstate2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);

  for (const thema of ["light", "dark"]) {
    await page.evaluate((t) => localStorage.setItem("flowstate-thema", t), thema);
    // Im CRM, damit die Untereintraege sichtbar sind
    await page.goto(`http://localhost:${PORT}/crm/pipeline?sparte=webdesign`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(ORDNER, `${thema}-1-zu.png`), clip: { x: 0, y: 0, width: 420, height: 1050 } });

    await page.hover(".rail-marke");
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(ORDNER, `${thema}-2-offen.png`), clip: { x: 0, y: 0, width: 420, height: 1050 } });
    console.log(`📸 ${thema}`);
  }
  await browser.close(); srv.kill();
  console.log(`✅ shots/${path.basename(ORDNER)}/`);
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
