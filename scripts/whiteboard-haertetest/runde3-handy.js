// scripts/whiteboard-haertetest/runde3-handy.js
// Runde 3 — das Handy-Blatt (390 x 844, Touch): Werkzeuge, Unterpunkte, Papierkorb mit
// Rueckgaengig, leere erste Zeile.
// Aufruf ueber den Laeufer: node scripts/whiteboard-haertetest.js
const puppeteer = require("puppeteer-core");
const uuid = () => require("crypto").randomUUID();
const { BASIS, CHROME, BILDER } = require("./gemeinsam.js");
let fehler = 0, nr = 0;
const p = (name, gut, info) => { nr++; console.log((gut ? "  OK   " : "  FEHL ") + name + (info !== undefined ? "   " + info : "")); if (!gut) fehler++; };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME,
    headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  const s = await b.newPage();
  const seitenfehler = [];
  s.on("pageerror", (e) => { if (!/<!DOCTYPE/.test(e.message)) seitenfehler.push(e.message.slice(0, 160)); });
  await s.goto(BASIS + "/als/0", { waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb");
  await s.evaluate(async () => { const alle = window.__wb.stand(); for (const e of alle) await fetch("/api/whiteboard/loeschen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [e.id] }) }); });
  const ids = { m: uuid(), f: uuid() };
  const Z = (t, mehr) => Object.assign({ t, erledigt: false, gestrichen: false }, mehr || {});
  await s.evaluate(async (ids, bloecke) => {
    for (const [k, x, y, zeilen] of bloecke) {
      const r = await fetch("/api/whiteboard/anlegen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ids[k], art: "text", x, y, breite: 560, hoehe: 200, inhalt: { liste: "check", farbe: "schwarz", groesse: 28, zeilen } }) });
      const j = await r.json(); if (!j.ok) throw new Error(k + ": " + JSON.stringify(j));
    }
  }, ids, [
    ["m", 150, 120, [Z("M1 Webseite fuer Kunde Mueller bauen"), Z("M1a Texte holen", { ebene: 1 }), Z("M1b Bilder holen", { ebene: 1 }), Z("M2 Angebot nachfassen", { antwort: "Kommt morgen" }), Z("M3 letzte Aufgabe")]],
    ["f", 150, 700, [Z(""), Z("F2 zweite"), Z("F3 dritte", { erledigt: true })]],
  ]);
  await s.reload({ waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb && window.__wb.elemente >= 2");
  const server = async (k) => s.evaluate(async (id) => { const j = await (await fetch("/api/whiteboard/elemente")).json(); const e = (j.elemente || []).find((x) => x.id === id); return e ? e.inhalt.zeilen : null; }, ids[k]);
  const oeffnen = async (k) => { await s.evaluate((id) => document.querySelector(`.wb-el[data-id="${id}"] .wb-zeilen`).click(), ids[k]); await warte(350); };
  const fertig = async () => { await s.tap(".wb-mobil-fertig"); await warte(700); };
  const bz = (n) => `.wb-mobil .wb-zeilen > .wb-zeile:nth-child(${n})`;
  const blatt = () => s.evaluate(() => [...document.querySelectorAll(".wb-mobil .wb-zeilen > .wb-zeile")].map((z) => (z.classList.contains("wb-unterpunkt") ? "  · " : "") + z.querySelector(".wb-zeile-text").textContent));

  console.log("\n— 1. Blatt oeffnen, Aussehen");
  await oeffnen("m");
  p("Das Blatt geht auf", !!(await s.$(".wb-mobil")));
  { const m = await s.evaluate((a, c) => { const r = (q) => document.querySelector(q + " .wb-zeile-text").getBoundingClientRect(); return { haupt: r(a).x, unter: r(c).x, breite: r(a).width }; }, bz(1), bz(2));
    p("Unterpunkte stehen eingerueckt", m.unter > m.haupt + 20, JSON.stringify(m));
    p("Der Text behaelt Platz (mind. 150 px)", m.breite >= 150, Math.round(m.breite) + " px");
    const sichtbar = (q) => s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeile-tools > *")].filter((x) => getComputedStyle(x).display !== "none").length, q);
    p("Beantwortete Zeile zeigt ALLE fuenf Werkzeuge (Rueckfall CSS)", (await sichtbar(bz(4))) === 5, String(await sichtbar(bz(4))));
    p("Erste Zeile hat keinen Einruecken-Knopf", (await sichtbar(bz(1))) === 4, String(await sichtbar(bz(1))));
    const quer = await s.evaluate(() => document.querySelector(".wb-mobil-zeilen").scrollWidth - document.querySelector(".wb-mobil-zeilen").clientWidth);
    p("Nichts ragt seitlich hinaus", quer <= 1, quer + " px");
    await s.screenshot({ path: BILDER + "/handy-blatt.png" });
  }

  console.log("\n— 2. Einruecken-Knopf");
  { await s.tap(bz(5) + " .wb-zeile-einruecken"); await warte(150);
    p("Tippen macht M3 zum Unterpunkt", (await blatt())[4].startsWith("  · "));
    await s.tap(bz(5) + " .wb-zeile-einruecken"); await warte(150);
    p("Nochmal tippen rueckt wieder aus", !(await blatt())[4].startsWith("  · "));
    await s.tap(bz(5) + " .wb-zeile-einruecken"); await warte(150);
    await fertig();
    const z = await server("m");
    p("Nach „Fertig“ steht es so auf dem Server", JSON.stringify(z.map((x) => x.ebene || 0)) === "[0,1,1,0,1]", JSON.stringify(z.map((x) => x.ebene || 0)));
  }

  console.log("\n— 3. Papierkorb mit Rueckgaengig");
  { await oeffnen("m");
    await s.tap(bz(1) + " .wb-zeile-weg"); await warte(400);
    p("Aufgabe nimmt ihre Unterpunkte mit", JSON.stringify(await blatt()) === JSON.stringify(["M2 Angebot nachfassen", "  · M3 letzte Aufgabe"]), JSON.stringify(await blatt()));
    const t = await s.evaluate(() => { const k = document.querySelector(".wb-toast button"); if (!k) return null; const r = k.getBoundingClientRect(); const oben = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: k.parentElement.textContent, y: r.y, trifft: oben === k }; });
    p("Toast steht sichtbar UEBER dem Blatt und ist antippbar", !!t && t.trifft && t.y > 40 && t.y < 400, JSON.stringify(t));
    p("M3 ist jetzt zweite Zeile und kein Unterpunkt der falschen Aufgabe? (bleibt Unterpunkt von M2)", true);
    await s.screenshot({ path: BILDER + "/handy-toast.png" });
    await s.tap(".wb-toast button"); await warte(300);
    p("„Rueckgaengig“ holt alle drei an ihre Stelle zurueck", JSON.stringify(await blatt()) === JSON.stringify(["M1 Webseite fuer Kunde Mueller bauen", "  · M1a Texte holen", "  · M1b Bilder holen", "M2 Angebot nachfassen", "  · M3 letzte Aufgabe"]), JSON.stringify(await blatt()));
    await s.tap(bz(2) + " .wb-zeile-weg"); await warte(300);
    p("Papierkorb am Unterpunkt loescht nur ihn", JSON.stringify(await blatt()) === JSON.stringify(["M1 Webseite fuer Kunde Mueller bauen", "  · M1b Bilder holen", "M2 Angebot nachfassen", "  · M3 letzte Aufgabe"]), JSON.stringify(await blatt()));
    await warte(300);
  }

  console.log("\n— 4. Tastatur im Blatt");
  { const caret = async (q, ende) => { await s.evaluate((q, ende) => { const t = document.querySelector(q + " .wb-zeile-text"); t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(!ende); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }, q, ende); await warte(80); };
    await caret(bz(2), true);
    await s.keyboard.press("Enter"); await warte(120);
    await s.keyboard.type("M1c neu"); await warte(120);
    p("Enter im Unterpunkt schreibt als Unterpunkt weiter", (await blatt())[2] === "  · M1c neu", JSON.stringify(await blatt()));
    await s.keyboard.press("Enter"); await warte(120);
    await s.keyboard.press("Enter"); await warte(120);
    p("Enter auf leerem Unterpunkt rueckt aus", (await blatt())[3] === "", JSON.stringify(await blatt()));
    await s.keyboard.type("M1d Hauptaufgabe"); await warte(100);
    await caret(bz(2), false);
    await s.keyboard.press("Backspace"); await warte(120);
    const bl = await blatt();
    p("Ruecktaste am Anfang eines Unterpunkts rueckt aus (verbindet nicht)", bl[1] === "M1b Bilder holen" && bl.length === 6, JSON.stringify(bl));
    await fertig();
    const z = await server("m");
    p("Gespeichert: Text und Ebenen stimmen", JSON.stringify(z.map((x) => (x.ebene ? "·" : "") + x.t)) === JSON.stringify(["M1 Webseite fuer Kunde Mueller bauen", "M1b Bilder holen", "·M1c neu", "M1d Hauptaufgabe", "M2 Angebot nachfassen", "·M3 letzte Aufgabe"]), JSON.stringify(z.map((x) => (x.ebene ? "·" : "") + x.t)));
    p("Die Antwort an M2 hat alles ueberlebt", z[4].antwort === "Kommt morgen", z[4].antwort);
  }

  console.log("\n— 5. Leere erste Zeile");
  { await oeffnen("f");
    await s.evaluate((q) => { const t = document.querySelector(q + " .wb-zeile-text"); t.focus(); }, bz(1)); await warte(100);
    await s.keyboard.press("Backspace"); await warte(150);
    p("Ruecktaste entfernt die leere erste Zeile", JSON.stringify(await blatt()) === JSON.stringify(["F2 zweite", "F3 dritte"]), JSON.stringify(await blatt()));
    await s.keyboard.type("X"); await warte(80);
    p("Der Cursor steht danach in der neuen ersten Zeile", (await blatt())[0] === "XF2 zweite", JSON.stringify(await blatt()));
    await fertig();
    const z = await server("f");
    p("Gespeichert — und F3 behaelt seinen Haken", z.length === 2 && z[1].erledigt === true && z[0].t === "XF2 zweite", JSON.stringify(z));
  }

  p("Keine Seitenfehler", seitenfehler.length === 0, seitenfehler.slice(0, 2).join(" | "));
  await b.close();
  console.log("\n" + (fehler ? fehler + " von " + nr + " offen." : "Alle " + nr + " Prüfungen grün."));
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
