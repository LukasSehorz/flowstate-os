// Vollprobe von Creative 2: Wird jeder Inhalt ERST dann geoeffnet, wenn er
// dran ist? Springt WhatsApp beim letzten Zug nach vorn? Bleibt das Mikrofon
// bei der Sprachbuehne?
const puppeteer = require("/app/node_modules/puppeteer-core");
const B = "http://127.0.0.1:3000";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await b.newPage();
  await p.goto(B + "/login", { waitUntil: "domcontentloaded" });
  await p.evaluate(() => { const f = document.querySelector("form");
    f.querySelector('[name=email]').value = "jannikvomhofe@flowstate-ai.net";
    f.querySelector('[name=password]').value = "dreh2026"; f.submit(); });
  await p.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});

  // Mappe oeffnen und vorladen — wie es die Sprachseite tut.
  await p.goto(B + "/regie/mappe?c=1", { waitUntil: "domcontentloaded" });
  await p.click("#laden");
  await warte(2500);
  let seiten = await b.pages();
  console.log("Nach dem Vorladen:", seiten.length - 2, "Inhalt(e)");
  seiten.slice(2).forEach((s) => console.log("   " + s.url().slice(0, 58)));

  // Jetzt Zug fuer Zug, so wie mappeZeigen() es macht.
  const drehbuch = await p.evaluate(async (basis) =>
    (await (await fetch(basis + "/regie/drehbuch.json?c=1")).json()).zuege, B);

  const mappe = p;   // wir sind IN der Mappe, also oeffnet window.open hier
  for (const z of drehbuch) {
    if (!z.oeffnen || !z.oeffnen.length) continue;
    for (const d of z.oeffnen) {
      const url = d.indexOf("http") === 0 ? d
        : d.charAt(0) === "/" ? d + (d.includes("?") ? "&" : "?") + "drehbuch=aus"
          : "/regie/datei/" + encodeURIComponent(d);
      const name = "dreh-" + String(d).split("?")[0].replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "").slice(0, 40);
      await mappe.evaluate((u, n) => window.open(u, n), url, name);
      await warte(1800);
      const alle = await b.pages();
      const aktiv = [];
      for (const s of alle) {
        try { if (await s.evaluate(() => document.visibilityState === "visible")) aktiv.push(s.url().slice(0, 46)); }
        catch {}
      }
      console.log(`${z.id}: ${alle.length - 2} Inhalte offen · vorn: ${aktiv.join(", ").slice(0, 70)}`);
    }
  }

  // Greift eine Inhalts-Seite noch aufs Mikrofon zu?
  const alle = await b.pages();
  const kal = alle.find((s) => s.url().includes("/kalender"));
  if (kal) {
    const log = [];
    kal.on("console", (m) => log.push(m.text()));
    await kal.reload({ waitUntil: "networkidle2" });
    await warte(1500);
    console.log("Kalender-Tab meldet Sprachsteuerung aus:",
      log.some((l) => /Sprachsteuerung auf dieser Seite aus/.test(l)));
  }
  await b.close();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
