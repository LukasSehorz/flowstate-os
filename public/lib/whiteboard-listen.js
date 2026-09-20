// public/lib/whiteboard-listen.js — die Listen-Tafeln "Kunden" und "Leads".
//
// Seit dem 14.09.2026 haengen sie IN der Wand: whiteboard.js baut die beiden
// Tafeln (Rahmen, Schild, Platz unter den Personen-Tafeln, Pfeile) und legt je
// ein leeres .wb-liste-mount hinein. Diese Datei fuellt es — Zeilen mit einer
// Firma aus dem CRM, einer Notiz, einem freien Preis und "bezahlt".
//
// Was hier eingetragen wird, schreibt der Server zusaetzlich in den Verlauf
// der Akte (lib/whiteboard-routes.js). Das Feld blinkt dann kurz gruen.
//
// Grundsatz beim Speichern (seit 09.09.): Was der Server NICHT bestaetigt,
// darf nicht so aussehen, als waere es gespeichert.
(function () {
  "use strict";

  const daten = window.WB_DATEN || {};
  const LISTEN = ["kunden", "leads"];
  const WORT = { kunden: "Kunde", leads: "Lead" };
  const KLEMMT = "Nicht gespeichert — Verbindung prüfen und Seite neu laden.";
  const GRIFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
    + 'stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/>'
    + '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
  const ZIEHTYP = "application/x-wb-listenzeile";
  // Bezahlt ist eine Auswahl, kein Freitext (20.09.2026). Dieselben Werte
  // stehen im Server und als Pruefung in der Datenbank (Migration 0071).
  const BEZAHLT = [["", "—"], ["ganz", "ganz"], ["50%", "50 %"], ["nein", "nein"]];

  const mounts = {};
  document.querySelectorAll(".wb-liste-mount").forEach((m) => { mounts[m.dataset.liste] = m; });
  if (!mounts.kunden && !mounts.leads) return;

  const stand = {};
  for (const l of LISTEN) stand[l] = ((daten.listen || {})[l] || []).slice();
  let zieht = false;

  const post = (url, body) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ ok: false }));
  const holen = (url) => fetch(url, { headers: { Accept: "application/json" } })
    .then((r) => r.json()).catch(() => ({ ok: false }));

  function knoten(tag, klasse, text) {
    const k = document.createElement(tag);
    if (klasse) k.className = klasse;
    if (text !== undefined) k.textContent = text;
    return k;
  }

  // Kurze Rueckmeldung an der Tafel. Sie verschwindet von selbst wieder —
  // eine Meldung, die stehen bleibt, liest nach dem zweiten Mal niemand.
  function melden(liste, text) {
    const feld = mounts[liste] && mounts[liste].querySelector(".wb-liste-meldung");
    if (!feld) return;
    feld.textContent = text;
    feld.hidden = false;
    clearTimeout(feld.__timer);
    feld.__timer = setTimeout(() => { feld.hidden = true; }, 6000);
  }

  function inAkteBlinken(feld) {
    feld.classList.remove("in-akte");
    void feld.offsetWidth; // Animation neu starten, auch beim zweiten Mal
    feld.classList.add("in-akte");
  }

  function leerPruefen(liste) {
    const m = mounts[liste];
    if (!m) return;
    m.querySelector(".wb-liste-leer").hidden = m.querySelector(".wb-liste-zeilen").children.length > 0;
  }

  // ------------------------------------------------------------ Firmenwahl

  // Eine Zeile, die der Abgleich erzeugt hat (Migration 0077). Bei ihr stehen
  // Firma und Preis fest — sie kommen aus der Akte, und sie hier zu aendern
  // waere folgenlos: Der naechste Abgleich schriebe den alten Wert zurueck.
  const erzeugt = (z) => !!z.herkunft;

  function firmaZeigen(liste, z, zelle) {
    zelle.textContent = "";
    if (!z.firma_id) { waehlerZeigen(liste, z, zelle, false); return; }
    const link = knoten("a", "wb-liste-firmalink", z.firma_name || "—");
    link.href = "/crm/firma/" + encodeURIComponent(z.firma_id);
    link.title = "Akte öffnen";
    zelle.appendChild(link);
    if (erzeugt(z)) {
      const marke = knoten("span", "wb-liste-auto", "automatisch");
      marke.title = "Kommt aus dem CRM. Verschwindet, sobald der Posten bezahlt ist.";
      zelle.appendChild(marke);
      return;
    }
    const wechsel = knoten("button", "wb-liste-firmawechsel", "ändern");
    wechsel.type = "button";
    wechsel.setAttribute("aria-label", WORT[liste] + " ändern");
    wechsel.addEventListener("click", () => waehlerZeigen(liste, z, zelle, true));
    zelle.appendChild(wechsel);
  }

  function waehlerZeigen(liste, z, zelle, abbrechbar) {
    zelle.textContent = "";
    const suche = knoten("input", "wb-liste-suche");
    suche.type = "text";
    suche.placeholder = WORT[liste] + " wählen …";
    suche.autocomplete = "off";
    suche.setAttribute("role", "combobox");
    suche.setAttribute("aria-autocomplete", "list");
    suche.setAttribute("aria-expanded", "false");
    const vorschlaege = knoten("div", "wb-liste-vorschlaege");
    vorschlaege.setAttribute("role", "listbox");
    vorschlaege.hidden = true;
    zelle.append(suche, vorschlaege);
    // Wer das CRM nicht oeffnen darf, bekommt auch hier keine Kundennamen.
    if (daten.crmZugang === false) {
      suche.disabled = true;
      suche.placeholder = "Nur mit CRM-Zugang";
      return;
    }

    let treffer = [], markiert = -1, timer = null, anfrage = 0;

    const zurueck = () => { if (abbrechbar && z.firma_id) firmaZeigen(liste, z, zelle); };

    function zeigen() {
      vorschlaege.textContent = "";
      treffer.forEach((t, i) => {
        const b = knoten("button", "wb-liste-vorschlag" + (i === markiert ? " markiert" : ""));
        b.type = "button";
        b.setAttribute("role", "option");
        b.append(knoten("span", "", t.name));
        if (t.ort) b.append(knoten("small", "", t.ort));
        // Der Fokus bleibt im Suchfeld, sonst schliesst blur die Liste,
        // bevor der Klick ankommt.
        b.addEventListener("pointerdown", (ev) => ev.preventDefault());
        b.addEventListener("click", () => waehlen(t));
        vorschlaege.appendChild(b);
      });
      if (!treffer.length && suche.value.trim().length >= 2)
        vorschlaege.appendChild(knoten("div", "wb-liste-keintreffer", `Kein ${WORT[liste]} mit diesem Namen.`));
      vorschlaege.hidden = !vorschlaege.children.length;
      suche.setAttribute("aria-expanded", String(!vorschlaege.hidden));
    }

    async function laden() {
      const nr = ++anfrage;
      const q = encodeURIComponent(suche.value.trim());
      const r = await holen(`/api/whiteboard-liste/firmen?liste=${liste}&q=${q}`);
      if (nr !== anfrage) return; // eine spaetere Eingabe war schneller
      treffer = r.ok ? (r.treffer || []) : [];
      markiert = treffer.length ? 0 : -1;
      zeigen();
    }

    async function waehlen(t) {
      suche.disabled = true;
      vorschlaege.hidden = true;
      const r = await post("/api/whiteboard-liste/firma", { id: z.id, firma: t.id });
      if (!r.ok || !r.zeile) {
        suche.disabled = false;
        melden(liste, r.grund === "firma" ? `Das ist gerade kein ${WORT[liste]} — bitte neu wählen.` : KLEMMT);
        return;
      }
      Object.assign(z, r.zeile);
      firmaZeigen(liste, z, zelle);
      if (r.akte) inAkteBlinken(zelle);
    }

    suche.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(laden, 180); });
    suche.addEventListener("focus", laden);
    suche.addEventListener("blur", () => setTimeout(() => {
      if (document.activeElement === suche) return;
      vorschlaege.hidden = true;
      zurueck();
    }, 150));
    suche.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!treffer.length) return;
        ev.preventDefault();
        markiert = (markiert + (ev.key === "ArrowDown" ? 1 : -1) + treffer.length) % treffer.length;
        zeigen();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (treffer[markiert]) waehlen(treffer[markiert]);
      } else if (ev.key === "Escape") {
        vorschlaege.hidden = true;
        zurueck();
      }
    });
    if (abbrechbar) suche.focus();
  }

  // ------------------------------------------------------------ Zeilen

  function zeileBauen(liste, z) {
    const zeile = knoten("div", "wb-liste-zeile");
    zeile.dataset.id = z.id;

    const griff = knoten("span", "wb-liste-griff");
    griff.title = "Ziehen zum Verschieben";
    griff.innerHTML = GRIFF_SVG;
    const firma = knoten("div", "wb-liste-firma");
    zeile.append(griff, firma);
    firmaZeigen(liste, z, firma);

    // Ein Feld speichern — Textfelder und die Bezahlt-Auswahl gehen denselben Weg.
    const speichern = async (el, feld, wert) => {
      const r = await post("/api/whiteboard-liste/aendern", { id: z.id, feld, wert });
      el.classList.toggle("klemmt", !r.ok);
      if (!r.ok) { melden(liste, KLEMMT); return; }
      z[feld] = wert;
      // Voll bezahlt: Der Posten ist erledigt, die Zeile gehoert nicht mehr
      // auf die Arbeitsliste. Der Server raeumt sie beim naechsten Abgleich
      // weg — hier verschwindet sie sofort, sonst stuende sie noch 30 Sekunden
      // da und man haekchenzt womoeglich ein zweites Mal.
      if (r.erledigt) {
        zeile.remove();
        stand[liste] = stand[liste].filter((x) => x.id !== z.id);
        leerPruefen(liste);
        return;
      }
      if (r.akte) inAkteBlinken(el);
      else if (String(wert).trim() && !z.firma_id)
        melden(liste, `Noch kein ${WORT[liste]} gewählt — der Eintrag steht vorerst nur auf der Tafel.`);
    };

    for (const [feld, platzhalter] of [["notiz1", "Was steht an?"], ["preis", "z. B. 4.500 € + 250 €/Monat"]]) {
      // Der Preis einer erzeugten Zeile ist eine Anzeige, kein Feld. Ein
      // Eingabefeld, dessen Inhalt beim naechsten Auffrischen zurueckspringt,
      // waere schlimmer als gar keins.
      if (feld === "preis" && erzeugt(z)) {
        const anzeige = knoten("div", "wb-liste-feld wb-liste-preis wb-liste-fest", z.preis || "—");
        anzeige.title = "Kommt aus der Kundenakte";
        zeile.appendChild(anzeige);
        continue;
      }
      const eingabe = knoten("input", "wb-liste-feld wb-liste-" + feld);
      eingabe.value = z[feld] || "";
      eingabe.placeholder = platzhalter;
      eingabe.maxLength = 400;
      eingabe.addEventListener("keydown", (ev) => { if (ev.key === "Enter") eingabe.blur(); });
      eingabe.addEventListener("change", () => speichern(eingabe, feld, eingabe.value));
      zeile.appendChild(eingabe);
    }

    const bezahlt = knoten("select", "wb-liste-feld wb-liste-bezahlt");
    bezahlt.setAttribute("aria-label", "Bezahlt");
    if (z.herkunft === "lead") {
      // Ein Lead hat nichts bezahlt — er hat noch nichts gekauft.
      bezahlt.disabled = true;
      bezahlt.title = "Erst wenn aus dem Lead ein Kunde wird";
    } else if (erzeugt(z)) {
      bezahlt.title = "Wird in die Kundenakte übernommen. „Ganz“ nimmt die Zeile von der Tafel.";
    }
    for (const [wert, wort] of BEZAHLT) {
      const o = knoten("option", "", wort);
      o.value = wert;
      if ((z.bezahlt || "") === wert) o.selected = true;
      bezahlt.appendChild(o);
    }
    bezahlt.addEventListener("change", () => speichern(bezahlt, "bezahlt", bezahlt.value));
    zeile.appendChild(bezahlt);

    const weg = knoten("button", "wb-liste-loeschen", "✕");
    weg.type = "button";
    weg.setAttribute("aria-label", "Zeile löschen");
    if (erzeugt(z)) {
      // Weg waere sie nur bis zum naechsten Abgleich. Statt eines Knopfes, der
      // nichts bewirkt, steht hier nichts.
      weg.disabled = true;
      weg.title = "Verschwindet von selbst, sobald der Posten bezahlt ist";
    }
    weg.addEventListener("click", async () => {
      // Erst wegnehmen (fuehlt sich sofort an), aber den Platz merken: Sagt
      // der Server nein, steht die Zeile wieder da, wo sie war.
      const behaelter = zeile.parentElement;
      const nachbar = zeile.nextElementSibling;
      zeile.remove();
      leerPruefen(liste);
      const r = await post("/api/whiteboard-liste/loeschen", { id: z.id });
      if (r.ok) { stand[liste] = stand[liste].filter((x) => x.id !== z.id); return; }
      if (nachbar && nachbar.parentElement === behaelter) behaelter.insertBefore(zeile, nachbar);
      else behaelter.appendChild(zeile);
      leerPruefen(liste);
      melden(liste, "Zeile konnte nicht gelöscht werden.");
    });
    zeile.appendChild(weg);

    // Gezogen wird nur am Griff: In einem Textfeld markiert man Text, man
    // schiebt keine Zeile herum.
    griff.addEventListener("pointerdown", () => { zeile.draggable = true; });
    griff.addEventListener("pointerup", () => { if (!zieht) zeile.draggable = false; });
    zeile.addEventListener("dragstart", (ev) => {
      if (!zeile.draggable) { ev.preventDefault(); return; }
      zieht = true;
      // Eigener Typ statt text/plain: Faellt die Zeile neben der Liste auf die
      // Wand, soll dort kein Zettel mit einer uuid entstehen.
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        try { ev.dataTransfer.setData(ZIEHTYP, String(z.id)); } catch { /* alter Browser */ }
      }
      setTimeout(() => zeile.classList.add("zieht"), 0);
    });
    zeile.addEventListener("dragend", async () => {
      zeile.classList.remove("zieht");
      zeile.draggable = false;
      zieht = false;
      const behaelter = mounts[liste].querySelector(".wb-liste-zeilen");
      const ids = [...behaelter.children].map((k) => k.dataset.id);
      if (ids.join() === stand[liste].map((x) => String(x.id)).join()) return;
      stand[liste].sort((a, b) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)));
      const r = await post("/api/whiteboard-liste/sortieren", { liste, ids });
      if (!r.ok) melden(liste, "Reihenfolge nicht gespeichert.");
    });
    return zeile;
  }

  // ------------------------------------------------------------ Tafel

  function listeBauen(liste) {
    const m = mounts[liste];
    if (!m) return;
    m.textContent = "";

    const inhalt = knoten("div", "wb-liste-inhalt");
    const kopf = knoten("div", "wb-liste-kopfzeile");
    ["", WORT[liste], "Notiz", "Preis", "Bezahlt", ""].forEach((t) => kopf.appendChild(knoten("span", "", t)));
    const zeilen = knoten("div", "wb-liste-zeilen");
    zeilen.dataset.liste = liste;
    const leer = knoten("div", "wb-liste-leer", `Noch kein ${WORT[liste]} auf dieser Tafel — unten auf „+ Zeile".`);
    const fuss = knoten("div", "wb-liste-fuss");
    const add = knoten("button", "wb-liste-add", "+ Zeile");
    add.type = "button";
    const meldung = knoten("p", "wb-liste-meldung");
    meldung.setAttribute("role", "status");
    meldung.setAttribute("aria-live", "polite");
    meldung.hidden = true;
    fuss.append(add, meldung);
    inhalt.append(kopf, zeilen, leer, fuss);
    m.appendChild(inhalt);

    stand[liste].forEach((z) => zeilen.appendChild(zeileBauen(liste, z)));
    leerPruefen(liste);

    // Die Wand gehoert Zoom, Pan und Stift. In der Liste wird getippt,
    // gewaehlt und sortiert — dort darf kein Druck auf die Flaeche durchgehen.
    inhalt.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    // In einer vollen Liste scrollt das Mausrad die Liste, nicht den Zoom.
    zeilen.addEventListener("wheel", (ev) => {
      if (zeilen.scrollHeight > zeilen.clientHeight) ev.stopPropagation();
    }, { passive: true });

    add.addEventListener("click", async () => {
      add.disabled = true;
      const r = await post("/api/whiteboard-liste/anlegen", { liste });
      add.disabled = false;
      // Die id kommt vom Server: Ohne sie gibt es nichts zu tippen, was
      // irgendwo ankaeme — dann lieber gar keine Zeile.
      if (!r.ok || !r.zeile) { melden(liste, "Zeile konnte nicht angelegt werden."); return; }
      stand[liste].push(r.zeile);
      const zeile = zeileBauen(liste, r.zeile);
      zeilen.appendChild(zeile);
      leerPruefen(liste);
      zeilen.scrollTop = zeilen.scrollHeight;
      const suche = zeile.querySelector(".wb-liste-suche");
      if (suche) suche.focus();
    });

    zeilen.addEventListener("dragover", (ev) => {
      const gezogen = zeilen.querySelector(".wb-liste-zeile.zieht");
      if (!gezogen) return; // fremdes Ziehgut geht uns nichts an
      ev.preventDefault();
      const davor = [...zeilen.querySelectorAll(".wb-liste-zeile:not(.zieht)")].find((k) => {
        const r = k.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      }) || null;
      if (davor) zeilen.insertBefore(gezogen, davor);
      else if (gezogen.nextElementSibling) zeilen.appendChild(gezogen);
    });
    zeilen.addEventListener("drop", (ev) => {
      if (zeilen.querySelector(".wb-liste-zeile.zieht")) ev.preventDefault();
    });
  }

  LISTEN.forEach(listeBauen);

  // ------------------------------------------------------------ Nachziehen
  //
  // Die Tafeln teilt sich das Team. Alle 20 Sekunden wird nachgesehen, ob
  // jemand anderes etwas geaendert hat — aber nie mitten im Tippen oder
  // Ziehen: Wer gerade schreibt, dem wird die Zeile nicht unter den Fingern
  // neu gebaut.
  const tippt = () => {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest(".wb-liste-inhalt"));
  };
  let takt = null;
  async function auffrischen() {
    if (document.hidden || zieht || tippt()) return;
    const r = await holen("/api/whiteboard-liste/zeilen");
    if (r && r.anmeldung) { clearInterval(takt); return; }
    if (!r || !r.ok || !r.listen || document.hidden || zieht || tippt()) return;
    for (const l of LISTEN) {
      const neu = r.listen[l] || [];
      if (JSON.stringify(neu) === JSON.stringify(stand[l])) continue;
      stand[l] = neu;
      listeBauen(l);
    }
  }
  takt = setInterval(auffrischen, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) auffrischen(); });
})();
