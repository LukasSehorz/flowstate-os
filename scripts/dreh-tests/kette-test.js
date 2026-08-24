const puppeteer = require("/app/node_modules/puppeteer-core");
const B = "http://127.0.0.1:3000";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream",
           "--use-fake-device-for-media-stream"] });
  const p = await b.newPage();
  const fehler = [];
  p.on("pageerror", (e) => fehler.push(e.message));
  await p.goto(B + "/login", { waitUntil: "domcontentloaded" });
  await p.evaluate(() => { const f = document.querySelector("form");
    f.querySelector('[name=email]').value = "jannikvomhofe@svhconsult.de";
    f.querySelector('[name=password]').value = "dreh2026"; f.submit(); });
  await p.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
  await p.goto(B + "/sprache", { waitUntil: "networkidle2" });
  await warte(2500);

  const stand = () => p.evaluate(() => ({
    zustand: document.getElementById("kugel").getAttribute("data-zustand"),
    hinweis: document.getElementById("kugel-hinweis").textContent.trim().slice(0, 46),
  }));

  await p.click("#kugel");
  await warte(1500); console.log("nach Start:      ", JSON.stringify(await stand()));
  await warte(7000); console.log("nach Zug 1 (7s): ", JSON.stringify(await stand()));

  // Leertaste als zweiter Ausloeser: zieht den naechsten Zug vor.
  await p.keyboard.press("Space");
  await warte(3000); console.log("nach Leertaste:  ", JSON.stringify(await stand()));
  console.log("Seitenfehler:", fehler.length ? fehler : "keine");
  await b.close();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
