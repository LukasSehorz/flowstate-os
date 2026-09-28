// scripts/whiteboard-haertetest/runde4-zeilenwahl.js
// Runde 4 — mehrere Zeilen markieren (Wunsch Lukas, 28.09.2026): Umschalt+Klick,
// Umschalt+Pfeil, Ziehen mit gedrueckter Maustaste, markiertes Loeschen — und der
// gemeldete Fehler, dass Umschalt+Klick INNERHALB einer umbrochenen Zeile keinen
// Text markierte.
// Aufruf ueber den Laeufer: node scripts/whiteboard-haertetest.js 4
const uuid = () => require("crypto").randomUUID();
const { BASIS, CHROME, BILDER } = require("./gemeinsam.js");
const puppeteer = require("puppeteer-core");
let fehler = 0, nr = 0;
const p = (name, gut, info) => { nr++; console.log((gut ? "  OK   " : "  FEHL ") + name + (info !== undefined ? "   " + info : "")); if (!gut) fehler++; };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--no-sandbox"], defaultViewport: { width: 1600, height: 1000 } });
  const s = await b.newPage();
  const seitenfehler = [];
  s.on("pageerror", (e) => { if (!/<!DOCTYPE/.test(e.message)) seitenfehler.push(e.message.slice(0, 160)); });
  await s.goto(BASIS + "/als/0", { waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb");
  await s.evaluate(async () => { for (const e of window.__wb.stand()) await fetch("/api/whiteboard/loeschen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [e.id] }) }); });

  const ids = { liste: uuid(), lang: uuid() };
  const Z = (t, mehr) => Object.assign({ t, erledigt: false, gestrichen: false }, mehr || {});
  // Der lange Text ist Lukas' Fall: eine Zeile, die ueber drei Bildschirmzeilen laeuft.
  const LANG = "Moderna Wohnbau: entscheiden, ob wir es machen wenn wir es machen:- Die Ads zusammenschneiden - Google-Drive-Ordner anschauen - Warten auf Feedback von denen, um die Creative Strategie auszuarbeiten";
  await s.evaluate(async (ids, LANG) => {
    const anlegen = (id, x, y, zeilen, breite) => fetch("/api/whiteboard/anlegen", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, art: "text", x, y, breite: breite || 620, hoehe: 220, inhalt: { liste: "check", farbe: "schwarz", groesse: 28, zeilen } }) });
    const Z = (t, mehr) => Object.assign({ t, erledigt: false, gestrichen: false }, mehr || {});
    await anlegen(ids.liste, 150, 150, [
      Z("A1 YUS Cosmetics"), Z("A2 SGB Steuerungstechnik"), Z("A3 Metaks GmbH"),
      Z("A3a Unterpunkt dazu", { ebene: 1 }),
      Z("A4 Passecker Gartentechnik"), Z("A5 Peter Schnock GmbH"), Z("A6 Team Bau Thomas Pittl")]);
    await anlegen(ids.lang, 150, 700, [Z(LANG), Z("Zweite Zeile darunter")], 700);
  }, ids, LANG);
  await s.reload({ waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb && window.__wb.elemente >= 2");

  const sel = (k) => `.wb-el[data-id="${ids[k]}"]`;
  const zSel = (k, n) => `${sel(k)} .wb-zeilen > .wb-zeile:nth-child(${n})`;
  const box = async (q) => { const h = await s.$(q); return h ? h.boundingBox() : null; };
  const gewaehlt = (k) => s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")]
    .map((z, i) => z.classList.contains("wb-zeile-gewaehlt") ? i : -1).filter((i) => i >= 0), sel(k));
  const zeilenVon = async (k) => { const e = (await s.evaluate(() => window.__wb.stand())).find((x) => x.id === ids[k]); return e ? e.zeilen : null; };
  const klickIn = async (k, n, dx) => { const r = await box(zSel(k, n) + " .wb-zeile-text"); await s.mouse.click(r.x + (dx || 30), r.y + r.height / 2); await warte(220); };
  const raus = async () => { await s.mouse.click(1400, 950); await warte(250); };

  console.log("\n— 1. Umschalt+Klick markiert von…bis (wie in einer Tabelle)");
  await klickIn("liste", 7);                       // in A6 (letzte)
  { const r = await box(zSel("liste", 5) + " .wb-zeile-text");   // bis A4
    await s.keyboard.down("Shift"); await s.mouse.click(r.x + 30, r.y + r.height / 2); await s.keyboard.up("Shift");
    await warte(300);
    const g = await gewaehlt("liste");
    p("A4 bis A6 sind markiert", JSON.stringify(g) === "[4,5,6]", JSON.stringify(g));
    const kanten = await s.evaluate((q) => { const z = [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")];
      return { erste: z.findIndex((x) => x.classList.contains("wb-zeile-gewaehlt-erste")), letzte: z.findIndex((x) => x.classList.contains("wb-zeile-gewaehlt-letzte")) }; }, sel("liste"));
    p("Kante nur oben und unten (ein Block, kein Stapel)", kanten.erste === 4 && kanten.letzte === 6, JSON.stringify(kanten));
  }

  console.log("\n— 2. Umschalt+Pfeil erweitert und verkleinert");
  { await s.keyboard.down("Shift"); await s.keyboard.press("ArrowUp"); await s.keyboard.up("Shift"); await warte(250);
    p("Umschalt+Hoch nimmt A3 dazu", JSON.stringify(await gewaehlt("liste")) === "[3,4,5,6]", JSON.stringify(await gewaehlt("liste")));
    await s.keyboard.down("Shift"); await s.keyboard.press("ArrowDown"); await s.keyboard.up("Shift"); await warte(250);
    p("Umschalt+Runter nimmt sie wieder weg", JSON.stringify(await gewaehlt("liste")) === "[4,5,6]", JSON.stringify(await gewaehlt("liste")));
  }

  console.log("\n— 3. Markiertes löschen, mit Rückgängig");
  { await s.keyboard.press("Delete"); await warte(500);
    const z = await zeilenVon("liste");
    p("Die drei markierten Zeilen sind weg", z && z.length === 4 && !z.some((x) => /A4|A5|A6/.test(x)), JSON.stringify(z));
    const toast = await s.evaluate(() => { const t = document.querySelector(".wb-toast"); return t ? t.textContent : ""; });
    p("Toast meldet es und bietet Rückgängig", /3 Zeilen gelöscht/.test(toast) && /Rückgängig/.test(toast), toast);
    await s.evaluate(() => document.querySelector(".wb-toast button").click()); await warte(500);
    const z2 = await zeilenVon("liste");
    p("Rückgängig holt alle drei zurück", z2 && z2.length === 7, JSON.stringify(z2 && z2.length));
  }

  console.log("\n— 4. Aufgabe nimmt ihre Unterpunkte mit");
  { await raus(); await klickIn("liste", 3);                    // A3 (hat Unterpunkt A3a)
    await s.keyboard.down("Shift"); await s.keyboard.press("ArrowUp"); await s.keyboard.up("Shift"); await warte(250);
    // markiert: A2..A3 — der Unterpunkt A3a haengt darunter und muss mit
    await s.keyboard.press("Delete"); await warte(500);
    const z = await zeilenVon("liste");
    p("A2, A3 und der Unterpunkt sind zusammen weg", z && !z.some((x) => /A2|A3/.test(x)), JSON.stringify(z));
    await s.evaluate(() => { const b = document.querySelector(".wb-toast button"); if (b) b.click(); }); await warte(500);
  }

  console.log("\n— 5. Ziehen mit gedrückter Maustaste");
  { await raus(); await warte(200);
    await klickIn("liste", 6);
    const a = await box(zSel("liste", 6) + " .wb-zeile-text");
    const c = await box(zSel("liste", 4) + " .wb-zeile-text");
    await s.mouse.move(a.x + 40, a.y + a.height / 2); await s.mouse.down();
    await s.mouse.move(c.x + 40, c.y + c.height / 2, { steps: 12 }); await warte(250);
    await s.mouse.up(); await warte(300);
    const g = await gewaehlt("liste");
    p("Ziehen markiert den überfahrenen Bereich", g.length === 3 && g[0] === 3 && g[2] === 5, JSON.stringify(g));
    await raus();
    p("Klick daneben hebt die Markierung auf", (await gewaehlt("liste")).length === 0);
  }

  console.log("\n— 6. Lukas' gemeldeter Fehler: Umschalt+Klick IN einer umbrochenen Zeile markiert TEXT");
  { const r = await box(zSel("lang", 1) + " .wb-zeile-text");
    // In die erste Bildschirmzeile klicken (oben), dann mit Umschalt weiter unten
    await s.mouse.click(r.x + 250, r.y + 12); await warte(250);
    await s.keyboard.down("Shift"); await s.mouse.click(r.x + 120, r.y + r.height - 12); await s.keyboard.up("Shift");
    await warte(300);
    const m = await s.evaluate(() => { const sel = window.getSelection(); return { text: String(sel), leer: sel.isCollapsed }; });
    p("Es ist wirklich Text markiert (nicht nichts)", !m.leer && m.text.length > 10, JSON.stringify(m.text.slice(0, 40)));
    p("Die Markierung bleibt IN der Zeile (keine Zeilenauswahl)", (await gewaehlt("lang")).length === 0, JSON.stringify(await gewaehlt("lang")));
    const teil = await s.evaluate(() => String(window.getSelection()));
    p("Der markierte Text stammt aus der langen Zeile", /machen|Ads|Drive|Feedback|Strategie/.test(teil), teil.slice(0, 50));
  }

  console.log("\n— 7. Über die Zeilengrenze hinweg werden ZEILEN markiert");
  { const r = await box(zSel("lang", 1) + " .wb-zeile-text");
    await s.mouse.click(r.x + 100, r.y + 12); await warte(250);
    const r2 = await box(zSel("lang", 2) + " .wb-zeile-text");
    await s.keyboard.down("Shift"); await s.mouse.click(r2.x + 60, r2.y + r2.height / 2); await s.keyboard.up("Shift");
    await warte(300);
    p("Beide Zeilen sind als Zeilen markiert", JSON.stringify(await gewaehlt("lang")) === "[0,1]", JSON.stringify(await gewaehlt("lang")));
    await s.keyboard.press("Escape"); await warte(250);
    p("Escape hebt auf", (await gewaehlt("lang")).length === 0);
    await raus();
  }

  console.log("\n— 8. Umschalt+Enter macht einen Stichpunkt (Wunsch 28.09.2026)");
  { await raus(); await warte(200);
    // In A1 ans Ende, dann Umschalt+Enter -> die neue Zeile ist ein Unterpunkt
    const r = await box(zSel("liste", 1) + " .wb-zeile-text");
    await s.mouse.click(r.x + r.width - 8, r.y + r.height / 2); await warte(250);
    await s.evaluate((q) => { const sp = document.querySelector(q + " .wb-zeile-text");
      const rr = document.createRange(); rr.selectNodeContents(sp); rr.collapse(false);
      const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rr); }, zSel("liste", 1));
    await warte(150);
    await s.keyboard.down("Shift"); await s.keyboard.press("Enter"); await s.keyboard.up("Shift"); await warte(200);
    await s.keyboard.type("Stichpunkt eins"); await warte(400);
    const ebenen = await s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")]
      .map((z) => z.classList.contains("wb-unterpunkt") ? 1 : 0), sel("liste"));
    p("Umschalt+Enter erzeugt einen Unterpunkt", ebenen[1] === 1, JSON.stringify(ebenen.slice(0, 4)));
    // Und Enter allein macht weiterhin eine normale Aufgabe
    await s.keyboard.press("Enter"); await warte(200);
    await s.keyboard.type("Normale Aufgabe"); await warte(400);
    const e2 = await s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")]
      .map((z) => z.classList.contains("wb-unterpunkt") ? 1 : 0), sel("liste"));
    p("Enter unter einem Stichpunkt bleibt Stichpunkt (Gliederung laeuft weiter)", e2[2] === 1, JSON.stringify(e2.slice(0, 4)));
    await raus(); await warte(300);
    const z = await zeilenVon("liste");
    p("Beides ist gespeichert", z && /Stichpunkt eins/.test(z.join("|")) && /Normale Aufgabe/.test(z.join("|")), JSON.stringify(z && z.length));
  }

  console.log("\n— 9. Nichts Kaputtes");
  { const z = await zeilenVon("lang");
    p("Der lange Text ist unversehrt", z && z[0].includes("Creative Strategie auszuarbeiten"), z ? z[0].slice(-30) : "");
    await s.reload({ waitUntil: "networkidle2" });
    await s.waitForFunction("window.__wb && window.__wb.elemente >= 2");
    const nach = await zeilenVon("liste");
    // 7 vom Anfang + die zwei aus Abschnitt 8 (Stichpunkt, normale Aufgabe)
    p("Nach dem Neuladen steht alles noch", nach && nach.length === 9, JSON.stringify(nach && nach.length));
    const ebenenNach = await s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")]
      .map((z) => z.classList.contains("wb-unterpunkt") ? 1 : 0), sel("liste"));
    p("Auch die Stichpunkte haben das Neuladen überlebt", ebenenNach[1] === 1 && ebenenNach[2] === 1, JSON.stringify(ebenenNach));
    p("Keine Seitenfehler", seitenfehler.length === 0, seitenfehler.slice(0, 2).join(" | "));
    await s.screenshot({ path: BILDER + "/zeilenwahl.png" });
  }

  await b.close();
  console.log("\n" + (fehler ? fehler + " von " + nr + " offen." : "Alle " + nr + " Prüfungen grün."));
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
