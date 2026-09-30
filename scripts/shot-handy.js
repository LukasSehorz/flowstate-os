// Screenshots aller Arbeitsseiten in HANDY-Breite — und daneben Desktop.
//
// Warum (Lukas, 30.09.2026): "Bei mir funktioniert die App aktuell nicht auf
// dem Handy. Schau bitte, dass das Operating System responsive Design hat."
//
// Das Skript misst zusaetzlich, was man auf einem Screenshot schlecht sieht:
//   · waagerechtes Scrollen (die Seite ist breiter als das Fenster)
//   · Elemente, die aus dem Fenster ragen — mit Angabe, WELCHE
//   · Tippziele unter 44 Pixel (Apples Mindestmass fuer den Daumen)
//
//   node scripts/shot-handy.js [ordnername] [--nur handy|desktop]
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const ORDNER = path.join(__dirname, "..", "shots", process.argv[2] || "handy");
const PORT = Number(process.env.SHOT_PORT || 3997);
const NUR = process.argv.includes("--nur") ? process.argv[process.argv.indexOf("--nur") + 1] : "";

// Chrome finden: erst der von Playwright mitgebrachte, dann das System-Chrome.
function chromeFinden() {
  const kandidaten = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const cache = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  try {
    for (const d of fs.readdirSync(cache).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
      kandidaten.unshift(path.join(cache, d, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"));
    }
  } catch { /* kein Playwright-Cache */ }
  for (const k of kandidaten) if (fs.existsSync(k)) return k;
  throw new Error("Kein Chrome gefunden.");
}

// Die Seiten, auf denen wirklich gearbeitet wird.
const SEITEN = [
  ["01-zentrale", "/"],
  ["02-crm", "/crm"],
  ["03-pipeline", "/crm/pipeline?sparte=webdesign"],
  ["04-leads", "/crm/leads"],
  ["05-buchhaltung", "/buchhaltung"],
  ["06-belege", "/buchhaltung/belege"],
  ["07-kosten", "/buchhaltung/kosten"],
  ["08-monate", "/buchhaltung/monate"],
  ["09-scan", "/buchhaltung/scan"],
  ["10-rechnungen", "/buchhaltung/rechnungen"],
  ["11-whiteboard", "/whiteboard"],
  ["12-kalender", "/kalender"],
  ["13-aufgaben", "/todos"],
  ["14-kunden", "/crm/kunden"],
];

// iPhone 14/15 in CSS-Pixeln. Das ist die Breite, bei der es weh tut.
const GERAETE = [
  { name: "handy", breite: 390, hoehe: 844, scale: 2, mobil: true },
  { name: "desktop", breite: 1512, hoehe: 950, scale: 1, mobil: false },
].filter((g) => !NUR || g.name === NUR);

// Im Browser ausgefuehrt: Was passt nicht ins Fenster?
const MESSEN = `(() => {
  const de = document.documentElement;
  const fensterBreite = de.clientWidth;
  const ueberlauf = Math.max(0, de.scrollWidth - fensterBreite);
  const raus = [];
  const klein = [];
  const beschreibe = (el) => {
    const t = el.tagName.toLowerCase();
    const k = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    const txt = (el.textContent || "").trim().slice(0, 28).replace(/\\s+/g, " ");
    return t + k + (txt ? ' "' + txt + '"' : "") + (el.id ? "#" + el.id : "");
  };
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Ragt nach rechts hinaus? Ein paar Pixel Toleranz fuer Rundungen.
    if (r.right > fensterBreite + 2) {
      // Nur das aeusserste melden, nicht jedes Kind darin.
      if (!raus.some((x) => x.el.contains(el))) raus.push({ el, ueber: Math.round(r.right - fensterBreite) });
    }
    // Tippziele: Knoepfe und Links, die zu klein fuer einen Daumen sind.
    if (/^(a|button)$/.test(el.tagName.toLowerCase()) || el.getAttribute("role") === "button") {
      if ((r.height < 40 || r.width < 40) && r.height > 4 && (el.textContent || "").trim()) {
        klein.push({ el, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  }
  return {
    fensterBreite, ueberlauf,
    scrollBreite: de.scrollWidth,
    rausragend: raus.slice(0, 8).map((x) => beschreibe(x.el) + " (+" + x.ueber + "px)"),
    rausGesamt: raus.length,
    kleineZiele: klein.slice(0, 6).map((x) => beschreibe(x.el) + " (" + x.w + "×" + x.h + ")"),
    kleineGesamt: klein.length,
  };
})()`;

(async () => {
  fs.mkdirSync(ORDNER, { recursive: true });
  const server = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  const aufraeumen = () => { try { server.kill(); } catch {} };
  process.on("exit", aufraeumen);
  await new Promise((r) => setTimeout(r, 4000));

  const browser = await puppeteer.launch({
    executablePath: chromeFinden(), headless: "new",
    args: ["--no-sandbox", "--hide-scrollbars"],
  });

  const bericht = [];
  for (const g of GERAETE) {
    const page = await browser.newPage();
    await page.setViewport({ width: g.breite, height: g.hoehe, deviceScaleFactor: g.scale, isMobile: g.mobil, hasTouch: g.mobil });
    if (g.mobil) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");

    // ANMELDUNG UEBER DIE DIENSTANMELDUNG (30.09.2026). Sie setzt dieselbe
    // Sitzung, die auch der Postfachlauf benutzt — ohne dass fuer eine Messung
    // ein Konto angelegt oder ein Passwort geraten werden muesste. Der
    // Endpunkt nimmt nur Aufrufe von 127.0.0.1 an, und genau von dort kommt
    // dieser Lauf. Es wird nichts in der Datenbank veraendert.
    await page.goto(`http://localhost:${PORT}/login`, { waitUntil: "domcontentloaded" });
    const angemeldet = await page.evaluate(async (pw) => {
      try {
        const r = await fetch("/intern/dienst-anmelden", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ passwort: pw }),
        });
        const d = await r.json();
        return d && d.ok ? "ja" : (d && d.hint) || "abgelehnt";
      } catch (e) { return String(e.message); }
    }, process.env.DASHBOARD_PASSWORD || "");
    if (angemeldet !== "ja") console.log(`  Anmeldung: ${angemeldet} — die Messung zeigt nur das Anmeldeformular.`);

    for (const [name, pfad] of SEITEN) {
      try {
        const antwort = await page.goto(`http://localhost:${PORT}${pfad}`, { waitUntil: "networkidle2", timeout: 25000 });
        await new Promise((r) => setTimeout(r, 400));
        // 404 FAELLT SONST NICHT AUF (30.09.2026): Eine Seite, die es nicht
        // gibt, hat keine Tippziele und keinen Ueberlauf — sie sieht im
        // Bericht "sauber" aus. Zwei Adressen in dieser Liste waren falsch,
        // und beide Seiten galten vier Messungen lang als in Ordnung.
        const status = antwort && antwort.status ? antwort.status() : 0;
        if (status >= 400) {
          console.log(`${g.name} ${name}: HTTP ${status} — diese Adresse gibt es nicht, nichts gemessen.`);
          bericht.push({ geraet: g.name, seite: name, pfad, fehler: `HTTP ${status} — Adresse gibt es nicht` });
          continue;
        }
        const mass = await page.evaluate(MESSEN);
        await page.screenshot({ path: path.join(ORDNER, `${g.name}-${name}.png`), fullPage: true });
        bericht.push({ geraet: g.name, seite: name, pfad, ...mass });
        const warn = mass.ueberlauf > 0 ? ` ⚠️ ${mass.ueberlauf}px zu breit` : "";
        console.log(`${g.name} ${name}${warn}${mass.kleineGesamt ? ` · ${mass.kleineGesamt} kleine Tippziele` : ""}`);
      } catch (e) {
        console.log(`${g.name} ${name}: FEHLER ${String(e.message).slice(0, 70)}`);
        bericht.push({ geraet: g.name, seite: name, pfad, fehler: String(e.message).slice(0, 120) });
      }
    }
    await page.close();
  }

  fs.writeFileSync(path.join(ORDNER, "bericht.json"), JSON.stringify(bericht, null, 1));
  const kaputt = bericht.filter((b) => b.ueberlauf > 0 || b.fehler);
  console.log(`\n${bericht.length} Aufnahmen in ${ORDNER}`);
  console.log(kaputt.length ? `${kaputt.length} Seite(n) mit Problemen:` : "Kein waagerechtes Scrollen gefunden.");
  for (const b of kaputt) {
    console.log(`  ${b.geraet} ${b.seite}: ${b.fehler || b.ueberlauf + "px zu breit"}`);
    for (const r of b.rausragend || []) console.log(`      ${r}`);
  }
  await browser.close();
  aufraeumen();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
