const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
for (const z of fs.readFileSync("C:/dev/flowstate-dashboard/.env", "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const ORDNER = "C:/dev/flowstate-dashboard/shots/os";
const PORT = 3997;
(async () => {
  fs.mkdirSync(ORDNER, { recursive: true });
  const srv = spawn("node", ["server.js"], {
    cwd: "C:/dev/flowstate-dashboard",
    env: { ...process.env, PORT, DASHBOARD_PASSWORD: "test123", VAULT_PATH: "C:/dev/flowstate-vault" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new", args: ["--no-sandbox", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });

  await page.goto(`http://localhost:${PORT}/login`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(ORDNER, "01-login.png") });

  await page.type("input[name=email]", "lukas.sehorz@flowstate-ai.net");
  await page.type("input[name=password]", "flowstate2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  await new Promise((r) => setTimeout(r, 2500)); // Kacheln laden per fetch nach
  await page.screenshot({ path: path.join(ORDNER, "02-zentrale.png"), fullPage: true });

  await page.goto(`http://localhost:${PORT}/crm`, { waitUntil: "networkidle0" });
  await page.hover(".rail");
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(ORDNER, "03-crm-rail.png") });

  await browser.close(); srv.kill();
  console.log("fertig");
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
