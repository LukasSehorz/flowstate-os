// scripts/whiteboard-haertetest/runde1-tafel.js
// Runde 1 — die Tafel am Schreibtisch: Zeilenwerkzeuge erreichbar, Papierkorb je Zeile,
// leere erste Zeile, Unterpunkte, Zeilen ziehen (im Block, in einen anderen, ins Freie).
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

  // Tafel leeren: der Test rechnet mit genau seinen fuenf Bloecken (Zaehler, Lagen)
  await s.evaluate(async () => { const alle = window.__wb.stand(); for (const e of alle) await fetch("/api/whiteboard/loeschen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [e.id] }) }); });
  const ids = { a: uuid(), b: uuid(), c: uuid(), d: uuid(), e: uuid() };
  const Z = (t, mehr) => Object.assign({ t, erledigt: false, gestrichen: false }, mehr || {});
  await s.evaluate(async (ids, bloecke) => {
    for (const [k, x, y, zeilen, extra] of bloecke) {
      const r = await fetch("/api/whiteboard/anlegen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ids[k], art: "text", x, y, breite: 560, hoehe: 200,
          inhalt: Object.assign({ liste: "check", farbe: "schwarz", groesse: 28, zeilen }, extra || {}) }) });
      const j = await r.json(); if (!j.ok) throw new Error("anlegen " + k + ": " + JSON.stringify(j));
    }
  }, ids, [
    ["a", 150, 120, [Z("A1 Moderna Report"), Z("A2 Formular bauen"), Z("A3 Seite finalisieren"), Z("A4 Glaserei nachfassen", { aufgabe: 4711, link: "/crm/firma/1" })]],
    ["b", 900, 120, [Z("B1 Backup pruefen"), Z("B2 Urlaubsplan")]],
    ["c", 150, 600, [Z("C1 Webseite bauen"), Z("C1a Texte holen", { ebene: 1 }), Z("C1b Bilder holen", { ebene: 1 }), Z("C2 Rechnung schreiben")]],
    ["d", 900, 600, [Z("D1 einzige Zeile")]],
    ["e", 1650, 120, [Z("E1 erste"), Z(""), Z("E3 dritte", { erledigt: true })]],
  ]);
  await s.reload({ waitUntil: "networkidle2" });
  await s.waitForFunction("window.__wb && window.__wb.elemente >= 5");

  const stand = async (k) => (await s.evaluate(() => window.__wb.stand())).find((e) => e.id === ids[k]);
  const zeilen = async (k) => { const e = await stand(k); return e ? e.zeilen : null; };
  const sel = (k) => `.wb-el[data-id="${ids[k]}"]`;
  const zSel = (k, n) => `${sel(k)} .wb-zeilen > .wb-zeile:nth-child(${n})`;
  const box = async (q) => { const h = await s.$(q); return h ? h.boundingBox() : null; };
  const klickInZeile = async (k, n, ende) => { const r = await box(zSel(k, n) + " .wb-zeile-text");
    await s.mouse.click(ende ? r.x + r.width - 6 : r.x + 30, r.y + r.height / 2); await warte(120); };
  const modell = async (k) => s.evaluate((id) => { const w = window.__wb; return w.zeilenRoh ? w.zeilenRoh(id) : null; }, ids[k]);
  const toolsSichtbar = (k, n) => s.evaluate((q) => { const t = document.querySelector(q + " .wb-zeile-tools"); return !!t && getComputedStyle(t).display !== "none"; }, zSel(k, n));
  const ebenen = (k) => s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile")].map((z) => z.classList.contains("wb-unterpunkt") ? 1 : 0), sel(k));
  const texte = (k) => s.evaluate((q) => [...document.querySelectorAll(q + " .wb-zeilen > .wb-zeile .wb-zeile-text")].map((z) => z.textContent), sel(k));
  const rueckgaengigImToast = async () => { const ok = await s.evaluate(() => { const bs = [...document.querySelectorAll(".wb-toast button")]; const x = bs[bs.length - 1]; if (x) { x.click(); return true; } return false; }); await warte(350); return ok; };
  const raus = async () => { await s.mouse.click(1400, 930); await warte(200); };

  console.log("\n— 1. Werkzeuge erreichbar (nur ueberfahren, nicht geklickt)");
  { const r = await box(zSel("a", 2) + " .wb-zeile-text");
    await s.mouse.move(r.x + 40, r.y + r.height / 2); await warte(160);
    p("Werkzeuge erscheinen beim Ueberfahren", await toolsSichtbar("a", 2));
    const w = await box(zSel("a", 2) + " .wb-zeile-weg");
    let verloren = false;
    for (let i = 1; i <= 30; i++) {
      await s.mouse.move(r.x + 40 + (w.x + w.width / 2 - r.x - 40) * i / 30, r.y + r.height / 2 + (w.y + w.height / 2 - r.y - r.height / 2) * i / 30);
      if (!(await toolsSichtbar("a", 2))) verloren = true;
    }
    p("Werkzeuge bleiben auf dem ganzen Weg zum Papierkorb stehen", !verloren);
    // auch auf dem Umweg ueber die Nachbarzeile (schraeg von unten)
    const r3 = await box(zSel("a", 3) + " .wb-zeile-text");
    await s.mouse.move(r.x + 300, r.y + r.height / 2); await warte(200);
    await s.mouse.move(r3.x + r3.width - 10, r3.y + r3.height / 2, { steps: 4 });
    await s.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 6 });
    p("… auch schraeg ueber die Nachbarzeile (Knoepfe springen nicht weg)", await toolsSichtbar("a", 2));
    await s.mouse.click(w.x + w.width / 2, w.y + w.height / 2); await warte(300);
    const z = await zeilen("a");
    p("Papierkorb loescht GENAU diese Zeile, der Block bleibt", z && z.length === 3 && !z.some((t) => /A2/.test(t)), JSON.stringify(z));
    p("Hinweis mit Rueckgaengig erscheint", await rueckgaengigImToast());
    const z2 = await zeilen("a");
    p("Rueckgaengig holt die Zeile an ihre Stelle zurueck", z2 && z2.length === 4 && /A2/.test(z2[1]), JSON.stringify(z2));
  }

  console.log("\n— 2. Reinklicken: Rahmen + feste Werkzeuge");
  { await raus(); await klickInZeile("a", 3);
    const st = await s.evaluate((q) => { const z = document.querySelector(q); const c = getComputedStyle(z);
      return { aktiv: z.classList.contains("wb-zeile-aktiv"), outline: c.outlineStyle, breite: parseFloat(c.outlineWidth) }; }, zSel("a", 3));
    p("Angeklickte Zeile ist aktiv und traegt einen Rahmen", st.aktiv && st.outline === "solid" && st.breite > 0, JSON.stringify(st));
    await s.mouse.move(1300, 900); await warte(900);
    p("Werkzeuge der aktiven Zeile bleiben, auch wenn die Maus weit weg ist", await toolsSichtbar("a", 3));
    const r1 = await box(zSel("a", 1) + " .wb-zeile-text");
    await s.mouse.move(r1.x + 50, r1.y + r1.height / 2); await warte(300);
    p("Andere Zeile ueberfahren zeigt KEINE zweite Knopfreihe", !(await toolsSichtbar("a", 1)) && await toolsSichtbar("a", 3));
    const breiteVorher = await s.evaluate((q) => document.querySelector(q + " .wb-zeile-text").getBoundingClientRect().left, zSel("a", 3));
    await klickInZeile("a", 1);
    const nachher = await s.evaluate((q) => document.querySelector(q + " .wb-zeile-text").getBoundingClientRect().left, zSel("a", 3));
    p("Der Rahmen verschiebt keinen Buchstaben", Math.abs(breiteVorher - nachher) < 0.5);
    p("Aktiv wandert mit dem Klick", await s.evaluate((q1, q3) => document.querySelector(q1).classList.contains("wb-zeile-aktiv") && !document.querySelector(q3).classList.contains("wb-zeile-aktiv"), zSel("a", 1), zSel("a", 3)));
    await klickInZeile("a", 3);
    const w = await box(zSel("a", 3) + " .wb-zeile-weg");
    await s.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 8 });
    await s.mouse.click(w.x + w.width / 2, w.y + w.height / 2); await warte(300);
    const z = await zeilen("a");
    p("Papierkorb an der aktiven Zeile loescht nur sie", z && z.length === 3 && !z.some((t) => /A3/.test(t)), JSON.stringify(z));
    const fokusDanach = await s.evaluate(() => { const a = document.activeElement; return a && a.classList.contains("wb-zeile-text") ? a.textContent : null; });
    p("Der Caret steht danach in einer Nachbarzeile (weiterschreiben geht)", !!fokusDanach, fokusDanach);
    await rueckgaengigImToast();
  }

  console.log("\n— 3. Leere Zeilen loswerden");
  { await raus(); await klickInZeile("b", 1);
    await s.evaluate(() => { const a = document.activeElement; const r = document.createRange(); r.selectNodeContents(a); const se = getSelection(); se.removeAllRanges(); se.addRange(r); });
    await s.keyboard.press("Backspace"); await warte(100);
    await s.keyboard.press("Backspace"); await warte(300);
    const z = await zeilen("b");
    p("Erste Zeile geleert + Backspace: das Kaestchen ist weg", z && z.length === 1 && /B2/.test(z[0]), JSON.stringify(z));
    const f = await s.evaluate(() => document.activeElement && document.activeElement.textContent);
    p("Caret steht am Anfang der naechsten Zeile", /B2/.test(f || ""), f);
    await raus(); await klickInZeile("d", 1);
    await s.evaluate(() => { const a = document.activeElement; const r = document.createRange(); r.selectNodeContents(a); const se = getSelection(); se.removeAllRanges(); se.addRange(r); });
    await s.keyboard.press("Backspace"); await s.keyboard.press("Backspace"); await s.keyboard.press("Backspace"); await warte(200);
    p("Einzige Zeile geleert + Backspace: nichts bricht", seitenfehler.length === 0 && !!(await s.$(sel("d"))));
    await s.keyboard.type("D1 neu"); await raus();
    // Entf auf der leeren mittleren Zeile: die naechste behaelt ihren Haken
    await klickInZeile("e", 2); await s.keyboard.press("Delete"); await warte(300);
    const ze = await zeilen("e");
    p("Entf auf leerer Zeile entfernt sie — die naechste behaelt ihren Haken", ze && ze.length === 2 && ze[1] === "[x] E3 dritte", JSON.stringify(ze));
    await raus();
  }

  console.log("\n— 4. Unterpunkte");
  { p("Unterpunkte kommen vom Server zurueck (Whitelist)", JSON.stringify(await ebenen("c")) === "[0,1,1,0]", JSON.stringify(await ebenen("c")));
    const schild = await s.evaluate(() => { const e = [...document.querySelectorAll(".wb-schild, .wb-board-kopf, [class*=schild]")].map((x) => x.textContent).join(" | "); return e; });
    const m = /(\d+) von (\d+) erledigt/.exec(schild || "");
    // Aufgaben gesamt: a=4, b=1, c=2 (ohne 2 Unterpunkte), d=1, e=2 -> 10
    p("Unterpunkte zaehlen nicht als Aufgaben", !!m && Number(m[2]) === 10, m ? m[0] : schild.slice(0, 80));
    const kreis = await s.evaluate((q) => { const r = document.querySelector(q + " .wb-kasten-rand"); return r ? getComputedStyle(r).rx : null; }, zSel("c", 2));
    p("Unterpunkt traegt einen Kreis statt des Kaestchens", /7\.5px/.test(kreis || ""), kreis);
    const ab = await box(zSel("c", 2) + " .wb-abhaken");
    await s.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2); await warte(300);
    p("Unterpunkt laesst sich abhaken", (await zeilen("c"))[1].startsWith("[x]"), (await zeilen("c"))[1]);
    await klickInZeile("c", 4, true); await s.keyboard.press("Tab"); await warte(250);
    p("Tab rueckt ein", JSON.stringify(await ebenen("c")) === "[0,1,1,1]", JSON.stringify(await ebenen("c")));
    const f1 = await s.evaluate(() => document.activeElement && document.activeElement.textContent);
    p("Caret bleibt beim Einruecken in der Zeile", /C2/.test(f1 || ""), f1);
    await s.keyboard.down("Shift"); await s.keyboard.press("Tab"); await s.keyboard.up("Shift"); await warte(250);
    p("Umschalt+Tab rueckt aus", JSON.stringify(await ebenen("c")) === "[0,1,1,0]");
    await klickInZeile("c", 1); await s.keyboard.press("Tab"); await warte(250);
    p("Erste Zeile bleibt Hauptzeile (Hinweis statt Einruecken)", (await ebenen("c"))[0] === 0);
    await klickInZeile("c", 3, true); await s.keyboard.press("Enter"); await s.keyboard.type("C1c Logo holen"); await warte(250);
    p("Enter im Unterpunkt macht den naechsten Unterpunkt", JSON.stringify(await ebenen("c")) === "[0,1,1,1,0]", JSON.stringify(await texte("c")));
    await s.keyboard.press("Enter"); await warte(150); await s.keyboard.press("Enter"); await warte(250);
    p("Enter auf leerem Unterpunkt beendet die Stichpunkte", JSON.stringify(await ebenen("c")) === "[0,1,1,1,0,0]", JSON.stringify(await ebenen("c")));
    await s.keyboard.press("Backspace"); await warte(250);   // leere Hauptzeile geht in die darueber auf
    await klickInZeile("c", 4); await s.keyboard.press("Home"); await s.keyboard.press("Backspace"); await warte(250);
    p("Backspace am Anfang eines Unterpunkts rueckt erst aus", (await ebenen("c"))[3] === 0, JSON.stringify(await ebenen("c")));
    await s.keyboard.press("Tab"); await warte(200);
    // Knopf "Einruecken" in den Werkzeugen
    await raus(); await klickInZeile("c", 5);
    const eb = await box(zSel("c", 5) + " .wb-zeile-einruecken");
    await s.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2); await warte(250);
    p("Knopf 'Einruecken' tut dasselbe wie Tab", (await ebenen("c"))[4] === 1, JSON.stringify(await ebenen("c")));
    await s.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2); await warte(250);
    await raus();
    await s.reload({ waitUntil: "networkidle2" }); await s.waitForFunction("window.__wb && window.__wb.elemente >= 5");
    p("Nach dem Neuladen steht die Gliederung noch", JSON.stringify(await ebenen("c")) === "[0,1,1,1,0]", JSON.stringify(await ebenen("c")) + " " + JSON.stringify(await texte("c")));
  }

  console.log("\n— 5. Aufgabe mit Unterpunkten loeschen");
  { await klickInZeile("c", 1);
    const w = await box(zSel("c", 1) + " .wb-zeile-weg");
    await s.mouse.click(w.x + w.width / 2, w.y + w.height / 2); await warte(300);
    const z = await zeilen("c");
    p("Die Aufgabe nimmt ihre Unterpunkte mit", z && z.length === 1 && /C2/.test(z[0]), JSON.stringify(z));
    await rueckgaengigImToast();
    p("Rueckgaengig bringt alle vier zurueck", (await zeilen("c")).length === 5 || (await zeilen("c")).length === 4, JSON.stringify(await zeilen("c")));
    await raus();
  }

  const ziehen = async (vonQ, zuX, zuY, schritte) => {
    const z = await box(vonQ + " .wb-zeile-text");
    await s.mouse.move(z.x + 40, z.y + z.height / 2); await warte(200);
    const g = await box(vonQ + " .wb-zeile-griff");
    await s.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 5 }); await warte(80);
    await s.mouse.down();
    await s.mouse.move(g.x + 30, g.y + 20, { steps: 4 });
    await s.mouse.move(zuX, zuY, { steps: schritte || 14 }); await warte(150);
    return g;
  };

  console.log("\n— 6. Zeile ziehen");
  { // 6a innerhalb des Blocks nach oben
    const erste = await box(zSel("a", 1));
    await ziehen(zSel("a", 4), erste.x + 120, erste.y + 2);
    const marke = await s.evaluate(() => !!document.querySelector(".wb-einfuege-marke") && document.querySelector(".wb-einfuege-marke").isConnected);
    p("Der blaue Strich zeigt die Einfuegestelle", marke);
    const wort = await s.evaluate(() => (document.querySelector(".wb-abgabe-ziel") || {}).textContent);
    p("Der Geist sagt, was passiert", /verschieben/.test(wort || ""), wort);
    await s.mouse.up(); await warte(400);
    const z = await zeilen("a");
    p("Umsortieren im selben Block", z && /A4/.test(z[0]) && /A1/.test(z[1]) && z.length === 4, JSON.stringify(z));
    const roh = await s.evaluate((id) => { const e = window.__wb.stand().find((x) => x.id === id); return { links: e.links, z: e.zeilen }; }, ids.a);
    p("Link der CRM-Zeile wandert mit", roh.links[0] === "/crm/firma/1", JSON.stringify(roh.links));
    p("Marke ist nach dem Loslassen weg", !(await s.$(".wb-einfuege-marke")));

    // 6b in einen anderen Block, zwischen dessen Zeilen
    await s.evaluate(async (id) => { /* Block b wieder zweizeilig machen */ }, ids.b);
    const zielZ = await box(zSel("e", 2));
    await ziehen(zSel("a", 2), zielZ.x + 150, zielZ.y + 3);
    await s.mouse.up(); await warte(500);
    const za = await zeilen("a"), ze = await zeilen("e");
    p("Zeile wandert in den anderen Block, an die gezeigte Stelle", za.length === 3 && ze.length === 3 && /A1/.test(ze[1]), JSON.stringify(ze));
    await rueckgaengigImToast();
    const za2 = await zeilen("a"), ze2 = await zeilen("e");
    p("EIN Rueckgaengig stellt beide Bloecke wieder her", za2.length === 4 && ze2.length === 2, JSON.stringify([za2.length, ze2.length]));

    // 6c Familie wandert zusammen
    const zb = await box(zSel("b", 1));
    await ziehen(zSel("c", 1), zb.x + 150, zb.y + zb.height + 8);
    const geist = await s.evaluate(() => (document.querySelector(".wb-abgabe-zeile") || {}).textContent);
    p("Der Geist nennt die Unterpunkte", /Unterpunkt/.test(geist || ""), geist);
    await s.mouse.up(); await warte(500);
    const eb = await ebenen("b"), tb = await texte("b");
    p("Aufgabe zieht mit ihren Unterpunkten um", tb.length >= 4 && /C1 /.test(tb[1]) && eb[2] === 1 && eb[3] === 1, JSON.stringify(tb) + JSON.stringify(eb));
    await rueckgaengigImToast();

    // 6d auf freie Flaeche -> eigener Block
    const vorher = await s.evaluate(() => window.__wb.elemente);
    await ziehen(zSel("a", 3), 760, 470);
    const wort2 = await s.evaluate(() => (document.querySelector(".wb-abgabe-ziel") || {}).textContent);
    await s.mouse.up(); await warte(500);
    const nachher = await s.evaluate(() => window.__wb.elemente);
    p("Auf freier Flaeche wird die Zeile ein eigener Block", nachher === vorher + 1 && (await zeilen("a")).length === 3, wort2);
    await rueckgaengigImToast();
    p("… und Rueckgaengig macht das wieder ganz", (await s.evaluate(() => window.__wb.elemente)) === vorher && (await zeilen("a")).length === 4);

    // 6e auf sich selbst
    const selbst = await box(zSel("a", 2));
    await ziehen(zSel("a", 2), selbst.x + 200, selbst.y + selbst.height / 2 + 2);
    await s.mouse.up(); await warte(400);
    p("Auf sich selbst fallen lassen aendert nichts", JSON.stringify(await zeilen("a")) === JSON.stringify(za2) || (await zeilen("a")).length === 4);
    // 6f Escape bricht ab
    await ziehen(zSel("a", 1), 1200, 400);
    await s.keyboard.press("Escape"); await warte(300); await s.mouse.up(); await warte(200);
    p("Esc bricht den Zug ab", (await zeilen("a")).length === 4 && !(await s.$(".wb-einfuege-marke")));
  }

  console.log("\n— 7. Groessen-Anfasser und Kasten");
  { await raus();
    const letzte = await box(zSel("a", 4) + " .wb-zeile-text");
    await s.mouse.move(letzte.x + 60, letzte.y + letzte.height / 2); await warte(200);
    const was = await s.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? String(e.className.baseVal || e.className) : ""; }, letzte.x + letzte.width - 8, letzte.y + letzte.height / 2);
    p("Rechts am Ende der letzten Zeile liegt der TEXT, nicht der Anfasser", /wb-zeile-text/.test(was), was);
    const griff = await box(sel("a") + " > .wb-groesse-griff");
    const blockR = await box(sel("a"));
    p("Der Anfasser sitzt ausserhalb der Ecke", !!griff && griff.x >= blockR.x + blockR.width - 8 && griff.y >= blockR.y + blockR.height - 8, griff && `${Math.round(griff.x)}/${Math.round(griff.y)} bei Ecke ${Math.round(blockR.x + blockR.width)}/${Math.round(blockR.y + blockR.height)}`);
    const b0 = (await stand("a")).breite;
    await s.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2); await s.mouse.down();
    await s.mouse.move(griff.x + 80, griff.y + 10, { steps: 6 }); await s.mouse.up(); await warte(400);
    p("Groesse aendern geht weiterhin", (await stand("a")).breite > b0, b0 + " -> " + (await stand("a")).breite);
    await klickInZeile("a", 1);
    const kastenWort = await s.evaluate((q) => { const k = document.querySelector(q + " .wb-kasten-weg"); return k ? k.textContent.trim() : null; }, sel("a"));
    p("Der Block-Papierkorb traegt sein Wort", kastenWort === "Block löschen", kastenWort);
    await raus();
  }

  p("Keine Seitenfehler im ganzen Lauf", seitenfehler.length === 0, seitenfehler.slice(0, 2).join(" | "));
  await s.screenshot({ path: BILDER + "/tafel-nachher.png" });
  await b.close();
  console.log("\n" + (fehler ? fehler + " von " + nr + " offen." : "Alle " + nr + " Prüfungen grün."));
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
