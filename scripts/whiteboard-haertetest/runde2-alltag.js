// scripts/whiteboard-haertetest/runde2-alltag.js
// Runde 2 — Alltag und Rueckfall: mehrfach loeschen, Haftnotiz, eingeordneter Block,
// Abgabe an eine fremde Tafel (Randlauf).
// Aufruf ueber den Laeufer: node scripts/whiteboard-haertetest.js
const puppeteer = require("puppeteer-core");
const uuid = () => require("crypto").randomUUID();
const { BASIS, CHROME, BILDER } = require("./gemeinsam.js");
let fehler = 0, nr = 0;
const p = (name, gut, info) => { nr++; console.log((gut ? "  OK   " : "  FEHL ") + name + (info !== undefined ? "   " + info : "")); if (!gut) fehler++; };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME,
    headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 1600, height: 1000 } });
  const s = await b.newPage();
  const seitenfehler = [];
  s.on("pageerror", (e) => { if (!/<!DOCTYPE/.test(e.message)) seitenfehler.push(e.message.slice(0, 160)); });
  await s.goto(BASIS + "/als/0", { waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb");
  // Tafel leeren, damit die Lagen stimmen
  await s.evaluate(async () => { const alle = window.__wb.stand(); for (const e of alle) await fetch("/api/whiteboard/loeschen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [e.id] }) }); });
  const ids = { liste: uuid(), notiz: uuid(), kat: uuid(), quelle: uuid() };
  const Z = (t, mehr) => Object.assign({ t, erledigt: false, gestrichen: false }, mehr || {});
  await s.evaluate(async (ids, bloecke) => {
    for (const [k, art, x, y, inhalt] of bloecke) {
      const r = await fetch("/api/whiteboard/anlegen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ids[k], art, x, y, breite: art === "notiz" ? 360 : 560, hoehe: art === "notiz" ? 300 : 200, inhalt }) });
      const j = await r.json(); if (!j.ok) throw new Error(k + ": " + JSON.stringify(j));
    }
  }, ids, [
    ["liste", "text", 150, 120, { liste: "check", farbe: "schwarz", groesse: 28, zeilen: [Z("L1"), Z("L2"), Z("L3"), Z("L4"), Z("L5")] }],
    ["notiz", "notiz", 900, 120, { liste: "keine", farbe: "schwarz", groesse: 24, zettel: "gelb", zeilen: [Z("N1 Zettelzeile"), Z("N2 zweite"), Z("N3 dritte")] }],
    ["kat", "text", 150, 650, { liste: "check", farbe: "schwarz", groesse: 28, kategorie: "kunden", zeilen: [Z("K1 einzige Kundenaufgabe")] }],
    ["quelle", "text", 1500, 650, { liste: "check", farbe: "schwarz", groesse: 28, zeilen: [Z("Q1 bleibt"), Z("Q2 geht zu Jannik")] }],
  ]);
  await s.reload({ waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb && window.__wb.elemente >= 4");
  const stand = async (k) => (await s.evaluate(() => window.__wb.stand())).find((e) => e.id === ids[k]);
  const zeilen = async (k) => { const e = await stand(k); return e ? e.zeilen : null; };
  const sel = (k) => `.wb-el[data-id="${ids[k]}"]`;
  const zSel = (k, n) => `${sel(k)} .wb-zeilen > .wb-zeile:nth-child(${n})`;
  const box = async (q) => { const h = await s.$(q); return h ? h.boundingBox() : null; };
  const raus = async () => { await s.mouse.click(1400, 930); await warte(200); };

  console.log("\n— A. Mehrere Zeilen hintereinander loeschen, ohne die Maus zu bewegen");
  { const r = await box(zSel("liste", 2) + " .wb-zeile-text");
    await s.mouse.move(r.x + 40, r.y + r.height / 2); await warte(200);
    const w = await box(zSel("liste", 2) + " .wb-zeile-weg");
    await s.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 10 });
    for (let i = 0; i < 3; i++) { await s.mouse.down(); await s.mouse.up(); await warte(350); }
    const z = await zeilen("liste");
    p("Dreimal klicken loescht L2, L3, L4 — L1 und L5 bleiben", JSON.stringify(z) === JSON.stringify(["[ ] L1", "[ ] L5"]), JSON.stringify(z));
    await raus();
    await s.keyboard.down("Meta"); await s.keyboard.press("z"); await s.keyboard.up("Meta"); await warte(300);
    await s.keyboard.down("Control"); await s.keyboard.press("z"); await s.keyboard.up("Control"); await warte(300);
    const z2 = await zeilen("liste");
    p("Strg+Z holt geloeschte Zeilen zurueck", z2.length > 2, JSON.stringify(z2));
  }

  console.log("\n— B. Haftnotiz");
  { const t = await box(zSel("notiz", 2) + " .wb-zeile-text");
    await s.mouse.click(t.x + 20, t.y + t.height / 2); await warte(250);
    const aktiv = await s.evaluate((q) => document.querySelector(q).classList.contains("wb-zeile-aktiv"), zSel("notiz", 2));
    p("Zeile auf dem Zettel wird aktiv", aktiv);
    const w = await box(zSel("notiz", 2) + " .wb-zeile-weg");
    p("Werkzeuge stehen am Zettel", !!w);
    if (w) { await s.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 8 }); await s.mouse.down(); await s.mouse.up(); await warte(350); }
    const z = await zeilen("notiz");
    p("Papierkorb loescht die Zettelzeile", z && z.length === 2 && !z.some((x) => /N2/.test(x)), JSON.stringify(z));
    await raus();
  }

  console.log("\n— C. Eingeordneter Block: letzte Zeile loeschen");
  { const t = await box(zSel("kat", 1) + " .wb-zeile-text");
    await s.mouse.click(t.x + 20, t.y + t.height / 2); await warte(250);
    const w = await box(zSel("kat", 1) + " .wb-zeile-weg");
    await s.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 8 }); await s.mouse.down(); await s.mouse.up(); await warte(400);
    const e = await stand("kat");
    p("Der Kategorie-Block bleibt stehen (leer, mit Ueberschrift)", !!e && e.zeilen.length === 1 && e.zeilen[0].trim() === "[ ]", e ? JSON.stringify(e.zeilen) : "BLOCK WEG");
    await raus();
    p("… auch nach dem Verlassen", !!(await stand("kat")));
  }

  console.log("\n— D. Abgabe an eine fremde Tafel (Rueckfall)");
  { const z = await box(zSel("quelle", 2) + " .wb-zeile-text");
    await s.mouse.move(z.x + 30, z.y + z.height / 2); await warte(200);
    const g = await box(zSel("quelle", 2) + " .wb-zeile-griff");
    await s.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 4 }); await s.mouse.down();
    await s.mouse.move(g.x + 40, g.y - 30, { steps: 4 });
    // an den rechten Rand: die Wand faehrt mit, bis Janniks Tafel unter dem Zeiger liegt
    let wort = "";
    for (let i = 0; i < 80; i++) {
      await s.mouse.move(1592, 480 + (i % 2)); await warte(60);
      wort = await s.evaluate(() => (document.querySelector(".wb-abgabe-ziel") || {}).textContent || "");
      if (/^zu /.test(wort)) break;
    }
    p("Randlauf bringt die Nachbartafel unter den Zeiger", /^zu /.test(wort), wort);
    // noch ein Stueck weiterfahren, damit die Tafel wirklich im Bild liegt — sonst
    // laesst der Test im Spalt zwischen zwei Tafeln los (das war der Fehler im Test)
    for (let i = 0; i < 14; i++) { await s.mouse.move(1592, 480 + (i % 2)); await warte(60); }
    await s.mouse.move(1500, 480, { steps: 3 }); await warte(200);
    wort = await s.evaluate(() => (document.querySelector(".wb-abgabe-ziel") || {}).textContent || "");
    // liegt dort schon ein Block von mir (aus einem frueheren Lauf), heisst es zu Recht "in diesen Block"
    p("Ausserhalb der Randzone zeigt das Schild weiter auf die fremde Tafel", /^(zu |in diesen Block)/.test(wort), wort);
    await s.mouse.up(); await warte(600);
    const q = await zeilen("quelle");
    p("Zeile ist bei mir weg", q && q.length === 1 && /Q1/.test(q[0]), JSON.stringify(q));
    const drueben = await s.evaluate(() => window.__wb.stand ? null : null);
    const alle = await s.evaluate((ich) => { const out = []; for (const t of (window.WB_DATEN.team || [])) { if (t.id === ich) continue; for (const e of window.__wb.stand(t.id)) if (e.zeilen && e.zeilen.some((x) => /Q2 geht zu Jannik/.test(x))) out.push(t.name); } return out; }, await s.evaluate(() => window.__wb.ich));
    p("… und steht auf der fremden Tafel", alle.length === 1, alle.join(", ") || wort);
  }

  console.log("\n— E. Der Antwort-Chip haelt Abstand vom Text");
  {
    // Gemeldet am 18.09.2026 (Lukas): "Der orangene Pfeil rechts ist zu nah am
    // Text dran. Wenn ich alles rauskopieren will, verdeckt es immer die letzten
    // zwei Buchstaben." Ursache: Der Chip haelt sich ueber --wb-anti2
    // bildschirmgross, sein Abstand zum Wort wurde aber in Layout-px gerechnet
    // und schrumpfte beim Herauszoomen mit — in der Tafel-Ansicht auf 3,5 px.
    // Geprueft wird deshalb in BILDSCHIRM-px und bei mehreren Zoomstufen, und
    // zwar das, was Lukas wirklich tut: Zeile markieren und kopieren.
    const idC = uuid(), adresse = "https://github.com/jannikvomhofe83-tech/fliesen-weinhold";
    await s.evaluate(async (id, url) => {
      await fetch("/api/whiteboard/anlegen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, art: "text", x: 150, y: 1150, breite: 620, hoehe: 190,
          inhalt: { liste: "check", farbe: "schwarz", groesse: 28, zeilen: [
            { t: "Fliesen Weinhold Netflify + Google Drive -->", erledigt: false, gestrichen: false },
            { t: url, erledigt: false, gestrichen: false, link: url }] } }) });
    }, idC, adresse);
    await s.reload({ waitUntil: "networkidle2" });
    await s.waitForFunction("window.__wb");
    await warte(300);

    const messen = () => s.evaluate((id) => {
      const sp = document.querySelectorAll(`.wb-el[data-id="${id}"] .wb-zeile-text`)[1];
      sp.focus();
      const r = document.createRange(); r.selectNodeContents(sp);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const chip = document.querySelector(".wb-zeile-chip");
      const kaesten = r.getClientRects(); const letzte = kaesten[kaesten.length - 1];
      if (!chip || !letzte) return null;
      // Liegt ueber einem der letzten Zeichen ein Bedienelement?
      const verdeckt = [];
      for (const dx of [2, 8, 16, 24]) {
        const oben = document.elementFromPoint(letzte.right - dx, letzte.top + letzte.height / 2);
        const stoerer = oben && oben.closest && oben.closest(".wb-zeile-chip,.wb-zeile-link,.wb-zeile-tools");
        if (stoerer) verdeckt.push(dx + "px");
      }
      return { luecke: chip.getBoundingClientRect().left - letzte.right,
               zoom: window.__wb.ansicht.s, verdeckt, markiert: String(getSelection()) };
    }, idC);

    let m = await messen();
    p("Markiert ist die ganze Adresse", !!m && m.markiert === adresse, m ? JSON.stringify(m.markiert.slice(-20)) : "kein Chip");
    p("Der Chip haelt in der Tafel-Ansicht mind. 10 Bildschirm-px Abstand", !!m && m.luecke >= 10,
      m ? "Zoom " + m.zoom.toFixed(2) + ": " + m.luecke.toFixed(1) + " px" : "kein Chip");
    p("Nichts verdeckt die letzten Zeichen", !!m && m.verdeckt.length === 0, m ? (m.verdeckt.join(",") || "frei") : "");

    // Naeher heranfahren: der Abstand darf auch dort nicht zusammenfallen.
    await s.evaluate(() => document.activeElement.blur());
    await s.mouse.move(600, 400);
    for (let i = 0; i < 4; i++) { await s.mouse.wheel({ deltaY: -120 }); await warte(120); }
    await warte(300);
    m = await messen();
    p("… und auch nah herangezoomt", !!m && m.luecke >= 10 && m.verdeckt.length === 0,
      m ? "Zoom " + m.zoom.toFixed(2) + ": " + m.luecke.toFixed(1) + " px, " + (m.verdeckt.join(",") || "frei") : "kein Chip");
  }

  p("Keine Seitenfehler", seitenfehler.length === 0, seitenfehler.slice(0, 2).join(" | "));
  await b.close();
  console.log("\n" + (fehler ? fehler + " von " + nr + " offen." : "Alle " + nr + " Prüfungen grün."));
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
