const puppeteer = require("/app/node_modules/puppeteer-core");
const B = "http://127.0.0.1:3000";
(async () => {
  const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const p = await b.newPage();
  const zeilen = [];
  p.on("console", (m) => zeilen.push(m.type() + ": " + m.text().slice(0, 130)));
  p.on("pageerror", (e) => zeilen.push("PAGEERROR: " + e.message));
  p.on("requestfailed", (r) => zeilen.push("404?: " + r.url().slice(-60)));
  p.on("response", (r) => { if (r.status() === 404) zeilen.push("404: " + r.url().slice(-60)); });

  await p.goto(B + "/login", { waitUntil: "domcontentloaded" });
  await p.evaluate(() => { const f = document.querySelector("form");
    f.querySelector('[name=email]').value = "jannikvomhofe@flowstate-ai.net";
    f.querySelector('[name=password]').value = "dreh2026"; f.submit(); });
  await p.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  await p.goto(B + "/sprache", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2500));
  const geladen = await p.evaluate(() => window.__drehprobe || null);
  console.log("--- Konsole ---");
  zeilen.forEach((z) => console.log("   " + z));
  await b.close();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
